// KOSHA 공공데이터포털 OpenAPI 클라이언트 — 건설현장 안전 신호등 + 사고사망 게시판.
// 정책: 인증키(KOSHA_SERVICE_KEY) 가 .env 에 있으면 실 API, 없으면 목업 fallback(데모 무중단).
// ⚠ 실 API 엔드포인트 경로 / 응답 필드명은 키 발급 후 활용가이드(.docx)·Swagger 로 확정 필요.
//   아래 ENDPOINT 상수와 normalize* 의 후보 필드는 같은 게시판 조회 API 패밀리(15121001) 기준 best-effort.
import "server-only";

// ── 공통 캐시 (weather route 패턴과 동일) ──────────────────────────────
type CacheEntry<T> = { ts: number; data: T };
const globalForKosha = globalThis as typeof globalThis & {
  __safetyMonitorKoshaCache?: Map<string, CacheEntry<unknown>>;
};
const cache =
  globalForKosha.__safetyMonitorKoshaCache ??
  (globalForKosha.__safetyMonitorKoshaCache = new Map());
const CACHE_TTL_MS = 30 * 60 * 1000; // KOSHA 게시판은 느리게 갱신 → 30분

function getCached<T>(key: string): T | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  return null;
}
function setCached<T>(key: string, data: T) {
  cache.set(key, { ts: Date.now(), data });
}

// ── 공통 상수 ─────────────────────────────────────────────────────────
// data.go.kr KOSHA(B552468) 게시판 조회 API. 엔드포인트 = 서비스/오퍼레이션(=get+서비스명).
// 실 응답으로 확정함(2026-05-31): 사고사망 callApiId=1040 정상, 안전신호등 1020 은 KOSHA 서버가
// UNKNOWN_ERROR(99) 반환(백엔드 오류, 우리 측 수정 불가) → 안전신호등은 목업 유지.
const KOSHA_BASE = "https://apis.data.go.kr/B552468";
const KOSHA_PATH = {
  safetyLight: "constplan01/getconstplan01", // 1020 — 현재 KOSHA 서버 오류
  fatalAccident: "news_api02/getNews_api02", // 1040 — ✅ 정상
  // 국내재해사례 1060 — 전용 End Point disaster_api02 는 키 미승인(Forbidden)이라
  // 동일 데이터를 주는 news_api02(callApiId=1060)로 수신. disaster_api02 활용신청 승인 시
  // 이 경로를 "disaster_api02/getdisaster_api02" 로 교체하면 됨.
  accidentCase: "news_api02/getNews_api02", // 1060 — ✅ 정상(6,334건)
} as const;
const CALL_API_ID = {
  safetyLight: "1020",
  fatalAccident: "1040",
  accidentCase: "1060",
} as const;

function hasKey(): boolean {
  return typeof process.env.KOSHA_SERVICE_KEY === "string" && process.env.KOSHA_SERVICE_KEY.length > 0;
}

