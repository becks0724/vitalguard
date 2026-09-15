// N-3: 실제 라우트·INSERT·트랜잭션·스키마 함수만 추출해 실행한다.
// pg/스토리지 모듈은 로드하지 않는다. SQL의 유일키 대기·23505·롤백은 메모리로 모의한다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import * as mediaScope from "./media-scope";
import type { insertCalendarMedia, insertCalendarMediaComment } from "./db";

const ROOT = join(import.meta.dirname, "..");
const dbSource = readFileSync(join(ROOT, "lib/db.ts"), "utf8");
const routeSource = readFileSync(join(ROOT, "app/api/app-media/route.ts"), "utf8");
const ast = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const compiled = new Map<string, string>();
function execute<T>(source: string, globals: Record<string, unknown>): T {
  if (!compiled.has(source)) compiled.set(source, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const module = { exports: {} };
  runInNewContext(compiled.get(source)!, { module, exports: module.exports, ...globals });
  return module.exports as T;
}
function functions(...names: string[]) {
  const nodes = ast.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
  assert.equal(nodes.length, names.length, "실제 DB 함수 추출 누락");
  return nodes.map((node) => node.getText(ast)).join("\n");
}
const dbFunctions = functions(
  "buildInsert", "insertAppMediaWithUpload", "insertCalendarMedia", "insertCalendarMediaComment",
);
type Table = "calendar_media" | "calendar_media_comment";
type Kind = "photo" | "ink" | "voice";
type Row = Record<string, unknown> & { id: string; client_operation_id: string | null };
type Db = { insertCalendarMedia: typeof insertCalendarMedia; insertCalendarMediaComment: typeof insertCalendarMediaComment };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
// 인덱스 정의를 실물 DDL에서 읽는다. WHERE나 IF NOT EXISTS가 빠지면 모의 DB도 준비되지 않는다.
function indexes(source: string) {
  return new Map([...source.matchAll(
    /CREATE UNIQUE INDEX IF NOT EXISTS (\w+)\s+ON (calendar_media(?:_comment)?)\(client_operation_id\) WHERE client_operation_id IS NOT NULL;/g,
  )].map((match) => [match[2] as Table, match[1]!]));
}

function harness() {
  const constraints = indexes(dbSource);
  assert.equal(constraints.size, 2);
  const state = {
    rows: { calendar_media: [], calendar_media_comment: [] } as Record<Table, Row[]>,
    objects: new Map<string, Uint8Array>(),
    puts: [] as string[],
    queries: [] as { sql: string; params: unknown[]; transaction: boolean }[],
    events: [] as string[],
    conflicts: 0,
    released: 0,
    connections: 0,
    putFailures: 0,
    insertFailure: null as Error | null,
    race: false,
    auth: "jwt" as "jwt" | "shared" | "none",
    originalWorker: "EMP-fixture",
    originalExists: true,
  };
  type Pending = { table: Table; row: Row; done: ReturnType<typeof deferred> };
  const pending = new Set<Pending>();
  const bothInserts = deferred();
  let arrivals = 0;
  const log = (sql: string, params: unknown[], transaction: boolean) => {
    state.queries.push({ sql, params: structuredClone(params), transaction });
    state.events.push(sql.split(" ")[0]!);
  };
  const insert = async (sql: string, params: unknown[], transaction: boolean) => {
    if (state.insertFailure) throw state.insertFailure;
    const match = sql.match(/^INSERT INTO (calendar_media(?:_comment)?) \(([^)]+)\) VALUES \(([^)]+)\) RETURNING \*$/);
    assert.ok(match, `예상 밖 INSERT: ${sql}`);
    const table = match[1] as Table;
    const columns = match[2]!.split(", ");
    assert.equal(columns.length, params.length);
    assert.deepEqual(match[3]!.split(", "), Array.from(params, (_, i) => `$${i + 1}`));
    const attributes = Object.fromEntries(columns.map((column, i) => [column, params[i]]));
    assert.equal(typeof attributes.id, "string");
    assert.ok(attributes.client_operation_id === null || typeof attributes.client_operation_id === "string");
    const row: Row = { ...attributes, id: attributes.id as string,
      client_operation_id: attributes.client_operation_id as string | null,
      created_at: "2026-09-14T03:00:00.000Z" };
    if (state.race && transaction) {
      if (++arrivals === 2) bothInserts.resolve();
      await bothInserts.promise;
    }
    if (row.client_operation_id !== null) {
      // 미커밋 유일키의 승자가 COMMIT/ROLLBACK할 때까지 경쟁 INSERT가 기다린다.
      let holder: Pending | undefined;
      while ((holder = [...pending].find((p) => p.table === table &&
        p.row.client_operation_id === row.client_operation_id))) await holder.done.promise;
      if (state.rows[table].some((r) => r.client_operation_id === row.client_operation_id)) {
        state.conflicts++;
        throw Object.assign(new Error("모의 unique_violation"), { code: "23505", constraint: constraints.get(table) });
      }
    }
    const result = { table, row, done: deferred() };
    if (transaction) pending.add(result);
    else state.rows[table].push(row);
    return result;
  };
  const q = async (sql: string, params: unknown[] = []) => {
    log(sql, params, false);
    if (sql.startsWith("INSERT")) {
      const result = await insert(sql, params, false);
      return { rows: [structuredClone(result.row)], rowCount: 1 };
    }
    const match = sql.match(/^SELECT \* FROM (calendar_media(?:_comment)?) WHERE client_operation_id = \$1$/);
    assert.ok(match, `예상 밖 조회: ${sql}`);
    const rows = state.rows[match[1] as Table].filter((r) => r.client_operation_id === params[0]);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const getPool = () => ({ connect: async () => {
    state.connections++;
    let active = false;
    let staged: Pending | null = null;
    return {
      query: async (sql: string, params: unknown[] = []) => {
        log(sql, params, true);
        if (sql === "BEGIN") { active = true; return { rows: [] }; }
        assert.ok(active, "트랜잭션 밖의 client 쿼리");
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          if (staged) {
            if (sql === "COMMIT") state.rows[staged.table].push(staged.row);
            pending.delete(staged);
            staged.done.resolve();
            staged = null;
          }
          active = false;
          return { rows: [] };
        }
        staged = await insert(sql, params, true);
        return { rows: [structuredClone(staged.row)] };
      },
      release: () => { assert.equal(active, false); assert.equal(staged, null); state.released++; },
    };
  } });
  const db = execute<Db>(dbFunctions, { q, getPool });
  const imports: Record<string, unknown> = {
    "next/server": { NextResponse },
    "../../../lib/db": {
      ...db,
      getCalendarMediaById: async (id: string) => state.originalExists ? {
        id, annotation_of: null, date_key: "2026-09-14", worker_id: state.originalWorker,
      } : null,
      getWorkerAliasMap: async () => ({}),
      findUserByUsername: async () => ({ name: "검증 작성자", job_title: "담당관" }),
      getOwnerProfile: async () => null,
    },
    "../../../lib/app-jwt": {
      bearerToken: () => null,
      verifyAppJwt: () => state.auth === "jwt" ? {
        sub: "fixture-login", workerId: "EMP-fixture", role: "worker", name: "검증 작성자",
      } : null,
    },
    "../../../lib/admin-auth": {
      verifyAppUploadToken: () => state.auth === "shared", appUploadTokenMatches: () => false,
    },
    "../../../lib/media-scope": mediaScope,
    "../../../lib/storage": {
      isStorageConfigured: () => true,
      putObject: async (key: string, bytes: Uint8Array) => {
        state.puts.push(key);
        state.events.push("PUT");
        if (state.putFailures > 0) { state.putFailures--; throw new Error("모의 PUT 실패"); }
        state.objects.set(key, bytes);
      },
    },
  };
  const route = execute<{ POST(request: Request): Promise<Response> }>(routeSource, {
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `실제 외부 모듈 로드 금지: ${name}`);
      return imports[name];
    },
    crypto, Uint8Array, console: { warn: () => {}, error: () => {} },
  });
  return { state, route, db };
}

