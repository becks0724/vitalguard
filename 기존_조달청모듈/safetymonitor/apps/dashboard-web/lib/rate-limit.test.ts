// 토큰버킷 레이트리밋 단위 테스트 — 한도 초과 차단·시간 회복·XFF 위조 우회 방지 회귀
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { consumeToken, resetRateLimits } from "./rate-limit";

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

// 감사 DLT-LIB-006 회귀 — 시계가 뒤로 가도 토큰이 거꾸로 깎이면 안 된다.
// 역행 폭만큼 정상 트래픽이 전면 429 가 되고, 워치·폰은 429 를 재전송하지 않아 무음 유실이 된다.
test("시계 역행 시 토큰이 깎이지 않는다", () => {
  resetRateLimits();
  const T = 1_000_000;
  assert.equal(consumeToken("clock", 10, 60_000, T), true);
  // 1시간 역행 — 과거에는 refill 이 큰 음수가 되어 이후 요청이 전부 막혔다.
  assert.equal(consumeToken("clock", 10, 60_000, T - 3_600_000), true, "역행 직후도 허용");
  assert.equal(consumeToken("clock", 10, 60_000, T - 3_600_000), true, "연속 요청도 허용");
  // 정상 시각으로 복귀해도 계속 동작
  assert.equal(consumeToken("clock", 10, 60_000, T + 1_000), true);
});

// 감사 DLT-LIB-007 회귀 — 잘못된 인자로 리미터가 조용히 꺼지면 안 된다(fail-closed).
test("windowMs 가 0·NaN 이면 통과시키지 않는다", () => {
  resetRateLimits();
  assert.equal(consumeToken("bad", 10, 0), false);
  assert.equal(consumeToken("bad", 10, Number.NaN), false);
});

test("limit 이 0·음수·NaN 이면 통과시키지 않는다", () => {
  resetRateLimits();
  assert.equal(consumeToken("bad2", 0, 60_000), false);
  assert.equal(consumeToken("bad2", -5, 60_000), false);
  assert.equal(consumeToken("bad2", Number.NaN, 60_000), false);
});
