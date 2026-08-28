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
  typesMatchingRate,
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

// ── 요율 → 공종 역추론(담당관 확정 화면의 힌트) ─────────────────────────
// 실측 사례(2026-08-27): 「가운중앙근린공원 리모델링」 자동 추정=건축(3.11%) vs 문서 요율=2.07%.
// 힌트가 이 문서 요율을 특수건설공사로 짚어 줘야 담당관이 오분류를 바로잡는다.
test("요율 역추론 — 2.07% 는 특수건설공사(5억 미만) 하나로 떨어진다", () => {
  const c = typesMatchingRate(2.07);
  assert.deepEqual(c, [{ type: "특수건설공사", bracket: "under5" }]);
});

// ⚠ 답이 하나가 아닐 수 있다 — 3.11% 는 건축(5억 미만)이자 중건설(50억 이상)이다.
//   하나만 돌려주면 나머지 가능성이 조용히 사라지므로 후보 전부를 내야 한다.
test("요율 역추론 — 3.11% 는 대상액 없이는 후보가 둘이다", () => {
  const c = typesMatchingRate(3.11);
  assert.equal(c.length, 2);
  assert.ok(c.some((x) => x.type === "건축공사" && x.bracket === "under5"));
  assert.ok(c.some((x) => x.type === "중건설공사" && x.bracket === "over50"));
});

test("요율 역추론 — 대상액을 알면 구간이 정해져 후보가 좁는다", () => {
  assert.deepEqual(typesMatchingRate(3.11, 100_000_000), [{ type: "건축공사", bracket: "under5" }]);
  // 별표1 에 없는 요율은 빈 배열 — 힌트가 "일치 없음(원본 확인)" 으로 말할 근거.
  assert.deepEqual(typesMatchingRate(9.99), []);
});

// ── 끝수 계산(국고금 관리법 제47조) — 법정 절사를 과소계상으로 오탐하지 않는다 ─────────
// 실측 사례(2026-08-27): 풀베기사업(군내임회지구) 원가계산서 — 대상액 40,072,880 × 2.07%
// = 829,508.616 을 발주처가 829,508원으로 계상(끝수 버림). 반올림 기준액 829,509와 비교하면
// 1원 미달로 '과소계상_의심'이 떴다. 제47조는 10원 미만 끝수를 계산하지 않는다(③ 지자체 준용).
test("판정 — 10원 미만 끝수 버림 계상은 정상(제47조)", () => {
  const c = evaluateSafetyCost({
    constructionType: "특수건설공사",
    baseAmount: 40_072_880, // 정확값 829,508.616 · 반올림 829,509 · 끝수버림 하한 829,500
    baseAmountIsApprox: false,
    declaredCost: 829_508, // 실제 문서 값
  });
  assert.equal(c.verdict, "정상");
  // 끝수 최대 폭(9원대)까지도 정상 — 법이 허용하는 범위다.
  const edge = evaluateSafetyCost({
    constructionType: "특수건설공사",
    baseAmount: 40_072_880,
    baseAmountIsApprox: false,
    declaredCost: 829_500,
  });
  assert.equal(edge.verdict, "정상");
});

test("판정 — 끝수를 넘는 미달은 여전히 과소계상 의심이다", () => {
  const c = evaluateSafetyCost({
    constructionType: "특수건설공사",
    baseAmount: 40_072_880,
    baseAmountIsApprox: false,
    declaredCost: 829_499, // 끝수버림 하한(829,500) 아래 — 법정 처리로 설명되지 않는 미달
  });
  assert.equal(c.verdict, "과소계상_의심");
});

// 끝수 폭이 판정을 갈랐으면 화면 안내(verdictNote)가 함께 나온다 — 기준액보다 적은데
// '정상'이면 화면만 보고는 오판정으로 읽힌다(2026-08-27 사용자 지시 "법정 폭 안내도 같이").
test("끝수 정상 판정에는 제47조 안내가 붙고, 평범한 정상에는 안 붙는다", () => {
  const ends = evaluateSafetyCost({
    constructionType: "특수건설공사",
    baseAmount: 40_072_880,
    baseAmountIsApprox: false,
    declaredCost: 829_508, // 기준액 829,509 보다 1원 적음 — 끝수 폭 안
  });
  assert.equal(ends.verdict, "정상");
  assert.ok(ends.verdictNote?.includes("제47조"), "끝수 안내가 없다 — 화면에서 오판정으로 읽힌다");
  assert.ok(ends.verdictNote?.includes("1원"), "몇 원 차이인지 안내에 없다");

  const plain = evaluateSafetyCost({
    constructionType: "특수건설공사",
    baseAmount: 40_072_880,
    baseAmountIsApprox: false,
    declaredCost: 830_000, // 기준액 이상 — 안내가 붙으면 오히려 소음
  });
  assert.equal(plain.verdict, "정상");
  assert.equal(plain.verdictNote, undefined);
});
