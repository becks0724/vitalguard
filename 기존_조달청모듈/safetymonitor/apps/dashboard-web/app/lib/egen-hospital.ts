// E-Gen(국립중앙의료원 병의원 정보) 서버 조회 — 지역별 병의원 목록(연락처·진료시간·좌표)을 받아 인근 병원 리스트를 보강.
// 정책: EGEN_SERVICE_KEY(없으면 KOSHA/KMA data.go.kr 키 폴백) 있고 활용신청 승인 시 실데이터.
//   미설정·미승인(403)·오류는 모두 no-op(패널은 네이버 결과 그대로 — 절대 무너뜨리지 않음).
import "server-only";

import { egenRegionParams, matchEgenPlace, parseEgenXml, type EgenPlace } from "./egen";
import { isEmergencyRoom, type Hospital } from "./hospital";

type CacheEntry = { ts: number; places: EgenPlace[] };
const g = globalThis as typeof globalThis & {
  __smEgenCache?: Map<string, CacheEntry>;
};
const cache = g.__smEgenCache ?? (g.__smEgenCache = new Map());
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간 — 병의원 목록은 저빈도 변동
const NEG_TTL_MS = 10 * 60 * 1000; // 빈 결과(미승인 등)는 10분만 — 승인 후 자동 재조회
// 국립중앙의료원_전국 병·의원 찾기 서비스(연락처 dutyTel1 + 요일별 진료시간 dutyTime{1..7}s/c + 좌표)
const BASE =
  "https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire";

function serviceKey(): string | null {
  return (
    process.env.EGEN_SERVICE_KEY?.trim() ||
    process.env.KOSHA_SERVICE_KEY?.trim() ||
    process.env.KMA_SERVICE_KEY?.trim() ||
    null
  );
}

export function isEgenConfigured(): boolean {
  return serviceKey() !== null;
}

async function fetchRegionPlaces(region: string): Promise<EgenPlace[]> {
  const k = serviceKey();
  if (!k || !region) return [];

  const hit = cache.get(region);
  if (hit) {
    const ttl = hit.places.length > 0 ? TTL_MS : NEG_TTL_MS;
    if (Date.now() - hit.ts < ttl) return hit.places;
  }

  const { sido, sidoShort, sigungu } = egenRegionParams(region);
  if (!sido) return [];

  // serviceKey 는 .env 에 인코딩키로 보관(kma.ts 와 동일하게 raw append).
  const fetchOne = async (q0: string): Promise<EgenPlace[]> => {
    const url =
      `${BASE}?serviceKey=${k}` +
      `&Q0=${encodeURIComponent(q0)}` +
      (sigungu ? `&Q1=${encodeURIComponent(sigungu)}` : "") +
      `&pageNo=1&numOfRows=1000`;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      // res.ok=false(403 미승인 등)면 [] → 빈 결과로 캐시(짧은 TTL)
      return res.ok ? parseEgenXml(await res.text()) : [];
    } catch {
      return []; // 네트워크/타임아웃도 no-op
    }
  };

  // E-Gen 은 Q0 를 주소 부분일치로 매칭하는데 표기가 지역마다 뒤섞임 —
  // 대부분은 정식명(충청북도…)이 맞지만 광주·전남은 「전남광주통합특별시」로 저장돼
  // 정식명이 0건 → 단축명(광주·전남)으로 1회 재시도해 뚫는다(반대 케이스는 정식명 유지).
  let places = await fetchOne(sido);
  if (places.length === 0 && sidoShort && sidoShort !== sido) {
    places = await fetchOne(sidoShort);
  }

  cache.set(region, { ts: Date.now(), places });
  return places;
}

// 인근 병원 목록에 연락처·진료시간을 보강(제자리 변형). 실패·미승인 시 그대로 둔다.
export async function enrichHospitals(
  hospitals: Hospital[],
  region: string,
): Promise<void> {
  const places = await fetchRegionPlaces(region);
  for (const h of hospitals) {
    const er = isEmergencyRoom(h); // 응급실/응급의료센터 = 규정상 24시간 운영
    const m = places.length > 0 ? matchEgenPlace(h, places) : null;
    if (m && !h.telephone && m.tel) h.telephone = m.tel;
    if (er) {
      h.openHours = "24시간 진료";
    } else if (m && m.hours) {
      h.openHours = m.hours;
    }
  }
}
