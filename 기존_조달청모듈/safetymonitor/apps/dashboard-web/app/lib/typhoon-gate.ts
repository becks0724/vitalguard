// 태풍 영향권 판정 순수 도메인 — 기상청 3구역(감시·경계·비상) + 강풍(rad15)/폭풍(rad25)반경 하이브리드.
// 두 축은 기준점이 다르다(구역=태풍 중심의 절대 위경도 / 반경=현장 기준 상대 거리) → 대체가 아니라 worst-of 합성.
// 현재 위치와 예보점을 모두 두 축으로 판정하고, 예보가 이기면 선행 경보 + 도달 리드타임을 낸다.
// 단 **실측이 태풍 강도에 미달하면 그 지점의 구역 축은 빼고 반경 축만 남긴다**(T-19, 아래 참조).
// 서버(typhoon.ts 정렬)·클라이언트(TyphoonTrack 게이팅) 양쪽에서 import 하는 무의존 순수 모듈(테스트 가능).

export type GateTrackPoint = {
  tm: string;
  lat: number;
  lon: number;
  rad15?: string; // 강풍반경(15m/s) km 문자열
  rad25?: string; // 폭풍반경(25m/s) km 문자열
  // 70% 확률반경(km) — 예보점에만 존재. ⚠️ 강풍반경이 아니라 '중심이 있을 수 있는 범위'다.
  // 강풍반경 자리에 넣으면 판정 근거가 통째로 바뀐다(풍속 도달 범위 ≠ 위치 오차).
  radPr?: string;
  maxWindMs?: number; // typWs — 최대풍속(m/s). 태풍 강도 미달(열대저압부) 판정에 쓴다.
};

// 판정 등급 6단계 — 앞 3개는 구역 축(태풍 중심 위치), 뒤 3개는 반경 축(현장 영향권).
// watch/alert/emergency = 기상청 감시/경계/비상구역, approach/gale/storm = 접근 대비/강풍역/폭풍역.
export type Zone = "storm" | "gale" | "approach" | "emergency" | "alert" | "watch" | "none";
export const ZONE_RANK: Record<Zone, number> = {
  none: 0,
  watch: 1,
  alert: 2,
  emergency: 3,
  approach: 4,
  gale: 5,
  storm: 6,
};

// 기상청 방재기상운영규정 태풍 구역 — 태풍 중심의 절대 위경도로만 판정(현장 위치·태풍 크기 무관).
// ⚠️ 원문은 배타 서술이지만 그대로 구현하면 사각지대가 생긴다(예: 20°N·130°E 는 감시에도 경계에도 미해당).
// → 비상 → 경계 → 나머지 전부 감시 순서의 중첩 포함 구조로 판정한다(docs/typhoon-zone-hybrid T-03).
export const ALERT_ZONE = { minLat: 25, maxLon: 135 }; // 경계구역 — 북위 25° 북쪽·동경 135° 서쪽
export const EMERGENCY_ZONE = { minLat: 28, maxLon: 132 }; // 비상구역 — 북위 28° 북쪽·동경 132° 서쪽

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

// 반경 값이 "명시적으로 주어졌는지" — 미제공(undefined/"")과 명시 "0"(강풍역 소멸 예보)을 가른다.
// 예보점에서 이 둘의 처리가 다르다(미제공 = 현재 반경 폴백 / 명시 0 = KMA 예보 존중해 반경 판정 제외).
function hasExplicitRadius(s?: string): boolean {
  return s !== undefined && String(s).trim() !== "";
}

// 태풍 중심 위경도 → 기상청 구역 등급. 발효 중인 태풍은 북서태평양에만 있으므로 최소 감시(watch)다.
export function classifyKmaZone(lat: number, lon: number): Zone {
  if (lat >= EMERGENCY_ZONE.minLat && lon <= EMERGENCY_ZONE.maxLon) return "emergency";
  if (lat >= ALERT_ZONE.minLat && lon <= ALERT_ZONE.maxLon) return "alert";
  return "watch";
}

// 기상청 태풍 정의 — 중심 부근 최대풍속 17m/s 이상. 미만은 열대저압부(TD)이지 태풍이 아니다.
export const TYPHOON_MIN_WIND_MS = 17;

