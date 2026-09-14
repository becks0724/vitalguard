// 실제 라우트·DB 함수 원문을 실행한다. DB·스토리지만 대체해 라이브 기록은 건드리지 않는다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import type { CalendarMediaListRow, CalendarMediaRow, DeleteCalendarMediaResult, insertCalendarMedia } from "./db";
import * as mediaScope from "./media-scope";

const ROOT = join(import.meta.dirname, "..");
const UPLOAD = "app/api/app-media/route.ts";
const CALENDAR = "app/api/calendar/media/route.ts";
const compiled = new Map<string, string>();
function execute<T>(source: string, globals: Record<string, unknown>): T {
  let code = compiled.get(source);
  if (!code) {
    code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    compiled.set(source, code);
  }
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, ...globals });
  return module.exports as T;
}

type Routes = { POST(request: Request): Promise<Response>; DELETE(request: Request): Promise<Response>; GET(request: Request): Promise<Response> };
function routes(path: typeof UPLOAD | typeof CALENDAR) {
  const state = {
    auth: "jwt" as "jwt" | "shared" | "none",
    role: "worker",
    jwtWorkerId: "fixture-worker" as string | null,
    original: { id: "original-id", annotation_of: null, worker_id: "fixture-worker" } as
      Pick<CalendarMediaRow, "id" | "annotation_of" | "worker_id"> | null,
    lookups: [] as string[],
    aliasLookups: 0,
    storageOn: true,
    puts: [] as { key: string; bytes: Uint8Array; contentType: string }[],
    inserts: [] as Parameters<typeof insertCalendarMedia>[0][],
    deletes: [] as string[],
    scopes: [] as mediaScope.MediaScope[],
    result: { status: "deleted", files: [] } as DeleteCalendarMediaResult,
    media: [] as CalendarMediaListRow[],
    deleteFailure: null as string | null,
    putFailure: false,
    warnings: 0,
  };
  const db = {
    MEDIA_DELETE_WINDOW_MIN: 10,
    getCalendarMediaById: async (id: string) => {
      state.lookups.push(id);
      return state.original?.id === id ? state.original : null;
    },
    insertCalendarMedia: async (input: Parameters<typeof insertCalendarMedia>[0]) => {
      state.inserts.push(input);
      return input;
    },
    deleteCalendarMedia: async (_id: string, scope: mediaScope.MediaScope) => {
      state.scopes.push(scope);
      return state.result;
    },
    getWorkerAliasMap: async () => {
      state.aliasLookups++;
      return { "fixture-alias": "fixture-worker" };
    },
    findUserByUsername: async () => null,
    listCalendarMedia: async () => state.media,
    listCommentsForMedia: async () => [],
  };
  const imports: Record<string, unknown> = {
    "next/server": { NextResponse },
    [path === UPLOAD ? "../../../lib/db" : "../../../../lib/db"]: db,
    [path === UPLOAD ? "../../../lib/admin-auth" : "../../../../lib/admin-auth"]: {
      verifyAppUploadToken: () => state.auth === "shared",
      appUploadTokenMatches: () => false,
      verifyBasicAuth: () => false,
      getSession: () => null,
    },
    [path === UPLOAD ? "../../../lib/app-jwt" : "../../../../lib/app-jwt"]: {
      bearerToken: () => null,
      verifyAppJwt: () => state.auth === "jwt" ? {
        role: state.role, workerId: state.jwtWorkerId, name: "검증 작업자",
      } : null,
      diagnoseAppAuth: () => ({ action: "login", logLine: "검증용 인증 실패" }),
    },
    [path === UPLOAD ? "../../../lib/storage" : "../../../../lib/storage"]: {
      isStorageConfigured: () => state.storageOn,
      putObject: async (key: string, bytes: Uint8Array, contentType: string) => {
        if (state.putFailure) throw new Error("검증용 업로드 실패");
        state.puts.push({ key, bytes, contentType });
      },
      deleteObject: async (key: string) => {
        state.deletes.push(key);
        if (key === state.deleteFailure) throw new Error("검증용 삭제 실패");
      },
      presignDownload: async (key: string) => `https://fixture.test/${key}`,
    },
    [path === UPLOAD ? "../../../lib/media-scope" : "../../../../lib/media-scope"]: mediaScope,
  };
  const route = execute<Routes>(readFileSync(join(ROOT, path), "utf8"), {
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `미허용 의존성: ${name}`);
      return imports[name];
    },
    console: { warn: () => state.warnings++, error: () => {} },
    URL, crypto, Uint8Array,
  });
  return { ...route, state };
}

