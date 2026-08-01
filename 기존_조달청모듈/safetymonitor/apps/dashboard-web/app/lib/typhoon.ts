// 기상청(1360000) 태풍정보 조회서비스 클라이언트 — getTyphoonInfo 진로/중심기압/최대풍속(다중 태풍).
// 정책: 이 서비스는 data.go.kr "활용신청" 승인이 별도로 필요(특보 키와 같은 계정이라도 미승인 시 Forbidden).
//   - 키 없음/미승인/오류 → 목업(데모 무중단, source:"mock" 으로 표시).
//   - 승인 + 발효 태풍 있음 → 실데이터 배열(각 source:"live"). 쌍태풍이면 2개 이상.
//   - 승인 + 발효 태풍 없음(비시즌) → 빈 배열.
// 파싱(typSeq 그룹핑·태풍별 최신 통보문 선택)은 순수 모듈 typhoon-parse.ts 로 분리(테스트 가능).
// 응답 필드(공식): typSeq/typTm/typLat/typLon/typDir/typSp/typPs/typWs/typ15/typ25/typName/typEn/img/tmFc.
import "server-only";

import {
  groupTyphoonItems,
  mergeForecast,
  parseForecastItems,
  pickCurrentIndex,
  type TrackPoint,
  type TyphoonInfo,
} from "./typhoon-parse";

export type { TrackPoint, TyphoonInfo };

type CacheEntry<T> = { ts: number; data: T };
const g = globalThis as typeof globalThis & {
  __smTyphoonCache?: Map<string, CacheEntry<unknown>>;
};
const cache = g.__smTyphoonCache ?? (g.__smTyphoonCache = new Map());
const TTL_MS = 30 * 60 * 1000; // 통보문은 3시간 간격 → 30분 캐시면 충분

function getCached<T>(k: string): T | null {
  const h = cache.get(k) as CacheEntry<T> | undefined;
  return h && Date.now() - h.ts < TTL_MS ? h.data : null;
}
function setCached<T>(k: string, d: T) {
  cache.set(k, { ts: Date.now(), data: d });
}

const BASE = "https://apis.data.go.kr/1360000/TyphoonInfoService";

// KMA 전용 키 우선, 없으면 KOSHA 키(같은 data.go.kr 계정 공통키) 폴백.
function serviceKey(): string | null {
  return (
    process.env.KMA_SERVICE_KEY?.trim() ||
    process.env.KOSHA_SERVICE_KEY?.trim() ||
    null
  );
}

// 데모 무중단용 목업(키 없음/미승인/오류 시). 남쪽에서 한반도로 북상하는 가상 태풍 진로.
function mockTyphoon(note: string): TyphoonInfo {
  const track: TrackPoint[] = [
    { tm: "샘플-1", lat: 24.0, lon: 127.5, dir: "NNW", speedKmh: 18, pressureHpa: 970, maxWindMs: 39, rad25: "120", rad15: "300" },
    { tm: "샘플-2", lat: 27.5, lon: 126.8, dir: "N", speedKmh: 20, pressureHpa: 965, maxWindMs: 43, rad25: "130", rad15: "320" },
    { tm: "샘플-3", lat: 31.0, lon: 126.5, dir: "NNE", speedKmh: 24, pressureHpa: 975, maxWindMs: 37, rad25: "110", rad15: "300" },
    { tm: "샘플-4", lat: 34.5, lon: 127.2, dir: "NE", speedKmh: 30, pressureHpa: 985, maxWindMs: 30, rad25: "0", rad15: "250" },
    { tm: "샘플-5", lat: 38.0, lon: 129.0, dir: "NE", speedKmh: 38, pressureHpa: 992, maxWindMs: 24, rad25: "0", rad15: "180" },
  ];
  return {
    source: "mock",
    seq: "샘플",
    name: "샘플태풍",
    nameEn: "SAMPLE",
    track,
    currentIndex: 1, // 두 번째 지점을 현재로 가정
    note,
  };
}