// 태풍 강도 미달(열대저압부) 여부 — 구역 축을 적용할 자격이 있는지 가른다.
// ⚠️ 최대풍속이 **없으면 false**(강등하지 않는다). 강등은 경보를 끄는 방향이라 사실로 확인된 값에만 적용한다.
// 값 미제공을 약화로 읽으면 상류 파싱이 한 번 실패했을 때 멀쩡한 태풍의 경보가 조용히 꺼진다.
export function isBelowTyphoonStrength(p: GateTrackPoint): boolean {
  return typeof p.maxWindMs === "number" && p.maxWindMs < TYPHOON_MIN_WIND_MS;
}

// 통보문 시각(typTm, KST yyyyMMddHHmm) → epoch ms. 형식 이상이면 null.
// 리드타임은 이 값들의 차이로만 계산한다 — 브라우저 시계(Date.now)를 섞으면 PC 시계 오차가 그대로 오차가 된다.
export function tmToMs(tm: string): number | null {
  const s = String(tm ?? "");
  if (!/^\d{12}/.test(s)) return null;
  return Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)) - 9, // KST(+9) → UTC
    Number(s.slice(10, 12)),
  );
}

// 한 지점(현재·예보 무관)의 반경 기반 영향권 등급 — 현장 GPS 있으면 현장 기준(정밀), 없으면 국토 중앙 근사.
function radiusZoneAt(
  lat: number,
  lon: number,
  galeKm: number,
  stormKm: number,
  siteLat?: number,
  siteLon?: number,
): Zone {
  const koreaKm = haversineKm(lat, lon, KOREA_CENTER.lat, KOREA_CENTER.lon);
  const siteKm =
    typeof siteLat === "number" && typeof siteLon === "number"
      ? haversineKm(lat, lon, siteLat, siteLon)
      : null;

  if (galeKm > 0) {
    if (siteKm !== null) {
      // 현장 GPS 기준(정밀) — 강풍역/폭풍역 진입 여부.
      if (stormKm > 0 && siteKm <= stormKm) return "storm";
      if (siteKm <= galeKm) return "gale";
      if (siteKm <= galeKm + APPROACH_LEAD_KM) return "approach";
      return "none";
    }
    // 현장 GPS 없음 — 국토 중앙점 근사로 강풍역 국토 도달 판정.
    if (koreaKm <= galeKm + KOREA_REACH_BUFFER_KM) return "gale";
    if (koreaKm <= galeKm + KOREA_REACH_BUFFER_KM + APPROACH_LEAD_KM) return "approach";
    return "none";
  }
  // 강풍반경 미제공 — 고정거리 폴백(접근 대비만).
  const inSite = siteKm !== null && siteKm <= SITE_FALLBACK_KM;
  const inKorea = koreaKm <= KOREA_FALLBACK_KM;
  return inSite || inKorea ? "approach" : "none";
}

const worst = (a: Zone, b: Zone): Zone => (ZONE_RANK[b] > ZONE_RANK[a] ? b : a);

export type GateResult = {
  tracking: boolean;
  zone: Zone; // 최종 등급 = worst(현재 구역, 현재 반경, 예보 최고)
  siteKm: number | null; // 태풍 현재 위치 ↔ 현장 거리
  koreaKm: number | null; // 태풍 현재 위치 ↔ 한국 중앙 거리
  galeKm: number; // 현재 위치 강풍반경
  stormKm: number; // 현재 위치 폭풍반경
  forecast: boolean; // true = 현재 시점보다 예보 진로가 높은 등급이라 선행 점등(진로 예보)
  kmaZone: Zone; // 현재 위치의 기상청 구역(합성 전) — 화면 라벨·근거 표시용
  radiusZone: Zone; // 현재 위치의 반경 판정(합성 전) — 구역 점등과 영향권 점등을 구분
  leadHours: number | null; // forecast 일 때 해당 예보점까지 남은 시간(통보문 시각 기준)
};

export const EMPTY_GATE: GateResult = {
  tracking: false,
  zone: "none",
  siteKm: null,
  koreaKm: null,
  galeKm: 0,
  stormKm: 0,
  forecast: false,
  kmaZone: "none",
  radiusZone: "none",
  leadHours: null,
};

