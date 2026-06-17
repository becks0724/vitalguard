// 기상청(1360000) 태풍정보 조회서비스 클라이언트 — getTyphoonInfo 진로/중심기압/최대풍속.
// 정책: 이 서비스는 data.go.kr "활용신청" 승인이 별도로 필요(특보 키와 같은 계정이라도 미승인 시 Forbidden).
//   - 키 없음/미승인/오류 → 목업(데모 무중단, source:"mock" 으로 표시).
//   - 승인 + 발효 태풍 있음 → 실데이터(source:"live").
//   - 승인 + 발효 태풍 없음(비시즌) → source:"none".
// 응답 필드(공식): typSeq/typTm/typLat/typLon/typDir/typSp/typPs/typWs/typ15/typ25/typName/typEn/img/tmFc.
import "server-only";

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

export type TrackPoint = {
  tm: string; // typTm — 분석/예보 시각(yyyyMMddHHmm)
  lat: number; // typLat
  lon: number; // typLon
  dir?: string; // typDir — 이동방향
  speedKmh?: number; // typSp — 이동속도(km/h)
  pressureHpa?: number; // typPs — 중심기압(hPa)
  maxWindMs?: number; // typWs — 최대풍속(m/s)
  rad25?: string; // typ25 — 25m/s 반경
  rad15?: string; // typ15 — 15m/s 반경
};

export type TyphoonInfo = {
  source: "live" | "mock" | "none";
  seq?: string; // typSeq — 태풍 번호
  name?: string; // typName — 태풍명(한글)
  nameEn?: string; // typEn — 태풍명(영문)
  img?: string; // 공식 진로 이미지 URL
  tmFc?: string; // 통보문 발표시각
  track: TrackPoint[]; // 시간순 진로
  currentIndex: number; // track 중 현재(통보문 시각 최근접) 인덱스
  note?: string; // 상태 안내 문구
};

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
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

// 통보문 시각(tmFc) 에 가장 가까운 track 지점 = 현재 분석 위치(이후 typTm 은 예보 위치).
function pickCurrentIndex(track: TrackPoint[], tmFc?: string): number {
  if (track.length === 0) return 0;
  if (!tmFc) return 0;
  const target = Number(tmFc.slice(0, 12)); // yyyyMMddHHmm 비교
  let best = 0;
  let bestD = Infinity;
  track.forEach((p, i) => {
    const t = Number(String(p.tm).slice(0, 12));
    if (!Number.isFinite(t)) return;
    const d = Math.abs(t - target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export async function getActiveTyphoon(): Promise<TyphoonInfo> {
  const key = serviceKey();
  if (!key) return mockTyphoon("인증키 미설정 — 샘플 진로");

  const cached = getCached<TyphoonInfo>("active");
  if (cached) return cached;

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 최근 2일 통보문
    const url =
      `${BASE}/getTyphoonInfo?serviceKey=${key}&dataType=JSON&pageNo=1&numOfRows=50` +
      `&fromTmFc=${yyyymmdd(from)}&toTmFc=${yyyymmdd(now)}`;
    // 업스트림 무응답 시 무한 대기 방지 — 8초 타임아웃(초과 시 throw → catch 의 목업 폴백).
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    // 미승인 시 본문이 "Forbidden" 평문 → JSON 파싱 실패. 승인 안내와 함께 샘플.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return mockTyphoon(UNAPPROVED_NOTE);
    }
    const root = json as {
      response?: { header?: { resultCode?: string }; body?: { items?: { item?: unknown } } };
    };
    if (root?.response?.header?.resultCode !== "00") {
      return mockTyphoon(UNAPPROVED_NOTE);
    }
    const raw = root.response?.body?.items?.item;
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    if (items.length === 0) {
      const none: TyphoonInfo = {
        source: "none",
        track: [],
        currentIndex: 0,
        note: "현재 발효 중인 태풍 없음",
      };
      setCached("active", none);
      return none;
    }

    // 가장 최근 통보문의 태풍(typSeq) 선택 → 그 태풍의 진로만.
    const latestTmFc = items
      .map((it) => String(it.tmFc ?? ""))
      .sort()
      .at(-1);
    const latestSeq = items.find((it) => String(it.tmFc ?? "") === latestTmFc)?.typSeq;
    const group = items.filter((it) => String(it.typSeq ?? "") === String(latestSeq));

    const track: TrackPoint[] = group
      .map((it) => ({
        tm: String(it.typTm ?? ""),
        lat: num(it.typLat) ?? NaN,
        lon: num(it.typLon) ?? NaN,
        dir: it.typDir ? String(it.typDir) : undefined,
        speedKmh: num(it.typSp),
        pressureHpa: num(it.typPs),
        maxWindMs: num(it.typWs),
        rad25: it.typ25 ? String(it.typ25) : undefined,
        rad15: it.typ15 ? String(it.typ15) : undefined,
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .sort((a, b) => String(a.tm).localeCompare(String(b.tm)));

    if (track.length === 0) {
      const none: TyphoonInfo = {
        source: "none",
        track: [],
        currentIndex: 0,
        note: "현재 발효 중인 태풍 없음",
      };
      setCached("active", none);
      return none;
    }

    const head =
      group.find((it) => String(it.typSeq ?? "") === String(latestSeq)) ?? group[0];
    if (!head) {
      const none: TyphoonInfo = {
        source: "none",
        track: [],
        currentIndex: 0,
        note: "현재 발효 중인 태풍 없음",
      };
      setCached("active", none);
      return none;
    }
    const info: TyphoonInfo = {
      source: "live",
      seq: head.typSeq ? String(head.typSeq) : undefined,
      name: head.typName ? String(head.typName) : undefined,
      nameEn: head.typEn ? String(head.typEn) : undefined,
      img: head.img ? String(head.img) : undefined,
      tmFc: latestTmFc,
      track,
      currentIndex: pickCurrentIndex(track, latestTmFc),
    };
    setCached("active", info);
    return info;
  } catch {
    return mockTyphoon(UNAPPROVED_NOTE);
  }
}
