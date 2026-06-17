// severity.ts 단위 테스트 — 카드 색칠/내보내기 경로의 위험도 판정 경계 회귀 방지.
// 임계는 analyzers THRESHOLDS 단일 source 이므로, 매직넘버가 아닌 THRESHOLDS 기준으로 검증한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { THRESHOLDS, estimateCoreTempC } from "@safetymonitor/analyzers";

import {
  heartRateStatus,
  spo2Status,
  coreTempStatus,
  overallStatus,
  workActivity,
  workHeartRateStatus,
  WORK_HR,
} from "./severity";

const { highBpm, lowBpm } = THRESHOLDS.heartRate;
const { dangerPct, cautionPct } = THRESHOLDS.spo2;

test("heartRateStatus — null/undefined 는 idle", () => {
  assert.equal(heartRateStatus(undefined), "idle");
  assert.equal(heartRateStatus(null), "idle");
});

test("heartRateStatus — THRESHOLDS 경계(highBpm/lowBpm)에서 danger", () => {
  assert.equal(heartRateStatus(highBpm), "danger"); // ≥130
  assert.equal(heartRateStatus(lowBpm), "danger"); // ≤40
  assert.equal(heartRateStatus(highBpm + 20), "danger");
});

test("heartRateStatus — caution 밴드(110~129 / 41~50)", () => {
  assert.equal(heartRateStatus(110), "caution");
  assert.equal(heartRateStatus(129), "caution");
  assert.equal(heartRateStatus(50), "caution");
  assert.equal(heartRateStatus(41), "caution");
});

test("heartRateStatus — 정상 밴드(51~109)", () => {
  assert.equal(heartRateStatus(72), "normal");
  assert.equal(heartRateStatus(109), "normal");
  assert.equal(heartRateStatus(51), "normal");
});

test("heartRateStatus — 활동 게이트: 작업 중(heavy)이면 작업부하 밴드, 안정/light 는 안정 임계", () => {
  // 작업 중 122bpm 은 정상 작업부하(< 135), 안정/미지정/rest/light 는 주의(≥110)
  assert.equal(heartRateStatus(122, "heavy"), "normal");
  assert.equal(heartRateStatus(122), "caution");
  assert.equal(heartRateStatus(122, null), "caution");
  assert.equal(heartRateStatus(122, "rest"), "caution");
  assert.equal(heartRateStatus(122, "light"), "caution"); // 기본은 heavy 만 완화
});

test("heartRateStatus — 작업 중에도 과부하(≥155)/급락(≤45)은 위험, 고강도(135~154)는 주의", () => {
  assert.equal(heartRateStatus(WORK_HR.overloadBpm, "heavy"), "danger");
  assert.equal(heartRateStatus(WORK_HR.heavyBpm, "heavy"), "caution");
  assert.equal(heartRateStatus(154, "heavy"), "caution");
  assert.equal(heartRateStatus(WORK_HR.collapseBpm, "heavy"), "danger");
});

test("heartRateStatus — 안전 불변식: 안정 시 고심박(140)은 작업밴드로 가려지지 않음", () => {
  // 140 은 작업밴드 과부하(155) 미만이지만, 안정 상태에서는 반드시 위험
  assert.equal(heartRateStatus(140), "danger");
  assert.equal(heartRateStatus(140, "rest"), "danger");
});

test("workActivity — 활동 가중합으로 rest/heavy 분류, 데이터 없으면 null", () => {
  assert.equal(workActivity({}), null);
  assert.equal(workActivity({ activeEnergyKcal: 0.5, steps: 50 }), "rest");
  assert.equal(workActivity({ activeEnergyKcal: 10, steps: 200, flightsClimbed: 1 }), "heavy");
  assert.equal(workActivity({ activeEnergyKcal: null, steps: null, flightsClimbed: null }), null);
});

test("workHeartRateStatus — 무조건 작업부하 밴드(차트 추세 전용)", () => {
  assert.equal(workHeartRateStatus(122), "normal");
  assert.equal(workHeartRateStatus(140), "caution");
  assert.equal(workHeartRateStatus(160), "danger");
  assert.equal(workHeartRateStatus(undefined), "idle");
});

test("end-to-end — 작업 중 샘플 122bpm 은 정상, 안정/무활동 샘플은 주의", () => {
  assert.equal(heartRateStatus(122, workActivity({ activeEnergyKcal: 10, steps: 200 })), "normal");
  assert.equal(heartRateStatus(122, workActivity({})), "caution");
});

test("spo2Status — THRESHOLDS 기준 danger/caution/normal", () => {
  assert.equal(spo2Status(undefined), "idle");
  assert.equal(spo2Status(dangerPct - 1), "danger"); // <88
  assert.equal(spo2Status(cautionPct - 1), "caution"); // <92, ≥88
  assert.equal(spo2Status(dangerPct), "caution"); // 88 → caution
  assert.equal(spo2Status(cautionPct), "normal"); // 92 → normal
  assert.equal(spo2Status(98), "normal");
});

test("coreTempStatus — estimateCoreTempC + THRESHOLDS 와 일관(매직넘버 우회 없음)", () => {
  const { dangerC, cautionC } = THRESHOLDS.coreTemp;
  const expected = (skin: number) => {
    const core = estimateCoreTempC(skin);
    if (core >= dangerC) return "danger";
    if (core >= cautionC) return "caution";
    return "normal";
  };
  assert.equal(coreTempStatus(undefined), "idle");
  for (const skin of [35, 36, 36.5, 37, 37.1, 37.5, 37.6, 38, 39]) {
    assert.equal(coreTempStatus(skin), expected(skin), `skin=${skin}`);
  }
});

test("overallStatus — 낙상/SOS 는 즉시 danger", () => {
  const base = { heart_rate: 72, spo2: 98, skin_temp_c: 36.5, manual_sos: 0, fall_detected: 0 };
  assert.equal(overallStatus({ ...base, fall_detected: 1 }), "danger");
  assert.equal(overallStatus({ ...base, manual_sos: 1 }), "danger");
});

test("overallStatus — 그 외 3 메트릭 worst-of, 전부 null 은 idle", () => {
  assert.equal(
    overallStatus({ heart_rate: 72, spo2: 98, skin_temp_c: 36.5, manual_sos: 0, fall_detected: 0 }),
    "normal",
  );
  assert.equal(
    overallStatus({ heart_rate: 115, spo2: 98, skin_temp_c: 36.5, manual_sos: 0, fall_detected: 0 }),
    "caution",
  );
  assert.equal(
    overallStatus({ heart_rate: 135, spo2: 98, skin_temp_c: 36.5, manual_sos: 0, fall_detected: 0 }),
    "danger",
  );
  assert.equal(
    overallStatus({ heart_rate: null, spo2: null, skin_temp_c: null, manual_sos: null, fall_detected: null }),
    "idle",
  );
});
