// 작업자 스트레스 지수 추정 (P1-lite) — 사양서 STEP1~3 의 규칙·통계 버전.
// 신체부하와 심리스트레스 분리: 활동 보정 초과심박(ExcessHR) + HRV 편차 결합.
// 개인 baseline 부재 시 population reference 로 동작(예비 추정), baseline 제공 시 정밀화.
// 순수 함수 — I/O 없음. 참고용 추정이며 의료 진단이 아니다.
import type { VitalSample } from "@safetymonitor/schemas";

export type StressLevel = "idle" | "normal" | "caution" | "danger";
export type ActivityState = "rest" | "light" | "heavy";

export interface StressInputs {
  heartRate?: number;
  hrvSdnnMs?: number;
  restingHeartRate?: number;
  activeEnergyKcal?: number; // 직전 ~60초 합
  steps?: number; // 직전 ~60초 합
  flightsClimbed?: number; // 직전 ~60초 합
  walkingHeartRate?: number;
  respiratoryRate?: number;
}

// 개인 baseline (STEP0). 미제공 시 population fallback 사용.
export interface StressBaseline {
  hrvMean: number;
  hrvStd: number;
  hrRest: number;
  hrLight: number;
  hrHeavy: number;
  respiratory: number;
}

export interface StressResult {
  calibrating: boolean;
  index: number | null; // 0~100 (calibrating 이면 null)
  level: StressLevel;
  activity: ActivityState | null;
}

// population reference — 개인 baseline 이 없을 때 fallback. 성인 단기 SDNN 대략치.
// 개인 데이터 축적 후 computeStressIndex(inputs, personalBaseline) 으로 정밀화.
export const STRESS_POPULATION_BASELINE: StressBaseline = {
  hrvMean: 50, // ms
  hrvStd: 18, // ms
  hrRest: 68, // bpm
  hrLight: 95, // bpm
  hrHeavy: 125, // bpm
  respiratory: 14, // brpm
};

// 활동지수 가중치 / 임계 (population 기본 — 개인 분위수 캘리브레이션 전)
const ACTIVITY = {
  wEnergy: 1.0,
  wSteps: 0.5,
  wFlights: 2.0,
  thRest: 2.5,
  thHigh: 6.0,
} as const;

// 신호 결합 가중치 + 로지스틱 스케일 (사양서 §6 초기값)
const COMBINE = { a: 0.5, b: 0.4, c: 0.1, k: 1.2, rawMid: 1.5 } as const;

// 활동별 HRV 신뢰도 — 움직임 많으면 HRV 부정확 → 신호1 비중 축소
const HRV_CONFIDENCE: Record<ActivityState, number> = {
  rest: 1.0,
  light: 0.5,
  heavy: 0.2,
};

// 지수 → 레벨 (사양서 §8 을 카드 3색 체계로 매핑: <40 정상 / 40~69 주의 / ≥70 위험)
const STRESS_LEVEL = { caution: 40, danger: 70 } as const;

function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// 활동 상태 분류 (활동에너지·걸음·계단 가중합 → rest/light/heavy, 데이터 전무 시 null).
// 심박 위험도 '작업 게이트'에서도 재사용한다 — 단일 source(스트레스와 동일 분류).
export function classifyActivity(inputs: StressInputs): ActivityState | null {
  const { activeEnergyKcal: e, steps: s, flightsClimbed: f } = inputs;
  if (e === undefined && s === undefined && f === undefined) return null;
  const a =
    ACTIVITY.wEnergy * (e ?? 0) +
    ACTIVITY.wSteps * ((s ?? 0) / 100) +
    ACTIVITY.wFlights * (f ?? 0);
  if (a < ACTIVITY.thRest) return "rest";
  if (a < ACTIVITY.thHigh) return "light";
  return "heavy";
}

export function computeStressIndex(
  inputs: StressInputs,
  baseline: StressBaseline = STRESS_POPULATION_BASELINE,
): StressResult {
  const hr = inputs.heartRate;
  const hrv = inputs.hrvSdnnMs;
  const activity = classifyActivity(inputs);

  // 보정 중 — 의미 있는 스트레스 신호가 하나도 없을 때.
  // 신호1(HRV) 또는 신호2(HR + 활동 맥락) 중 적어도 하나 필요.
  const hasHrvSignal = hrv !== undefined;
  const hasExcessSignal = hr !== undefined && activity !== null;
  if (!hasHrvSignal && !hasExcessSignal) {
    return { calibrating: true, index: null, level: "idle", activity };
  }

  // 활동 데이터 없으면 rest 가정(보수적) — ExcessHR 기댓값 계산용
  const act: ActivityState = activity ?? "rest";

  // 신호1: HRV 편차 (baseline 보다 낮을수록 스트레스↑)
  const zHrv = hasHrvSignal
    ? (baseline.hrvMean - (hrv as number)) / baseline.hrvStd
    : 0;

  // 신호2: 활동 보정 초과심박 (활동으로 설명 안 되는 상승만)
  let zHr = 0;
  if (hr !== undefined) {
    const expected =
      act === "rest"
        ? inputs.restingHeartRate ?? baseline.hrRest
        : act === "light"
          ? inputs.walkingHeartRate ?? baseline.hrLight
          : baseline.hrHeavy;
    const excess = hr - expected;
    zHr = excess > 0 ? excess / expected : 0;
  }

  // 신호3: 호흡 편차 (옵션)
  const zRr =
    inputs.respiratoryRate !== undefined
      ? (inputs.respiratoryRate - baseline.respiratory) / baseline.respiratory
      : 0;

  // HRV 신뢰도 — 신호1 비중을 활동 강도로 축소, 줄인 만큼 신호2로 재분배
  const conf = HRV_CONFIDENCE[act];
  const aEff = COMBINE.a * conf;
  const bEff = COMBINE.b + (COMBINE.a - aEff);

  const raw =
    aEff * clip(zHrv, 0, 3) +
    bEff * clip(zHr, 0, 0.5) * 6 +
    COMBINE.c * clip(zRr, 0, 0.5) * 6;

  const index = Math.round(
    100 / (1 + Math.exp(-COMBINE.k * (raw - COMBINE.rawMid))),
  );

  const level: StressLevel =
    index >= STRESS_LEVEL.danger
      ? "danger"
      : index >= STRESS_LEVEL.caution
        ? "caution"
        : "normal";

  return { calibrating: false, index, level, activity: act };
}

// VitalSample(또는 부분) → StressInputs 추출 — 대시보드/서버 공용
export function stressInputsFromSample(s: Partial<VitalSample>): StressInputs {
  return {
    heartRate: s.heartRate,
    hrvSdnnMs: s.hrvSdnnMs,
    restingHeartRate: s.restingHeartRate,
    activeEnergyKcal: s.activeEnergyKcal,
    steps: s.steps,
    flightsClimbed: s.flightsClimbed,
    walkingHeartRate: s.walkingHeartRate,
    respiratoryRate: s.respiratoryRate,
  };
}
