// 네이버 지역검색(NCP NAVER API HUB · naverapihub.apigw.ntruss.com/search/v1/local) — 현장 지역+진료과로 인근 병원 검색.
// 정책: Client ID/Secret(NCP APIGW 키·헤더 X-NCP-APIGW-API-KEY-ID/KEY) 서버 보관, 진료과별 검색(쿼리당 최대 5건)→현장 GPS 거리정렬·중복제거, 지역별 6h 캐시.
//   - NAVER_SEARCH_CLIENT_ID/SECRET(= NCP API HUB Client ID/Secret) 미설정 → configured:false (대시보드 무중단, 패널이 키 미설정 안내).
//   - 지역검색은 좌표를 안 받으므로 "지역명 진료과" 키워드로 검색하고 거리·반경은 반환 좌표(mapx/mapy=WGS84×1e7)로 계산.
import "server-only";

import { enrichHospitals } from "./egen-hospital";
import {
  DEPARTMENTS,
  EMERGENCY_DEPARTMENTS,
  isEmergencyRoom,
  isMedicalPlace,
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
  const url = `https://naverapihub.apigw.ntruss.com/search/v1/local?query=${encodeURIComponent(
    query,
  )}&display=${PER_DEPT}&start=1&sort=comment&format=json`;
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
    "X-NCP-APIGW-API-KEY-ID": c.id,
    "X-NCP-APIGW-API-KEY": c.secret,
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
      // 주차장·교차로 등 비의료 junk 배제(전 그룹 — 인근 병원 리스트에서도 주차장 제거).
      if (!isMedicalPlace(h)) return false;
      const k = `${h.name}|${h.roadAddress}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (items.length > 0) groups.push({ department: dept, items });
  }

  // 공공데이터(E-Gen)로 연락처·진료시간 보강 — 제자리 변형이라 아래 nearestEmergency 파생 복사본에도 반영.
  // 미승인/오류는 no-op(네이버 결과 그대로).
  await enrichHospitals(groups.flatMap((grp) => grp.items), region);

  // nearestEmergency — 실제 응급실/응급의료센터(category "병원>응급실")를 1순위 티어로, 종합병원은 폴백 티어.
  // (전역 거리순이면 가까운 종합병원[정형외과 등]이 실제 응급의료센터보다 위로 오던 버그 수정)
  const emergencyPool = (
    scope === "emergency"
      ? groups.flatMap((grp) => grp.items)
      : (groups.find((grp) => grp.department === "응급실")?.items ?? [])
  ).filter((h) => h.distanceKm !== undefined);
  const byDist = (a: Hospital, b: Hospital) =>
    (a.distanceKm as number) - (b.distanceKm as number);
  const ers = emergencyPool
    .filter(isEmergencyRoom)
    .sort(byDist)
    .map((h) => ({ ...h, emergencyKind: "응급실" as const }));
  const general = emergencyPool
    .filter((h) => !isEmergencyRoom(h))
    .sort(byDist)
    .map((h) => ({ ...h, emergencyKind: "종합병원" as const }));
  // 응급실 티어 우선, 같은 병원(도로명주소) 중복은 앞선 것(응급실) 유지.
  const seenLoc = new Set<string>();
  const nearestEmergency = [...ers, ...general]
    .filter((h) => {
      const k = h.roadAddress || h.name;
      if (seenLoc.has(k)) return false;
      seenLoc.add(k);
      return true;
    })
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
