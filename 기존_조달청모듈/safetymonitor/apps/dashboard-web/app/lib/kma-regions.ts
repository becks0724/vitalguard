// 기상특보(t6/t7) 구역 문자열 파싱 순수 유틸 — 괄호 안 콤마를 보존하는 최상위 분리 + 시·도 head 매칭
// + 현장 GPS 기반 시·도/인근 시·도 도출·구역 지역화. server-only 인 kma.ts 에서 분리해 단위테스트 가능하게 유지.
import { haversineKm } from "./typhoon-gate";

// 17 시·도 중심좌표 + t6 구역 문자열 매칭 키워드(head 매칭 기준 — kma.ts 에서 이동).
export type Sido = { name: string; lat: number; lon: number; keywords: string[] };
export const SIDO: Sido[] = [
  { name: "서울", lat: 37.5665, lon: 126.978, keywords: ["서울"] },
  { name: "부산", lat: 35.1796, lon: 129.0756, keywords: ["부산"] },
  { name: "대구", lat: 35.8714, lon: 128.6014, keywords: ["대구"] },
  { name: "인천", lat: 37.4563, lon: 126.7052, keywords: ["인천"] },
  // 광주광역시는 t6 에서 head "광주" 단독 토큰("…대전, 광주, 부산…") — 괄호-보존 분리 + head 매칭이라
  // 경기도 괄호 안의 경기 광주시("경기도(…, 광주, …)")와 충돌하지 않는다.
  { name: "광주", lat: 35.1595, lon: 126.8526, keywords: ["광주"] },
  { name: "대전", lat: 36.3504, lon: 127.3845, keywords: ["대전"] },
  { name: "울산", lat: 35.5384, lon: 129.3114, keywords: ["울산"] },
  { name: "세종", lat: 36.48, lon: 127.289, keywords: ["세종"] },
  { name: "경기", lat: 37.4138, lon: 127.5183, keywords: ["경기"] },
  { name: "강원", lat: 37.8228, lon: 128.1555, keywords: ["강원"] },
  { name: "충북", lat: 36.6357, lon: 127.4917, keywords: ["충청북", "충북"] },
  { name: "충남", lat: 36.5184, lon: 126.8, keywords: ["충청남", "충남"] },
  { name: "전북", lat: 35.7175, lon: 127.153, keywords: ["전라북", "전북"] },
  { name: "전남", lat: 34.8161, lon: 126.463, keywords: ["전라남", "전남"] },
  { name: "경북", lat: 36.4919, lon: 128.8889, keywords: ["경상북", "경북"] },
  { name: "경남", lat: 35.4606, lon: 128.2132, keywords: ["경상남", "경남"] },
  { name: "제주", lat: 33.4996, lon: 126.5312, keywords: ["제주"] },
];

// 현장 GPS → 가장 가까운 시·도(유클리드 근사, 키 불필요).
export function latLonToSido(lat: number, lon: number): Sido {
  // SIDO 는 17개 고정 리터럴이라 항상 존재하지만, 빈 배열 방어용 fallback 으로 undefined 제거.
  let best = SIDO[0] ?? { name: "서울", lat: 37.5665, lon: 126.978, keywords: ["서울"] };
  let bestD = Infinity;
  for (const s of SIDO) {
    const d = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// 인근 시·도 — 현장 GPS 기준 시·도 중심거리 임계 이내(현장 시·도 자신 제외).
// 예: 광주 현장 → 전남(~52km)·전북(~67km). 경보 팝업의 "현장 + 인근" 지역화에 사용.
export const NEAR_SIDO_KM = 120;
export function nearbySidos(lat: number, lon: number): Sido[] {
  const own = latLonToSido(lat, lon);
  return SIDO.filter(
    (s) => s.name !== own.name && haversineKm(lat, lon, s.lat, s.lon) <= NEAR_SIDO_KM,
  );
}

// 특보 구역 목록을 현장·인근 시·도 것만 남기고 지역화 — 전국 나열 대신 관제 관점 요약.
// keywordSets[0] = 현장 시·도(맨 앞 정렬), 이후 = 인근 시·도.
// otherCount = 제외된(그 외 시·도) 구역 토큰 수 — 표시부에서 "외 N개 지역"으로 전국 발효 맥락 보존.
export function localizeRegions(
  regions: string[],
  keywordSets: string[][],
): { local: string[]; otherCount: number } {
  const rank = (r: string) => {
    const i = keywordSets.findIndex((ks) => regionMatchesSido(r, ks));
    return i < 0 ? Infinity : i;
  };
  const local = regions
    .filter((r) => rank(r) !== Infinity)
    .sort((a, b) => rank(a) - rank(b)); // 현장 시·도 → 인근 순(sort 안정성으로 원 순서 보존)
  return { local, otherCount: regions.length - local.length };
}

// 구역 나열을 최상위 콤마로만 분리 — "경기도(안산, 시흥), 인천" → ["경기도(안산, 시흥)", "인천"].
// 단순 split(",") 은 괄호 안 시·군·구가 독립 토큰으로 흩어져("광주" 등) 시·도 매칭을 오염시킨다.
export function splitRegions(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === "," && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
    } else {
      cur += ch;
    }
  }
  const t = cur.trim();
  if (t) out.push(t);
  return out;
}

// 구역 토큰의 head(괄호 앞 본구역명)가 시·도 키워드를 포함하는지.
// head 한정 매칭이라 "경기도(…, 광주, …)" 괄호 안의 경기 광주시가 광주광역시로 오매칭되지 않고,
// 광주광역시는 t6 에서 head "광주" 단독 토큰으로 오므로 정확히 잡힌다.
export function regionMatchesSido(region: string, keywords: string[]): boolean {
  const head = (region.split("(")[0] ?? region).trim();
  return keywords.some((k) => head.includes(k));
}
