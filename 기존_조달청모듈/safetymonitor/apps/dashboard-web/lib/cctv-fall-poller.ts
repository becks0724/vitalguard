// CCTV CAM-02 낙상 폴러(서버 백그라운드) — cctv-ai /cctv/stats2 를 주기 폴링해 fallen 상승 전이를
// CctvFallEvent 로 만들어 ingestCctvEvent(fusion 결합 판정)로 넘긴다. 설계: docs/fusion/artifacts/fusion-design.md §9.
// 순수 변환(전이 감지)은 cctv-poller.ts 재사용, 여기선 fetch+주기 루프(thin wrapper)만 둔다.
import { cctvStatsToEvent, fallenCount, type CctvStats } from "./cctv-poller";
import { ingestCctvEvent } from "../app/api/cctv/ingest";

const CAM02_ID = "CAM-02"; // CctvQuadView CAMERAS[1] (aiSuffix "2" = /cctv/stats2)
const POLL_MS = Number(process.env.CCTV_FALL_POLL_MS ?? "1500");
const AI_URL = process.env.NEXT_PUBLIC_AI_CCTV_API ?? "";

// HMR/다중 import 시 중복 기동 방지 — mockStore 와 동일한 globalThis 캐시 패턴.
const g = globalThis as typeof globalThis & { __cctvFallPollerStarted?: boolean };

// 서버 기동 시 1회 호출(instrumentation.register). AI_URL 미설정이면 미기동(경보만 워치 단독).
export function startCctvFallPoller(): void {
  if (g.__cctvFallPollerStarted) return;
  if (!AI_URL) {
    console.warn("[cctv-fall-poller] NEXT_PUBLIC_AI_CCTV_API 미설정 — CCTV 낙상 폴러 미기동");
    return;
  }
  g.__cctvFallPollerStarted = true;
  let prevFallen = 0;
  // 폴 주기만큼만 시간 해상도가 있다(설계 §9) — silent cap 금지, 기동 시 명시 로그(warn 로 노출).
  console.warn(
    `[cctv-fall-poller] 기동 — ${AI_URL}/cctv/stats2, ${POLL_MS}ms 주기(시간해상도=폴주기), CAM-02`,
  );

  const tick = async () => {
    try {
      const res = await fetch(`${AI_URL}/cctv/stats2`, { cache: "no-store" });
      if (!res.ok) return;
      const stats = (await res.json()) as CctvStats;
      const event = cctvStatsToEvent(stats, prevFallen, {
        cameraId: CAM02_ID,
        // zone 미지정 — 워커 zone 도 비어 있어 confirmed 격상 대신 warning_zone 트랙으로 판정됨(설계 §15-7).
        ts: new Date().toISOString(),
      });
      prevFallen = fallenCount(stats); // byStatus 케이스 포함해 다음 폴 기준 갱신
      if (event) {
        await ingestCctvEvent(event); // 워치와 시간창 매칭 → decideFusion → 경보 라우팅
        console.warn(`[cctv-fall-poller] 낙상 상승전이 감지 → fusion(fallen=${event.fallenCount})`);
      }
    } catch (e) {
      // 폴 실패는 다음 주기에 재시도 — 루프는 죽지 않는다(cctv-ai 재기동/일시장애 대비).
      console.error("[cctv-fall-poller] 폴 실패(다음 주기 재시도)", e);
    }
  };

  setInterval(tick, POLL_MS);
}
