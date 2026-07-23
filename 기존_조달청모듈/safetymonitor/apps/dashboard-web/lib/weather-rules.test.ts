// 풍속 판정 단위 테스트 — 크레인/고소 중지 임계(순간풍속 기준)가 돌풍 값으로 판정되는지 회귀 고정.
// 배경: 평균풍속(2.9m/s)만 보고 "정상" 표시되던 사이, 예보 돌풍 10.5m/s 가 임계(10m/s) 초과하던 불일치.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { evaluateWindKmh } from "./weather-rules.js";

test("돌풍 미제공 — 평균풍속 폴백 판정 + 한계 명시", () => {
  const r = evaluateWindKmh(10.6);
  assert.equal(r.currentSeverity, "normal");
  assert.ok(r.currentValue.includes("돌풍 데이터 없음"));
  assert.ok(r.baseline.includes("평균풍속으로 판정"));
});

test("평균 2.9m/s·돌풍 10.5m/s — 평균 미만이어도 돌풍 초과 = 주의(타워크레인/고소 중지)", () => {
  // 현장 재현 케이스: 평균 10.6km/h(2.9m/s) 정상 표시 + 돌풍 37.8km/h(10.5m/s) 임계 초과.
  const r = evaluateWindKmh(10.6, 37.8);
  assert.equal(r.currentSeverity, "caution");
  assert.ok(r.currentStep?.label.includes("10m/s"));
  assert.ok(r.currentStep?.label.includes("타워크레인"));
});

test("돌풍 15m/s 이상 — 위험(타워크레인 운전·옥외작업 중지·법적)", () => {
  const r = evaluateWindKmh(20, 55.1); // 15.3m/s
  assert.equal(r.currentSeverity, "danger");
  assert.equal(r.currentStep?.binding, "legal");
  assert.ok(r.currentStep?.label.includes("15m/s"));
});

test("경계값 — 돌풍 36km/h(10.0m/s)=주의 · 54km/h(15.0m/s)=위험", () => {
  assert.equal(evaluateWindKmh(10, 36).currentSeverity, "caution");
  assert.equal(evaluateWindKmh(10, 54).currentSeverity, "danger");
});

test("돌풍 임계 미만 — 정상", () => {
  const r = evaluateWindKmh(5, 20); // 돌풍 5.6m/s
  assert.equal(r.currentSeverity, "normal");
});

test("이상 데이터(돌풍 < 평균) — 안전측으로 큰 값 판정", () => {
  const r = evaluateWindKmh(40, 20); // 평균 11.1m/s > 돌풍 5.6m/s
  assert.equal(r.currentSeverity, "caution");
});

test("표시 병기 — 돌풍 있으면 순간·평균 둘 다 currentValue 에 포함", () => {
  const r = evaluateWindKmh(10.6, 37.8);
  assert.ok(r.currentValue.includes("순간 37.8km/h (10.5m/s)"));
  assert.ok(r.currentValue.includes("평균 10.6km/h (2.9m/s)"));
});
