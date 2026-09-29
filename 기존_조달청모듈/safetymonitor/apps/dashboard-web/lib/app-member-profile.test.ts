import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { before, after, test } from "node:test";
import ts from "typescript";
import { NextResponse } from "next/server";
import * as jwt from "./app-jwt";
import { appMemberProfile, maskProfilePhone } from "./app-member-profile";

const root = join(import.meta.dirname, "..");
const saved = process.env.APP_JWT_SECRET;
before(() => { process.env.APP_JWT_SECRET = "profile-fixture-only-key"; });
after(() => { if (saved === undefined) delete process.env.APP_JWT_SECRET; else process.env.APP_JWT_SECRET = saved; });
function load<T>(file: string, imports: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, console: { warn() {} }, require: (name: string) => {
    assert.ok(Object.hasOwn(imports, name), `미허용 의존성 ${name}`); return imports[name];
  } });
  return module.exports as T;
}
const user = { username: "fixture-self", name: "모의 사용자", role: "admin", status: "approved", admin_access: true,
  company: "모의 시공사", department: "안전팀", job_title: "팀장", employee_id: "A-1", phone: "01012345670", email: "self@example.invalid",
  password_hash: "가짜 비밀번호 해시", totp_secret: "가짜 인증 비밀", guardian_phone: "01099999999" };
function harness(value: typeof user | null = user, fail: boolean | "profile" | "owner" = false) {
  const calls: string[] = [];
  const db = {
    async findUserByUsername(username: string, options: { readOnly?: boolean }) {
      assert.equal(options.readOnly, true); calls.push(username); if (fail === true || (fail === "profile" && calls.length === 2)) throw Error("DB 실패"); return value;
    },
    async getOwnerProfile(username: string, options: { readOnly?: boolean }) {
      assert.equal(options.readOnly, true); calls.push(username); if (fail === "owner") throw Error("프로필 조회 실패"); return { ...user, username };
    },
  };
  const gate = load("lib/app-admin-auth.ts", { "./app-jwt": jwt, "./db": db });
  const route = load<{ GET: (request: Request) => Promise<Response> }>("app/api/app/admin/profile/route.ts", {
    "next/server": { NextResponse }, "../../../../../lib/app-admin-auth": gate,
    "../../../../../lib/db": db, "../../../../../lib/app-member-profile": { appMemberProfile },
  });
  return { ...route, calls };
}
function request(role = "admin", token: string | null = jwt.signMobileAccessJwt({ sub: "fixture-self", role, name: "모의", workerId: null, sessionId: "fixture-session" })) {
  return new Request("https://fixture.invalid/api/app/admin/profile?username=another-user", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test("전화는 앞3/뒤2만 공개하고 짧거나 없는 번호를 만들지 않는다", () => {
  assert.equal(maskProfilePhone("010-1234-5670"), "010-****-**70");
  assert.equal(maskProfilePhone("0311234570"), "031-***-**70");
  assert.equal(maskProfilePhone(null), null); assert.equal(maskProfilePhone("1234"), null);
  const masked = maskProfilePhone("+82 10 1234 5670")!; assert.equal(masked.replace(/\D/g, "").length, 5);
});
test("요청ID를 무시하고 인증된 본인만 조회하며 전화원문/비밀은 DTO에서 제외한다", async () => {
  const h = harness(); const response = await h.GET(request()); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.profile.username, "fixture-self"); assert.equal(body.profile.phoneMasked, "010-****-**70");
  assert.equal(body.profile.jobTitle, "팀장"); assert.equal(body.profile.company, "모의 시공사");
  assert.ok(h.calls.every(x => x === "fixture-self"));
  for (const key of ["phone", "guardian_phone", "password_hash", "totp_secret"]) assert.ok(!(key in body.profile));
  assert.ok(!JSON.stringify(body).includes(user.phone));
});
test("앱JWT 없는 요청과 구형 단말 토큰을 거부한다", async () => {
  const h = harness(); assert.equal((await h.GET(request("admin", null))).status, 401);
  assert.equal((await h.GET(request("admin", "invalid-fixture"))).status, 401);
  const legacy = jwt.signAppJwt({ sub: "fixture-self", role: "admin", name: "모의", workerId: null });
  assert.equal((await h.GET(request("admin", legacy))).status, 401); assert.equal(h.calls.length, 0);
});
test("회수된 관리 권한과 퇴사 계정은 즉시 차단한다", async () => {
  assert.equal((await harness({ ...user, admin_access: false }).GET(request())).status, 403);
  assert.equal((await harness({ ...user, status: "rejected" }).GET(request())).status, 403);
});
test("DB 장애는 503이며 거짓 프로필을 돌려주지 않는다", async () => {
  const response = await harness(user, true).GET(request()); assert.equal(response.status, 503);
  assert.ok(!("profile" in await response.json()));
});
test("users 행 없는 owner만 자신의 owner_profile을 읽는다", async () => {
  const h = harness(null);const response = await h.GET(request("owner")); const body = await response.json();
  assert.equal(response.status, 200);assert.equal(body.profile.username, "fixture-self");assert.equal(body.profile.phoneMasked, "010-****-**70");
  assert.equal((await harness(null).GET(request("admin"))).status, 403);
});
test("owner 프로필 읽기 전용 옵션은 스키마 초기화 경로를 거치지 않는다", async () => {
  const src = readFileSync(join(root, "lib/db.ts"), "utf8");const ast = ts.createSourceFile("db.ts", src, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "getOwnerProfile")!;
  let direct = 0;let initializing = 0;
  const module = { exports: {} as { getOwnerProfile?: (id: string, options?: { readOnly?: boolean }) => Promise<unknown> } };
  runInNewContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, getPool: () => ({ query: async (_: string, values: string[]) => { assert.deepEqual(Array.from(values), ["fixture-self"]);direct++;return { rows: [] }; } }),
    q: async () => { initializing++;return { rows: [] }; },
  });
  await module.exports.getOwnerProfile!("fixture-self", { readOnly: true });assert.equal(direct, 1);assert.equal(initializing, 0);
  await module.exports.getOwnerProfile!("fixture-self");assert.equal(initializing, 1);
});

test("프로필 재조회 및 owner_profile 조회 장애도 503으로 닫는다", async () => {
  for (const response of [await harness(user, "profile").GET(request()), await harness(null, "owner").GET(request("owner"))]) {
    assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json(); assert.ok(!("profile" in body)); assert.ok(!JSON.stringify(body).includes(user.phone));
  }
});
