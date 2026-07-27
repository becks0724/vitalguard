// worker-condition.ts 단위 테스트 — 컨디션 등급 규칙의 경계 회귀 방지.
// 등급 임계는 CONDITION_RULES 단일 source 기준으로 검증한다(매직넘버 금지).
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CONDITION_RULES,
  gradeCondition,
  type ConditionSignals,
} from "./worker-condition";

const base: ConditionSignals = {
  sampleCount: 100,
  firstTs: "2026-07-21T00:00:00.000Z",
  latestTs: "2026-07-21T04:00:00.000Z",
  spo2CautionCount: 0,
  spo2DangerCount: 0,
  hrCautionCount: 0,
  hrDangerCount: 0,
  fallAlerts: 0,
  sosAlerts: 0,
  vitalAlerts: 0,
  unackedAlerts: 0,
};

test("데이터 없음 → unknown + NO_DATA (배제가 아니라 보류)", () => {
  const r = gradeCondition({ ...base, sampleCount: 0, firstTs: null, latestTs: null });
  assert.equal(r.grade, "unknown");
  assert.equal(r.reasons[0]?.code, "NO_DATA");
});

test("이상 신호 없음 → fit(양호), 사유 0건", () => {
  const r = gradeCondition(base);
  assert.equal(r.grade, "fit");
  assert.equal(r.reasons.length, 0);
});

test("낙상/SOS/SpO₂ 위험 이력은 각각 단독으로 restricted", () => {
  assert.equal(gradeCondition({ ...base, fallAlerts: 1 }).grade, "restricted");
  assert.equal(gradeCondition({ ...base, sosAlerts: 1 }).grade, "restricted");
  assert.equal(gradeCondition({ ...base, spo2DangerCount: 1 }).grade, "restricted");
});

test("표시 사유는 의료적 추정 대신 안전 기준 언어를 사용한다", () => {
  const fall = gradeCondition({ ...base, fallAlerts: 1 }).reasons[0]!;
  const oxygen = gradeCondition({ ...base, spo2DangerCount: 1 }).reasons[0]!;
  const longShift = gradeCondition({
    ...base,
    latestTs: new Date(
      Date.parse(base.firstTs!) + CONDITION_RULES.longShiftHours * 3_600_000,
    ).toISOString(),
  }).reasons[0]!;
  for (const reason of [fall, oxygen, longShift]) {
    assert.doesNotMatch(reason.detail, /피로|회복|재발|건강\s*상태|신체\s*상태|증상|질환|진단|예상|우려/);
  }
});

test("심박 위험 반복은 임계(hrDangerRestrict) 경계에서만 restricted", () => {
  const under = gradeCondition({ ...base, hrDangerCount: CONDITION_RULES.hrDangerRestrict - 1 });
  assert.notEqual(under.grade, "restricted");
  const at = gradeCondition({ ...base, hrDangerCount: CONDITION_RULES.hrDangerRestrict });
  assert.equal(at.grade, "restricted");
  assert.equal(at.reasons[0]?.code, "HR_DANGER_24H");
});

test("주의 신호(빈발·경보·미대응)는 caution + 해당 사유코드", () => {
  const spo2 = gradeCondition({ ...base, spo2CautionCount: CONDITION_RULES.spo2CautionFreq });
  assert.equal(spo2.grade, "caution");
  assert.ok(spo2.reasons.some((r) => r.code === "SPO2_CAUTION_FREQ"));

  const hr = gradeCondition({ ...base, hrCautionCount: CONDITION_RULES.hrCautionFreq });
  assert.equal(hr.grade, "caution");
  assert.ok(hr.reasons.some((r) => r.code === "HR_CAUTION_FREQ"));

  const vital = gradeCondition({ ...base, vitalAlerts: 1 });
  assert.equal(vital.grade, "caution");

  const unacked = gradeCondition({ ...base, unackedAlerts: 2 });
  assert.equal(unacked.grade, "caution");
  assert.ok(unacked.reasons.some((r) => r.code === "UNACKED_ALERT"));
});

test("장시간 착용(longShiftHours 이상)은 caution + LONG_SHIFT", () => {
  const hours = CONDITION_RULES.longShiftHours;
  const r = gradeCondition({
    ...base,
    firstTs: "2026-07-21T00:00:00.000Z",
    latestTs: new Date(Date.parse("2026-07-21T00:00:00.000Z") + hours * 3_600_000).toISOString(),
  });
  assert.equal(r.grade, "caution");
  assert.ok(r.reasons.some((x) => x.code === "LONG_SHIFT"));
});

test("restricted 는 caution 사유를 함께 보존(사유 병기)", () => {
  const r = gradeCondition({ ...base, fallAlerts: 1, unackedAlerts: 1 });
  assert.equal(r.grade, "restricted");
  assert.ok(r.reasons.some((x) => x.code === "FALL_24H"));
  assert.ok(r.reasons.some((x) => x.code === "UNACKED_ALERT"));
});
