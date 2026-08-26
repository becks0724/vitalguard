// vital sample → 위험도 판정. analyzers THRESHOLDS 단일 source.
// DB row(snake_case) 와 VitalSample(camelCase) 둘 다 받기 위해 raw 필드를 받는 함수로 분리.
import {
  THRESHOLDS,
  estimateCoreTempC,
  classifyActivity,
  type ActivityState,
} from "@safetymonitor/analyzers";

export type Status = "idle" | "normal" | "caution" | "danger";

export const STATUS_LABEL: Record<Status, string> = {
  idle: "대기",
  normal: "정상",
  caution: "주의",
  danger: "위험",
};

// ── 작업 중 심박 작업부하 밴드 (활동 게이트 — 카드·차트 공유 단일 source) ──
// 육체노동으로 구조적으로 상승한 심박을 안정 임계(110/130)로 오경보하지 않도록,
// 활동이 '작업 중(heavy)'으로 분류될 때만 작업부하 밴드를 적용한다(ISO 8996·ACGIH 참고·튜닝 가능).
// 안전 불변식: 활동 데이터 없음/안정이면 안정 임계(보수적), 완화만 하고 강화는 없음,
// 과부하(overload)·급락(collapse)은 작업 중에도 위험. SpO₂·체온은 활동 무관(미적용).
export const WORK_HR = { heavyBpm: 135, overloadBpm: 155, collapseBpm: 45 } as const;

// 활동 인자(rest/light/heavy/null) 가 '작업 중'인지. 기본은 heavy 만 완화(가장 안전).
export function isWorking(activity: ActivityState | null | undefined): boolean {
  return activity === "heavy";
}

// VitalSample 형태(활동 필드)에서 활동 상태 분류 — classifyActivity 단일 source 재사용.
export function workActivity(inputs: {
  activeEnergyKcal?: number | null;
  steps?: number | null;
  flightsClimbed?: number | null;
}): ActivityState | null {
  return classifyActivity({
    activeEnergyKcal: inputs.activeEnergyKcal ?? undefined,
    steps: inputs.steps ?? undefined,
    flightsClimbed: inputs.flightsClimbed ?? undefined,
  });
}

// 무조건 작업부하 밴드 판정 — 차트 추세 전용(집계 버킷이라 per-점 활동맥락이 없어 작업기준 고정).
export function workHeartRateStatus(hr: number | null | undefined): Status {
  if (hr === null || hr === undefined) return "idle";
  if (hr >= WORK_HR.overloadBpm || hr <= WORK_HR.collapseBpm) return "danger";
  if (hr >= WORK_HR.heavyBpm) return "caution";
  return "normal";
}

// 심박 안정 임계의 '주의' 밴드 (의료 reference) — heartRateStatus 와 SQL 집계가 공유하는 단일 소스.
export const HR_CAUTION = { highBpm: 110, lowBpm: 50 } as const;

// 심박 위험도 — 활동 미지정/안정: danger ≥130·≤40, caution 110~129·41~50 (안정 임계, 의료 reference).
// 활동 '작업 중(heavy)': danger ≥155(과부하)·≤45(급락), caution 135~154(고강도) (작업부하 밴드).
export function heartRateStatus(
  hr: number | null | undefined,
  activity?: ActivityState | null,
): Status {
  if (hr === null || hr === undefined) return "idle";
  if (isWorking(activity)) return workHeartRateStatus(hr);
  if (hr >= THRESHOLDS.heartRate.highBpm || hr <= THRESHOLDS.heartRate.lowBpm) {
    return "danger";
  }
  if (hr >= HR_CAUTION.highBpm || hr <= HR_CAUTION.lowBpm) return "caution";
  return "normal";
}

export function spo2Status(spo2: number | null | undefined): Status {
  if (spo2 === null || spo2 === undefined) return "idle";
  if (spo2 < THRESHOLDS.spo2.dangerPct) return "danger";
  if (spo2 < THRESHOLDS.spo2.cautionPct) return "caution";
  return "normal";
}

