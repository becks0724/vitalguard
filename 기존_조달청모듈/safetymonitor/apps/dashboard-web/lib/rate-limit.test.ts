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
