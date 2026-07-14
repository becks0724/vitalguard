// 태풍 영향권 판정 순수 도메인 — 강풍(rad15)/폭풍(rad25)반경 기반 존 판정(현재 위치 + 예보점 선행 경보)·worst-of 합성.
// 서버(typhoon.ts 정렬)·클라이언트(TyphoonTrack 게이팅) 양쪽에서 import 하는 무의존 순수 모듈(테스트 가능).

export type GateTrackPoint = {
  tm: string;
  lat: number;
  lon: number;
  rad15?: string; // 강풍반경(15m/s) km 문자열
  rad25?: string; // 폭풍반경(25m/s) km 문자열
};

// 태풍 영향권 등급 — 폭풍역(≥25m/s)·강풍역(≥15m/s)·접근 대비·밖.
export type Zone = "storm" | "gale" | "approach" | "none";
export const ZONE_RANK: Record<Zone, number> = { none: 0, approach: 1, gale: 2, storm: 3 };

export const KOREA_CENTER = { lat: 36.0, lon: 127.8 }; // 한반도 중앙 내륙 근사
export const APPROACH_LEAD_KM = 300; // 강풍역 바깥 '접근 대비'(조기 인지) 마진
export const KOREA_REACH_BUFFER_KM = 400; // 현장 GPS 없을 때 국토 가장자리 근사(강풍역이 국토에 닿는지)
export const SITE_FALLBACK_KM = 500; // 강풍반경 미제공 시 현장 폴백 거리
export const KOREA_FALLBACK_KM = 1000; // 강풍반경 미제공 시 한국 폴백 거리

const D2R = Math.PI / 180;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = (bLat - aLat) * D2R;
  const dLon = (bLon - aLon) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// 강풍/폭풍반경 문자열("300"·"0"·"")을 km 숫자로. 값 없음/0 이하 → 0.
export function parseRadiusKm(s?: string): number {
  const n = s ? Number.parseFloat(s) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type GateResult = {
  tracking: boolean;
  zone: Zone;
  siteKm: number | null; // 태풍 현재 위치 ↔ 현장 거리
  koreaKm: number | null; // 태풍 현재 위치 ↔ 한국 중앙 거리
  galeKm: number; // 현재 위치 강풍반경
  stormKm: number; // 현재 위치 폭풍반경
  forecast: boolean; // true = 현재 위치는 밖이지만 예보 진로가 영향권에 들어와 선행 점등(접근 예보)
};

export const EMPTY_GATE: GateResult = {
  tracking: false,
  zone: "none",
  siteKm: null,
  koreaKm: null,
  galeKm: 0,
  stormKm: 0,
  forecast: false,
};

// 강풍반경(rad15)/폭풍반경(rad25) 기준 영향권 판정 — 태풍 강풍역/폭풍역이 현장(또는 국토)에 닿는지.
// 현장 GPS(작업자 등록) 있으면 현장 기준(정밀), 없으면 국토 중앙점 근사로 판정.
// 현재 위치가 영향권 밖이어도 예보점(currentIndex 이후)이 강풍 영향권에 들어오면 '접근(진로 예보)'로 선행 점등.
export function computeGate(
  track: GateTrackPoint[],
  currentIndex: number,
  lat?: number,
  lon?: number,
): GateResult {
  const cur = track[Math.min(currentIndex, track.length - 1)] ?? null;
  if (!cur) return EMPTY_GATE;

  const hasSite = typeof lat === "number" && typeof lon === "number";
  const galeKm = parseRadiusKm(cur.rad15);
  const stormKm = parseRadiusKm(cur.rad25);
  const koreaKm = haversineKm(cur.lat, cur.lon, KOREA_CENTER.lat, KOREA_CENTER.lon);
  const siteKm = hasSite ? haversineKm(cur.lat, cur.lon, lat, lon) : null;

  let zone: Zone = "none";
  if (galeKm > 0) {
    if (siteKm !== null) {
      // 현장 GPS 기준(정밀) — 강풍역/폭풍역 진입 여부.
      if (stormKm > 0 && siteKm <= stormKm) zone = "storm";
      else if (siteKm <= galeKm) zone = "gale";
      else if (siteKm <= galeKm + APPROACH_LEAD_KM) zone = "approach";
    } else {
      // 현장 GPS 없음 — 국토 중앙점 근사로 강풍역 국토 도달 판정.
      if (koreaKm <= galeKm + KOREA_REACH_BUFFER_KM) zone = "gale";
      else if (koreaKm <= galeKm + KOREA_REACH_BUFFER_KM + APPROACH_LEAD_KM) zone = "approach";
    }
  } else {
    // 강풍반경 미제공 — 고정거리 폴백(접근 대비만).
    const inSite = siteKm !== null && siteKm <= SITE_FALLBACK_KM;
    const inKorea = koreaKm <= KOREA_FALLBACK_KM;
    if (inSite || inKorea) zone = "approach";
  }

  // 예보점 선행 경보 — 예보 진로(rad15 미제공 점은 현재 반경 폴백)가 현장/국토 강풍 영향권에 들어오면 접근 예보.
  let forecast = false;
  if (zone === "none") {
    for (let i = currentIndex + 1; i < track.length; i++) {
      const p = track[i];
      if (!p) continue;
      // 반경 폴백은 '값 미제공'일 때만 — 명시 "0"(강풍역 소멸 예보)은 KMA 예보를 존중해 미점등.
      const hasExplicit = p.rad15 !== undefined && String(p.rad15).trim() !== "";
      const pg = hasExplicit ? parseRadiusKm(p.rad15) : galeKm;
      if (pg <= 0) continue;
      const hit =
        hasSite && siteKm !== null
          ? haversineKm(p.lat, p.lon, lat, lon) <= pg
          : haversineKm(p.lat, p.lon, KOREA_CENTER.lat, KOREA_CENTER.lon) <= pg + KOREA_REACH_BUFFER_KM;
      if (hit) {
        zone = "approach";
        forecast = true;
        break;
      }
    }
  }

  return { tracking: zone !== "none", zone, siteKm, koreaKm, galeKm, stormKm, forecast };
}

// 다중 태풍 worst-of — 존 등급 최고, 동률이면 현장(없으면 한국) 최근접 태풍의 인덱스.
export function pickWorst(gates: GateResult[]): number {
  let best = 0;
  for (let i = 1; i < gates.length; i++) {
    const a = gates[best];
    const b = gates[i];
    if (!a || !b) continue;
    const ra = ZONE_RANK[a.zone];
    const rb = ZONE_RANK[b.zone];
    const da = a.siteKm ?? a.koreaKm ?? Infinity;
    const db = b.siteKm ?? b.koreaKm ?? Infinity;
    if (rb > ra || (rb === ra && db < da)) best = i;
  }
  return best;
}
