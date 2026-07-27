// 기상 항목 판정 단위 테스트 — 표시 심각도와 모달 본문이 어긋나던 불일치들을 회귀 고정.
// 배경1(풍속): 평균풍속(2.9m/s)만 보고 "정상" 표시되던 사이, 예보 돌풍 10.5m/s 가 임계(10m/s) 초과.
// 배경2(기상특보): 칩은 폭염경보(위험)인데 모달 본문은 "정상 범위 · 특보 없음" — currentStep 미설정.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  evaluateApparentTemp,
  evaluateDiscomfortIndex,
  evaluateKmaPreliminary,
  evaluateKmaWarning,
  evaluatePM25,
  evaluatePrecipitation,
  evaluateUV,
  evaluateWindKmh,
  type KmaEvaluationInput,
  type RuleEvaluation,
} from "./weather-rules.js";

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

function kma(over: Partial<KmaEvaluationInput> = {}): KmaEvaluationInput {
  return {
    sido: "광주",
    source: "live",
    severity: "normal",
    summary: "특보 없음",
    preliminary: [],
    preliminarySeverity: "normal",
    preliminarySummary: "예정 특보 없음",
    ...over,
  };
}

test("기상특보 경보 — 위험 + '경보' 단계가 현재 단계", () => {
  const r = evaluateKmaWarning(kma({ severity: "danger", summary: "폭염경보 · 열대야주의보" }));
  assert.equal(r.currentSeverity, "danger");
  assert.equal(r.currentStep?.severity, "danger");
  assert.ok(r.currentStep?.label.includes("경보"));
  assert.equal(r.currentValue, "폭염경보 · 열대야주의보");
});

test("기상특보 주의보 — 주의 + '주의보' 단계가 현재 단계", () => {
  const r = evaluateKmaWarning(kma({ severity: "caution", summary: "강풍주의보" }));
  assert.equal(r.currentSeverity, "caution");
  assert.equal(r.currentStep?.severity, "caution");
  assert.ok(r.currentStep?.label.includes("주의보"));
});

test("기상특보 없음 — 정상 + 현재 단계 없음(모달 '정상 범위')", () => {
  const r = evaluateKmaWarning(kma());
  assert.equal(r.currentSeverity, "normal");
  assert.equal(r.currentStep, undefined);
});

test("기상특보 조회 전(null) — 정상 + '조회 중' 표기", () => {
  const r = evaluateKmaWarning(null);
  assert.equal(r.currentSeverity, "normal");
  assert.equal(r.currentStep, undefined);
  assert.equal(r.currentValue, "조회 중");
});

test("기상특보 현재 단계는 steps 안의 객체 — 모달 하이라이트가 참조 동일성으로 걸린다", () => {
  const r = evaluateKmaWarning(kma({ severity: "danger" }));
  assert.ok(r.steps.includes(r.currentStep as (typeof r.steps)[number]));
});

test("기상특보 샘플 응답 — 근거에 '샘플' 표시", () => {
  assert.ok(evaluateKmaWarning(kma({ source: "mock" })).notes?.includes("샘플"));
});

test("예비특보 예정 — 주의 + 현재 단계 + 예정 시각을 근거에 표기", () => {
  const r = evaluateKmaPreliminary(
    kma({
      preliminarySeverity: "caution",
      preliminarySummary: "호우 예정",
      preliminary: [{ when: "28일 09시" }],
    }),
  );
  assert.equal(r.currentSeverity, "caution");
  assert.equal(r.currentStep?.severity, "caution");
  assert.ok(r.notes?.includes("28일 09시"));
});

test("예비특보 없음 — 정상 + 현재 단계 없음", () => {
  const r = evaluateKmaPreliminary(kma());
  assert.equal(r.currentSeverity, "normal");
  assert.equal(r.currentStep, undefined);
});

// 모달은 currentStep 유무로 "정상 범위" 박스를 그린다(WeatherRuleModal.tsx).
// 심각도만 올리고 단계를 비우면 칩은 '위험'인데 본문은 '정상 범위'가 되므로 전 항목에 대해 막는다.
const SEVERITY_STEP_CASES: [string, RuleEvaluation][] = [
  ["기상특보 경보", evaluateKmaWarning(kma({ severity: "danger" }))],
  ["기상특보 주의보", evaluateKmaWarning(kma({ severity: "caution" }))],
  ["기상특보 없음", evaluateKmaWarning(kma())],
  ["예비특보 예정", evaluateKmaPreliminary(kma({ preliminarySeverity: "caution" }))],
  ["예비특보 없음", evaluateKmaPreliminary(kma())],
  ["체감온도 폭염", evaluateApparentTemp(36)],
  ["체감온도 정상", evaluateApparentTemp(20)],
  ["풍속 돌풍", evaluateWindKmh(30, 90)],
  ["미세먼지 나쁨", evaluatePM25(90)],
  ["자외선 매우높음", evaluateUV(9)],
  ["강수 호우", evaluatePrecipitation(30)],
  ["불쾌지수 매우높음", evaluateDiscomfortIndex(35, 80)],
];

for (const [label, r] of SEVERITY_STEP_CASES) {
  test(`심각도·현재 단계 동기 — ${label}`, () => {
    if (r.currentSeverity === "normal") {
      assert.equal(r.currentStep, undefined);
    } else {
      assert.ok(r.currentStep, "심각도가 정상이 아닌데 현재 단계가 비어 있다");
      assert.equal(r.currentStep.severity, r.currentSeverity);
    }
  });
}