function upload(body = '{"v":1}', options: {
  filename?: string; type?: string; fields?: Record<string, string>; parentField?: string | null;
} = {}) {
  const form = new FormData();
  form.set("file", new Blob([body], { type: options.type ?? "application/json" }), options.filename ?? "ink.json");
  if (options.parentField !== null) form.set(options.parentField ?? "annotationOf", " original-id ");
  form.set("dateKey", "2026-09-13");
  for (const [key, value] of Object.entries(options.fields ?? {})) form.set(key, value);
  return new Request("https://fixture.test/api/app-media", { method: "POST", body: form });
}

async function expectInkDenied(h: ReturnType<typeof routes>, status: number, error: string, fields?: Record<string, string>) {
  const response = await h.POST(upload(undefined, { fields }));
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { ok: false, error });
  assert.deepEqual(h.state.lookups, ["original-id"]);
  assert.equal(h.state.puts.length, 0, "거부한 잉크를 스토리지에 저장하면 안 된다");
  assert.equal(h.state.inserts.length, 0, "거부한 잉크를 DB에 등록하면 안 된다");
}

test("잉크 원본이 없으면 소유권 판정 전에 404로 거부한다(owner·공유 토큰도 동일)", async () => {
  for (const identity of ["worker", "owner", "shared"]) {
    const h = routes(UPLOAD);
    h.state.original = null;
    if (identity === "shared") h.state.auth = "shared";
    else h.state.role = identity;
    await expectInkDenied(h, 404, "잉크본을 연결할 원본을 찾을 수 없습니다");
    assert.equal(h.state.aliasLookups, 0);
  }
});

test("잉크본을 원본으로 지정하면 소유권 판정 전에 400으로 거부한다(owner·공유 토큰도 동일)", async () => {
  for (const identity of ["worker", "owner", "shared"]) {
    const h = routes(UPLOAD);
    h.state.original = { id: "original-id", annotation_of: "parent-id", worker_id: "other-worker" };
    if (identity === "shared") h.state.auth = "shared";
    else h.state.role = identity;
    await expectInkDenied(h, 400, "잉크본을 원본으로 지정할 수 없습니다");
    assert.equal(h.state.aliasLookups, 0);
  }
});

for (const role of ["worker", "admin"]) {
  test(`다른 담당관의 원본은 ${role}도 403이며 폼 사번·이름·역할 위조로 통과하지 못한다`, async () => {
    const h = routes(UPLOAD);
    h.state.role = role;
    h.state.original!.worker_id = "other-worker";
    await expectInkDenied(h, 403, "본인이 올린 원본에만 잉크본을 추가할 수 있습니다", {
      workerId: "other-worker", worker_id: "other-worker", uploader: "검증 작업자", role: "owner",
    });
  });
}

