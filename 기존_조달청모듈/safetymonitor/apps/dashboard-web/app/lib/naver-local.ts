// 네이버 지역검색(openapi.naver.com/v1/search/local) 클라이언트 — 현장 지역+진료과로 인근 병원 검색.
// 정책: Client ID/Secret 서버 보관, 진료과별 검색(쿼리당 최대 5건)→현장 GPS 거리정렬·중복제거, 지역별 6h 캐시.
//   - NAVER_SEARCH_CLIENT_ID/SECRET 미설정 → configured:false (대시보드 무중단, 패널이 키 미설정 안내).
//   - 지역검색은 좌표를 안 받으므로 "지역명 진료과" 키워드로 검색하고 거리·반경은 반환 좌표로 계산.
import "server-only";

import {
  DEPARTMENTS,
  EMERGENCY_DEPARTMENTS,
  parseNaverLocalItem,
  type Hospital,
  type HospitalGroup,
  type HospitalResult,
  type NaverLocalRaw,
} from "./hospital";

type CacheEntry = { ts: number; data: HospitalResult };
const g = globalThis as typeof globalThis & {
  __smHospitalCache?: Map<string, CacheEntry>;
};
const cache = g.__smHospitalCache ?? (g.__smHospitalCache = new Map());
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간 — 병원 목록은 저빈도 변동 + 쿼터 절약
const PER_DEPT = 5; // 지역검색 최대(display=5)
const NEAREST_N = 3; // nearestEmergency 상위 노출 수

function creds(): { id: string; secret: string } | null {
  const id = process.env.NAVER_SEARCH_CLIENT_ID?.trim();
  const secret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function isNaverSearchConfigured(): boolean {
  return creds() !== null;
}

async function searchOne(
  query: string,
  headers: Record<string, string>,
): Promise<{ items: NaverLocalRaw[]; status: number }> {
  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(
    query,
  )}&display=${PER_DEPT}&sort=comment`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { items: [], status: res.status };
    const json = (await res.json()) as { items?: NaverLocalRaw[] };
    return {
      items: Array.isArray(json.items) ? json.items : [],
      status: 200,
    };
  } catch {
    return { items: [], status: 0 }; // 개별 진료과 실패는 부분 격리(전체 무너지지 않게)
  }
}

export type HospitalScope = "full" | "emergency";

export async function searchNearbyHospitals(params: {
  region: string;
  lat: number;
  lon: number;
  scope: HospitalScope;
}): Promise<HospitalResult> {
  const { region, lat, lon, scope } = params;
  const c = creds();
  if (!c) {
    return {
      configured: false,
      region,
      groups: [],
      nearestEmergency: [],
      note: "NAVER_SEARCH_CLIENT_ID/SECRET 미설정",
    };
  }
  if (!region) {
    return {
      configured: true,
      region: "",
      groups: [],
      nearestEmergency: [],
      note: "현장 주소에서 지역을 도출할 수 없음",
    };
  }

  const cacheKey = `${scope}:${region}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.data;

  const departments =
    scope === "emergency"
      ? [...EMERGENCY_DEPARTMENTS]
      : [...DEPARTMENTS];
  const headers = {
    "X-Naver-Client-Id": c.id,
    "X-Naver-Client-Secret": c.secret,
  };
  const origin =
    Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;

  const seen = new Set<string>(); // name|roadAddress — 진료과 간 중복 제거(같은 병원이 여러 과에 잡힘)
  const groups: HospitalGroup[] = [];
  let authFailed = false; // 401/403 — 키는 있으나 인증 실패

  for (const dept of departments) {
    const { items: raws, status } = await searchOne(`${region} ${dept}`, headers);
    if (status === 401 || status === 403) authFailed = true;
    let items: Hospital[] = raws.map((r) => parseNaverLocalItem(r, origin));
    // 거리순(좌표 유효 우선), 그다음 이름
    items.sort(
      (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    );
    items = items.filter((h) => {
      if (!h.name) return false;
      const k = `${h.name}|${h.roadAddress}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (items.length > 0) groups.push({ department: dept, items });
  }

  // nearestEmergency — emergency 스코프면 전체, full 이면 응급실 그룹에서 거리순 상위.
  const emergencyPool =
    scope === "emergency"
      ? groups.flatMap((grp) => grp.items)
      : (groups.find((grp) => grp.department === "응급실")?.items ?? []);
  const nearestEmergency = emergencyPool
    .filter((h) => h.distanceKm !== undefined)
    .sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number))
    .slice(0, NEAREST_N);

  const data: HospitalResult = {
    configured: true,
    region,
    groups,
    nearestEmergency,
    ...(authFailed && groups.length === 0
      ? {
          authError: true,
          note: "네이버 인증 실패(401/403) — 검색 API Client ID/Secret 확인",
        }
      : {}),
  };
  // 인증 실패는 캐시하지 않는다(키 교정 즉시 반영되게).
  if (!data.authError) cache.set(cacheKey, { ts: Date.now(), data });
  return data;
}
