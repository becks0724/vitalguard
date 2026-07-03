// 인근 병원 검색 순수 유틸 — 현장 주소→지역 도출, 네이버 지역검색 항목 파싱, 거리 계산.
// 서버(naver-local)·클라(HospitalPanel)·테스트가 공유하므로 server-only·네트워크 금지(순수 함수만).

export type Hospital = {
  name: string;
  category: string; // 네이버 category 예: "의료,건강>병원>정형외과"
  roadAddress: string;
  address: string;
  telephone: string;
  link: string;
  lat?: number;
  lon?: number;
  distanceKm?: number; // 현장 GPS 로부터의 거리(좌표 유효 시)
};

export type HospitalGroup = { department: string; items: Hospital[] };

export type HospitalResult = {
  configured: boolean; // 네이버 검색 API 키 설정 여부
  region: string; // 검색에 사용한 지역 키워드(예: "광주 동구")
  groups: HospitalGroup[]; // 진료과별 그룹
  nearestEmergency: Hospital[]; // 가장 가까운 응급실/종합병원 상위 N(거리순)
  authError?: boolean; // 키는 있으나 네이버 인증 실패(401/403) — "결과 없음"과 구분
  note?: string;
};

// 진료 카테고리(응급 우선). 지역검색은 쿼리당 최대 5건이라 진료과별로 각각 검색한다.
export const DEPARTMENTS = [
  "응급실",
  "정형외과",
  "외과",
  "신경외과",
  "내과",
  "안과",
  "이비인후과",
  "치과",
] as const;

// SOS·응급 대응용 축약 검색셋(호출 수 절약).
export const EMERGENCY_DEPARTMENTS = ["응급실", "종합병원"] as const;

// 한국 범위 게이트 — fieldCoords 와 동일 기준(비-한국·NaN·swap 좌표 배제).
const KR_LAT_MIN = 32.5;
const KR_LAT_MAX = 39.5;
const KR_LON_MIN = 123.5;
const KR_LON_MAX = 132.5;

export function inKorea(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= KR_LAT_MIN &&
    lat <= KR_LAT_MAX &&
    lon >= KR_LON_MIN &&
    lon <= KR_LON_MAX
  );
}

// 시·도 정식명 → 검색용 단축명. 지역검색 키워드는 "광주 동구"처럼 짧을수록 정확.
const SIDO_SHORT: Record<string, string> = {
  서울특별시: "서울",
  서울시: "서울",
  부산광역시: "부산",
  대구광역시: "대구",
  인천광역시: "인천",
  광주광역시: "광주",
  대전광역시: "대전",
  울산광역시: "울산",
  세종특별자치시: "세종",
  세종시: "세종",
  경기도: "경기",
  강원특별자치도: "강원",
  강원도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전북특별자치도: "전북",
  전라북도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주특별자치도: "제주",
  제주도: "제주",
};

// 현장 주소에서 "시·도 시·군·구"를 뽑아 검색 지역 키워드로 만든다.
// 예: "광주광역시 동구 중앙로 196" → "광주 동구", "경기도 성남시 분당구 …" → "경기 성남시".
// 시·군·구가 없으면(세종 등) 시·도 단독. 도출 불가 시 빈 문자열.
export function extractRegion(address: string): string {
  if (!address) return "";
  const tokens = address.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";

  const first = tokens[0] ?? "";
  // 시·도 판정: 맵에 있거나(정식명) 광역시/특별시/특별자치시/도/특별자치도 접미사.
  let sido = "";
  let restStart = 1;
  const mappedSido = SIDO_SHORT[first];
  if (mappedSido) {
    sido = mappedSido;
  } else if (/(특별시|광역시|특별자치시|특별자치도|도)$/.test(first)) {
    sido = first; // 미등록 시·도명은 원문 유지(그래도 검색은 됨)
  } else {
    // 첫 토큰이 시·도가 아니면 시·군·구부터 시작하는 주소로 간주.
    sido = "";
    restStart = 0;
  }

  let sigungu = "";
  for (let i = restStart; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok && /(시|군|구)$/.test(tok)) {
      sigungu = tok;
      break;
    }
  }

  return [sido, sigungu].filter(Boolean).join(" ").trim();
}

// HTML 태그 제거(지역검색 title 은 <b>강조</b> 포함).
export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

// 하버사인 거리(km).
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type NaverLocalRaw = {
  title?: string;
  category?: string;
  telephone?: string;
  address?: string;
  roadAddress?: string;
  link?: string;
  mapx?: string;
  mapy?: string;
};

// 네이버 지역검색 item 1건 → Hospital. mapx/mapy 는 현재 API 에서 WGS84×1e7 정수(경도=mapx·위도=mapy).
// 파싱 좌표가 한국 범위를 벗어나면(구 KATECH 형식 등) 좌표 미상으로 두고 거리 계산 제외.
export function parseNaverLocalItem(
  raw: NaverLocalRaw,
  origin?: { lat: number; lon: number },
): Hospital {
  const name = stripTags(raw.title ?? "").trim();
  const lonI = raw.mapx ? parseInt(raw.mapx, 10) : NaN;
  const latI = raw.mapy ? parseInt(raw.mapy, 10) : NaN;

  let lat: number | undefined;
  let lon: number | undefined;
  if (Number.isFinite(latI) && Number.isFinite(lonI)) {
    const la = latI / 1e7;
    const lo = lonI / 1e7;
    if (inKorea(la, lo)) {
      lat = la;
      lon = lo;
    }
  }

  let distanceKm: number | undefined;
  if (origin && lat !== undefined && lon !== undefined) {
    distanceKm = haversineKm(origin.lat, origin.lon, lat, lon);
  }

  return {
    name,
    category: raw.category ?? "",
    roadAddress: raw.roadAddress || "",
    address: raw.address || "",
    telephone: raw.telephone || "",
    link: raw.link || "",
    lat,
    lon,
    distanceKm,
  };
}

// 거리 표기(1km 미만은 m).
export function formatDistance(km?: number): string {
  if (km === undefined) return "";
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}
