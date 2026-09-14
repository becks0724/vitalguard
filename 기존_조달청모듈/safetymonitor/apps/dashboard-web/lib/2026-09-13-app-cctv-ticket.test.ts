// 실제 앱 게이트·JWT·서명으로 새 POST를 실행한다. DB만 대체해 라이브 접속 없이 인가를 검증한다.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { NextResponse } from "next/server";
import ts from "typescript";

import type { AppAdminGate } from "./app-admin-auth";
import * as appJwt from "./app-jwt";
import * as signing from "./cctv-ticket";
import type { CctvPermission, cctvPermissionFor, recordCctvTicketAudit } from "./db";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const keys = crypto.generateKeyPairSync("ed25519");
const fixtureEnv = {
  APP_JWT_SECRET: "app-cctv-fixture-not-a-credential",
  CCTV_TICKET_KEY: keys.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex"),
  CCTV_TICKET_KID: "fixture",
  CCTV_TICKET_TTL_SEC: "60",
};
const savedEnv = new Map(Object.keys(fixtureEnv).map((key) => [key, process.env[key]]));
before(() => Object.assign(process.env, fixtureEnv));
after(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// 라우트와 게이트의 원문을 실행한다. 미허용 import는 차단해 실제 DB가 적재되지 않게 한다.
function loadModule<T>(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(readFileSync(join(ROOT, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(code, {
    module, exports: module.exports,
    require: (name: string) => {
      assert.ok(Object.hasOwn(imports, name), `미허용 의존성: ${name}`);
      return imports[name];
    },
    console: { warn: () => {} },
    ...globals,
  });
  return module.exports as T;
}

type FixtureUser = { username: string; role: string; status: string; admin_access: boolean };
function harness() {
  const state = {
    user: { username: "fixture-admin", role: "admin", status: "approved", admin_access: true } as FixtureUser | null,
    userLookupFails: false,
    permission: { siteId: "registry-site", canView: true, canControl: false } as CctvPermission | null,
    permissionCalls: [] as Parameters<typeof cctvPermissionFor>[],
    audits: [] as Parameters<typeof recordCctvTicketAudit>[0][],
    signInputs: [] as Parameters<typeof signing.signTicket>[0][],
    signFails: false,
    nowMs: 60_000,
  };
  const gate = loadModule<{ requireAppAdmin: (request: Request) => Promise<AppAdminGate> }>("lib/app-admin-auth.ts", {
    "./app-jwt": appJwt,
    "./db": {
      findUserByUsername: async (username: string) => {
        if (state.userLookupFails) throw new Error("검증용 DB 조회 실패");
        return state.user?.username === username ? state.user : null;
      },
    },
  });
  const route = loadModule<{ POST: (request: Request) => Promise<Response> }>("app/api/app/admin/cctv-ticket/route.ts", {
    "next/server": { NextResponse },
    "../../../../../lib/app-admin-auth": gate,
    "../../../../../lib/cctv-ticket": {
      ticketSigningReady: signing.ticketSigningReady,
      signTicket: (input: Parameters<typeof signing.signTicket>[0]) => {
        state.signInputs.push({ ...input });
        return state.signFails ? null : signing.signTicket(input);
      },
    },
    "../../../../../lib/db": {
      cctvPermissionFor: async (...args: Parameters<typeof cctvPermissionFor>) => {
        state.permissionCalls.push(args);
        return state.permission;
      },
      recordCctvTicketAudit: async (input: Parameters<typeof recordCctvTicketAudit>[0]) => {
        state.audits.push({ ...input });
      },
    },
  }, { Date: { now: () => state.nowMs }, process: { env: {} } });
  return { ...route, state };
}

function mobileToken(role = "admin", username = "fixture-admin") {
  return appJwt.signMobileAccessJwt({
    sub: username, role, name: "검증 관리자", workerId: "fixture-worker",
    sessionId: "11111111-2222-3333-4444-555555555555",
  });
}

function request(body: unknown = { cameraId: "CAM-03" }, token: string | null = mobileToken()) {
  return new Request("http://fixture.test/api/app/admin/cctv-ticket", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("정상 모바일 관리자에게 대장 현장의 read 티켓만 서명한다 — 본문 위조 무시", async () => {
  const h = harness();
  const response = await h.POST(request({
    cameraId: " CAM-03 ", scope: "control", siteId: "forged-site", username: "forged-owner", role: "owner",
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.gateApi, "");
  const [body, signature] = (data.ticket as string).split(".");
  const raw = Buffer.from(body!, "base64url");
  assert.ok(crypto.verify(null, raw, keys.publicKey, Buffer.from(signature!, "base64url")));
  const payload = JSON.parse(raw.toString("utf8"));
  assert.equal(payload.aud, "CAM-03");
  assert.equal(payload.sid, "registry-site");
  assert.equal(payload.scp, "read");
  assert.equal(payload.sub, "fixture-admin");
  assert.equal(data.expiresAt, payload.exp * 1000);
  assert.equal(data.ttlSec, 60);
  assert.deepEqual(h.state.permissionCalls, [["fixture-admin", "admin", "CAM-03"]]);
  assert.deepEqual(h.state.audits, [{ username: "fixture-admin", cameraId: "CAM-03", scope: "read", granted: true }]);
});

test("토큰 없음·레거시 토큰은 401과 재인증 action을 그대로 반환한다", async () => {
  const legacy = appJwt.signAppJwt({ sub: "fixture-admin", role: "admin", name: null, workerId: "fixture-worker" });
  for (const token of [null, legacy]) {
    const h = harness();
    const response = await h.POST(request(undefined, token));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { ok: false, error: "unauthorized", action: appJwt.mobileUnauthorizedAction(token) });
    assert.equal(h.state.permissionCalls.length, 0);
    assert.equal(h.state.signInputs.length, 0);
  }
});

test("작업자·권한 회수·거절 계정은 모바일 토큰이 유효해도 403이다", async () => {
  for (const user of [
    { role: "worker", status: "approved", admin_access: false },
    { role: "admin", status: "approved", admin_access: false },
    { role: "admin", status: "rejected", admin_access: true },
  ]) {
    const h = harness();
    Object.assign(h.state.user!, user);
    const response = await h.POST(request(undefined, mobileToken(user.role)));
    assert.equal(response.status, 403);
    assert.equal(h.state.permissionCalls.length, 0);
    assert.equal(h.state.signInputs.length, 0);
  }
});

test("CCTV 역할은 토큰의 옛 owner 값이 아니라 게이트가 읽은 현재 역할을 따른다", async () => {
  const h = harness();
  assert.equal((await h.POST(request(undefined, mobileToken("owner")))).status, 200);
  assert.equal(h.state.permissionCalls[0]![1], "admin");
});

test("부트스트랩 owner도 read로만 발급한다", async () => {
  const h = harness();
  h.state.user = null;
  const response = await h.POST(request({ cameraId: "CAM-03", scope: "control" }, mobileToken("owner")));
  assert.equal(response.status, 200);
  assert.equal(h.state.permissionCalls[0]![1], "owner");
  assert.equal(h.state.signInputs[0]!.scope, "read");
});

test("관리자 권한 조회 실패는 503이며 티켓을 발급하지 않는다", async () => {
  const h = harness();
  h.state.userLookupFails = true;
  const response = await h.POST(request());
  assert.equal(response.status, 503);
  assert.equal(h.state.permissionCalls.length, 0);
  assert.equal(h.state.signInputs.length, 0);
});

test("없는 카메라와 조회 권한 없음은 각각 404·403으로 거절하고 감사에 남긴다", async () => {
  for (const [permission, status, reason] of [
    [null, 404, "unknown camera"],
    [{ siteId: "registry-site", canView: false, canControl: true }, 403, "no read on registry-site"],
  ] as const) {
    const h = harness();
    h.state.permission = permission;
    assert.equal((await h.POST(request({ cameraId: "CAM-03", scope: "control", siteId: "forged" }))).status, status);
    assert.equal(h.state.signInputs.length, 0);
    assert.deepEqual(h.state.audits, [{ username: "fixture-admin", cameraId: "CAM-03", scope: "read", granted: false, reason }]);
  }
});

test("JSON 오류·cameraId 누락은 400이며 카메라 권한 조회에 도달하지 않는다", async () => {
  const h = harness();
  for (const body of [null, {}, { cameraId: "  " }]) {
    assert.equal((await h.POST(request(body))).status, 400);
  }
  const invalid = new Request("http://fixture.test/api/app/admin/cctv-ticket", {
    method: "POST", headers: { Authorization: `Bearer ${mobileToken()}` }, body: "{",
  });
  assert.equal((await h.POST(invalid)).status, 400);
  assert.equal(h.state.permissionCalls.length, 0);
});

test("서명키 미설정·서명 실패는 503이며 성공 감사가 남지 않는다", async () => {
  const h = harness();
  const saved = process.env.CCTV_TICKET_KEY;
  try {
    delete process.env.CCTV_TICKET_KEY;
    assert.equal((await h.POST(request())).status, 503);
    assert.equal(h.state.permissionCalls.length, 0);
  } finally {
    process.env.CCTV_TICKET_KEY = saved;
  }
  h.state.signFails = true;
  assert.equal((await h.POST(request())).status, 503);
  assert.equal(h.state.audits.length, 0);
});

test("동일 사용자는 분당 60회까지, 다음 분에는 다시 발급된다", async () => {
  const h = harness();
  for (let i = 0; i < 60; i++) assert.equal((await h.POST(request())).status, 200);
  assert.equal((await h.POST(request())).status, 429);
  assert.equal(h.state.permissionCalls.length, 60);
  assert.equal(h.state.audits.length, 60);
  h.state.nowMs += 60_000;
  assert.equal((await h.POST(request())).status, 200);
});
