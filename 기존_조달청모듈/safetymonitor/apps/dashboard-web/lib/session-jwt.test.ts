// 대시보드 세션 JWT 단위 테스트 — 서명 왕복·변조 거부·페이로드 바인딩·형식 검증.
// (키는 모듈 내부에서 프로세스 단위로 일관 — 왕복/변조 테스트는 외부 키 불필요.)
import assert from "node:assert/strict";
import { test } from "node:test";

import { signSessionJwt, verifySessionJwt } from "./session-jwt";

test("roundtrip — 서명한 토큰을 검증하면 클레임 반환", () => {
  const token = signSessionJwt({ sub: "admin", role: "owner" });
  const claims = verifySessionJwt(token);
  assert.ok(claims, "유효 토큰은 클레임 반환");
  assert.equal(claims!.sub, "admin");
  assert.equal(claims!.role, "owner");
  assert.ok(claims!.exp > Math.floor(Date.now() / 1000), "exp 는 미래");
  assert.ok(claims!.exp - claims!.iat > 0, "exp > iat");
});

test("admin 역할 왕복", () => {
  const claims = verifySessionJwt(signSessionJwt({ sub: "user1", role: "admin" }));
  assert.equal(claims?.role, "admin");
  assert.equal(claims?.sub, "user1");
});

test("서명 변조 거부", () => {
  const token = signSessionJwt({ sub: "admin", role: "owner" });
  const [h, p, s] = token.split(".");
  const tampered = `${h}.${p}.${s!.slice(0, -3)}xyz`;
  assert.equal(verifySessionJwt(tampered), null);
});

test("페이로드 교체(기존 서명 유지) 거부 — 서명이 페이로드를 바인딩", () => {
  const token = signSessionJwt({ sub: "admin", role: "admin" });
  const [h, , s] = token.split(".");
  // 권한 상승 시도: role 을 owner 로 바꾼 페이로드 + 기존 서명 → 서명 불일치로 거부
  const forged = Buffer.from(
    JSON.stringify({ sub: "attacker", role: "owner", iat: 0, exp: 9999999999 }),
  ).toString("base64url");
  assert.equal(verifySessionJwt(`${h}.${forged}.${s}`), null);
});

test("형식 오류 거부", () => {
  assert.equal(verifySessionJwt(null), null);
  assert.equal(verifySessionJwt(undefined), null);
  assert.equal(verifySessionJwt(""), null);
  assert.equal(verifySessionJwt("a.b"), null);
  assert.equal(verifySessionJwt("only-one-part"), null);
  assert.equal(verifySessionJwt("garbage.value.here"), null);
});
