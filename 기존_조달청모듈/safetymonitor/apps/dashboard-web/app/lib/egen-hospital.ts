// E-Gen(국립중앙의료원 병의원 정보) 서버 조회 — 지역별 병의원 목록(연락처·진료시간·좌표)을 받아 인근 병원 리스트를 보강.
// 정책: EGEN_SERVICE_KEY(없으면 KOSHA/KMA data.go.kr 키 폴백) 있고 활용신청 승인 시 실데이터.
//   미설정·미승인(403)·오류는 모두 no-op(패널은 네이버 결과 그대로 — 절대 무너뜨리지 않음).
import "server-only";

import {
  egenRegionParams,
  matchEgenPlace,
  mergeEgenPlaces,
  parseEgenTotalCount,
  parseEgenXml,
  type EgenPlace,
} from "./egen";
import { isEmergencyRoom, type Hospital } from "./hospital";

type CacheEntry = { ts: number; places: EgenPlace[] };
const g = globalThis as typeof globalThis & {
  __smEgenCache?: Map<string, CacheEntry>;
};
const cache = g.__smEgenCache ?? (g.__smEgenCache = new Map());
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간 — 병의원 목록은 저빈도 변동
const NEG_TTL_MS = 10 * 60 * 1000; // 빈 결과(미승인 등)는 10분만 — 승인 후 자동 재조회
// 한 요청에 받을 건수. 5000 은 실측 상한 확인값(강남구 3,058건이 1회에 들어온다·2.7MB·1.06s).
const PAGE_ROWS = 5000;
// 지역당 페이지 상한 = 10,000건. 시·군·구 단위는 1페이지로 끝나고, 이 상한에 닿는 것은
// Q1 이 비어 시·도 전체가 잡힌 예외 경로뿐이다. 닿으면 경고를 남긴다(조용한 절단 금지).
const MAX_PAGES = 2;
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
  const fetchPage = async (
    q0: string,
    pageNo: number,
  ): Promise<{ places: EgenPlace[]; total: number }> => {
    const url =
      `${BASE}?serviceKey=${k}` +
      `&Q0=${encodeURIComponent(q0)}` +
      (sigungu ? `&Q1=${encodeURIComponent(sigungu)}` : "") +
      `&pageNo=${pageNo}&numOfRows=${PAGE_ROWS}`;
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      // res.ok=false(403 미승인 등)면 [] → 빈 결과로 캐시(짧은 TTL)
      if (!res.ok) return { places: [], total: -1 };
      const xml = await res.text();
      return { places: parseEgenXml(xml), total: parseEgenTotalCount(xml) };
    } catch {
      return { places: [], total: -1 }; // 네트워크/타임아웃도 no-op
    }
  };

  // 한 지역명의 전체 목록. 종전엔 `numOfRows=1000` 한 번이라 **1000건 넘는 시·군·구는 뒤가 잘리고
  // 잘린 병원은 조용히 연락처가 안 붙었다**(서울 강남구 실측 3,058건 — 2/3 유실).
  // 실측(2026-08-14) 기준 시·군·구 단위는 최대 3천 건대라 PAGE_ROWS 한 번으로 끝난다(강남구 2.7MB·1.06s).
  // ⚠ 주소에 시/군/구 토큰이 없어 Q1 이 비면 시·도 전체가 잡힌다(서울 19,497 · 경기 18,181) —
  //   그건 MAX_PAGES 로 끊고 **경고를 남긴다**. 조용히 자르면 "연락처가 원래 없는 병원"과 구분되지 않는다.
  const fetchAll = async (q0: string): Promise<EgenPlace[]> => {
    const first = await fetchPage(q0, 1);
    if (first.places.length === 0) return [];
    const pages = Math.min(
      Math.max(1, Math.ceil(first.total / PAGE_ROWS)),
      MAX_PAGES,
    );
    if (first.total > PAGE_ROWS * MAX_PAGES) {
      console.warn(
        `[egen] ${q0}${sigungu ? ` ${sigungu}` : ""} 전체 ${first.total}건 중 ${PAGE_ROWS * MAX_PAGES}건만 조회 — 나머지는 연락처가 비게 된다(시·군·구가 비어 시·도 전체가 잡혔는지 확인할 것)`,
      );
    }
    if (pages <= 1) return first.places;
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => fetchPage(q0, i + 2)),
    );
    return [first.places, ...rest.map((r) => r.places)].flat();
  };

  // E-Gen 은 Q0 를 주소 부분일치로 매칭하는데 2026 개편으로 표기가 지역마다 갈렸다.
  // ★ 종전엔 "정식명이 0건이면 단축명 재시도" 였는데, 광주는 옛 표기로 남은 잔여가 **1건** 이라
  //   0 이 아니어서 재시도가 영영 안 열렸다(정식명 1 vs 단축명 234 — 연락처가 통째로 비었다).
  //   반대 방향도 있어(충북 1130 vs 0 · 충남 847 vs 1) 순서를 뒤집어도 같은 함정이다.
  //   그래서 **둘 다 조회해 합친다** — 병렬이라 지연은 그대로고, 순서·임계 판단이 사라진다.
  const both = await Promise.all([
    fetchAll(sido),
    sidoShort && sidoShort !== sido ? fetchAll(sidoShort) : Promise.resolve([]),
  ]);
  const places = mergeEgenPlaces(both[0], both[1]);

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