test("본인 원본은 JWT 사번으로 확인한 뒤 잉크본을 저장한다", async () => {
  const h = routes(UPLOAD);
  const response = await h.POST(upload(undefined, { fields: { workerId: "위조" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(h.state.lookups, ["original-id"]);
  assert.equal(h.state.puts.length, 1);
  assert.equal(h.state.inserts.length, 1);
  assert.equal(h.state.inserts[0]?.annotationOf, "original-id");
  assert.equal(h.state.inserts[0]?.workerId, "fixture-worker");
});

test("병합된 사번은 기존 미디어 규칙처럼 양방향으로 본인 원본으로 인정한다", async () => {
  for (const [jwtId, originalId] of [["fixture-worker", "fixture-alias"], ["fixture-alias", "fixture-worker"]]) {
    const h = routes(UPLOAD);
    h.state.jwtWorkerId = ` ${jwtId} `;
    h.state.original!.worker_id = originalId!;
    assert.equal((await h.POST(upload())).status, 200);
    assert.deepEqual(h.state.lookups, ["original-id"]);
    assert.equal(h.state.aliasLookups, 1);
    assert.equal(h.state.inserts.length, 1);
  }
});

test("owner는 기존 moderator 규칙에 따라 다른 사람·사번 없는 원본도 허용한다", async () => {
  for (const workerId of ["other-worker", null]) {
    const h = routes(UPLOAD);
    h.state.role = "owner";
    h.state.jwtWorkerId = null;
    h.state.original!.worker_id = workerId;
    assert.equal((await h.POST(upload())).status, 200);
    assert.deepEqual(h.state.lookups, ["original-id"]);
    assert.equal(h.state.aliasLookups, 0);
    assert.equal(h.state.inserts.length, 1);
  }
});

test("공유 업로드 토큰은 폼에 본인 사번·owner 역할을 보내도 잉크본 권한을 얻지 못한다", async () => {
  const h = routes(UPLOAD);
  h.state.auth = "shared";
  await expectInkDenied(h, 403, "본인이 올린 원본에만 잉크본을 추가할 수 있습니다", {
    workerId: "fixture-worker", uploader: "검증 작업자", role: "owner",
  });
  assert.equal(h.state.aliasLookups, 0);
});

test("JWT 사번이 없거나 공백인 담당관은 폼 사번으로 잉크본 소유권을 대신하지 못한다", async () => {
  for (const workerId of [null, "", "  "]) {
    const h = routes(UPLOAD);
    h.state.role = "admin";
    h.state.jwtWorkerId = workerId;
    await expectInkDenied(h, 403, "본인이 올린 원본에만 잉크본을 추가할 수 있습니다", { workerId: "fixture-worker" });
    assert.equal(h.state.aliasLookups, 0);
  }
});

test("원본 사번이 없으면 owner 외에는 잉크본을 추가할 수 없다", async () => {
  const h = routes(UPLOAD);
  h.state.original!.worker_id = null;
  await expectInkDenied(h, 403, "본인이 올린 원본에만 잉크본을 추가할 수 있습니다");
});

test("잉크 JSON 원문과 정수 버전·원본 연결을 보존하고 JWT 신원을 사용한다", async () => {
  const h = routes(UPLOAD);
  const body = '{ "v": 1, "앱전용": {"미지의형식": true}, "strokes": [] }\n';
  const response = await h.POST(upload(body, { fields: { workerId: "위조", uploader: "위조" } }));
  assert.equal(response.status, 200);
  assert.equal(h.state.inserts[0]?.mediaType, "ink");
  assert.equal(h.state.inserts[0]?.annotationOf, "original-id");
  assert.equal(h.state.inserts[0]?.workerId, "fixture-worker");
  assert.equal(h.state.inserts[0]?.uploader, "검증 작업자");
  assert.equal(h.state.puts[0]?.contentType, "application/json");
  assert.equal(new TextDecoder().decode(h.state.puts[0]?.bytes), body);
  assert.match(h.state.puts[0]!.key, /^calendar-media\/2026-09-13\/.+\.json$/);
});

for (const field of ["annotationOf", "annotation_of", "annotationOfId", "annotation_of_id"]) {
  test(`원본 연결 필드 변형 ${field}를 수용한다`, async () => {
    const h = routes(UPLOAD);
    assert.equal((await h.POST(upload(undefined, { parentField: field }))).status, 200);
    assert.equal(h.state.inserts[0]?.annotationOf, "original-id");
    assert.deepEqual(h.state.lookups, ["original-id"]);
  });
}

test("타입이 없는 대문자 JSON 확장자도 잉크로 판정한다", async () => {
  const h = routes(UPLOAD);
  assert.equal((await h.POST(upload(undefined, { type: "", filename: "INK.JSON" }))).status, 200);
  assert.equal(h.state.inserts[0]?.mediaType, "ink");
});

for (const body of ['{', '{}', 'null', '[]', '1', '"문자열"', '{"v":"1"}', '{"v":1.5}', '{"v":null}', '{"nested":{"v":1}}']) {
  test(`유효한 JSON·최상위 정수 버전 조건을 만족하지 않으면 400: ${body}`, async () => {
    const h = routes(UPLOAD);
    assert.equal((await h.POST(upload(body))).status, 400);
    assert.equal(h.state.puts.length, 0);
    assert.equal(h.state.inserts.length, 0);
  });
}

test("형식 버전을 1로 제한하거나 앱의 획 규격을 검사하지 않는다", async () => {
  const h = routes(UPLOAD);
  for (const v of [0, -1, 2]) assert.equal((await h.POST(upload(JSON.stringify({ v })))).status, 200);
});

test("잉크 원본 연결 누락·공백은 400이며 저장하지 않는다", async () => {
  const variants: Record<string, string>[] = [{}, { annotationOf: "  " }];
  for (const fields of variants) {
    const h = routes(UPLOAD);
    assert.equal((await h.POST(upload(undefined, { parentField: null, fields }))).status, 400);
    assert.equal(h.state.puts.length, 0);
    assert.equal(h.state.inserts.length, 0);
  }
});

test("2MB까지 허용하고 1바이트 초과는 파싱·저장 전에 413으로 거부한다", async () => {
  const prefix = '{"v":1,"data":"';
  const body = prefix + "a".repeat(2 * 1024 * 1024 - prefix.length - 2) + '"}';
  const h = routes(UPLOAD);
  assert.equal((await h.POST(upload(body))).status, 200);
  assert.equal(h.state.puts[0]?.bytes.byteLength, 2 * 1024 * 1024);
  assert.equal((await h.POST(upload(body + "a"))).status, 413);
  assert.equal(h.state.puts.length, 1);
  assert.equal(h.state.inserts.length, 1);
});

test("크기는 글자 수가 아닌 UTF-8 바이트 수로 제한한다", async () => {
  const h = routes(UPLOAD);
  const body = JSON.stringify({ v: 1, data: "가".repeat(750_000) });
  assert.ok(body.length < 2 * 1024 * 1024);
  assert.equal((await h.POST(upload(body))).status, 413);
  assert.equal(h.state.puts.length, 0);
});

test("재편집·같은 내용 재전송도 서로 다른 행과 객체로 보존한다", async () => {
  const h = routes(UPLOAD);
  for (let i = 0; i < 2; i++) assert.equal((await h.POST(upload())).status, 200);
  assert.equal(h.state.inserts.length, 2);
  assert.notEqual(h.state.inserts[0]?.id, h.state.inserts[1]?.id);
  assert.notEqual(h.state.puts[0]?.key, h.state.puts[1]?.key);
});

test("사진·영상은 원본 조회 없이 기존 분류와 JWT·공유 토큰 인증을 유지한다", async () => {
  for (const auth of ["jwt", "shared"] as const) {
    for (const [type, filename, expected] of [
      ["image/jpeg", "photo.jpg", "image"], ["video/mp4", "video.mp4", "video"],
    ]) {
      const h = routes(UPLOAD);
      h.state.auth = auth;
      h.state.original = null;
      const fields = { workerId: "form-worker", uploader: "폼 업로더" };
      assert.equal((await h.POST(upload("fixture", { type, filename, parentField: null, fields }))).status, 200);
      assert.equal(h.state.puts.length, 1);
      assert.equal(h.state.inserts.length, 1);
      assert.equal(h.state.inserts[0]?.mediaType, expected);
      assert.equal(h.state.inserts[0]?.annotationOf, undefined);
      assert.equal(h.state.inserts[0]?.workerId, auth === "jwt" ? "fixture-worker" : "form-worker");
      assert.equal(h.state.inserts[0]?.uploader, auth === "jwt" ? "검증 작업자" : "폼 업로더");
      assert.equal(new TextDecoder().decode(h.state.puts[0]?.bytes), "fixture");
      assert.deepEqual(h.state.lookups, []);
      assert.equal(h.state.aliasLookups, 0);
    }
  }
});

test("인증 실패·스토리지 미설정·업로드 실패 때 DB를 등록하지 않는다", async () => {
  for (const mode of ["auth", "config", "put"] as const) {
    const h = routes(UPLOAD);
    if (mode === "auth") h.state.auth = "none";
    if (mode === "config") h.state.storageOn = false;
    if (mode === "put") h.state.putFailure = true;
    assert.equal((await h.POST(upload())).status, { auth: 401, config: 503, put: 502 }[mode]);
    assert.equal(h.state.inserts.length, 0);
  }
});

function deletion() { return new Request("https://fixture.test/api/calendar/media?id=original-id", { method: "DELETE" }); }

test("삭제 유예 경과 403과 없음 404를 구분하고 파일은 건드리지 않는다", async () => {
  for (const status of ["not_found", "delete_window_expired"] as const) {
    const h = routes(CALENDAR);
    h.state.result = { status };
    const response = await h.DELETE(deletion());
    assert.equal(response.status, status === "not_found" ? 404 : 403);
    const body = await response.json();
    if (status === "delete_window_expired") {
      assert.equal(body.code, "MEDIA_DELETE_WINDOW_EXPIRED");
      assert.match(body.error, /10분/);
    }
    assert.equal(h.state.deletes.length, 0);
    assert.deepEqual(structuredClone(h.state.scopes), [{ workerIds: ["fixture-worker", "fixture-alias"] }]);
  }
});

test("원본·모든 잉크 객체를 지우며 한 객체 실패 뒤에도 나머지를 계속 지운다", async () => {
  const h = routes(CALENDAR);
  h.state.result = { status: "deleted", files: [
    { storageProvider: "naver", storageKey: "original.jpg" },
    { storageProvider: "naver", storageKey: "ink-1.json" },
    { storageProvider: "naver", storageKey: "ink-2.json" },
    { storageProvider: null, storageKey: "external" },
    { storageProvider: "naver", storageKey: null },
  ] };
  h.state.deleteFailure = "ink-1.json";
  assert.equal((await h.DELETE(deletion())).status, 200);
  assert.deepEqual(h.state.deletes, ["original.jpg", "ink-1.json", "ink-2.json"]);
  assert.equal(h.state.warnings, 1);
});

test("스토리지 미설정·인증 없음 때 객체 삭제 호출이 없다", async () => {
  for (const mode of ["config", "auth"]) {
    const h = routes(CALENDAR);
    h.state.result = { status: "deleted", files: [{ storageProvider: "naver", storageKey: "original.jpg" }] };
    if (mode === "config") h.state.storageOn = false;
    else h.state.auth = "none";
    assert.equal((await h.DELETE(deletion())).status, mode === "config" ? 200 : 401);
    assert.equal(h.state.deletes.length, 0);
  }
});

test("목록 canDelete는 소유권과 DB 삭제 유예 판정을 함께 따른다(owner도 유예 적용)", async () => {
  for (const role of ["worker", "owner"]) {
    const h = routes(CALENDAR);
    h.state.role = role;
    h.state.media = [
      { id: "recent", worker_id: "fixture-worker", deleteWindowExpired: false },
      { id: "expired", worker_id: "fixture-worker", deleteWindowExpired: true },
      { id: "other", worker_id: "other-worker", deleteWindowExpired: false },
    ] as CalendarMediaListRow[];
    const response = await h.GET(new Request("https://fixture.test/api/calendar/media?from=2026-09-01&to=2026-09-30"));
    const body = await response.json();
    assert.deepEqual(body.media.map((m: { canDelete: boolean }) => m.canDelete), [true, false, role === "owner"]);
  }
});

// 전체 DB 모듈을 적재하지 않고 AST로 함수 선언을 고른다. initSchema·풀 웜업은 실행될 수 없다.
const dbSource = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const ast = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = new Set(["deleteCalendarMedia", "listCalendarMedia", "MEDIA_DELETE_WINDOW_MIN"]);
const selected = ast.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && names.has(d.name.text))),
).map((node) => node.getText(ast)).join("\n");
assert.equal(ast.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)).length, 2);

