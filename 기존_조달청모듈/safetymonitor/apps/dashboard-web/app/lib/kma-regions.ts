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

// 시·도 판정용 대표점 — 시·도당 중심점 1개로 최근접을 재면 면적이 작은 광역시가
// 넓은 도(道)를 잡아먹는다(안산→인천·창원→부산·구미→대구). 그래서 도에는 주요 시·군 좌표를
// 여러 개 두고 "가장 가까운 시드가 속한 시·도"로 판정한다.
// 실측(2026-07-30) — 시드에 넣지 않은 홀드아웃 도시 24곳 정확도 58% → 88%.
// 남은 오판은 경계 인접(공주=충남·세종 / 정읍=전북 남단 / 장성=전남·광주)으로,
// 최근접 방식으로는 원리적 한계다. 100% 는 행정구역 폴리곤·역지오코딩이라야 한다.
// ⚠️ nearbySidos 의 거리 계산은 아래 시드가 아니라 SIDO 중심점을 그대로 쓴다 —
//    인근 시·도 목록(반경 120km)의 기존 동작을 바꾸지 않기 위해서다.
// 미기재 시·도(광역시)는 SIDO 중심점 1개를 시드로 쓴다.
const SIDO_SEEDS: Record<string, readonly (readonly [number, number])[]> = {
  경기: [
    [37.2636, 127.0286], // 수원
    [37.3219, 126.8309], // 안산
    [37.6584, 126.832], // 고양
    [37.738, 127.034], // 의정부
    [36.9921, 127.1129], // 평택
    [37.6359, 127.2165], // 남양주
    [37.272, 127.435], // 이천
    [37.6152, 126.7156], // 김포
    [37.7599, 126.78], // 파주
    [37.42, 127.1265], // 성남
  ],
  강원: [
    [37.8813, 127.7298], // 춘천
    [37.7519, 128.8761], // 강릉
    [37.3422, 127.9202], // 원주
    [38.207, 128.5918], // 속초
    [37.1641, 128.9856], // 태백
  ],
  충북: [
    [36.6424, 127.489], // 청주
    [36.991, 127.926], // 충주
    [37.1326, 128.191], // 제천
    [36.3062, 127.5714], // 옥천
  ],
  충남: [
    [36.8151, 127.1139], // 천안
    [36.6014, 126.6608], // 홍성
    [36.7848, 126.4503], // 서산
    [36.1872, 127.0987], // 논산
    [36.3333, 126.6127], // 보령
  ],
  전북: [
    [35.8242, 127.148], // 전주
    [35.9676, 126.7369], // 군산
    [35.4164, 127.3905], // 남원
    [36.0068, 127.6608], // 무주
  ],
  전남: [
    [34.8118, 126.3922], // 목포
    [34.9506, 127.4872], // 순천
    [34.7604, 127.6622], // 여수
    [35.0158, 126.7108], // 나주
    [34.5735, 126.5989], // 해남
    [35.3212, 126.988], // 담양
  ],
  경북: [
    [36.5684, 128.7294], // 안동
    [36.019, 129.3435], // 포항
    [36.1196, 128.3441], // 구미
    [35.8562, 129.2247], // 경주
    [35.825, 128.7415], // 경산
    [36.8057, 128.624], // 영주
    [36.4109, 128.159], // 상주
  ],
  경남: [
    [35.2281, 128.6811], // 창원
    [35.1803, 128.1076], // 진주
    [35.2285, 128.8894], // 김해
    [34.8544, 128.4331], // 통영
    [35.6866, 127.9095], // 거창
    [35.335, 129.0373], // 양산
  ],
  제주: [
    [33.4996, 126.5312], // 제주시
    [33.2541, 126.5601], // 서귀포
  ],
};

// 현장 GPS → 가장 가까운 대표점이 속한 시·도(유클리드 근사, 키 불필요).
export function latLonToSido(lat: number, lon: number): Sido {
  // SIDO 는 17개 고정 리터럴이라 항상 존재하지만, 빈 배열 방어용 fallback 으로 undefined 제거.
  let best = SIDO[0] ?? { name: "서울", lat: 37.5665, lon: 126.978, keywords: ["서울"] };
  let bestD = Infinity;
  for (const s of SIDO) {
    for (const [sLat, sLon] of SIDO_SEEDS[s.name] ?? [[s.lat, s.lon] as const]) {
      const d = (sLat - lat) ** 2 + (sLon - lon) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
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
