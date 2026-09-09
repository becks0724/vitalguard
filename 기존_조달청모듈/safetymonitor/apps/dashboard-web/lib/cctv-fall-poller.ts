// CCTV CAM-02 낙상 폴러(서버 백그라운드) — cctv-ai /cctv/stats2 를 주기 폴링해 fallen 상승 전이를
// CctvFallEvent 로 만들어 ingestCctvEvent(fusion 결합 판정)로 넘긴다. 설계: docs/fusion/artifacts/fusion-design.md §9.
// 순수 변환(전이 감지)은 cctv-poller.ts 재사용, 여기선 fetch+주기 루프(thin wrapper)만 둔다.
import { cctvStatsToEvent, fallenCount, type CctvStats } from "./cctv-poller";
import { ingestCctvEvent } from "../app/api/cctv/ingest";

const CAM02_ID = "CAM-02"; // CctvQuadView CAMERAS[1] (aiSuffix "2" = /cctv/stats2)
const POLL_MS = Number(process.env.CCTV_FALL_POLL_MS ?? "1500");
// 연속 실패 시 물러서는 상한. 상류가 죽어 있으면 1.5초 주기를 유지할 이유가 없다.
const MAX_BACKOFF_MS = 5 * 60_000;
const AI_URL = process.env.NEXT_PUBLIC_AI_CCTV_API ?? "";

// HMR/다중 import 시 중복 기동 방지 — vitalStore 와 동일한 globalThis 캐시 패턴.
const g = globalThis as typeof globalThis & { __cctvFallPollerStarted?: boolean };

// 서버 fetch 는 절대 URL 만 받는다. 이 값은 브라우저와 공유되는 NEXT_PUBLIC_ 변수라
// 프록시용 상대 경로("/ai-cctv")가 들어올 수 있는데, 그건 브라우저에서만 유효하다.
// 걸러내지 않으면 폴 주기마다 Invalid URL 로 실패한다 — 재시도해도 영원히 성공하지 않고,
// 1.5초마다 스택 트레이스를 찍어 다른 문제의 로그를 덮는다(실제로 dev 진단을 방해했다).
export function isPollableUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

/**
 * 연속 실패 횟수에 따른 다음 폴 간격. 성공(=0)이면 기본 주기로 돌아온다.
 * 왜 필요한가 — 상류가 죽으면 재시도해도 영원히 성공하지 않는다. 2026-09-07 에 cctv-ai 인가가
 * 끊긴 뒤 이 폴러가 이틀간 1.5초마다 403 을 받으며 하루 55,872건을 보냈다.
 * 물러서면 하루 288건으로 줄고, 상류가 살아나면 첫 성공에서 곧바로 원래 주기로 복귀한다.
 */
export function pollBackoffMs(baseMs: number, failStreak: number, capMs = MAX_BACKOFF_MS): number {
  if (failStreak <= 0) return baseMs;
  return Math.min(baseMs * 2 ** Math.min(failStreak, 12), capMs);
}

// 서버 기동 시 1회 호출(instrumentation.register). AI_URL 미설정이면 미기동(경보만 워치 단독).
export function startCctvFallPoller(): void {
  if (g.__cctvFallPollerStarted) return;
  if (!AI_URL) {
    console.warn("[cctv-fall-poller] NEXT_PUBLIC_AI_CCTV_API 미설정 — CCTV 낙상 폴러 미기동");
    return;
  }
  if (!isPollableUrl(AI_URL)) {
    console.warn(
      `[cctv-fall-poller] NEXT_PUBLIC_AI_CCTV_API 가 절대 URL 이 아님("${AI_URL}") — ` +
        "서버에서는 폴링할 수 없어 미기동(브라우저 프록시 경로는 서버 fetch 에 쓸 수 없다)",
    );
    return;
  }
  g.__cctvFallPollerStarted = true;
  let prevFallen = 0;
  let failStreak = 0; // 연속 폴 실패 횟수 — 로그를 솎아내는 기준(아래 catch 참고)
  // 폴 주기만큼만 시간 해상도가 있다(설계 §9) — silent cap 금지, 기동 시 명시 로그(warn 로 노출).
  console.warn(
    `[cctv-fall-poller] 기동 — ${AI_URL}/cctv/stats2, ${POLL_MS}ms 주기(시간해상도=폴주기), CAM-02`,
  );

  const tick = async () => {
    let nextMs = POLL_MS;
    try {
      const res = await fetch(`${AI_URL}/cctv/stats2`, { cache: "no-store" });
      // ★ 2xx 가 아니면 "이번엔 값이 없다" 가 아니라 경로가 끊긴 것이다.
      //   종전에는 여기서 조용히 return 해서 403 이 실패로 세이지도 로그로 남지도 않았고,
      //   그래서 2026-09-07 에 끊긴 경로를 이틀 동안 아무도 몰랐다(같은 관측이 정상과 고장 양쪽에서 나왔다).
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (failStreak > 0) {
        console.warn(`[cctv-fall-poller] 폴 복구 — 직전까지 ${failStreak}회 연속 실패`);
        failStreak = 0;
      }
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
      // 다만 cctv-ai 가 꺼져 있으면 실패가 무한히 이어진다. 주기마다 스택을 찍으면
      // 시간당 2,400줄이 쌓여 다른 문제의 로그를 덮으므로 첫 실패와 이후 100회마다만 남긴다.
      failStreak += 1;
      nextMs = pollBackoffMs(POLL_MS, failStreak);
      if (failStreak === 1 || failStreak % 100 === 0) {
        console.error(
          `[cctv-fall-poller] 폴 실패 ${failStreak}회 연속 — 다음 시도 ${Math.round(nextMs / 1000)}초 뒤`,
          e,
        );
      }
    }
    // setInterval 이 아니라 매번 다시 예약한다 — 간격을 바꿀 수 있고, 느린 폴이 겹치지도 않는다.
    timer = setTimeout(() => void tick(), nextMs);
  };

  let timer: ReturnType<typeof setTimeout> = setTimeout(() => void tick(), POLL_MS);
  // 프로세스가 이 타이머 때문에 살아 있지 않도록 — 폴러는 부수 작업이다.
  timer.unref?.();
}