type DbFunctions = {
  deleteCalendarMedia(id: string, scope: mediaScope.MediaScope): Promise<DeleteCalendarMediaResult>;
  listCalendarMedia(from: string, to: string): Promise<CalendarMediaListRow[]>;
};
function database(replies: (Record<string, unknown>[] | Error)[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let released = 0;
  let schemaChecked = 0;
  const query = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ? structuredClone(params) : undefined });
    assert.ok(replies.length, `예상 밖 쿼리: ${sql}`);
    const next = replies.shift()!;
    if (next instanceof Error) throw next;
    return { rows: next };
  };
  const functions = execute<DbFunctions>(selected, {
    mediaScopeClause: mediaScope.mediaScopeClause,
    ensureSchema: async () => { schemaChecked++; },
    getPool: () => ({ connect: async () => ({ query, release: () => { released++; } }) }),
    q: query,
  });
  return { ...functions, calls, get released() { return released; }, get schemaChecked() { return schemaChecked; } };
}

test("삭제는 소유권 조건으로 잠근 뒤 원본·전체 잉크 키를 COMMIT 후 반환한다", async () => {
  const h = database([[], [{ annotation_of: null }], [{ expired: false }], [
    { id: "original-id", storage_provider: "naver", storage_key: "original.jpg" },
    { id: "ink-old", storage_provider: "naver", storage_key: "ink-old.json" },
    { id: "ink-new", storage_provider: "naver", storage_key: "ink-new.json" },
  ], [], []]);
  const result = await h.deleteCalendarMedia("original-id", { workerIds: ["worker", "alias"] });
  assert.deepEqual(structuredClone(result), { status: "deleted", files: [
    { storageProvider: "naver", storageKey: "original.jpg" },
    { storageProvider: "naver", storageKey: "ink-old.json" },
    { storageProvider: "naver", storageKey: "ink-new.json" },
  ] });
  assert.equal(h.schemaChecked, 1);
  assert.equal(h.calls[0]?.sql, "BEGIN");
  assert.match(h.calls[1]!.sql, /WHERE id = \$1 AND worker_id = ANY\(\$2::text\[\]\) FOR UPDATE/);
  assert.deepEqual(h.calls[1]?.params, ["original-id", ["worker", "alias"]]);
  assert.match(h.calls[2]!.sql, /created_at::timestamptz < statement_timestamp\(\) - interval '10 minutes'/);
  assert.match(h.calls[3]!.sql, /WHERE id = \$1 OR annotation_of = \$1\s+RETURNING storage_provider, storage_key, id/);
  assert.match(h.calls[4]!.sql, /DELETE FROM calendar_media_comment WHERE media_id = ANY\(\$1::text\[\]\)\s+RETURNING audio_storage_key/);
  assert.deepEqual(h.calls[4]?.params, [["original-id", "ink-old", "ink-new"]]);
  assert.equal(h.calls[5]?.sql, "COMMIT");
  assert.equal(h.released, 1);
});