function request(kind: Kind, operationId?: string, change?: (form: FormData) => void) {
  const form = new FormData();
  form.set("file", new Blob([kind === "ink" ? '{"v":1,"strokes":[]}' : "fixture-bytes"], {
    type: kind === "ink" ? "application/json" : kind === "voice" ? "audio/mp4" : "image/jpeg",
  }), kind === "ink" ? "ink.json" : kind === "voice" ? "voice.m4a" : "photo.jpg");
  form.set("dateKey", "2026-09-14");
  form.set("capturedAt", "2026-09-14T12:00:00+09:00");
  if (kind === "ink") form.set("annotationOf", "original");
  if (kind === "voice") { form.set("commentOf", "original"); form.set("audioMs", "1200"); }
  if (operationId !== undefined) form.set("clientOperationId", operationId);
  change?.(form);
  return new Request("https://fixture.test/api/app-media", { method: "POST", body: form });
}

for (const kind of ["photo", "ink", "voice"] as const) {
  const table: Table = kind === "voice" ? "calendar_media_comment" : "calendar_media";
  const field = kind === "voice" ? "comment" : "media";

  test(`${kind}: 같은 작업 ID 재전송은 기존 결과·시각·키를 반환하고 행/객체가 각각 1개다`, async () => {
    const h = harness();
    const first = await h.route.POST(request(kind, "operation-1"));
    const second = await h.route.POST(request(kind, "operation-1", (form) => form.set("title", "덮어쓰면 안 됨")));
    assert.deepEqual([first.status, second.status], [200, 200]);
    const a = await first.json();
    const b = await second.json();
    assert.deepEqual({ ...b, deduplicated: false }, a);
    assert.equal(b.ok, true);
    assert.equal(b.deduplicated, true);
    assert.equal(b.clientOperationId, "operation-1");
    assert.equal(b[field].client_operation_id, "operation-1");
    assert.equal(h.state.rows[table].length, 1);
    assert.equal(h.state.objects.size, 1);
    assert.equal(h.state.puts.length, 1);
    assert.equal(h.state.connections, 1, "순차 중복은 트랜잭션도 만들지 않는다");
    assert.ok(h.state.events.indexOf("INSERT") < h.state.events.indexOf("PUT"));
    assert.ok(h.state.events.indexOf("PUT") < h.state.events.indexOf("COMMIT"));
  });

  test(`${kind}: 작업 ID 없이 두 번은 기존대로 행/객체 2개이며 응답 상위 필드도 유지한다`, async () => {
    const h = harness();
    const responses = [];
    for (let i = 0; i < 2; i++) {
      const response = await h.route.POST(request(kind));
      assert.equal(response.status, 200);
      responses.push(await response.json());
    }
    assert.deepEqual(Object.keys(responses[1]).sort(), [field, "ok"].sort());
    assert.notEqual(responses[0][field].id, responses[1][field].id);
    assert.equal(h.state.rows[table].length, 2);
    assert.ok(h.state.rows[table].every((row) => row.client_operation_id === null));
    assert.equal(h.state.objects.size, 2);
    assert.equal(h.state.connections, 0);
    assert.ok(h.state.events.indexOf("PUT") < h.state.events.indexOf("INSERT"));
  });

  test(`${kind}: 두 SELECT가 모두 빗나간 동시 INSERT도 23505를 성공으로 복구하고 PUT은 1회다`, async () => {
    const h = harness();
    h.state.race = true;
    const responses = await Promise.all([
      h.route.POST(request(kind, "simultaneous")), h.route.POST(request(kind, "simultaneous")),
    ]);
    assert.deepEqual(responses.map((r) => r.status), [200, 200]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    assert.deepEqual(bodies.map((b) => b.deduplicated).sort(), [false, true]);
    assert.deepEqual(bodies[0][field], bodies[1][field]);
    assert.equal(h.state.conflicts, 1, "실제로 유일 인덱스 위반을 거쳐야 한다");
    assert.equal(h.state.rows[table].length, 1);
    assert.equal(h.state.objects.size, 1);
    assert.equal(h.state.puts.length, 1, "경쟁 패자는 새 오브젝트를 올리면 안 된다");
    assert.equal(h.state.released, 2);
    assert.deepEqual(h.state.events.slice(-2), ["ROLLBACK", "SELECT"]);
  });

  test(`${kind}: 다른 작업 ID는 같은 파일이어도 별도 저장한다`, async () => {
    const h = harness();
    for (const id of ["one", "two"]) assert.equal((await h.route.POST(request(kind, id))).status, 200);
    assert.equal(h.state.rows[table].length, 2);
    assert.equal(h.state.objects.size, 2);
  });

  test(`${kind}: PUT 실패는 행·작업 ID를 롤백하고 같은 ID 재시도가 새 저장으로 성공한다`, async () => {
    const h = harness();
    h.state.putFailures = 1;
    assert.equal((await h.route.POST(request(kind, "retry"))).status, 502);
    assert.equal(h.state.rows[table].length, 0);
    assert.equal(h.state.objects.size, 0);
    const retried = await h.route.POST(request(kind, "retry"));
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).deduplicated, false);
    assert.equal(h.state.rows[table].length, 1);
    assert.equal(h.state.objects.size, 1);
    assert.equal(h.state.released, 2);
  });

  test(`${kind}: 경쟁 선행 요청 PUT 실패 후 대기 요청은 키를 확보하여 저장한다`, async () => {
    const h = harness();
    h.state.race = true;
    h.state.putFailures = 1;
    const responses = await Promise.all([
      h.route.POST(request(kind, "retry-race")), h.route.POST(request(kind, "retry-race")),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 502]);
    assert.equal(h.state.rows[table].length, 1);
    assert.equal(h.state.objects.size, 1);
    assert.equal(h.state.conflicts, 0);
    assert.equal(h.state.released, 2);
  });

  test(`${kind}: 다른 유일키·일반 DB 오류를 중복 성공으로 숨기지 않고 PUT 전에 실패한다`, async () => {
    for (const extra of [{ code: "23505", constraint: `${table}_pkey` }, { code: "08006" }]) {
      const h = harness();
      h.state.insertFailure = Object.assign(new Error("모의 다른 DB 오류"), extra);
      await assert.rejects(h.route.POST(request(kind, "failure")), /모의 다른 DB 오류/);
      assert.equal(h.state.puts.length, 0);
      assert.equal(h.state.rows[table].length, 0);
      assert.equal(h.state.released, 1);
    }
  });
}

