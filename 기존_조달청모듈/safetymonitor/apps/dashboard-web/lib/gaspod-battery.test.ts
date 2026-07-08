// 가스포드 단말 배터리 전압→잔량 곡선 보간 단위 테스트 — 하드웨어 팀 검산(3.75V→53%) + 경계.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { vbatToPercent } from "./gaspod-battery.js";

test("vbatToPercent — 하드웨어 검산(3.75V → 53%)", () => {
  assert.equal(vbatToPercent(3.75), 53);
});

test("vbatToPercent — 만충/상한(≥4.15V) = 100", () => {
  assert.equal(vbatToPercent(4.2), 100);
  assert.equal(vbatToPercent(4.15), 100);
});

test("vbatToPercent — 안전종료선(3.0V)=0 · 그 이하도 0", () => {
  assert.equal(vbatToPercent(3.0), 0);
  assert.equal(vbatToPercent(2.8), 0);
});

test("vbatToPercent — 곡선 꼭짓점 정확 반환", () => {
  assert.equal(vbatToPercent(3.5), 20);
  assert.equal(vbatToPercent(3.9), 75);
  assert.equal(vbatToPercent(3.2), 4);
});

test("vbatToPercent — 구간 선형보간(3.72V → 48%)", () => {
  // 3.7V(45%)~3.8V(60%) 사이: 45 + (0.02/0.1)*15 = 48.
  assert.equal(vbatToPercent(3.72), 48);
});

test("vbatToPercent — NaN/무효 입력은 0", () => {
  assert.equal(vbatToPercent(Number.NaN), 0);
});
