// 기상청(1360000) 기상특보 클라이언트 — 현재 발효 특보를 현장 GPS(17 시·도 coarse 매핑)로 필터.
// 정책: KMA_SERVICE_KEY(없으면 KOSHA_SERVICE_KEY 폴백) 있으면 실 API, 없으면 목업(데모 무중단).
// 데이터: getWthrWrnMsg(stnId=108 본청) 최신 통보문의 t6 = "현재 발효 특보 현황"
//   ("o 특보종류 : 구역1, 구역2…" 줄들) 을 파싱 → 시·도 키워드로 필터.
import "server-only";

type CacheEntry<T> = { ts: number; data: T };
const g = globalThis as typeof globalThis & {
  __smKmaCache?: Map<string, CacheEntry<unknown>>;
};
const cache = g.__smKmaCache ?? (g.__smKmaCache = new Map());
const TTL_MS = 10 * 60 * 1000; // 특보는 수시 변동 → 10분 캐시

function getCached<T>(k: string): T | null {
  const h = cache.get(k) as CacheEntry<T> | undefined;
  return h && Date.now() - h.ts < TTL_MS ? h.data : null;
}
function setCached<T>(k: string, d: T) {
  cache.set(k, { ts: Date.now(), data: d });
}

const BASE = "https://apis.data.go.kr/1360000/WthrWrnInfoService";

// KMA 전용 키 우선, 없으면 KOSHA 키(같은 data.go.kr 계정 공통키) 폴백.
function serviceKey(): string | null {
  return (
    process.env.KMA_SERVICE_KEY?.trim() ||
    process.env.KOSHA_SERVICE_KEY?.trim() ||
    null
  );
}

export type WarningLevel = "경보" | "주의보";
export type ActiveWarning = { type: string; level: WarningLevel; regions: string[] };
// 예비특보(t7) — 가까운 미래에 발효 예정인 특보(사전 대비용). 시점 문자열 + 구역.
export type PreliminaryWarning = { type: string; when: string; regions: string[] };

