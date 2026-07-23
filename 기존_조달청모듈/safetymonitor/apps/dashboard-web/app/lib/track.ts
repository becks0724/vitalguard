// 작업자 이동 경로(트랙) 순수 유틸 — 한국범위 게이트 + 균등 다운샘플(순수 로직, I/O 없음)
export type TrackPoint = { lat: number; lon: number; ts: string };

// 트레일 조회 윈도(분) — 기간 선택 UI 없이 이 상수 하나로 조정한다.
export const TRACK_WINDOW_MIN = 30;
// 다운샘플 상한 — 30분×2초 케이던스(≈900점)를 지도 폴리라인에 적정한 밀도로 줄인다.
export const TRACK_MAX_POINTS = 240;

// 한국 범위 게이트 — 지도 마커·fieldCoords 와 동일 기준(시뮬레이터 해외 좌표 오염 차단).
export function isKoreaCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 32.5 &&
    lat <= 39.5 &&
    lon >= 123.5 &&
    lon <= 132.5
  );
}

// DB 행 → 트랙 포인트 — 좌표 유효성·한국범위를 통과한 것만.
export function sanitizeTrack(
  rows: { ts: string; latitude: number | null; longitude: number | null }[],
): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const r of rows) {
    if (r.latitude === null || r.longitude === null) continue;
    if (!isKoreaCoord(r.latitude, r.longitude)) continue;
    if (Number.isNaN(Date.parse(r.ts))) continue;
    out.push({ lat: r.latitude, lon: r.longitude, ts: r.ts });
  }
  return out;
}

// 균등 인덱스 다운샘플 — 첫 점·마지막 점 보존(마지막 점 = 현재 위치와 이어져야 함).
export function downsampleTrack(points: TrackPoint[], maxPoints = TRACK_MAX_POINTS): TrackPoint[] {
  if (maxPoints < 2 || points.length <= maxPoints) return points;
  const out: TrackPoint[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const p = points[Math.round(i * step)];
    if (p) out.push(p);
  }
  return out;
}
