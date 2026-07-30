// 인증 거부 진단 — 사유는 로그로만, 응답에는 복구 가능 여부(action)만.
//
// 배경(2026-07-29): 토큰 인증은 네 가지로 실패하는데(무토큰·서명오류·만료·클레임누락)
// 응답이 전부 401 하나라 원인을 못 찾고 배포를 4회 롤백했다. 그렇다고 응답에 사유를 실으면
// "서명은 맞는데 만료됨"과 "서명 자체가 틀림"을 외부에 알려주는 셈이라 키 추측에 힌트가 된다.
// 그래서 사유는 서버 로그, 응답은 action 만 — 이 경계가 깨지지 않도록 고정한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { diagnoseAppAuth, signAppJwt } from "./app-jwt";

const root = resolve(__dirname, "..");

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
  new Request("https://x.test/api/mock/vital", {
    method: "POST",
    headers: {
      ...(auth ? { authorization: auth } : {}),
      "user-agent": "VitAlGuard/83",
    },
  });

test("토큰이 없으면 no_token · 재로그인으로 복구 가능", () => {
  const d = diagnoseAppAuth(req());
  assert.equal(d.reason, "no_token");
  assert.equal(d.action, "reauth");
});

test("서명이 틀리면 verify_failed · 재로그인해도 소용없으므로 none", () => {
  withSecret(() => {
    const d = diagnoseAppAuth(req("Bearer a.b.c"));
    assert.equal(d.reason, "verify_failed");
    assert.equal(d.action, "none", "서명 불일치는 앱이 재로그인해도 같은 결과다");
  });
});

test("사번 없는 토큰은 no_worker_id · 재로그인하면 새 사번이 실린다", () => {
  withSecret(() => {
    // 2026-07-27 사번 백필 이전에 발급된 토큰이 정확히 이 모양이었다.
    const token = signAppJwt({ sub: "admin6861", role: "admin", name: null, workerId: null });
    const d = diagnoseAppAuth(req(`Bearer ${token}`), { requireWorkerId: true });
    assert.equal(d.reason, "no_worker_id");
    assert.equal(d.action, "reauth");
  });
});

test("로그에는 판별에 필요한 것만 남고 토큰 문자열은 절대 안 들어간다", () => {
  withSecret(() => {
    const token = signAppJwt({ sub: "admin6861", role: "admin", name: null, workerId: null });
    const d = diagnoseAppAuth(req(`Bearer ${token}`), { requireWorkerId: true });
    // 있어야 할 것 — 이게 없으면 "낡은 토큰인지 방금 발급인지"를 못 가린다.
    assert.match(d.logLine, /sub=admin6861/);
    assert.match(d.logLine, /iat=\d{4}-\d{2}-\d{2}T/, "발급 시각이 낡은 토큰 판별자다");
    assert.match(d.logLine, /ua=VitAlGuard\/83/, "클라이언트 버전이 구버전 잔존 판별자다");
    // 절대 없어야 할 것
    assert.doesNotMatch(d.logLine, new RegExp(token.slice(0, 24)), "토큰 문자열이 로그에 샜다");
    assert.doesNotMatch(d.logLine, /test-secret/, "시크릿이 로그에 샜다");
  });
});

test("401 응답 본문에 사유를 싣지 않는다(서명 성공 여부 노출 금지)", () => {
  const vital = readFileSync(resolve(root, "app/api/mock/vital/route.ts"), "utf8");
  const block = vital.slice(vital.indexOf("!claims?.workerId"), vital.indexOf("!claims?.workerId") + 600);
  assert.match(block, /action: d\.action/, "응답에 action 이 없으면 앱이 재로그인을 못 띄운다");
  assert.doesNotMatch(block, /reason: d\.reason|error: d\.reason/, "사유를 응답에 실으면 외부로 샌다");
  assert.match(block, /console\.warn/, "사유는 서버 로그에 남아야 한다");
});
