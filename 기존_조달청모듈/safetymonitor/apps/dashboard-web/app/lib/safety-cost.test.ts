// 안전관리비 룰엔진 단위테스트. 프로젝트에서는 `pnpm --filter @safetymonitor/dashboard-web test`
// (tsx --test) 로 실행. 의존성 없이 node 타입스트리핑으로도 검증 가능(개발 중 빠른 확인용).
// 요율: 고시 제2025-11호 별표1(신 4공종). 기초액 단위 '원'.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OVER_APPROPRIATION_RATIO,
  bracketOf,
  computeRequiredSafetyCost,
  evaluateSafetyCost,
} from "./safety-cost";

test("구간 판정 — 경계값은 상위 구간 포함", () => {
  assert.equal(bracketOf(499_999_999), "under5");
  assert.equal(bracketOf(500_000_000), "mid"); // 정확히 5억 → mid
  assert.equal(bracketOf(4_999_999_999), "mid");
  assert.equal(bracketOf(5_000_000_000), "over50"); // 정확히 50억 → over50
});

test("5억 미만 — 대상액 × 요율", () => {
  const r = computeRequiredSafetyCost("건축공사", 300_000_000);
  assert.equal(r.bracket, "under5");
  assert.equal(r.requiredCost, 9_330_000); // 300,000,000 × 3.11%
});

test("5억~50억 — 요율 + 기초액", () => {
  const r = computeRequiredSafetyCost("건축공사", 1_450_000_000);
  assert.equal(r.bracket, "mid");
  // 1,450,000,000 × 2.28% + 4,325,000 = 33,060,000 + 4,325,000
  assert.equal(r.requiredCost, 37_385_000);
});

test("5억 경계 — mid 식 적용", () => {
  const r = computeRequiredSafetyCost("건축공사", 500_000_000);
  // 500,000,000 × 2.28% + 4,325,000 = 11,400,000 + 4,325,000
  assert.equal(r.requiredCost, 15_725_000);
});

test("50억 경계 — over50 식 적용(기초액 없음)", () => {
  const r = computeRequiredSafetyCost("건축공사", 5_000_000_000);
  assert.equal(r.bracket, "over50");
  assert.equal(r.baseAdded, 0);
  assert.equal(r.requiredCost, 118_500_000); // 5,000,000,000 × 2.37%
});

test("토목공사 mid 요율·기초액", () => {
  const r = computeRequiredSafetyCost("토목공사", 1_000_000_000);
  // 1,000,000,000 × 2.53% + 3,300,000 = 25,300,000 + 3,300,000
  assert.equal(r.requiredCost, 28_600_000);
});

test("판정 — 명시값 없음/근사면 검토필요(단정 금지)", () => {
  const c = evaluateSafetyCost({
    constructionType: "건축공사",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: true,
    declaredCost: null,
  });
  assert.equal(c.inputSufficiency, "partial");
  assert.equal(c.verdict, "검토필요");
});

test("판정 — 명시값 < 기준액이면 과소계상 의심", () => {
  const c = evaluateSafetyCost({
    constructionType: "건축공사",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: false,
    declaredCost: 10_000_000, // 기준 37,385,000 보다 작음
  });
  assert.equal(c.inputSufficiency, "full");
  assert.equal(c.verdict, "과소계상_의심");
});

test("판정 — 명시값 >= 기준액이면 정상", () => {
  const c = evaluateSafetyCost({
    constructionType: "건축공사",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: false,
    declaredCost: 40_000_000, // 기준 37,385,000 이상
  });
  assert.equal(c.verdict, "정상");
});

test("판정 — 명시값이 기준액의 1.3배 초과면 과다계상 의심", () => {
  const c = evaluateSafetyCost({
    constructionType: "건축공사",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: false,
    declaredCost: 50_000_000, // 기준 37,385,000 × 1.3 = 48,600,500 초과
  });
  assert.equal(c.verdict, "과다계상_의심");
});

// 법정 요율은 '최소' 기준이라 초과 계상 자체는 적법하다 — 경계에서 과다로 넘어가지 않아야 한다.
test("판정 — 기준액의 1.3배 정확히는 정상(초과분만 과다)", () => {
  const required = computeRequiredSafetyCost("건축공사", 1_450_000_000).requiredCost;
  const c = evaluateSafetyCost({
    constructionType: "건축공사",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: false,
    declaredCost: required * OVER_APPROPRIATION_RATIO,
  });
  assert.equal(c.verdict, "정상");
});

// 메인 관제 현장(SITE-SMARTHRD-2026) 회귀 고정 — 대상액 9억은 'mid' 구간이라 기초액이 붙는다.
// 이 값이 흔들리면 덱 p6 ①계상·중앙 배너(계상액 ÷ worker-day)가 함께 어긋난다.
test("메인 현장 9억 — mid 구간 기초액 적용 + 과다계상 의심", () => {
  const r = computeRequiredSafetyCost("건축공사", 900_000_000);
  assert.equal(r.bracket, "mid");
  // 900,000,000 × 2.28% + 4,325,000 = 20,520,000 + 4,325,000
  assert.equal(r.requiredCost, 24_845_000);

  const c = evaluateSafetyCost({
    constructionType: "건축공사",
    baseAmount: 900_000_000,
    baseAmountIsApprox: false,
    declaredCost: 35_000_000, // 24,845,000 × 1.3 = 32,298,500 초과
  });
  assert.equal(c.verdict, "과다계상_의심");
});
