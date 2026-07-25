// 토큰버킷 레이트리밋 단위 테스트 — 한도 초과 차단·시간 회복·XFF 위조 우회 방지 회귀
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { clientIpForRateLimit, consumeToken, resetRateLimits } from "./rate-limit";

test("한도까지는 허용하고 초과분은 차단한다", () => {
  resetRateLimits();
  for (let i = 0; i < 3; i += 1) {
    assert.equal(consumeToken("k1", 3, 60_000), true, `${i + 1}번째는 허용`);
  }
  assert.equal(consumeToken("k1", 3, 60_000), false);
});

test("키가 다르면 서로 영향을 주지 않는다", () => {
  resetRateLimits();
  assert.equal(consumeToken("a", 1, 60_000), true);
  assert.equal(consumeToken("a", 1, 60_000), false);
  assert.equal(consumeToken("b", 1, 60_000), true);
});

test("윈도가 지나면 토큰이 회복된다", async () => {
  resetRateLimits();
  assert.equal(consumeToken("slow", 1, 20), true);
  assert.equal(consumeToken("slow", 1, 20), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(consumeToken("slow", 1, 20), true);
});

// BE-AUTHZ-07 회귀 — 클라이언트가 XFF 를 위조해도 프록시가 마지막에 덧붙인 실제 IP 를 쓴다.
// 최우측이 정답인 근거는 라이브 실측(2026-07-25) — rate-limit.ts 주석 참조.
// 이 테스트는 admin-auth.ts 의 clientIpFromXff 와 같은 규칙임을 고정한다(두 곳이 어긋나면 안 된다).
test("XFF 위조값이 앞에 와도 최우측(프록시가 덧붙인 실제 IP)을 쓴다", () => {
  const forged = new Request("https://x.test", {
    headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.9" },
  });
  assert.equal(clientIpForRateLimit(forged), "203.0.113.9");
});

test("위조 홉이 여러 개여도 최우측만 신뢰한다", () => {
  const forged = new Request("https://x.test", {
    headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.9" },
  });
  assert.equal(clientIpForRateLimit(forged), "203.0.113.9");
});

test("XFF 가 한 개면 그 값을 쓴다", () => {
  const single = new Request("https://x.test", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(clientIpForRateLimit(single), "203.0.113.9");
});

test("XFF 가 없으면 x-real-ip, 그것도 없으면 unknown", () => {
  assert.equal(
    clientIpForRateLimit(new Request("https://x.test", { headers: { "x-real-ip": "8.8.8.8" } })),
    "8.8.8.8",
  );
  assert.equal(clientIpForRateLimit(new Request("https://x.test")), "unknown");
});
