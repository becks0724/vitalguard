// 스트레스 지수 단위 테스트 — 사양서 필수 검증 시나리오 1~4
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { computeStressIndex } from "./stress-index.js";

// 시나리오 1 — 중작업 + 스트레스 없음: 활동 높음 + ExcessHR≈0 + 정상 HRV → 낮음
test("스트레스 — 중작업 + 무스트레스 → 낮음(정상)", () => {
  const r = computeStressIndex({
    heartRate: 125,
    hrvSdnnMs: 50,
    activeEnergyKcal: 10,
    steps: 130,
    flightsClimbed: 0,
  });
  assert.equal(r.calibrating, false);
  assert.equal(r.activity, "heavy");
  assert.ok(r.index !== null && r.index < 40, `index=${r.index} 는 정상권이어야 함`);
  assert.equal(r.level, "normal");
});

// 시나리오 2 — 휴식 + 스트레스: 활동 낮음 + HRV 급락 + ExcessHR>0 → 높음
test("스트레스 — 휴식 + HRV 급락 + 초과심박 → 높음", () => {
  const r = computeStressIndex({
    heartRate: 105,
    hrvSdnnMs: 12,
    restingHeartRate: 65,
    activeEnergyKcal: 1,
    steps: 5,
    flightsClimbed: 0,
  });
  assert.equal(r.calibrating, false);
  assert.equal(r.activity, "rest");
  assert.ok(r.index !== null && r.index >= 70, `index=${r.index} 는 위험권이어야 함`);
  assert.equal(r.level, "danger");
});

// 시나리오 3 — 계단 작업 직후: flightsClimbed↑ → 활동 heavy 분류 →
// 일시적 심박 상승을 스트레스로 오판하지 않아야 함
test("스트레스 — 계단 직후 심박 상승은 활동 보정으로 오판 안 함", () => {
  const r = computeStressIndex({
    heartRate: 120,
    hrvSdnnMs: 48,
    activeEnergyKcal: 8,
    steps: 100,
    flightsClimbed: 3,
  });
  assert.equal(r.activity, "heavy");
  assert.ok(r.index !== null && r.index < 40, `index=${r.index} 는 정상권이어야 함`);
});

// 시나리오 4 — Baseline/입력 부족: 스트레스 신호 없음 → calibrating, 경보 미발생
test("스트레스 — 입력 부족(HRV·활동 없음) → 보정 중", () => {
  const r = computeStressIndex({ heartRate: 80 });
  assert.equal(r.calibrating, true);
  assert.equal(r.index, null);
  assert.equal(r.level, "idle");
});

// 경계 — HRV 만 있고 활동/HR 없어도 계산 (HRV-only 예비 추정)
test("스트레스 — HRV 단독이면 계산 가능", () => {
  const r = computeStressIndex({ hrvSdnnMs: 15 });
  assert.equal(r.calibrating, false);
  assert.ok(r.index !== null);
});

// 활동 분류 — light: 가중합이 thRest(2.5) 이상 thHigh(6.0) 미만이면 light
// a = 1.0*energy + 0.5*(steps/100) + 2.0*flights = 4.0 + 0.25 = 4.25 → light
test("스트레스 — 중간 활동은 light 로 분류", () => {
  const r = computeStressIndex({
    heartRate: 100,
    hrvSdnnMs: 45,
    activeEnergyKcal: 4,
    steps: 50,
    flightsClimbed: 0,
  });
  assert.equal(r.activity, "light");
});

// 신호3(호흡) 경로 — respiratoryRate 가 baseline(14) 보다 높으면 zRr 가 양수로 가산되어
// 같은 입력 대비 지수가 상승해야 한다(다른 신호 동일).
test("스트레스 — 호흡수 상승은 지수를 높인다(zRr 경로)", () => {
  const base = {
    heartRate: 95,
    hrvSdnnMs: 40,
    restingHeartRate: 65,
    activeEnergyKcal: 0,
    steps: 0,
    flightsClimbed: 0,
  };
  const without = computeStressIndex(base);
  const withRr = computeStressIndex({ ...base, respiratoryRate: 28 });
  assert.ok(without.index !== null && withRr.index !== null);
  assert.ok(
    (withRr.index as number) > (without.index as number),
    `호흡수↑ 지수=${withRr.index} 가 기본 지수=${without.index} 보다 커야 함`,
  );
});

// 개인 baseline 인자 오버라이드 — hrvMean 을 측정값 수준으로 낮춘 개인 baseline 을 주면
// 같은 HRV 가 '급락' 으로 보이지 않아 population 대비 지수가 낮아진다.
test("스트레스 — 개인 baseline 오버라이드가 결과를 바꾼다", () => {
  const inputs = {
    hrvSdnnMs: 30,
    heartRate: 70,
    restingHeartRate: 68,
    activeEnergyKcal: 0,
    steps: 0,
    flightsClimbed: 0,
  };
  const population = computeStressIndex(inputs);
  const personal = computeStressIndex(inputs, {
    hrvMean: 28,
    hrvStd: 18,
    hrRest: 68,
    hrLight: 95,
    hrHeavy: 125,
    respiratory: 14,
  });
  assert.ok(population.index !== null && personal.index !== null);
  assert.ok(
    (personal.index as number) < (population.index as number),
    `개인 baseline 지수=${personal.index} 가 population 지수=${population.index} 보다 낮아야 함`,
  );
});

// 지수 경계 — caution 밴드(40 이상 70 미만)로 떨어지는 입력
test("스트레스 — 중간 부하는 caution(40~69) 밴드", () => {
  const r = computeStressIndex({
    heartRate: 95,
    hrvSdnnMs: 40,
    restingHeartRate: 68,
    activeEnergyKcal: 0,
    steps: 0,
    flightsClimbed: 0,
  });
  assert.equal(r.level, "caution");
  assert.ok(
    r.index !== null && r.index >= 40 && r.index < 70,
    `index=${r.index} 는 caution 밴드여야 함`,
  );
});
