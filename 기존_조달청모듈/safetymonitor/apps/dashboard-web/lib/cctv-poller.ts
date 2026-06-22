// 영상 FastAPI(:8000) /cctv/stats{N} 폴링 어댑터 — 데모 리포(safetymonitor-cctv-demo) 비침습.
// 설계: docs/fusion/artifacts/fusion-design.md §9. fallen 상승 전이를 CctvFallEvent 로 변환한다.
// 순수 변환 함수만 둔다(실제 폴링 루프·fetch 는 호출부 thin wrapper). 폴링 주기(예: 1초)만큼만
// 시간 해상도가 있다 — 이 한계는 호출부가 log 로 명시한다(silent cap 금지).
import type { CctvFallEvent } from "@safetymonitor/schemas";

// /cctv/stats{N} 응답 형식 — CctvQuadView FallDetectionStrip 이 소비하는 형태와 동일.
export interface CctvStats {
  total?: number;
  fallen?: number;
  byStatus?: { status: string; label: string; count: number }[];
}

// 현재 쓰러진 인원 — fallen 필드 우선, 없으면 byStatus 의 fallen count.
export function fallenCount(stats: CctvStats): number {
  if (typeof stats.fallen === "number") return stats.fallen;
  const f = stats.byStatus?.find((b) => b.status === "fallen");
  return f?.count ?? 0;
}

// 이전 폴 대비 fallen 이 증가(상승 전이)한 순간만 CctvFallEvent 로 만든다(아니면 null).
// edge 트리거 — 같은 낙상이 매 폴마다 중복 이벤트가 되지 않도록 "증가"한 폴에서만 1건 생성.
export function cctvStatsToEvent(
  stats: CctvStats,
  prevFallen: number,
  ctx: { cameraId: string; zone?: string; ts: string },
): CctvFallEvent | null {
  const now = fallenCount(stats);
  if (now <= prevFallen) return null; // 상승 전이 아님 — 이벤트 없음
  return {
    cameraId: ctx.cameraId,
    zone: ctx.zone,
    ts: ctx.ts,
    status: "fallen",
    fallenCount: now,
    total: stats.total,
    source: "poller",
  };
}