test("없음·남의 것은 날짜나 키 조회 없이 롤백한다", async () => {
  const h = database([[], [], []]);
  assert.equal((await h.deleteCalendarMedia("missing", { workerIds: ["worker"] })).status, "not_found");
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2]?.sql, "ROLLBACK");
  assert.equal(h.released, 1);
});

test("10분이 지난 원본은 소유자·owner 모두 거부하고 잉크도 보존한다", async () => {
  for (const scope of [{ workerIds: ["worker"] }, "moderator"] as const) {
    const h = database([[], [{ annotation_of: null }], [{ expired: true }], []]);
    const result = await h.deleteCalendarMedia("expired", scope === "moderator" ? scope : { workerIds: [...scope.workerIds] });
    assert.equal(result.status, "delete_window_expired");
    assert.equal(h.calls[3]?.sql, "ROLLBACK");
    assert.ok(h.calls.every((c) => !c.sql.startsWith("DELETE")));
    assert.equal(h.released, 1);
  }
});

test("잉크 단독 삭제는 날짜 캐스팅·유예·동반 삭제를 적용하지 않는다", async () => {
  const h = database([[], [{ annotation_of: "original-id" }], [{ storage_provider: "naver", storage_key: "ink.json" }], []]);
  assert.equal((await h.deleteCalendarMedia("ink-id", "moderator")).status, "deleted");
  assert.match(h.calls[2]!.sql, /WHERE id = \$1\s+RETURNING/);
  assert.ok(h.calls.every((c) => !c.sql.includes("timestamptz") && !c.sql.includes(" OR annotation_of")));
  assert.equal(h.calls[3]?.sql, "COMMIT");
  assert.equal(h.released, 1);
});

