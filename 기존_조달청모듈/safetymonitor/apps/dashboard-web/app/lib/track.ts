// 작업자 이동 경로(트랙) 순수 유틸 — 한국범위 게이트 + 균등 다운샘플(순수 로직, I/O 없음)
export type TrackPoint = {
  lat: number;
  lon: number;
  /** 전송 시각(ISO-UTC). */
  ts: string;
  /** 측위 시각(ISO-UTC). `ts` 와의 차가 그 좌표의 나이다. null = 미상(컬럼 도입 이전 행). */
  fixTs: string | null;
  /** 수평 정확도(m). null = 미보고. */
  accM: number | null;
};

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
  rows: {
    ts: string;
    latitude: number | null;
    longitude: number | null;
    location_timestamp?: string | null;
    location_accuracy_m?: number | null;
  }[],
): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const r of rows) {
    if (r.latitude === null || r.longitude === null) continue;
    if (!isKoreaCoord(r.latitude, r.longitude)) continue;
    if (Number.isNaN(Date.parse(r.ts))) continue;
    // 좌표 메타는 게이트가 아니다 — 없거나 깨져도 점은 살리고 "미상" 으로 남긴다.
    // 여기서 걸러 버리면 이력이 조용히 짧아진다(좌표는 멀쩡한데 메타 때문에 사라지는 꼴).
    const fixTs =
      typeof r.location_timestamp === "string" && !Number.isNaN(Date.parse(r.location_timestamp))
        ? r.location_timestamp
        : null;
    const accM =
      typeof r.location_accuracy_m === "number" && Number.isFinite(r.location_accuracy_m)
        ? r.location_accuracy_m
        : null;
    out.push({ lat: r.latitude, lon: r.longitude, ts: r.ts, fixTs, accM });
  }
  return out;
}

/**
 * 트레일 한 구간의 좌표 품질 요약 — 이력 상세(경로 칩)에 한 줄로 뜬다.
 *
 * ★ **다운샘플 이전** 점으로 내야 한다. `downsampleTrack` 이 240점으로 솎으므로 이후에 세면
 *   실제 분포가 아니라 표본의 분포를 재게 된다.
 * ★ 임계값을 쓰지 않는다 — 최대 지연(초)만 내고 "오래됐다" 판정은 화면이 자기 상수로 한다.
 *   서버가 300초를 알면 그 숫자가 두 곳에 살게 되고, 그 어긋남이 이 레포의 단골 결함이다.
 */
export type TrackQuality = {
  /** 좌표 보유 점 수(다운샘플 이전). */
  points: number;
  /** 측위 시각 대비 최대 지연(초). null = 잴 수 있는 점이 하나도 없다. */
  fixAgeMaxSec: number | null;
  /** 측위 시각이 없는 점 수. **0 으로 위장하지 않는다** — 컬럼 도입 이전 구간이 여기 드러난다. */
  unknownFix: number;
  /** 수평 정확도 중앙값(m). null = 보고된 점이 없다. */
  accuracyMedianM: number | null;
};

export function summarizeTrackQuality(points: TrackPoint[]): TrackQuality {
  let fixAgeMaxSec: number | null = null;
  let unknownFix = 0;
  const accs: number[] = [];
  for (const p of points) {
    if (p.fixTs === null) unknownFix += 1;
    else {
      // 음수는 시계 어긋남 — 0 으로 눕힌다(미래 측위는 없다).
      const age = Math.max(0, (Date.parse(p.ts) - Date.parse(p.fixTs)) / 1000);
      if (Number.isFinite(age) && (fixAgeMaxSec === null || age > fixAgeMaxSec)) fixAgeMaxSec = age;
    }
    if (p.accM !== null) accs.push(p.accM);
  }
  accs.sort((a, b) => a - b);
  const mid = Math.floor(accs.length / 2);
  const accuracyMedianM =
    accs.length === 0
      ? null
      : accs.length % 2 === 1
        ? (accs[mid] as number)
        : ((accs[mid - 1] as number) + (accs[mid] as number)) / 2;
  return {
    points: points.length,
    fixAgeMaxSec: fixAgeMaxSec === null ? null : Math.round(fixAgeMaxSec),
    unknownFix,
    accuracyMedianM,
  };
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

/**
 * 경로 **선**에 쓰는 정확도 상한(m). 이 값을 넘는 점은 선으로 잇지 않고 "부정확 점" 으로 따로 낸다.
 *
 * ★ 왜 (2026-08-29 · wear-os-port R-33). 워치가 FUSED 공급자라 위성(±12~40m)과 wifi·기지국(±100·200·300·1,366m)
 *   좌표가 한 줄에 섞여 온다. 하루 84점 중 정확도 >100m 가 10점이고, 연속 점 83구간 중 도보 불가 속도(>15km/h)
 *   8구간의 7이 정확도 >50m 였다 — 사용자가 "동선과 다르다" 고 짚은 500m 점프가 정확히 그 점들이다.
 *   선은 "지나간 길" 로 읽히므로 ±200m 짜리 점을 이으면 없는 길을 그린다. 원으로 두면 "이 근방 어딘가" 로 읽힌다.
 * ★ 50m 인 이유 = 위성 점의 p90(약 40m)과 기지국 최소값(93~100m) 사이. 데이터는 버리지 않는다(`coarse` 로 같이 간다).
 * ⚠ 정확도 **미보고(null)는 선에 남긴다** — 컬럼 도입 이전 행·애플 옛 행이 그것이고, 모르는 것을 나쁜 것으로 취급하면
 *   이력이 통째로 사라진다(sanitizeTrack 의 "메타는 게이트가 아니다" 와 같은 원칙).
 */
export const TRACK_LINE_ACC_MAX_M = 50;

/** 부정확 점 — 지도가 선 대신 반경=정확도의 흐린 원으로 그린다. */
export type TrackCoarsePoint = { lat: number; lon: number; accM: number };

/** 선에 쓸 점(정확도 ≤ 상한 또는 미보고)과 부정확 점을 가른다. 순서는 각각 보존된다. */
export function partitionTrackByAccuracy(points: TrackPoint[]): { line: TrackPoint[]; coarse: TrackPoint[] } {
  const line: TrackPoint[] = [];
  const coarse: TrackPoint[] = [];
  for (const p of points) {
    if (p.accM === null || p.accM <= TRACK_LINE_ACC_MAX_M) line.push(p);
    else coarse.push(p);
  }
  return { line, coarse };
}
