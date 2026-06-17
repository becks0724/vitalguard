// 저산소 (SpO₂) 분석기 — < 88% 즉시 danger / < 92% 30s 지속 caution
import type { HazardEvent, VitalSample } from "@safetymonitor/schemas";
import { THRESHOLDS } from "./thresholds.js";

export interface Spo2DetectInput {
  recent: VitalSample[];
  now?: string;
}

export function detectSpo2Low({
  recent,
  now,
}: Spo2DetectInput): HazardEvent | null {
  if (recent.length === 0) return null;

  const last = recent[recent.length - 1];
  if (!last || last.spo2 === undefined) return null;

  if (last.spo2 < THRESHOLDS.spo2.dangerPct) {
    return {
      eventId: `spo2-${last.workerId}-${last.ts}`,
      workerId: last.workerId,
      type: "spo2_low",
      severity: "danger",
      ts: now ?? last.ts,
      detail: {
        spo2: last.spo2,
        message: `SpO₂ ${last.spo2}% < ${THRESHOLDS.spo2.dangerPct}% (즉시 danger)`,
      },
    };
  }

  const earliestAllowed = new Date(
    new Date(last.ts).getTime() - THRESHOLDS.spo2.cautionSustainSec * 1000,
  );

  const window = recent.filter(
    (s) => s.spo2 !== undefined && new Date(s.ts) >= earliestAllowed,
  );
  if (window.length === 0) return null;

  // 지속(sustain) 강제 — 윈도가 실제로 cautionSustainSec 폭을 덮을 때만 트리거.
  // 단일 샘플로 "30s 지속" 오발화 방지(샘플 2개 이상 또는 시간폭 충족).
  const first = window[0];
  if (
    !first ||
    (window.length < 2 &&
      new Date(last.ts).getTime() - new Date(first.ts).getTime() <
        THRESHOLDS.spo2.cautionSustainSec * 1000)
  ) {
    return null;
  }

  const allLow = window.every(
    (s) => (s.spo2 ?? 100) < THRESHOLDS.spo2.cautionPct,
  );
  if (!allLow) return null;

  return {
    eventId: `spo2-${last.workerId}-${last.ts}`,
    workerId: last.workerId,
    type: "spo2_low",
    severity: "caution",
    ts: now ?? last.ts,
    detail: {
      spo2: last.spo2,
      message: `SpO₂ ${last.spo2}% < ${THRESHOLDS.spo2.cautionPct}% (${THRESHOLDS.spo2.cautionSustainSec}s 지속)`,
    },
  };
}