test("날짜 캐스팅·미디어/댓글 DELETE·COMMIT 실패는 모두 롤백하고 키를 반환하지 않는다", async () => {
  for (const step of ["cast", "delete", "comments", "commit"]) {
    const error = new Error(`검증용 ${step} 실패`);
    const replies: (Record<string, unknown>[] | Error)[] = [[], [{ annotation_of: null }]];
    if (step !== "cast") replies.push([{ expired: false }]);
    if (step === "comments" || step === "commit") {
      replies.push([{ id: "original-id", storage_provider: "naver", storage_key: "original.jpg" }]);
    }
    if (step === "commit") replies.push([]);
    replies.push(error, []);
    const h = database(replies);
    await assert.rejects(h.deleteCalendarMedia("original-id", "moderator"), (err: unknown) => err === error);
    assert.equal(h.calls.at(-1)?.sql, "ROLLBACK");
    assert.equal(h.released, 1);
  }
});

test("최신 잉크만 가리키고 원본 목록의 기존 날짜·촬영시각 정렬은 보존한다", async () => {
  const h = database([[]]);
  await h.listCalendarMedia("2026-09-01", "2026-09-30");
  const sql = h.calls[0]!.sql;
  assert.match(sql, /WHERE a.annotation_of = m.id\s+ORDER BY a.created_at::timestamptz DESC, a.id DESC\s+LIMIT 1/);
  assert.match(sql, /WHERE m.annotation_of IS NULL\s+AND m.date_key >= \$1 AND m.date_key <= \$2/);
  assert.match(sql, /ORDER BY m.date_key ASC, m.captured_at ASC NULLS LAST, m.created_at ASC/);
  assert.match(sql, /m.created_at::timestamptz < statement_timestamp\(\) - interval '10 minutes'/);
  assert.deepEqual(h.calls[0]?.params, ["2026-09-01", "2026-09-30"]);
});