const UNAPPROVED_NOTE = "태풍정보 서비스 활용신청 승인 후 실시간 표시 — 현재 샘플 진로";

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// 태풍별 예보 진로(getTyphoonFcst) — 통보문(getTyphoonInfo)에는 예보점이 없어 별도 호출이 필요하다.
// 필수 파라미터는 tmFc + typSeq 둘 다(하나만 주면 APPLICATION_ERROR). 태풍당 1회.
// 응답에는 5일치 예보점과 radPr(70% 확률반경)이 들어 있다.
async function fetchForecast(key: string, seq: string, tmFc: string): Promise<TrackPoint[]> {
  const url =
    `${BASE}/getTyphoonFcst?serviceKey=${key}&dataType=JSON&pageNo=1&numOfRows=50` +
    `&tmFc=${encodeURIComponent(tmFc)}&typSeq=${encodeURIComponent(seq)}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return []; // 미승인/장애 시 평문 응답 — 관측 궤적만으로 계속 동작
  }
  const root = json as {
    response?: { header?: { resultCode?: string }; body?: { items?: { item?: unknown } } };
  };
  if (root?.response?.header?.resultCode !== "00") return [];
  const raw = root.response?.body?.items?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  return parseForecastItems(items);
}

// 각 태풍에 예보 진로를 붙인다. 예보 조회는 태풍마다 독립이라 하나가 실패해도 나머지는 살린다
// (실패 시 관측 궤적만 남고 화면은 그대로 동작 — 예보 부재는 정상 상태다).
async function attachForecasts(key: string, infos: TyphoonInfo[]): Promise<void> {
  await Promise.all(
    infos.map(async (info) => {
      if (!info.seq || !info.tmFc) return;
      try {
        const fc = await fetchForecast(key, info.seq, info.tmFc);
        if (fc.length === 0) return;
        info.track = mergeForecast(info.track, fc);
        info.currentIndex = pickCurrentIndex(info.track, info.tmFc); // 예보가 붙어도 현재는 마지막 관측
      } catch {
        // 관측 궤적 유지
      }
    }),
  );
}

// 발효 중인 태풍 전부(한국 최근접 순). 목업은 비캐시(승인 즉시 자동 라이브), 라이브/없음은 30분 캐시.
export async function getActiveTyphoons(): Promise<TyphoonInfo[]> {
  const key = serviceKey();
  if (!key) return [mockTyphoon("인증키 미설정 — 샘플 진로")];

  // 캐시 키 v3 — track 에 예보점(getTyphoonFcst)이 붙어 shape 이 바뀌었다. 회전하지 않으면 배포 후에도
  // 관측점만 든 stale 배열이 30분간 서빙된다(v2 회전과 같은 이유).
  const cached = getCached<TyphoonInfo[]>("active-v3");
  if (cached) return cached;

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 최근 2일 통보문
    // 페이지당 500행 + totalCount 기반 추가 페이지(최대 3) — 통보문 3시간 간격 × 2일 × 다중 태풍 ×
    // 진로점이라 단일 페이지 절단 시 최신 통보문이 잘려 stale 위치로 게이팅되는 조용한 열화 방지.
    const collected: Record<string, unknown>[] = [];
    for (let page = 1; page <= 3; page++) {
      const url =
        `${BASE}/getTyphoonInfo?serviceKey=${key}&dataType=JSON&pageNo=${page}&numOfRows=500` +
        `&fromTmFc=${yyyymmdd(from)}&toTmFc=${yyyymmdd(now)}`;
      // 업스트림 무응답 시 무한 대기 방지 — 8초 타임아웃(초과 시 throw → catch 의 목업 폴백).
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      // 미승인 시 본문이 "Forbidden" 평문 → JSON 파싱 실패. 승인 안내와 함께 샘플.
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        if (page === 1) return [mockTyphoon(UNAPPROVED_NOTE)];
        break; // 후속 페이지 실패는 수집분으로 진행
      }
      const root = json as {
        response?: {
          header?: { resultCode?: string };
          body?: { totalCount?: unknown; items?: { item?: unknown } };
        };
      };
      if (root?.response?.header?.resultCode !== "00") {
        if (page === 1) return [mockTyphoon(UNAPPROVED_NOTE)];
        break;
      }
      const body = root.response?.body;
      const raw = body?.items?.item;
      const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
      collected.push(...items);
      const total = Number(body?.totalCount ?? 0);
      if (!Number.isFinite(total) || collected.length >= total || items.length === 0) break;
    }
    const infos = groupTyphoonItems(collected); // 발효 없음 → [] (빈 배열도 캐시 = 정상 무태풍)
    await attachForecasts(key, infos); // 예보 진로(5일)·확률반경 부착
    setCached("active-v3", infos);
    return infos;
  } catch {
    return [mockTyphoon(UNAPPROVED_NOTE)];
  }
}
