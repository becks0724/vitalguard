// 실제 POST·앱 게이트·JWT를 실행하고 DB는 모의 함수만 허용한다. 실 DB의 ack 쓰기는 금지다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import type { AppAdminGate } from "./app-admin-auth";
import * as alertTypes from "./alert-type";
import * as appJwt from "./app-jwt";
import type { ackAlert, ackAlertByKey } from "./db";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const codeCache = new Map<string, string>();
function loadModule<T>(path: string, imports: Record<string, unknown>): T {
  let code = codeCache.get(path);
  if (!code) {
    code = ts.transpileModule(readFileSync(join(ROOT, path), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    codeCache.set(path, code);
  }
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `실 DB/통신을 허용하지 않은 의존성: ${name}`);
      return imports[name];
    },
    console: { warn: () => {} },
  });
  return module.exports as T;
}

const savedSecret = process.env.APP_JWT_SECRET;
before(() => { process.env.APP_JWT_SECRET = "app-alerts-ack-fixture-not-a-credential"; });
after(() => {
  if (savedSecret === undefined) delete process.env.APP_JWT_SECRET;
  else process.env.APP_JWT_SECRET = savedSecret;
});

function mobileToken(role = "admin") {
  return appJwt.signMobileAccessJwt({
    sub: "fixture-admin", role, name: "검증 관리자", workerId: "fixture-admin-worker",
    sessionId: "11111111-2222-3333-4444-555555555555",
  });
}
function rawRequest(body: string | undefined, token: string | null = mobileToken()) {
  return new Request("http://fixture.test/api/app/admin/alerts/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
}
function request(body: unknown, token: string | null = mobileToken()) {
  return rawRequest(JSON.stringify(body), token);
}

function harness() {
  const state = {
    user: { username: "fixture-admin", role: "admin", status: "approved", admin_access: true },
    userLookupFails: false,
    lookups: [] as string[],
    changed: 1,
    writeFails: false,
    byId: [] as Parameters<typeof ackAlert>[],
    byKey: [] as Parameters<typeof ackAlertByKey>[],
  };
  const gate = loadModule<{ requireAppAdmin: (request: Request) => Promise<AppAdminGate> }>("lib/app-admin-auth.ts", {
    "./app-jwt": appJwt,
    "./db": { findUserByUsername: async (username: string) => {
      state.lookups.push(username);
      if (state.userLookupFails) throw new Error("검증용 권한 DB 실패");
      return state.user;
    } },
  });
  const route = loadModule<{ POST: (request: Request) => Promise<Response> }>("app/api/app/admin/alerts/ack/route.ts", {
    "next/server": { NextResponse },
    "../../../../../../lib/app-admin-auth": gate,
    "../../../../../../lib/alert-type": alertTypes,
    "../../../../../../lib/db": {
      ackAlert: async (...args: Parameters<typeof ackAlert>) => {
        state.byId.push(args);
        if (state.writeFails) throw new Error("검증용 ack 실패");
        return state.changed;
      },
      ackAlertByKey: async (...args: Parameters<typeof ackAlertByKey>) => {
        state.byKey.push(args);
        if (state.writeFails) throw new Error("검증용 ack 실패");
        return state.changed;
      },
    },
  });
  return { ...route, state };
}

test("인증이 없으면 401과 게이트 본문을 반환하며 DB를 호출하지 않는다", async () => {
  const h = harness();
  // 인증을 JSON 파싱보다 먼저 검사한다.
  const response = await h.POST(rawRequest("{", null));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized", action: "reauth" });
  assert.deepEqual(h.state.lookups, []);
  assert.deepEqual(h.state.byId, []);
  assert.deepEqual(h.state.byKey, []);
});

test("레거시 수집 토큰은 401이며 대응 확인에 도달하지 않는다", async () => {
  const h = harness();
  const legacy = appJwt.signAppJwt({ sub: "fixture-admin", role: "admin", name: null, workerId: null });
  const response = await h.POST(request({ id: 42 }, legacy));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: "unauthorized", action: "reauth" });
  assert.equal(h.state.lookups.length + h.state.byId.length + h.state.byKey.length, 0);
});

test("현재 DB의 권한 회수는 토큰의 owner 역할과 무관하게 403 그대로다", async () => {
  const h = harness();
  h.state.user.admin_access = false;
  const response = await h.POST(request({ id: 42 }, mobileToken("owner")));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "forbidden" });
  assert.equal(h.state.byId.length + h.state.byKey.length, 0);
});

