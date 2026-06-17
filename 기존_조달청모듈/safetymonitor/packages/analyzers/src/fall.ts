// 낙상 감지 분석기 — 가속도 임계 초과 + N초 무동작 패턴
import type { HazardEvent, VitalSample } from "@safetymonitor/schemas";
import { THRESHOLDS } from "./thresholds.js";

export interface FallDetectInput {
  sample: VitalSample;
  now?: string;
}

export function detectFall({
  sample,
  now,
}: FallDetectInput): HazardEvent | null {
  const accel = sample.accelMagnitudeG;
  const still = sample.motionStillSec;
  if (accel === undefined || still === undefined) return null;

  if (
    accel >= THRESHOLDS.fall.accelMagnitudeG &&
    still >= THRESHOLDS.fall.motionStillSec
  ) {
    return {
      eventId: `fall-${sample.workerId}-${sample.ts}`,
      workerId: sample.workerId,
      type: "fall",
      severity: "danger",
      ts: now ?? sample.ts,
      detail: {
        accelMagnitudeG: accel,
        motionStillSec: still,
        message: `가속도 ${accel.toFixed(2)}G + 무동작 ${still}s 감지`,
      },
    };
  }
  return null;
}