// 하이브리드 영향권 판정 — 기상청 구역(태풍 중심 위경도) + 강풍/폭풍반경(현장 기준 거리)을 worst-of 합성.
// 현장 GPS(작업자 등록) 있으면 반경 축을 현장 기준(정밀)으로, 없으면 국토 중앙점 근사로 판정한다.
// ★ 예보 스캔은 조건 없이 항상 돈다 — 구역 축이 들어오면서 발효 태풍은 늘 watch 이상이라,
//   과거처럼 `zone === "none"` 을 조건으로 두면 선행 경보가 영영 실행되지 않는다(T-04).
export function computeGate(
  track: GateTrackPoint[],
  currentIndex: number,
  lat?: number,
  lon?: number,
): GateResult {
  const cur = track[Math.min(currentIndex, track.length - 1)] ?? null;
  if (!cur) return EMPTY_GATE;

  const galeKm = parseRadiusKm(cur.rad15);
  const stormKm = parseRadiusKm(cur.rad25);
  const koreaKm = haversineKm(cur.lat, cur.lon, KOREA_CENTER.lat, KOREA_CENTER.lon);
  const siteKm =
    typeof lat === "number" && typeof lon === "number"
      ? haversineKm(cur.lat, cur.lon, lat, lon)
      : null;

  // ── 현재 시점 = 두 축의 worst-of ──
  // ★ 실측이 태풍 강도 미달(열대저압부)이면 구역 축을 합성에서 뺀다(T-19).
  //   기상청 구역 정의에는 서쪽·남쪽 한계가 없어(T-08 기록된 한계) 중국 내륙에서 소멸 중인 저압부도
  //   위경도만으로 비상구역이 된다 — 2026-08-11 제13호 돌핀(현장 1,208km·15m/s·예보점 없음)이
  //   최고 등급 대표를 차지해 실제로 접근 중이던 제15호 찬홈을 화면에서 밀어냈다.
  //   반경 축은 건드리지 않는다 — 약화해도 현장에 가까우면 현장 실거리로 여전히 점등한다(안전 손실 없음).
  //   예보점에는 적용하지 않는다 — 실측 약화는 사실이지만 예보 약화는 추정이고,
  //   추정을 근거로 경보를 끄면 예보가 빗나갔을 때 그대로 경보 공백이 된다.
  const kmaZone = isBelowTyphoonStrength(cur) ? "none" : classifyKmaZone(cur.lat, cur.lon);
  const radiusZone = radiusZoneAt(cur.lat, cur.lon, galeKm, stormKm, lat, lon);
  const curZone = worst(kmaZone, radiusZone);

  // ── 예보점 스캔 — 각 예보점도 두 축으로 판정해 최고 등급과 그 지점을 찾는다 ──
  let fcZone: Zone = "none";
  let fcIdx = -1;
  for (let i = currentIndex + 1; i < track.length; i++) {
    const p = track[i];
    if (!p) continue;
    // 반경 폴백은 '값 미제공'일 때만 — 명시 "0"(강풍역 소멸 예보)은 KMA 예보를 존중해 반경 축에서 제외.
    // 구역 축은 위경도만 보므로 그대로 산출된다(강풍역이 소멸해도 중심이 비상구역이면 감시 대상).
    const gale15 = hasExplicitRadius(p.rad15) ? parseRadiusKm(p.rad15) : galeKm;
    const storm25 = hasExplicitRadius(p.rad25) ? parseRadiusKm(p.rad25) : stormKm;
    // 확률반경만큼 중심이 현장 쪽으로 치우쳐 있을 수 있다 → 그만큼 영향권을 넓혀 보수적으로 본다.
    // 반경이 0(미제공·소멸 예보)인 축에는 더하지 않는다 — 더하면 없던 영향권이 생긴다.
    const prKm = parseRadiusKm(p.radPr);
    const pRadius =
      hasExplicitRadius(p.rad15) && gale15 <= 0
        ? "none"
        : radiusZoneAt(
            p.lat,
            p.lon,
            gale15 > 0 ? gale15 + prKm : 0,
            storm25 > 0 ? storm25 + prKm : 0,
            lat,
            lon,
          );
    const pZone = worst(classifyKmaZone(p.lat, p.lon), pRadius);
    if (ZONE_RANK[pZone] > ZONE_RANK[fcZone]) {
      fcZone = pZone;
      fcIdx = i;
    }
  }

  // ── 최종 합성 — 예보가 현재보다 높을 때만 선행 점등(그때만 리드타임이 의미를 갖는다) ──
  const forecast = ZONE_RANK[fcZone] > ZONE_RANK[curZone];
  const zone = forecast ? fcZone : curZone;

  let leadHours: number | null = null;
  if (forecast && fcIdx >= 0) {
    const from = tmToMs(cur.tm);
    const to = tmToMs(track[fcIdx]?.tm ?? "");
    if (from !== null && to !== null && to > from) leadHours = (to - from) / 3_600_000;
  }

  return {
    tracking: zone !== "none",
    zone,
    siteKm,
    koreaKm,
    galeKm,
    stormKm,
    forecast,
    kmaZone,
    radiusZone,
    leadHours,
  };
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
