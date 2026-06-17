// 안전관리비 룰엔진 단위테스트. 프로젝트에서는 `pnpm --filter @safetymonitor/dashboard-web test`
// (tsx --test) 로 실행. 의존성 없이 node 타입스트리핑으로도 검증 가능(개발 중 빠른 확인용).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketOf, computeRequiredSafetyCost, evaluateSafetyCost } from "./safety-cost";

test("구간 판정 — 경계값은 상위 구간 포함", () => {
  assert.equal(bracketOf(499_999_999), "under5");
  assert.equal(bracketOf(500_000_000), "mid"); // 정확히 5억 → mid
  assert.equal(bracketOf(4_999_999_999), "mid");
  assert.equal(bracketOf(5_000_000_000), "over50"); // 정확히 50억 → over50
});

test("5억 미만 — 대상액 × 요율", () => {
  const r = computeRequiredSafetyCost("일반건설공사(갑)", 300_000_000);
  assert.equal(r.bracket, "under5");
  assert.equal(r.requiredCost, 8_790_000); // 300,000,000 × 2.93%
});

test("5억~50억 — 요율 + 기초액 (API-Spec 예시와 일치)", () => {
  const r = computeRequiredSafetyCost("일반건설공사(갑)", 1_450_000_000);
  assert.equal(r.bracket, "mid");
  // 1,450,000,000 × 1.86% + 5,349,000 = 26,970,000 + 5,349,000
  assert.equal(r.requiredCost, 32_319_000);
});

test("5억 경계 — mid 식 적용", () => {
  const r = computeRequiredSafetyCost("일반건설공사(갑)", 500_000_000);
  // 500,000,000 × 1.86% + 5,349,000 = 9,300,000 + 5,349,000
  assert.equal(r.requiredCost, 14_649_000);
});

test("50억 경계 — over50 식 적용(기초액 없음)", () => {
  const r = computeRequiredSafetyCost("일반건설공사(갑)", 5_000_000_000);
  assert.equal(r.bracket, "over50");
  assert.equal(r.baseAdded, 0);
  assert.equal(r.requiredCost, 98_500_000); // 5,000,000,000 × 1.97%
});

test("일반건설공사(을) mid 요율·기초액", () => {
  const r = computeRequiredSafetyCost("일반건설공사(을)", 1_000_000_000);
  // 1,000,000,000 × 1.99% + 5,499,000 = 19,900,000 + 5,499,000
  assert.equal(r.requiredCost, 25_399_000);
});

test("판정 — 명시값 없음/근사면 검토필요(단정 금지)", () => {
  const c = evaluateSafetyCost({
    constructionType: "일반건설공사(갑)",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: true,
    declaredCost: null,
  });
  assert.equal(c.inputSufficiency, "partial");
  assert.equal(c.verdict, "검토필요");
});

test("판정 — 명시값 < 기준액이면 과소계상 의심", () => {
  const c = evaluateSafetyCost({
    constructionType: "일반건설공사(갑)",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: false,
    declaredCost: 10_000_000, // 기준 32,319,000 보다 작음
  });
  assert.equal(c.inputSufficiency, "full");
  assert.equal(c.verdict, "과소계상_의심");
});

test("판정 — 명시값 >= 기준액이면 정상", () => {
  const c = evaluateSafetyCost({
    constructionType: "일반건설공사(갑)",
    baseAmount: 1_450_000_000,
    baseAmountIsApprox: false,
    declaredCost: 40_000_000,
  });
  assert.equal(c.verdict, "정상");
});
