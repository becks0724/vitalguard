// 심박 이상 분석기 — high/low 임계 초과가 sustainSec 이상 지속될 때 트리거
import type { HazardEvent, VitalSample } from "@safetymonitor/schemas";
import { THRESHOLDS } from "./thresholds.js";

export interface HeartRateDetectInput {
  recent: VitalSample[];
  now?: string;
}

export function detectHeartRateAbnormal({
  recent,
  now,
}: HeartRateDetectInput): HazardEvent | null {
  if (recent.length === 0) return null;

  const last = recent[recent.length - 1];
  if (!last || last.heartRate === undefined) return null;

  const earliestAllowed = new Date(
    new Date(last.ts).getTime() - THRESHOLDS.heartRate.sustainSec * 1000,
  );

  const window = recent.filter(
    (s) => s.heartRate !== undefined && new Date(s.ts) >= earliestAllowed,
  );
  if (window.length === 0) return null;

  // 지속(sustain) 강제 — 윈도가 실제로 sustainSec 폭을 덮을 때만 트리거.
  // 단일 샘플로 "Xs 지속" 오발화 방지(샘플 2개 이상 또는 시간폭 충족).
  const first = window[0];
  if (
    !first ||
    (window.length < 2 &&
      new Date(last.ts).getTime() - new Date(first.ts).getTime() <
        THRESHOLDS.heartRate.sustainSec * 1000)
  ) {
    return null;
  }

  const allHigh = window.every(
    (s) => (s.heartRate ?? 0) >= THRESHOLDS.heartRate.highBpm,
  );
  const allLow = window.every(
    (s) =>
      (s.heartRate ?? Number.POSITIVE_INFINITY) <= THRESHOLDS.heartRate.lowBpm,
  );

  if (!allHigh && !allLow) return null;

  return {
    eventId: `hr-${last.workerId}-${last.ts}`,
    workerId: last.workerId,
    type: "hr_abnormal",
    severity: "warning",
    ts: now ?? last.ts,
    detail: {
      heartRate: last.heartRate,
      message: allHigh
        ? `HR ${last.heartRate}bpm ≥ ${THRESHOLDS.heartRate.highBpm} (${THRESHOLDS.heartRate.sustainSec}s 지속)`
        : `HR ${last.heartRate}bpm ≤ ${THRESHOLDS.heartRate.lowBpm} (${THRESHOLDS.heartRate.sustainSec}s 지속)`,
    },
  };
}
