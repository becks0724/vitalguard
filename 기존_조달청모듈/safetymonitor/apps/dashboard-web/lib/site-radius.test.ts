// 관제구역 반경 정책 단위 테스트 — 클램프 경계와 비유한 입력.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SITE_RADIUS_MAX_M, SITE_RADIUS_MIN_M, clampSiteRadiusM } from "./site-radius";

test("정책 범위는 50~100m", () => {
  assert.equal(SITE_RADIUS_MIN_M, 50);
  assert.equal(SITE_RADIUS_MAX_M, 100);
});

test("범위 안 값은 그대로 통과한다", () => {
  assert.equal(clampSiteRadiusM(50), 50);
  assert.equal(clampSiteRadiusM(75), 75);
  assert.equal(clampSiteRadiusM(100), 100);
});

test("하한 미만은 50 으로 올린다 — 측위 오차가 반경을 넘으면 이탈이 오탐이 된다", () => {
  assert.equal(clampSiteRadiusM(10), 50);
  assert.equal(clampSiteRadiusM(0), 50);
  assert.equal(clampSiteRadiusM(-30), 50);
});

test("상한 초과는 100 으로 내린다 — 구 앱의 500m 가 관제 100m 와 5배 어긋나 있었다", () => {
  assert.equal(clampSiteRadiusM(101), 100);
  assert.equal(clampSiteRadiusM(500), 100);
  assert.equal(clampSiteRadiusM(5000), 100);
});

test("비유한 값은 상한으로 — 하한으로 떨어뜨리면 오탐 이탈이 쏟아진다", () => {
  assert.equal(clampSiteRadiusM(Number.NaN), 100);
  assert.equal(clampSiteRadiusM(Number.POSITIVE_INFINITY), 100);
  assert.equal(clampSiteRadiusM(Number.NEGATIVE_INFINITY), 100);
});
