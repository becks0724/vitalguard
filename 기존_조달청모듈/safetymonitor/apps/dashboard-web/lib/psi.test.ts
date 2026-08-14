// PSI 단위 테스트 — 문헌 지수라 우리가 정한 숫자가 없다. 성질과 경계를 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CT0 } from "@safetymonitor/analyzers";
import { computePsi, psiBand, PSI_HIGH, PSI_CRITICAL } from "./psi";

const base = { coreTempC: 37.5, heartRate: 100, restingHeartRate: 60 };

test("체온이 오르면 PSI 가 오른다", () => {
  const cool = computePsi({ ...base, coreTempC: 37.2 })!;
  const hot = computePsi({ ...base, coreTempC: 38.5 })!;
  assert.ok(hot.value > cool.value, `${hot.value} > ${cool.value} 이어야 한다`);
});

test("심박이 오르면 PSI 가 오른다", () => {
  const calm = computePsi({ ...base, heartRate: 80 })!;
  const fast = computePsi({ ...base, heartRate: 150 })!;
  assert.ok(fast.value > calm.value);
});

test("★ 개인화 — 안정심박이 낮을수록 같은 심박에서 PSI 가 높다(초과분이 크다)", () => {
  const fit = computePsi({ ...base, restingHeartRate: 50 })!;
  const unfit = computePsi({ ...base, restingHeartRate: 75 })!;
  assert.ok(fit.value > unfit.value, "안정심박 50 인 사람의 심박 100 이 더 큰 상승폭이다");
  assert.equal(fit.personalized, true);
});

test("Tc0 는 심부체온 필터의 CT0 를 그대로 쓴다 — 기준 체온에서 열 항이 0", () => {
  // 체온 = CT0 이고 심박 = 안정심박이면 두 항 모두 0 → PSI 0.
  const r = computePsi({ coreTempC: CT0, heartRate: 60, restingHeartRate: 60 })!;
  assert.equal(r.value, 0);
});

test("0~10 클램프 — 범위를 벗어나지 않는다", () => {
  const over = computePsi({ coreTempC: 42, heartRate: 210, restingHeartRate: 60 })!;
  assert.equal(over.value, 10);
  const under = computePsi({ coreTempC: 35, heartRate: 40, restingHeartRate: 60 })!;
  assert.equal(under.value, 0);
});

test("★ 입력 결측은 null(판정 불가) — 0(부담 없음)과 구분한다", () => {
  assert.equal(computePsi({ coreTempC: null, heartRate: 100 }), null);
  assert.equal(computePsi({ coreTempC: 37.5, heartRate: null }), null);
  assert.equal(computePsi({ coreTempC: undefined, heartRate: undefined }), null);
  // 0 을 내는 정상 경로와 대비 — 이쪽은 객체다.
  assert.notEqual(computePsi({ coreTempC: CT0, heartRate: 60 }), null);
});

test("안정심박이 없거나 비현실적이면 논문 기본값 60 · personalized=false", () => {
  const noRhr = computePsi({ coreTempC: 37.5, heartRate: 100 })!;
  const fallback = computePsi({ coreTempC: 37.5, heartRate: 100, restingHeartRate: 60 })!;
  assert.equal(noRhr.personalized, false);
  assert.equal(noRhr.value, fallback.value, "폴백은 60 과 같은 값이어야 한다");
  // 오측 방어 — 범위 밖 안정심박은 개인화하지 않는다.
  assert.equal(computePsi({ ...base, restingHeartRate: 5 })!.personalized, false);
  assert.equal(computePsi({ ...base, restingHeartRate: 250 })!.personalized, false);
});

test("밴드 경계 — 문헌 임계 6 / 7.5 는 그 구간에 포함", () => {
  assert.equal(psiBand(5.99), "normal");
  assert.equal(psiBand(PSI_HIGH), "high");
  assert.equal(psiBand(7.49), "high");
  assert.equal(psiBand(PSI_CRITICAL), "critical");
  assert.equal(psiBand(10), "critical");
});
