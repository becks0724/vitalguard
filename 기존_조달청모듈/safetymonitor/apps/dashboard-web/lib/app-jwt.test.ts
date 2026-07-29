// 앱 JWT 서명/검증 단위 테스트 — 왕복·만료·변조·미설정.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { bootstrapOwnerWorkerId, signAppJwt, verifyAppJwt, bearerToken, isAppJwtConfigured } from "./app-jwt";

const withSecret = (fn: () => void) => {
  const prev = process.env.APP_JWT_SECRET;
  process.env.APP_JWT_SECRET = "test-secret-0123456789";
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.APP_JWT_SECRET;
    else process.env.APP_JWT_SECRET = prev;
  }
};

test("JWT — 서명 후 검증 왕복(클레임 보존)", () => {
  withSecret(() => {
    const token = signAppJwt({ sub: "admin6861", role: "worker", name: "장우진", workerId: "EMP-6861" });
    const claims = verifyAppJwt(token);
    assert.ok(claims);
    assert.equal(claims.sub, "admin6861");
    assert.equal(claims.role, "worker");
    assert.equal(claims.name, "장우진");
    assert.equal(claims.workerId, "EMP-6861");
    assert.ok(claims.exp > claims.iat);
  });
});

test("JWT — 부트스트랩 소유자도 안정적인 workerId로 생체 전송에 바인딩", () => {
  withSecret(() => {
    const workerId = bootstrapOwnerWorkerId("admin");
    assert.match(workerId, /^owner-[a-f0-9]{16}$/);
    assert.equal(workerId, bootstrapOwnerWorkerId("admin"));
    assert.notEqual(workerId, bootstrapOwnerWorkerId("admin2"));

    const claims = verifyAppJwt(signAppJwt({ sub: "admin", role: "owner", name: null, workerId }));
    assert.equal(claims?.workerId, workerId);
  });
});

test("JWT — 변조된 서명은 거부", () => {
  withSecret(() => {
    const token = signAppJwt({ sub: "a", role: "admin", name: null, workerId: null });
    const tampered = token.slice(0, -2) + (token.slice(-1) === "A" ? "B" : "A");
    assert.equal(verifyAppJwt(tampered), null);
  });
});

test("JWT — 다른 시크릿으로 서명한 토큰은 거부", () => {
  let token = "";
  withSecret(() => {
    token = signAppJwt({ sub: "a", role: "admin", name: null, workerId: null });
  });
  const prev = process.env.APP_JWT_SECRET;
  process.env.APP_JWT_SECRET = "다른-시크릿";
  assert.equal(verifyAppJwt(token), null);
  if (prev === undefined) delete process.env.APP_JWT_SECRET;
  else process.env.APP_JWT_SECRET = prev;
});

test("JWT — 만료 토큰 거부", () => {
  withSecret(() => {
    // exp 를 과거로 직접 조작한 페이로드로 서명(내부와 동일 형식).
    const secret = process.env.APP_JWT_SECRET as string;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64({ sub: "a", role: "admin", name: null, workerId: null, iat: 1, exp: 2 });
    const sig = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
    assert.equal(verifyAppJwt(`${h}.${p}.${sig}`), null);
  });
});

test("JWT — 시크릿 미설정 시 검증 null·미설정 플래그", () => {
  const prev = process.env.APP_JWT_SECRET;
  delete process.env.APP_JWT_SECRET;
  assert.equal(isAppJwtConfigured(), false);
  assert.equal(verifyAppJwt("x.y.z"), null);
  if (prev !== undefined) process.env.APP_JWT_SECRET = prev;
});

test("JWT — bearerToken 추출", () => {
  const req = new Request("https://x", { headers: { authorization: "Bearer abc.def.ghi" } });
  assert.equal(bearerToken(req), "abc.def.ghi");
  const noauth = new Request("https://x");
  assert.equal(bearerToken(noauth), null);
});
