// N-4: 실제 GET·requireAppAdmin·JWT·DB 조회 함수를 실행한다.
// pg/스토리지/통신은 로드하지 않고, 허용한 SELECT만 모의 풀에서 실행한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import * as appJwt from "./app-jwt";
import type * as appAdmin from "./app-admin-auth";
import type { findUserByUsername, listOwnedAppMediaOperationIds } from "./db";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const ast = ts.createSourceFile("db.ts", read("lib/db.ts"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["q", "findUserByUsername", "listOwnedAppMediaOperationIds"];
const functions = ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
assert.equal(functions.length, names.length, "실제 DB 함수 추출 누락");
const dbSource = functions.map((node) => node.getText(ast)).join("\n");
const compiled = new Map<string, string>();
function execute<T>(source: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  if (!compiled.has(source)) compiled.set(source, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const module = { exports: {} };
  runInNewContext(compiled.get(source)!, {
    module, exports: module.exports, URL,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `실 DB/스토리지/통신 의존성 금지: ${name}`);
      return imports[name];
    },
    console: { warn: () => {} }, ...globals,
  });
  return module.exports as T;
}

const savedSecret = process.env.APP_JWT_SECRET;
before(() => { process.env.APP_JWT_SECRET = "operation-status-fixture-not-a-credential"; });
after(() => {
  if (savedSecret === undefined) delete process.env.APP_JWT_SECRET;
  else process.env.APP_JWT_SECRET = savedSecret;
});
function token(workerId: string | null = "EMP-fixture", role = "admin") {
  return appJwt.signMobileAccessJwt({
    sub: "fixture-login", role, name: "검증 담당관", workerId,
    sessionId: "11111111-2222-3333-4444-555555555555",
  });
}
function request(ids: string[], jwt: string | null = token(), extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  for (const id of ids) params.append("clientOperationId", id);
  return new Request(`https://fixture.test/api/app/admin/operation-status?${params}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
}

type Kind = "photo" | "ink" | "voice" | "text";
type Media = {
  id: string; client_operation_id: string; worker_id: string | null; media_type: string;
  annotation_of: string | null; storage_key: string;
};
type Comment = {
  id: string; client_operation_id: string; author_id: string | null; media_id: string; audio_storage_key: string | null;
};
type User = { username: string; role: string; status: string; admin_access: boolean };
const internalError = "postgres://private-db:5432 calendar-media/private/key.m4a /private/server/path";
function harness() {
  const state = {
    user: { username: "fixture-login", role: "admin", status: "approved", admin_access: true } as User | null,
    media: [] as Media[], comments: [] as Comment[],
    queries: [] as { sql: string; params: unknown[] }[],
    schemaAttempts: 0,
    fail: null as "users" | "operations" | null,
  };
  const query = async (text: string, params: unknown[]) => {
    const sql = text.replace(/\s+/g, " ").trim();
    state.queries.push({ sql, params: structuredClone(params) });
    // 아래 SELECT만 허용한다. DDL·DML·트랜잭션·부수 효과 함수도 금지한다.
    if (sql === "SELECT * FROM users WHERE username = $1") {
      if (state.fail === "users") throw new Error(internalError);
      return { rows: state.user?.username === params[0] ? [structuredClone(state.user)] : [] };
    }
    assert.equal(sql,
      "SELECT client_operation_id, id FROM calendar_media WHERE client_operation_id = ANY($1::text[]) AND worker_id = $2 " +
      "UNION ALL SELECT client_operation_id, id FROM calendar_media_comment WHERE client_operation_id = ANY($1::text[]) AND author_id = $3",
      "허용된 소유자 범위 SELECT만 실행한다");
    if (state.fail === "operations") throw new Error(internalError);
    const [ids, workerId, username] = params as [string[], string | null, string];
    const media = state.media.filter((row) => ids.includes(row.client_operation_id) &&
      workerId !== null && row.worker_id === workerId);
    const comments = state.comments.filter((row) => ids.includes(row.client_operation_id) && row.author_id === username);
    return { rows: [...media, ...comments].map(({ client_operation_id, id }) => ({ client_operation_id, id })) };
  };
  const db = execute<{
    findUserByUsername: typeof findUserByUsername;
    listOwnedAppMediaOperationIds: typeof listOwnedAppMediaOperationIds;
  }>(dbSource, {}, {
    getPool: () => ({ query }),
    ensureSchema: async () => { state.schemaAttempts++; throw new Error("조회 GET에서 스키마 초기화 금지"); },
  });
  const gate = execute<typeof appAdmin>(read("lib/app-admin-auth.ts"), {
    "./app-jwt": appJwt, "./db": db,
  });
  const route = execute<{ GET(request: Request): Promise<Response> }>(
    read("app/api/app/admin/operation-status/route.ts"), {
      "next/server": { NextResponse },
      "../../../../../lib/app-admin-auth": gate, "../../../../../lib/db": db,
    });
  function seed(kind: Kind, id: string, own = true) {
    if (kind === "voice" || kind === "text") {
      state.comments.push({ id: `server-${id}`, client_operation_id: id, author_id: own ? "fixture-login" : "other-login",
        media_id: "original-photo", audio_storage_key: kind === "voice" ? "calendar-media/private/key.m4a" : null });
    } else {
      state.media.push({ id: `server-${id}`, client_operation_id: id, worker_id: own ? "EMP-fixture" : "EMP-other",
        media_type: kind === "ink" ? "ink" : "image", annotation_of: kind === "ink" ? "original-photo" : null,
        storage_key: "calendar-media/private/key.jpg" });
    }
  }
  return { ...route, state, seed, db };
}
function body(ids: string[], registered: string[] = []) {
  return { ok: true, operations: ids.map((clientOperationId) => registered.includes(clientOperationId)
    ? { clientOperationId, status: "registered", id: `server-${clientOperationId}` }
    : { clientOperationId, status: "not_registered" }) };
}

test("인증 없으면 질의 검증보다 먼저 401, 권한·작업 DB 조회도 0회다", async () => {
  const h = harness();
  const response = await h.GET(request([], null));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized", action: "reauth" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(h.state.queries.length, 0);
  assert.equal(h.state.schemaAttempts, 0);
});

test("레거시 앱 토큰·잘못된 토큰은 401이고 DB에 접근하지 않는다", async () => {
  const legacy = appJwt.signAppJwt({ sub: "fixture-login", role: "owner", name: null, workerId: "EMP-fixture" });
  for (const jwt of [legacy, "invalid-token"]) {
    const h = harness();
    assert.equal((await h.GET(request(["id"], jwt))).status, 401);
    assert.equal(h.state.queries.length, 0);
  }
});

for (const change of ["revoked", "rejected", "missing"] as const) {
  test(`현재 계정 ${change}: 살아 있는 권한이 없으면 게이트가 403으로 막는다`, async () => {
    const h = harness();
    if (change === "revoked") h.state.user!.admin_access = false;
    if (change === "rejected") h.state.user!.status = "rejected";
    if (change === "missing") h.state.user = null;
    const response = await h.GET(request(["id"], token("EMP-fixture", change === "missing" ? "admin" : "owner")));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { ok: false, error: "forbidden" });
    assert.equal(h.state.queries.length, 1);
    assert.equal(h.state.schemaAttempts, 0);
  });
}

for (const kind of ["photo", "ink", "voice", "text"] as const) {
  test(`${kind}: 내 작업은 등록됨·행 ID만 반환하고 저장 키·경로·전체 행은 반환하지 않는다`, async () => {
    const h = harness();
    h.seed(kind, "own-operation");
    const response = await h.GET(request(["own-operation"]));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body(["own-operation"], ["own-operation"]));
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  test(`${kind}: 타인 ID와 없는 ID는 같은 요청에 상태·본문·헤더가 완전히 같다`, async () => {
    const h = harness();
    h.seed(kind, "hidden-operation", false);
    const hidden = await h.GET(request(["hidden-operation"]));
    h.state.media = [];
    h.state.comments = [];
    const missing = await h.GET(request(["hidden-operation"]));
    assert.equal(hidden.status, 200);
    assert.equal(hidden.status, missing.status);
    assert.deepEqual([...hidden.headers], [...missing.headers]);
    assert.equal(await hidden.text(), await missing.text());
  });

  test(`${kind}: 없는 ID는 200 미등록이고 owner도 타인 작업을 조회하지 못한다`, async () => {
    const h = harness();
    h.state.user!.role = "owner";
    h.seed(kind, "other-operation", false);
    h.seed(kind, "own-operation");
    const response = await h.GET(request(["missing", "other-operation", "own-operation"], token("EMP-fixture", "owner")));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body(["missing", "other-operation", "own-operation"], ["own-operation"]));
  });

  test(`${kind}: GET 반복은 SELECT만 실행하고 행·스키마·스토리지에 쓰지 않는다`, async () => {
    const h = harness();
    h.seed(kind, "own-operation");
    const beforeRows = structuredClone({ media: h.state.media, comments: h.state.comments });
    for (let i = 0; i < 2; i++) {
      const response = await h.GET(request(["own-operation", "missing"]));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), body(["own-operation", "missing"], ["own-operation"]));
    }
    assert.deepEqual({ media: h.state.media, comments: h.state.comments }, beforeRows);
    assert.equal(h.state.schemaAttempts, 0, "권한 조회에서도 ensureSchema를 호출하면 안 된다");
    assert.equal(h.state.queries.length, 4, "각 GET은 권한 SELECT 1회 + 작업 SELECT 1회뿐이다");
    assert.ok(h.state.queries.every(({ sql }) => sql.startsWith("SELECT ")));
  });
}

test("혼합 목록은 입력 순서를 유지하며 반복 ID는 한 번 반환하고 DB 조회는 한 번이다", async () => {
  const h = harness();
  h.seed("photo", "photo"); h.seed("ink", "ink"); h.seed("voice", "voice"); h.seed("voice", "hidden", false);
  const response = await h.GET(request(["voice", "missing", "photo", "hidden", "ink", "photo"]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body(["voice", "missing", "photo", "hidden", "ink"], ["photo", "ink", "voice"]));
  assert.equal(h.state.queries.length, 2);
  assert.deepEqual(h.state.queries[1]!.params, [["voice", "missing", "photo", "hidden", "ink"], "EMP-fixture", "fixture-login"]);
});

test("동일 ID가 양쪽 테이블에 있어도 자기 행만으로 판정하고 결과는 하나다", async () => {
  const h = harness();
  h.seed("photo", "shared-id", false);
  h.seed("voice", "shared-id");
  h.state.media[0]!.id = "hidden-photo-row";
  h.state.comments[0]!.id = "owned-comment-row";
  assert.deepEqual(await (await h.GET(request(["shared-id"]))).json(), {
    ok: true, operations: [{ clientOperationId: "shared-id", status: "registered", id: "owned-comment-row" }],
  });
  h.state.comments[0]!.author_id = "other-login";
  assert.deepEqual(await (await h.GET(request(["shared-id"]))).json(), body(["shared-id"]));
});

test("등록된 사진·잉크·음성·텍스트는 실제 행 ID와 일치하고 미등록·타인 작업에는 ID가 없다", async () => {
  const h = harness();
  h.seed("photo", "photo-operation"); h.seed("ink", "ink-operation");
  h.seed("voice", "voice-operation"); h.seed("text", "text-operation");
  h.seed("text", "hidden-operation", false);
  h.state.media[0]!.id = "actual-photo-row";
  h.state.media[1]!.id = "actual-ink-row";
  h.state.comments[0]!.id = "actual-voice-row";
  h.state.comments[1]!.id = "actual-text-row";
  const response = await h.GET(request([
    "photo-operation", "ink-operation", "voice-operation", "text-operation", "missing", "hidden-operation",
  ]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    operations: [
      { clientOperationId: "photo-operation", status: "registered", id: h.state.media[0]!.id },
      { clientOperationId: "ink-operation", status: "registered", id: h.state.media[1]!.id },
      { clientOperationId: "voice-operation", status: "registered", id: h.state.comments[0]!.id },
      { clientOperationId: "text-operation", status: "registered", id: h.state.comments[1]!.id },
      { clientOperationId: "missing", status: "not_registered" },
      { clientOperationId: "hidden-operation", status: "not_registered" },
    ],
  });
  assert.equal(h.state.schemaAttempts, 0);
});

test("사번 없는 계정은 NULL·다른 사번 미디어를 못 보지만 자기 음성은 조회한다", async () => {
  for (const workerId of [null, ""]) {
    const h = harness();
    h.seed("photo", "null-photo"); h.state.media[0]!.worker_id = null;
    h.seed("ink", "other-ink", false); h.seed("voice", "own-voice");
    const response = await h.GET(request(["null-photo", "other-ink", "own-voice"], token(workerId)));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body(["null-photo", "other-ink", "own-voice"], ["own-voice"]));
  }
});

test("쿼리로 위조한 workerId·username·role은 소유권 범위에 사용하지 않는다", async () => {
  const h = harness();
  h.seed("photo", "other-photo", false); h.seed("voice", "other-voice", false);
  const response = await h.GET(request(["other-photo", "other-voice"], token(), {
    workerId: "EMP-other", username: "other-login", role: "owner",
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body(["other-photo", "other-voice"]));
  assert.deepEqual(h.state.queries[1]!.params.slice(1), ["EMP-fixture", "fixture-login"]);
});

test("음성 소유자는 원본 사진 소유자·사번이 아니라 댓글 author_id다", async () => {
  const h = harness();
  h.seed("photo", "original-photo");
  h.seed("voice", "others-comment", false);
  h.seed("voice", "worker-id-comment"); h.state.comments[1]!.author_id = "EMP-fixture";
  h.seed("voice", "own-comment"); h.state.comments[2]!.media_id = "someone-elses-photo";
  const response = await h.GET(request(["others-comment", "worker-id-comment", "own-comment"]));
  assert.deepEqual(await response.json(), body(["others-comment", "worker-id-comment", "own-comment"], ["own-comment"]));
});

test("DB 행 없는 bootstrap owner도 타인 조회 예외가 없다", async () => {
  const h = harness(); h.state.user = null;
  h.seed("photo", "other", false); h.seed("voice", "own");
  const response = await h.GET(request(["other", "own"], token("EMP-fixture", "owner")));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body(["other", "own"], ["own"]));
});

for (const [label, ids] of [
  ["누락", []], ["빈 값", [""]], ["공백", [" "]], ["앞뒤 공백", [" id "]],
  ["129자", ["x".repeat(129)]], ["51개", Array.from({ length: 51 }, (_, i) => `id-${i}`)],
  ["반복해도 51개", Array.from({ length: 51 }, () => "id")], ["일부만 유효", ["valid", ""]],
] as const) {
  test(`잘못된 질의(${label})는 400이고 작업 조회를 실행하지 않는다`, async () => {
    const h = harness();
    const response = await h.GET(request([...ids]));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      ok: false, error: "clientOperationId는 앞뒤 공백 없는 1~128자 문자열로 1~50개 보내야 합니다",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(h.state.queries.length, 1);
    assert.equal(h.state.schemaAttempts, 0);
  });
}

test("50개·128자·UUID·예약 문자가 포함된 기존 작업 ID를 변형 없이 조회한다", async () => {
  const h = harness();
  const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
  ids[0] = "x".repeat(128); ids[1] = "6a430471-65f2-4f67-897c-8bbefc980cab";
  ids[2] = "한글/+?&=%,id"; ids[3] = "x' OR 1=1 --";
  ids.forEach((id) => h.seed("photo", id));
  const response = await h.GET(request(ids));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), body(ids, ids));
  assert.deepEqual(h.state.queries[1]!.params[0], ids);
});

for (const failure of ["users", "operations"] as const) {
  test(`${failure} DB 장애는 고정 문구 503이며 미등록으로 오인하거나 내부 오류를 노출하지 않는다`, async () => {
    const h = harness(); h.state.fail = failure;
    const response = await h.GET(request(["id"]));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false, error: failure === "users" ? "권한 확인 실패" : "작업 상태 조회 실패",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(h.state.schemaAttempts, 0);
    assert.equal(h.state.queries.length, failure === "users" ? 1 : 2);
  });
}