/**
 * ★ **심부 체온을 직접 받아 판정한다** — 라이브 판정의 정본(2026-08-26 신설).
 *
 * 입력은 심박 기반 칼만 추정치(`estimateCoreTempSeries`)를 상정한다. 아래
 * `coreTempStatus(skin)` 와 임계는 같지만 **입력의 출처가 다르다** — 그것이 이 함수를
 * 따로 둔 이유다. 손목 실측에는 기기 발열이 섞이고(주변온≥33 구간에서 +0.841℃),
 * 심박 경로는 같은 구간에서 +0.019℃ 로 사실상 안 움직인다(2026-08-26 실측).
 *
 * ⚠ `undefined` 는 "정상"이 아니라 **판정 불가(idle)** 다. 칼만은 30분 심박 이력을 먹는
 *   필터라 워밍업 전에는 값이 없다. 그때 손목 실측으로 폴백하면 이 함수를 만든 이유가
 *   사라지므로 **폴백하지 않는다** — 모르는 것은 모른다고 둔다.
 */
export function coreTempStatusC(coreTempC: number | null | undefined): Status {
  if (coreTempC === null || coreTempC === undefined) return "idle";
  if (coreTempC >= THRESHOLDS.coreTemp.dangerC) return "danger";
  if (coreTempC >= THRESHOLDS.coreTemp.cautionC) return "caution";
  return "normal";
}

/**
 * 손목 온도 → 추정 심부 체온 변환 후 판정.
 *
 * ⚠ **입력이 오염된다.** 워치 온도 센서가 기기 표면 근처라 발열이 섞이고, `wristToCoreOffsetC`
 * 자체도 근거 미확인이다. 그래서 **라이브 판정에는 위 `coreTempStatusC` 를 쓴다.**
 * 이 함수는 **칼만을 만들 수 없는 자리**에만 남아 있다 — 행 단위 과거 조회·내보내기·
 * 수집 시점 경보(`dangerMetrics`)는 단일 행이라 심박 이력이 없어 필터를 돌릴 수 없다.
 * 그 경로들을 칼만으로 옮기는 것은 별건이다(서버가 워커별 심박 창을 들어야 한다).
 */
export function coreTempStatus(skinTempC: number | null | undefined): Status {
  if (skinTempC === null || skinTempC === undefined) return "idle";
  return coreTempStatusC(estimateCoreTempC(skinTempC));
}

// SQL 집계(내보내기 미리보기 카운트)용 임계 파라미터 — 위 판정 함수들과 동일 상수에서 파생(단일 소스).
// SQL 쪽에 숫자를 하드코딩하지 않기 위해 쿼리 파라미터로 바인딩해 전달한다(과거 감사 M5 임계 중복 재발 방지).
export const SEVERITY_SQL_PARAMS = {
  hrDangerHigh: THRESHOLDS.heartRate.highBpm,
  hrDangerLow: THRESHOLDS.heartRate.lowBpm,
  hrCautionHigh: HR_CAUTION.highBpm,
  hrCautionLow: HR_CAUTION.lowBpm,
  spo2Danger: THRESHOLDS.spo2.dangerPct,
  spo2Caution: THRESHOLDS.spo2.cautionPct,
  tempOffset: THRESHOLDS.coreTemp.wristToCoreOffsetC,
  tempDanger: THRESHOLDS.coreTemp.dangerC,
  tempCaution: THRESHOLDS.coreTemp.cautionC,
} as const;

export type SeveritySqlParams = typeof SEVERITY_SQL_PARAMS;

export type StatusInputs = {
  heart_rate: number | null;
  spo2: number | null;
  skin_temp_c: number | null;
  manual_sos: number | null;
  fall_detected: number | null;
};

// 종합: 낙상 또는 SOS 가 트리거되면 즉시 danger, 아니면 3 메트릭 worst-of
export function overallStatus(row: StatusInputs): Status {
  if (row.fall_detected === 1) return "danger";
  if (row.manual_sos === 1) return "danger";
  const statuses: Status[] = [
    heartRateStatus(row.heart_rate),
    spo2Status(row.spo2),
    coreTempStatus(row.skin_temp_c),
  ];
  if (statuses.includes("danger")) return "danger";
  if (statuses.includes("caution")) return "caution";
  if (statuses.includes("normal")) return "normal";
  return "idle";
}