// 응답에서 후보 키들 중 첫 번째 존재값 추출(실 필드명 미확정 대비 tolerant).
function pick(obj: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const v = obj[c];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

// ── 건설현장 안전 신호등 ───────────────────────────────────────────────
export type SafetyLightPayload = {
  source: "live" | "mock";
  counts: { red: number; yellow: number; green: number; total: number };
  fetchedAt: string;
  note?: string;
};

const SAFETY_LIGHT_MOCK: SafetyLightPayload = {
  source: "mock",
  counts: { red: 12, yellow: 38, green: 174, total: 224 },
  fetchedAt: "",
  note: "KOSHA 신호등 API(callApiId 1020) 서버 점검중 — 샘플 표시",
};

export async function getSafetyLight(): Promise<SafetyLightPayload> {
  const nowIso = new Date().toISOString();
  if (!hasKey()) return { ...SAFETY_LIGHT_MOCK, fetchedAt: nowIso };

  const cacheHit = getCached<SafetyLightPayload>("safety-light");
  if (cacheHit) return cacheHit;

  // ⚠ 실 호출 — 엔드포인트·필드명 확정 후 정상화. 실패 시 목업으로 안전 강등.
  try {
    const url = new URL(`${KOSHA_BASE}/${KOSHA_PATH.safetyLight}`);
    url.searchParams.set("serviceKey", process.env.KOSHA_SERVICE_KEY as string);
    url.searchParams.set("callApiId", CALL_API_ID.safetyLight);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("type", "json");

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    assertNormal(json); // KOSHA 는 HTTP 200 + header.resultCode 로 앱 에러 전달(99=UNKNOWN_ERROR)
    const rows = extractRows(json);
    if (rows.length === 0) throw new Error("no rows");

    // 신호등 색/등급 필드 후보로 빨강/노랑/초록 집계.
    const counts = { red: 0, yellow: 0, green: 0, total: 0 };
    for (const row of rows) {
      const color = (pick(row, ["signalColor", "sgnlColor", "lightColor", "grade", "result", "color"]) ?? "").toLowerCase();
      counts.total++;
      if (/red|빨|적|위험|3/.test(color)) counts.red++;
      else if (/yellow|노|황|주의|2/.test(color)) counts.yellow++;
      else if (/green|초|녹|양호|1/.test(color)) counts.green++;
    }
    const payload: SafetyLightPayload = { source: "live", counts, fetchedAt: nowIso };
    setCached("safety-light", payload);
    return payload;
  } catch (err) {
    console.error("[kosha] safety-light fallback to mock:", err);
    return { ...SAFETY_LIGHT_MOCK, fetchedAt: nowIso, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}

// ── 사고사망 게시판 ───────────────────────────────────────────────────
export type AccidentItem = {
  id: string;
  title: string;
  date?: string;
  place?: string;
};
export type FatalAccidentsPayload = {
  source: "live" | "mock";
  items: AccidentItem[];
  fetchedAt: string;
  note?: string;
};

const FATAL_MOCK: FatalAccidentsPayload = {
  source: "mock",
  items: [
    { id: "m1", title: "[샘플] ○○아파트 신축현장 추락사고", date: "2026-05-30", place: "경기" },
    { id: "m2", title: "[샘플] △△플랜트 끼임사고", date: "2026-05-29", place: "충남" },
    { id: "m3", title: "[샘플] □□토목현장 건설기계 충돌", date: "2026-05-28", place: "전남" },
    { id: "m4", title: "[샘플] ◇◇교량 보수현장 추락", date: "2026-05-27", place: "부산" },
  ],
  fetchedAt: "",
  note: "샘플 데이터 — 인증키 연결 시 KOSHA 실시간 속보로 전환",
};

export async function getFatalAccidents(): Promise<FatalAccidentsPayload> {
  const nowIso = new Date().toISOString();
  if (!hasKey()) return { ...FATAL_MOCK, fetchedAt: nowIso };

  const cacheHit = getCached<FatalAccidentsPayload>("fatal-accidents");
  if (cacheHit) return cacheHit;

  try {
    const url = new URL(`${KOSHA_BASE}/${KOSHA_PATH.fatalAccident}`);
    url.searchParams.set("serviceKey", process.env.KOSHA_SERVICE_KEY as string);
    url.searchParams.set("callApiId", CALL_API_ID.fatalAccident);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "15");

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    assertNormal(json);
    const rows = extractRows(json);
    if (rows.length === 0) throw new Error("no rows");

    // 실 필드(2026-05-31 확정): keyword=제목(날짜·지역 포함), contents=HTML 본문, arno/boardno=id.
    const items: AccidentItem[] = rows.slice(0, 15).map((row, i) => ({
      id: pick(row, ["arno", "boardno", "id", "seq", "no"]) ?? `r${i}`,
      title: pick(row, ["keyword", "title", "subject", "ttl"]) ?? "(제목 없음)",
      date: pick(row, ["regDate", "createDate", "occrDate", "date", "writeDate"]),
      place: pick(row, ["place", "location", "addr", "area", "region"]),
    }));
    const payload: FatalAccidentsPayload = { source: "live", items, fetchedAt: nowIso };
    setCached("fatal-accidents", payload);
    return payload;
  } catch (err) {
    console.error("[kosha] fatal-accidents fallback to mock:", err);
    return { ...FATAL_MOCK, fetchedAt: nowIso, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}

// ── 국내재해사례 게시판 (callApiId 1060) ──────────────────────────────
export type AccidentCase = {
  id: string;
  title: string;
  business?: string; // 업종 (제조업/건설업 등)
  summary?: string; // 사고 경위 요약 (HTML 제거·축약, 카드용)
  detail?: string; // 사고 경위 전문 (HTML 제거, 모달용)
};
export type AccidentCasesPayload = {
  source: "live" | "mock";
  items: AccidentCase[];
  fetchedAt: string;
  note?: string;
};

const ACCIDENT_CASE_MOCK: AccidentCasesPayload = {
  source: "mock",
  items: [
    { id: "c1", title: "컨베이어에 끼임", business: "제조업", summary: "골재 이송 컨베이어 상부 이물질 제거 중 다리가 벨트와 테일풀리 사이에 끼임.", detail: "07:30경, 경기도 소재 사업장에서 재해자가 골재 이송 컨베이어 상부의 이물질을 제거하던 중 다리가 컨베이어 벨트와 테일 풀리(Tail Pulley) 사이에 끼임. ※ 테일 풀리: 컨베이어의 아래쪽 끝단에서 회전하며 벨트를 순환시키는 원통형 기계장치." },
    { id: "c2", title: "이동식 비계에서 추락", business: "건설업", summary: "외벽 도장 작업 중 안전난간 미설치 비계에서 약 3m 아래로 추락.", detail: "외벽 도장 작업 중 안전난간이 설치되지 않은 이동식 비계 작업발판에서 균형을 잃고 약 3m 아래 바닥으로 추락. 작업발판 단부 안전난간·안전대 부착설비 미설치." },
    { id: "c3", title: "지게차 충돌", business: "운수창고업", summary: "물류창고 내 후진하던 지게차와 보행 작업자가 충돌.", detail: "물류창고 내에서 후진하던 지게차와 보행 중이던 작업자가 충돌. 후방 경보장치·유도자 미배치, 작업구역과 보행로 미분리." },
    { id: "c4", title: "밀폐공간 질식", business: "환경처리업", summary: "정화조 내부 점검 중 산소결핍·황화수소로 질식.", detail: "정화조 내부 점검을 위해 진입한 작업자가 산소결핍 및 황화수소(H₂S)에 노출되어 질식. 사전 환기·가스농도 측정·감시인 배치 미흡." },
  ],
  fetchedAt: "",
  note: "샘플 데이터 — 인증키 연결 시 KOSHA 국내재해사례로 전환",
};

export async function getAccidentCases(): Promise<AccidentCasesPayload> {
  const nowIso = new Date().toISOString();
  if (!hasKey()) return { ...ACCIDENT_CASE_MOCK, fetchedAt: nowIso };

  const cacheHit = getCached<AccidentCasesPayload>("accident-cases");
  if (cacheHit) return cacheHit;

  try {
    const url = new URL(`${KOSHA_BASE}/${KOSHA_PATH.accidentCase}`);
    url.searchParams.set("serviceKey", process.env.KOSHA_SERVICE_KEY as string);
    url.searchParams.set("callApiId", CALL_API_ID.accidentCase);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "20");
    url.searchParams.set("type", "json");

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    assertNormal(json);
    const rows = extractRows(json);
    if (rows.length === 0) throw new Error("no rows");

    // 실 필드(2026-06-01 확정): keyword=제목, business=업종, contents=경위(평문/HTML), boardno=id.
    const items: AccidentCase[] = rows.slice(0, 20).map((row, i) => {
      const body = stripHtml(pick(row, ["contents", "cn", "content"]) ?? "");
      return {
        id: pick(row, ["boardno", "arno", "id", "seq", "no"]) ?? `c${i}`,
        title: pick(row, ["keyword", "title", "subject", "ttl"]) ?? "(제목 없음)",
        business: pick(row, ["business", "induty", "bizType", "indutyNm"]),
        summary: truncate(body, 110), // 카드 미리보기
        detail: truncate(body, 2000), // 모달 전문
      };
    });
    const payload: AccidentCasesPayload = { source: "live", items, fetchedAt: nowIso };
    setCached("accident-cases", payload);
    return payload;
  } catch (err) {
    console.error("[kosha] accident-cases fallback to mock:", err);
    return { ...ACCIDENT_CASE_MOCK, fetchedAt: nowIso, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}

// HTML 태그·엔티티 제거 + 공백 정리 (경위 본문이 <p><img> 등을 포함할 수 있음).
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// KOSHA 는 HTTP 200 으로 내리고 header.resultCode 로 성공/실패를 알린다(00=정상, 그 외 에러).
function assertNormal(json: unknown): void {
  const header = (json as Record<string, unknown>)?.header as Record<string, unknown> | undefined;
  const code = header?.resultCode;
  if (code != null && String(code) !== "00") {
    throw new Error(`KOSHA ${code} ${header?.resultMsg ?? ""}`.trim());
  }
}

// data.go.kr 응답에서 결과 row 배열 추출 — response.body.items.item 관례 + 변형 대비.
function extractRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  // 흔한 형태: { response: { body: { items: { item: [...] } } } } 또는 items 가 바로 배열.
  const root = json as Record<string, unknown>;
  const body = ((root.response as Record<string, unknown>)?.body ?? root.body ?? root) as Record<string, unknown>;
  const items = (body?.items ?? body?.list ?? body) as unknown;
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  const item = (items as Record<string, unknown>)?.item;
  if (Array.isArray(item)) return item as Record<string, unknown>[];
  if (item && typeof item === "object") return [item as Record<string, unknown>];
  return [];
}