for (const [name, change] of [
  ["빈 값", (form: FormData) => form.set("clientOperationId", "")],
  ["공백", (form: FormData) => form.set("clientOperationId", " id ")],
  ["128자 초과", (form: FormData) => form.set("clientOperationId", "x".repeat(129))],
  ["반복 필드", (form: FormData) => form.append("clientOperationId", "another")],
  ["파일 필드", (form: FormData) => form.set("clientOperationId", new Blob(["id"]), "id.txt")],
] as const) {
  test(`잘못된 작업 ID(${name})는 중복 방지를 생략하지 않고 400이다`, async () => {
    const h = harness();
    assert.equal((await h.route.POST(request("photo", "id", change))).status, 400);
    assert.equal(h.state.puts.length, 0);
    assert.equal(h.state.queries.length, 0);
  });
}

test("UUID 및 128자 작업 ID가 그대로 저장·반환된다", async () => {
  const h = harness();
  for (const id of [crypto.randomUUID(), "x".repeat(128)]) {
    const response = await h.route.POST(request("photo", id));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).clientOperationId, id);
  }
});

test("멱등 재전송에도 인증·잉크 소유권·음성 로그인 검사는 생략하지 않는다", async () => {
  for (const kind of ["photo", "ink", "voice"] as const) {
    const h = harness();
    assert.equal((await h.route.POST(request(kind, "auth-check"))).status, 200);
    h.state.auth = "none";
    assert.equal((await h.route.POST(request(kind, "auth-check"))).status, 401);
    h.state.auth = "shared";
    if (kind === "voice") assert.equal((await h.route.POST(request(kind, "auth-check"))).status, 401);
    if (kind === "ink") {
      assert.equal((await h.route.POST(request(kind, "auth-check"))).status, 403);
      h.state.auth = "jwt";
      h.state.originalWorker = "someone-else";
      assert.equal((await h.route.POST(request(kind, "auth-check"))).status, 403);
    }
    assert.equal(h.state.puts.length, 1);
  }
});