test("권한 DB 조회 실패는 게이트의 503 그대로이며 쓰기는 0회다", async () => {
  const h = harness();
  h.state.userLookupFails = true;
  const response = await h.POST(request({ workerId: "worker-1", type: "sos" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "권한 확인 실패" });
  assert.equal(h.state.byId.length + h.state.byKey.length, 0);
});

test("id는 ackAlert만 호출하고 게이트 username으로 기록한다", async () => {
  const h = harness();
  const response = await h.POST(request({ id: 42 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, acked: true });
  assert.deepEqual(h.state.byId, [[42, "fixture-admin"]]);
  assert.deepEqual(h.state.byKey, []);
});

for (const type of alertTypes.ALERT_TYPES) {
  test(`workerId + ${type}은 ackAlertByKey만 호출한다`, async () => {
    const h = harness();
    const response = await h.POST(request({ workerId: "worker-1", type }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, acked: true });
    assert.deepEqual(h.state.byKey, [["worker-1", type, "fixture-admin"]]);
    assert.deepEqual(h.state.byId, []);
  });
}

test("장기 미수신(absence)은 이미 처리되어 변경 0건이어도 200과 acked:false다", async () => {
  const h = harness();
  h.state.changed = 0;
  const response = await h.POST(request({ workerId: "worker-1", type: "absence" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, acked: false });
  assert.deepEqual(h.state.byKey, [["worker-1", "absence", "fixture-admin"]]);
  assert.deepEqual(h.state.byId, []);
});

for (const [branch, body] of [
  ["id", { id: 42 }],
  ["자연키", { workerId: "worker-1", type: "sos" }],
] as const) {
  test(`${branch}: body의 ackBy를 무시하고 게이트 username을 자르지 않고 기록한다`, async () => {
    const h = harness();
    const username = `gate-${"관리자".repeat(20)}`;
    // 토큰 sub·표시 이름·사번과도 다른 DB username으로 게이트 주체 사용을 검증한다.
    h.state.user.username = username;
    const response = await h.POST(request({ ...body, ackBy: "다른 관리자" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, acked: true });
    assert.deepEqual(h.state.lookups, ["fixture-admin"]);
    assert.deepEqual(h.state.byId, branch === "id" ? [[42, username]] : []);
    assert.deepEqual(h.state.byKey, branch === "자연키" ? [["worker-1", "sos", username]] : []);
  });

  test(`${branch}: 이미 처리되어 변경 0건이어도 200과 acked:false다`, async () => {
    const h = harness();
    h.state.changed = 0;
    const response = await h.POST(request(body));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, acked: false });
    assert.equal(h.state.byId.length, branch === "id" ? 1 : 0);
    assert.equal(h.state.byKey.length, branch === "자연키" ? 1 : 0);
  });

  test(`${branch}: DB 예외를 이미 처리됨이나 성공으로 바꾸지 않는다`, async () => {
    const h = harness();
    h.state.writeFails = true;
    await assert.rejects(h.POST(request(body)), /검증용 ack 실패/);
    assert.equal(h.state.byId.length + h.state.byKey.length, 1);
  });
}

test("본문 없음·빈 문자열·깨진 JSON은 400이며 쓰기는 0회다", async () => {
  const h = harness();
  for (const body of [undefined, "", "{", " "]) {
    const response = await h.POST(rawRequest(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid json" });
  }
  assert.equal(h.state.byId.length + h.state.byKey.length, 0);
});

for (const [label, bodies] of [
  ["객체 아님·식별자 없음", [null, [], [{ id: 42 }], "42", 42, true, {}, { ackBy: "다른 관리자" }]],
  ["잘못된 id", [null, "42", true, [], [42], {}, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((id) => ({ id }))],
  ["잘못된 작업자", [null, 42, true, [], ["worker-1"], {}, "", "  "].map((workerId) => ({ workerId, type: "sos" }))],
  ["잘못된 종류", [null, 42, true, [], ["sos"], {}, "", "SOS", "danger_zone"].map((type) => ({ workerId: "worker-1", type }))],
  ["자연키 한쪽 누락", [{ workerId: "worker-1" }, { type: "sos" }]],
  ["식별 방식 혼합", [{ id: 42, workerId: "worker-1", type: "sos" }, { id: 42, workerId: "worker-1" }, { id: 42, type: "sos" }, { id: null, workerId: "worker-1", type: "sos" }]],
] as const) {
  test(`${label}는 400이며 DB 쓰기를 호출하지 않는다`, async () => {
    const h = harness();
    for (const body of bodies) {
      const response = await h.POST(request(body));
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(await response.json(), { ok: false, error: "id or (workerId + type) required" });
    }
    assert.equal(h.state.byId.length + h.state.byKey.length, 0);
  });
}
