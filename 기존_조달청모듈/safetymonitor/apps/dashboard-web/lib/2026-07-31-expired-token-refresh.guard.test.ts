// 만료 액세스 토큰을 재로그인이 아니라 refresh 로 분류하는지 고정하는 가드.
//
// 실제로 일어난 일(2026-07-31) — 앱을 15분(액세스 토큰 수명) 넘게 놔뒀다 다시 켜면
// "다시 로그인 필요"가 떴다. 원인은 서버가 만료를 action:"reauth" 로 내보낸 것이다.
//
//   앱: 401 + action=="reauth"  →  deleteMobileSession()
//       그 안에서 appJWT · refreshToken · password 를 모두 지운다
//   그 직후 앱이 refresh 를 시도하지만 refreshToken 이 이미 없어 실패
//
// 즉 회복 수단을 회복 신호가 지워버렸다. mobile_app_session 13건이 전부
// updated_at == created_at(회전 0회)였던 것이 그 증거다.
//
// 만료는 세션이 살아 있는 상태라 refresh 로 풀린다. 반대로 사번 누락·구 스키마는
// refresh 해도 같은 클레임이 재발급되므로 반드시 reauth 여야 한다 — 이 구분이 핵심이고
// 뒤집히면 무한 재로그인 또는 무한 refresh 중 하나에 빠진다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { diagnoseAppAuth, mobileUnauthorizedAction, signAppJwt, signMobileAccessJwt } from "./app-jwt";

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

const req = (auth?: string) =>
  new Request("https://x.test/api/app/vital", {
    method: "POST",
    headers: { ...(auth ? { authorization: auth } : {}), "user-agent": "VitAlGuard/85" },
  });

test("만료된 액세스 토큰 → refresh (세션이 살아 있으므로 재로그인 아님)", () => {
  withSecret(() => {
    const token = signMobileAccessJwt({
      sub: "admin6861",
      role: "admin",
      name: "장우진",
      workerId: "EMP-admin6861",
      sessionId: "s-1",
    });
    // 시계를 토큰 수명(15분) 너머로 밀어 만료 상태를 만든다.
    const real = Date.now;
    Date.now = () => real() + 16 * 60 * 1000;
    try {
      assert.equal(mobileUnauthorizedAction(token), "refresh");
    } finally {
      Date.now = real;
    }
  });
});

test("유효한 토큰은 none — 401 자체가 나면 안 되는 상태", () => {
  withSecret(() => {
    const token = signMobileAccessJwt({
      sub: "admin6861",
      role: "admin",
      name: "장우진",
      workerId: "EMP-admin6861",
      sessionId: "s-1",
    });
    assert.equal(mobileUnauthorizedAction(token), "none");
  });
});

test("토큰 없음 → reauth", () => {
  assert.equal(mobileUnauthorizedAction(null), "reauth");
  assert.equal(mobileUnauthorizedAction(""), "reauth");
});

test("서명 불일치 → none (재로그인해도 같은 결과)", () => {
  withSecret(() => {
    assert.equal(mobileUnauthorizedAction("a.b.c"), "none");
  });
});

// 이 순서가 뒤집히면 만료된 구 스키마 토큰이 refresh 로 가고, 같은 결함을 가진 토큰이
// 다시 발급돼 무한 반복에 빠진다.
test("사번 없는 토큰은 만료 여부와 무관하게 reauth — refresh 해도 같은 클레임이 나온다", () => {
  withSecret(() => {
    const token = signAppJwt({ sub: "admin6861", role: "admin", name: null, workerId: null });
    assert.equal(mobileUnauthorizedAction(token), "reauth");
    const real = Date.now;
    Date.now = () => real() + 400 * 24 * 60 * 60 * 1000; // 만료시킨 뒤에도
    try {
      assert.equal(mobileUnauthorizedAction(token), "reauth", "만료돼도 refresh 로 가면 안 된다");
    } finally {
      Date.now = real;
    }
  });
});

test("diagnoseAppAuth 도 만료를 refresh 로 분류한다", () => {
  withSecret(() => {
    const token = signAppJwt({
      sub: "admin6861",
      role: "admin",
      name: "장우진",
      workerId: "EMP-admin6861",
    });
    const real = Date.now;
    Date.now = () => real() + 400 * 24 * 60 * 60 * 1000;
    try {
      const d = diagnoseAppAuth(req(`Bearer ${token}`), { requireWorkerId: true });
      assert.equal(d.reason, "expired");
      assert.equal(d.action, "refresh", "만료를 reauth 로 내보내면 앱이 refresh 토큰을 지운다");
    } finally {
      Date.now = real;
    }
  });
});

// action 을 하드코딩한 라우트가 있으면 만료/재로그인 구분이 그 자리에서 무너진다.
// /me 가 실제로 그랬다 — 분류 함수를 고쳐도 하드코딩이 덮어써 수정이 무력했다.
// refresh·logout 의 하드코딩은 의도된 것이다: 그 401 은 세션 자체가 없다는 뜻이라 재로그인이 맞다.
test("세션 me 라우트는 action 을 하드코딩하지 않고 분류 함수를 쓴다", () => {
  const src = readFileSync("app/api/mobile/v1/session/me/route.ts", "utf8");
  assert.match(src, /action: mobileUnauthorizedAction\(/, "me 가 action 을 하드코딩하고 있다");
  assert.doesNotMatch(src, /action: "reauth"/, "하드코딩된 reauth 가 남아 있다");
});