test("기존 NULL 행 다수에 nullable 컬럼·부분 유일 인덱스를 멱등 적용한다(DDL 모의)", async () => {
  const queries: string[] = [];
  let released = 0;
  const schema = execute<{ run(): Promise<void> }>(
    functions("initSchema") + "\nexports.run = initSchema;", {
      NOW_ISO: "CURRENT_TIMESTAMP", SCHEMA_LOCK_TIMEOUT: "3s",
      getPool: () => ({ connect: async () => ({
        query: async (sql: string) => { queries.push(sql); return { rows: [] }; },
        release: () => { released++; },
      }) }),
    },
  );
  await schema.run();
  await schema.run();
  assert.equal(released, 2);
  const ddl = queries.find((sql) => sql.includes("CREATE TABLE"))!;
  assert.equal(indexes(ddl).size, 2);
  for (const table of ["calendar_media", "calendar_media_comment"] as const) {
    assert.match(ddl, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS client_operation_id TEXT;`));
    const h = harness();
    h.state.rows[table].push(...["legacy-1", "legacy-2", "legacy-3"].map((id) => ({ id, client_operation_id: null })));
    const kind = table === "calendar_media" ? "photo" : "voice";
    for (const id of [undefined, undefined, "new-id", "new-id"]) {
      assert.equal((await h.route.POST(request(kind, id))).status, 200);
    }
    assert.equal(h.state.rows[table].filter((row) => row.client_operation_id === null).length, 5);
    assert.equal(h.state.rows[table].length, 6);
  }
});