// 17 시·도 중심좌표 + t6 구역 문자열 매칭 키워드(구역명이 도/시 전체명을 포함).
const SIDO: { name: string; lat: number; lon: number; keywords: string[] }[] = [
  { name: "서울", lat: 37.5665, lon: 126.978, keywords: ["서울"] },
  { name: "부산", lat: 35.1796, lon: 129.0756, keywords: ["부산"] },
  { name: "대구", lat: 35.8714, lon: 128.6014, keywords: ["대구"] },
  { name: "인천", lat: 37.4563, lon: 126.7052, keywords: ["인천"] },
  { name: "광주", lat: 35.1595, lon: 126.8526, keywords: ["광주광역시", "광주북", "광주남", "광주동", "광주서"] },
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
export function latLonToSido(lat: number, lon: number) {
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

// t6 ("o 태풍경보 : 남해…\r\no 강풍주의보 : 전라남도(…)") → 발효 특보 배열.
function parseT6(t6: string): ActiveWarning[] {
  const out: ActiveWarning[] = [];
  for (const raw of t6.split(/\r?\n/)) {
    const line = raw.replace(/^\s*o\s*/, "").trim();
    if (!line || line.startsWith("없음")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const type = line.slice(0, idx).trim();
    if (!type) continue;
    const regions = line
      .slice(idx + 1)
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    const level: WarningLevel = type.endsWith("경보") ? "경보" : "주의보";
    out.push({ type, level, regions });
  }
  return out;
}

// t7 ("(1) 풍랑 예비특보\r\no 06월 02일 밤(18시~24시) : 동해…\r\no …") → 예비특보 배열.
// "(N) <종류> 예비특보" 머리줄로 종류가 바뀌고, 그 아래 "o <시점> : 구역들" 줄들이 해당 종류.
function parseT7(t7: string): PreliminaryWarning[] {
  const out: PreliminaryWarning[] = [];
  let curType = "";
  for (const raw of t7.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^\(\d+\)\s*(.+?)\s*예비특보/);
    if (head) {
      curType = (head[1] ?? "").trim();
      continue;
    }
    if (!line.startsWith("o")) continue;
    const body = line.replace(/^o\s*/, "").trim();
    if (!body || body.startsWith("없음")) continue;
    const idx = body.indexOf(":");
    if (idx < 0) continue;
    const when = body.slice(0, idx).trim();
    const regions = body
      .slice(idx + 1)
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (curType && regions.length > 0) out.push({ type: curType, when, regions });
  }
  return out;
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

// 데모 무중단용 목업(키 없을 때만).
const MOCK_WARNINGS: ActiveWarning[] = [
  { type: "강풍주의보", level: "주의보", regions: ["서울", "경기도", "강원특별자치도"] },
  { type: "폭염주의보", level: "주의보", regions: ["전라남도", "경상남도", "제주도"] },
];
const MOCK_PRELIMINARY: PreliminaryWarning[] = [
  { type: "강풍", when: "오늘 밤(18시~24시)", regions: ["서울", "경기도"] },
];

type AllActive = {
  source: "live" | "mock";
  warnings: ActiveWarning[];
  preliminary: PreliminaryWarning[];
};

async function fetchAllActive(): Promise<AllActive> {
  const key = serviceKey();
  if (!key) {
    return { source: "mock", warnings: MOCK_WARNINGS, preliminary: MOCK_PRELIMINARY };
  }

  // 캐시 키 v2 — t7 추가로 저장 shape 변경(과거 배열 shape와 충돌 방지).
  const cached = getCached<Omit<AllActive, "source">>("active.v2");
  if (cached) return { source: "live", ...cached };

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3일 전(최대 6일 제약 내)
    const url =
      `${BASE}/getWthrWrnMsg?serviceKey=${key}&dataType=JSON&pageNo=1&numOfRows=1` +
      `&stnId=108&fromTmFc=${yyyymmdd(from)}&toTmFc=${yyyymmdd(now)}`;
    // data.go.kr hang 시 무한 대기 방지 — 6초 타임아웃(abort 시 아래 catch 가 목업 폴백).
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const json = await res.json();
    const resultCode = json?.response?.header?.resultCode;
    // 03 = NO_DATA: 발효 특보가 실제로 없는 "정상 무특보" 상태(오류 아님) → 라이브 빈 결과.
    //   이 분기 없이 !== "00" 으로 묶으면 전국 무특보 날 MOCK_WARNINGS(가짜 특보)가
    //   서울/경기/강원·전남/경남/제주 등록 작업자에게 거짓 점등됨(세션23 발견).
    if (resultCode === "03") {
      const empty = { warnings: [] as ActiveWarning[], preliminary: [] as PreliminaryWarning[] };
      setCached("active.v2", empty);
      return { source: "live", ...empty };
    }
    // 그 외 비정상 코드(99 서버오류·30 키오류 등)만 데모 무중단용 목업 폴백.
    if (resultCode !== "00") {
      return { source: "mock", warnings: MOCK_WARNINGS, preliminary: MOCK_PRELIMINARY };
    }
    // data.go.kr 응답 변형 대비(typhoon.ts/kosha.ts 와 동일 tolerant 추출):
    //   items.item(배열/단일) / items 가 바로 배열 / item 단일 모두 수용 후 첫 row.
    const body = json?.response?.body ?? {};
    const itemsRaw = body?.items ?? body;
    const rows = Array.isArray(itemsRaw)
      ? itemsRaw
      : (() => {
          const it = itemsRaw?.item ?? itemsRaw;
          return Array.isArray(it) ? it : it ? [it] : [];
        })();
    const first = rows[0];
    const warnings = parseT6(String(first?.t6 ?? ""));
    const preliminary = parseT7(String(first?.t7 ?? ""));
    setCached("active.v2", { warnings, preliminary });
    return { source: "live", warnings, preliminary };
  } catch {
    return { source: "mock", warnings: MOCK_WARNINGS, preliminary: MOCK_PRELIMINARY };
  }
}

export type LocationWarning = {
  source: "live" | "mock";
  sido: string;
  warnings: ActiveWarning[]; // 해당 시·도 매칭만
  severity: "normal" | "caution" | "danger";
  summary: string; // "강풍주의보 · 폭염주의보" 또는 "특보 없음"
  // 예비특보(t7) — 해당 시·도에 발효 예정인 특보(사전 대비). 있으면 caution.
  preliminary: PreliminaryWarning[];
  preliminarySeverity: "normal" | "caution";
  preliminarySummary: string; // "풍랑·강풍 예정" 또는 "예정 특보 없음"
};

// 현장 GPS 위치(시·도)의 현재 발효 특보 + 예비특보.
export async function warningsForLocation(
  lat: number,
  lon: number,
): Promise<LocationWarning> {
  const sido = latLonToSido(lat, lon);
  const matchSido = (regions: string[]) =>
    regions.some((r) => sido.keywords.some((k) => r.includes(k)));

  const { source, warnings, preliminary } = await fetchAllActive();
  const matched = warnings.filter((w) => matchSido(w.regions));
  const severity: LocationWarning["severity"] = matched.some((w) => w.level === "경보")
    ? "danger"
    : matched.length > 0
      ? "caution"
      : "normal";
  const summary = matched.length > 0 ? matched.map((w) => w.type).join(" · ") : "특보 없음";

  const prelimMatched = preliminary.filter((p) => matchSido(p.regions));
  const prelimTypes = [...new Set(prelimMatched.map((p) => p.type))];
  const preliminarySummary =
    prelimTypes.length > 0 ? `${prelimTypes.join("·")} 예정` : "예정 특보 없음";
  const preliminarySeverity: LocationWarning["preliminarySeverity"] =
    prelimMatched.length > 0 ? "caution" : "normal";

  return {
    source,
    sido: sido.name,
    warnings: matched,
    severity,
    summary,
    preliminary: prelimMatched,
    preliminarySeverity,
    preliminarySummary,
  };
}
