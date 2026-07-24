// 무충격 붕괴 감지 분석기 — 충격 없이(저G) 장시간 무동작 = 실신·서서히 주저앉음 후보.
// 낙상(detectFall: 고G + 무동작)은 충격 게이트에 걸리지만, 실신은 충격이 없어 그 게이트를
// 원리적으로 통과 못 한다. 이 분석기가 그 사각(충격 없는 쓰러짐)을 별도로 잡는다.
//
// ⚠ 이것은 '후보'다. 정상 휴식·앉은작업·기대기도 무동작이므로 단독으로 danger 가 아니다.
//   반드시 확인 프롬프트(진동·음성 → 사용자 취소 가능) 뒤에만 경보로 승격하고, 무응답 시 danger.
//   그래서 severity 는 warning(확인 필요)이며, danger 격상은 배선 계층(응답 루프)이 담당한다.
// 설계: docs/fall-ml-relabel/03-syncope-layer.md (STORM 실신 리서치 통합).
import type { HazardEvent, VitalSample } from "@safetymonitor/schemas";
import { THRESHOLDS } from "./thresholds.js";

export interface CollapseDetectInput {
  sample: VitalSample;
  now?: string;
}

export function detectCollapse({
  sample,
  now,
}: CollapseDetectInput): HazardEvent | null {
  const accel = sample.accelMagnitudeG;
  const still = sample.motionStillSec;
  if (accel === undefined || still === undefined) return null;

  // 저G(충격 없음) + 장시간 무동작. accel >= maxImpactG 는 낙상 경로(detectFall)가 담당하므로 제외.
  if (
    accel < THRESHOLDS.collapse.maxImpactG &&
    still >= THRESHOLDS.collapse.motionStillSec
  ) {
    return {
      eventId: `collapse-${sample.workerId}-${sample.ts}`,
      workerId: sample.workerId,
      type: "collapse",
      severity: "warning", // 후보 — 확인 프롬프트 필요. 무응답 시 배선 계층이 danger 로 격상.
      ts: now ?? sample.ts,
      detail: {
        accelMagnitudeG: accel,
        motionStillSec: still,
        message: `충격 없이 무동작 ${still}s 지속(≥${THRESHOLDS.collapse.motionStillSec}s) — 실신·붕괴 후보, 확인 필요`,
      },
    };
  }
  return null;
}
