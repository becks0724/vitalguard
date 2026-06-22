// 영상(CCTV)·워치(CoreMotion) 낙상 결합(fusion) 판정 — 순수 함수(I/O 없음).
// 설계: docs/fusion/artifacts/fusion-design.md.
//
// 불변 원칙(Safety Monotonicity): fusion 은 신뢰도를 올리기만 하고, 단독 신호가 이미 발생시킨
// 경보를 절대 깎지 않는다. 워치 확정(fallDetected) danger 는 영상 부재/음성/zone불명에도 유지된다.

// 소스 가용성 — 부재를 낙상 음성으로 흡수하지 않기 위한 별도 축. blind/unavailable = unknown.
export type SourceAvailability = "available" | "stale" | "blind" | "unavailable";

export type FusionStage =
  | "none"
  | "suspect"
  | "warning_zone"
  | "danger_watch"
  | "confirmed";

export interface FusionInputs {
  watch: {
    confirmed: boolean; // fallDetected===true (이미 danger)
    candidate: boolean; // fallCandidate && fallDecision==="fall" 이고 아직 fallDetected 아님
    workerId?: string;
    zone?: string; // 워치 GPS→zone 매핑 결과(있으면)
    ts?: string; // 발신 시각(ISO8601 UTC)
    availability: SourceAvailability;
  };
  vision: {
    fallen: boolean;
    lying: boolean;
    cameraId?: string;
    zone?: string;
    ts?: string; // 프레임/폴 관측 시각(ISO8601 UTC)
    availability: SourceAvailability;
  };
  window?: { preSec: number; postSec: number }; // 기본 10/15
}

export type FusionTarget =
  | { kind: "worker"; workerId: string }
  | { kind: "zone"; cameraId: string }
  | { kind: "none" };

export interface FusionDecision {
  stage: FusionStage;
  confidence: number; // 0..1 — 표시·로깅용. 단계를 내리는 데 사용 금지.
  earlyEscalated?: boolean; // 워치 후보를 영상으로 조기 격상한 경우
  target: FusionTarget;
  basis: string[];
  recommendedActions: string[];
}

export const DEFAULT_FUSION_WINDOW = { preSec: 10, postSec: 15 } as const;

// 시간 정합 — 영상 관측 시각이 워치 발신 시각의 [-preSec, +postSec] 안인가.
// 둘 중 하나라도 ts 가 없거나 파싱 불가면 정합 불가(false) — 시각 없으면 넓은 창이라도 매칭하지 않는다.
export function timeMatched(i: FusionInputs): boolean {
  const w = i.watch.ts ? Date.parse(i.watch.ts) : NaN;
  const v = i.vision.ts ? Date.parse(i.vision.ts) : NaN;
  if (Number.isNaN(w) || Number.isNaN(v)) return false;
  const diffSec = (v - w) / 1000;
  const win = i.window ?? DEFAULT_FUSION_WINDOW;
  return diffSec >= -win.preSec && diffSec <= win.postSec;
}

// zone 호환 — 워치/영상 zone 이 둘 다 명시되고 같을 때만 true. 매핑 없음/불명은 false(unknown 취급).
// confirmed 격상의 필수 조건 — 임의 zone fallen 으로 worker 오귀속 방지(fusion-design §4.1).
export function zoneCompatible(i: FusionInputs): boolean {
  const wz = i.watch.zone;
  const vz = i.vision.zone;
  return !!wz && !!vz && wz === vz;
}

export function decideFusion(i: FusionInputs): FusionDecision {
  // 영상이 워치를 확증하는가 — available + fallen + 시간정합 + zone호환(매핑 확인) 모두 충족 시에만.
  const visionCorroborates =
    i.vision.availability === "available" &&
    i.vision.fallen &&
    timeMatched(i) &&
    zoneCompatible(i);

  // 1) 워치 확정(fallDetected) — 이미 danger. 절대 깎지 않음.
  if (i.watch.confirmed) {
    const workerId = i.watch.workerId ?? "";
    if (visionCorroborates) {
      return {
        stage: "confirmed",
        confidence: 0.95,
        target: { kind: "worker", workerId },
        basis: ["watch.fallDetected", "vision.fallen", "timeMatched", "zoneCompatible"],
        recommendedActions: ["alert.control", "sos.modal", "alert.record"],
      };
    }
    // 영상 부재/blind/음성/zone불명 무관 — danger 유지(monotonicity).
    return {
      stage: "danger_watch",
      confidence: 0.7,
      target: { kind: "worker", workerId },
      basis: ["watch.fallDetected"],
      recommendedActions: ["alert.control", "sos.modal"],
    };
  }

  // 2) 워치 후보(fallDecision=fall, 미확정) — 영상이 확증하면 20초 프롬프트 생략하고 조기 격상.
  if (i.watch.candidate && visionCorroborates) {
    return {
      stage: "confirmed",
      confidence: 0.9,
      earlyEscalated: true,
      target: { kind: "worker", workerId: i.watch.workerId ?? "" },
      basis: ["watch.candidate", "vision.fallen", "timeMatched", "zoneCompatible"],
      recommendedActions: ["alert.control", "sos.modal", "alert.record"],
    };
  }
  // 워치 후보가 영상 확증을 못 받으면 워치는 자체 20초 프롬프트에 맡긴다(fusion 개입 안 함).
  // 단, 영상 단독 신호(fallen/lying)는 아래 zone 트랙에서 독립적으로 계속 평가한다 — 워치 후보가
  // 영상 zone 경보를 먹지 않도록(두 트랙 분리, monotonicity). 그래서 여기서 return 하지 않는다.

  // 3) 영상 단독 — 대상 미특정 zone 트랙.
  if (i.vision.availability === "available") {
    const cameraId = i.vision.cameraId ?? "";
    if (i.vision.fallen) {
      return {
        stage: "warning_zone",
        confidence: 0.5,
        target: { kind: "zone", cameraId },
        basis: ["vision.fallen"],
        recommendedActions: ["alert.control", "zone.verify"],
      };
    }
    if (i.vision.lying) {
      return {
        stage: "suspect",
        confidence: 0.3,
        target: { kind: "zone", cameraId },
        basis: ["vision.lying"],
        recommendedActions: ["log"],
      };
    }
  }

  // 아무 트랙도 해당 없음. 워치 후보가 프롬프트 대기 중이면 그 맥락만 남긴다(영상 신호도 없는 경우).
  return {
    stage: "none",
    confidence: 0,
    target: { kind: "none" },
    basis: i.watch.candidate ? ["watch.candidate.pendingPrompt"] : [],
    recommendedActions: [],
  };
}
