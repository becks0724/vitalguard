// 영상(CCTV) 낙상 이벤트 수신 → fusion 결합 판정 → worker 경보(alerts) 또는 zone hazard(메모리).
// 설계: docs/fusion/artifacts/fusion-design.md §5·§9·§11. 워치(/api/mock/vital)와 별개 경로.
import {
  decideFusion,
  type FusionDecision,
  type FusionInputs,
} from "@safetymonitor/analyzers";
import {
  ZoneHazardEventSchema,
  type CctvFallEvent,
  type ZoneHazardEvent,
} from "@safetymonitor/schemas";

import { persistCctvEvent, recordAlert } from "../../../lib/db";
import { mockStore } from "../mock/store";

const VISION_WINDOW = { preSec: 10, postSec: 15 } as const;
const ZONE_HAZARD_MAX = 200;

// 대상 미특정 zone 위험 + 워커→zone 매핑 — HMR 안전 위해 globalThis 캐시(store.ts mockStore 패턴).
// alerts 는 worker_id 필수라 zone hazard 를 직접 못 넣어 메모리에 보관(설계 §11).
const g = globalThis as typeof globalThis & {
  __cctvZoneHazards?: ZoneHazardEvent[];
  __cctvWorkerZoneMap?: Map<string, string>;
};
const zoneHazards: ZoneHazardEvent[] = (g.__cctvZoneHazards ??= []);
const workerZoneMap: Map<string, string> = (g.__cctvWorkerZoneMap ??= new Map());

export function recentZoneHazards(limit = 50): ZoneHazardEvent[] {
  return zoneHazards.slice(-limit).reverse();
}

// 워커→zone 매핑(데모 시드). 비어있으면 zoneCompatible 불가 → confirmed 안 남(설계 §15-7, 확인필요).
export function setWorkerZone(workerId: string, zone: string): void {
  workerZoneMap.set(workerId, zone);
}

// 영상 이벤트 ts 기준 시간창 안의 최근 워치 양성 샘플(confirmed 우선, 없으면 candidate)을 찾는다.
function matchWatch(event: CctvFallEvent): FusionInputs["watch"] {
  const eventMs = Date.parse(event.ts);
  let best:
    | { ts: string; workerId: string; confirmed: boolean; candidate: boolean; diffAbs: number }
    | null = null;
  if (!Number.isNaN(eventMs)) {
    for (const s of mockStore.samples) {
      const confirmed = s.fallDetected === true;
      const candidate =
        s.fallCandidate === true &&
        s.fallDecision === "fall" &&
        s.fallDetected !== true;
      if (!confirmed && !candidate) continue;
      const sMs = Date.parse(s.ts);
      if (Number.isNaN(sMs)) continue;
      const diffSec = (eventMs - sMs) / 1000;
      if (diffSec < -VISION_WINDOW.preSec || diffSec > VISION_WINDOW.postSec) continue;
      const diffAbs = Math.abs(diffSec);
      // 선택 우선순위(코덱스 리뷰 반영): ① confirmed 우선 ② 같은 등급이면 영상과 시간거리 최소
      // ③ 동률이면 최신(ts 큰 것). 단순 최신 선택은 영상 직후의 다른 움직임(구조행동 등)을
      // 오매칭할 수 있어, 같은 등급 내에서는 영상 시각에 가장 가까운 워치 이벤트를 먼저 고른다.
      const better =
        !best ||
        (confirmed && !best.confirmed) ||
        (confirmed === best.confirmed &&
          (diffAbs < best.diffAbs ||
            (diffAbs === best.diffAbs && sMs > Date.parse(best.ts))));
      if (better) {
        best = { ts: s.ts, workerId: s.workerId, confirmed, candidate, diffAbs };
      }
    }
  }
  if (!best) {
    return { confirmed: false, candidate: false, availability: "unavailable" };
  }
  return {
    confirmed: best.confirmed,
    candidate: best.candidate,
    workerId: best.workerId,
    zone: workerZoneMap.get(best.workerId),
    ts: best.ts,
    availability: "available",
  };
}

// 영상 이벤트 1건 수신 → 저장(감사) → fusion 판정 → 경보 라우팅. 판정 결과 반환.
export async function ingestCctvEvent(event: CctvFallEvent): Promise<FusionDecision> {
  await persistCctvEvent(event); // DB 감사 이력

  const vision: FusionInputs["vision"] = {
    fallen: event.status === "fallen" || (event.fallenCount ?? 0) > 0,
    lying: event.status === "lying",
    cameraId: event.cameraId,
    zone: event.zone,
    ts: event.ts,
    availability: "available",
  };
  const watch = matchWatch(event);
  const decision = decideFusion({ watch, vision, window: VISION_WINDOW });

  if (
    decision.stage === "confirmed" &&
    decision.target.kind === "worker" &&
    decision.target.workerId
  ) {
    // 영상이 워치를 확증 — worker 경보 1건. alert ts 는 (영상 시각이 아니라) 매칭된 워치 샘플 ts 를 쓴다:
    // 워치 확정(fallDetected) 경로가 이미 만든 alert(같은 worker/fall/워치ts)와 UNIQUE 로 dedup 되어
    // 같은 낙상이 영상 확증으로 중복 알림되지 않는다. 후보 조기격상은 워치가 아직 alert 를 안 만들었으므로 신규 1건.
    await recordAlert({
      workerId: decision.target.workerId,
      type: "fall",
      ts: watch.ts ?? event.ts,
    });
  } else if (
    (decision.stage === "warning_zone" || decision.stage === "suspect") &&
    decision.target.kind === "zone" &&
    decision.target.cameraId
  ) {
    // 대상 미특정 — alerts 에 못 넣으므로(worker 필수) zone hazard 메모리에 보관.
    const isWarning = decision.stage === "warning_zone";
    const label = event.zone ?? event.cameraId;
    const hazard = ZoneHazardEventSchema.parse({
      eventId: `zone-${event.cameraId}-${event.ts}`,
      cameraId: event.cameraId,
      zone: event.zone,
      type: "fall",
      severity: isWarning ? "warning" : "caution",
      ts: event.ts,
      detail: {
        status: isWarning ? "fallen" : "lying",
        fallenCount: event.fallenCount,
        message: isWarning
          ? `${label} 구역 낙상 의심 — 대상 확인 필요`
          : `${label} 구역 누움 감지(의심)`,
      },
    });
    zoneHazards.push(hazard);
    if (zoneHazards.length > ZONE_HAZARD_MAX) {
      zoneHazards.splice(0, zoneHazards.length - ZONE_HAZARD_MAX);
    }
  }
  return decision;
}
