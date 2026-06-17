// 고온 (열사병) 분석기 — 손목 온도를 심부 체온으로 추정 후 의료/KOSHA 임계와 비교
import type { HazardEvent, VitalSample } from "@safetymonitor/schemas";
import { THRESHOLDS } from "./thresholds.js";

export interface HyperthermiaDetectInput {
  sample: VitalSample;
  now?: string;
}

// 손목 피부 온도 → 심부 체온 추정. 1차는 단순 고정 오프셋. 의료 진단 아님 (산업안전 보조 정보).
export function estimateCoreTempC(wristTempC: number): number {
  return wristTempC + THRESHOLDS.coreTemp.wristToCoreOffsetC;
}

export function detectHyperthermia({
  sample,
  now,
}: HyperthermiaDetectInput): HazardEvent | null {
  const skin = sample.skinTempC;
  if (skin === undefined) return null;

  const core = estimateCoreTempC(skin);

  if (core >= THRESHOLDS.coreTemp.dangerC) {
    return {
      eventId: `hyper-${sample.workerId}-${sample.ts}`,
      workerId: sample.workerId,
      type: "hyperthermia",
      severity: "danger",
      ts: now ?? sample.ts,
      detail: {
        skinTempC: skin,
        estimatedCoreTempC: Number(core.toFixed(1)),
        ambientTempC: sample.ambientTempC,
        message: `추정 체온 ${core.toFixed(1)}℃ ≥ ${THRESHOLDS.coreTemp.dangerC}℃ (손목 ${skin.toFixed(1)}℃ + 보정 ${THRESHOLDS.coreTemp.wristToCoreOffsetC}℃)`,
      },
    };
  }

  if (core >= THRESHOLDS.coreTemp.cautionC) {
    return {
      eventId: `hyper-${sample.workerId}-${sample.ts}`,
      workerId: sample.workerId,
      type: "hyperthermia",
      severity: "caution",
      ts: now ?? sample.ts,
      detail: {
        skinTempC: skin,
        estimatedCoreTempC: Number(core.toFixed(1)),
        ambientTempC: sample.ambientTempC,
        message: `추정 체온 ${core.toFixed(1)}℃ ≥ ${THRESHOLDS.coreTemp.cautionC}℃ (손목 ${skin.toFixed(1)}℃ + 보정 ${THRESHOLDS.coreTemp.wristToCoreOffsetC}℃)`,
      },
    };
  }

  return null;
}
