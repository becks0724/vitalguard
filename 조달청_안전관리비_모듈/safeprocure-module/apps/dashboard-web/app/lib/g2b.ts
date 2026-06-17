// 조달청 나라장터(G2B) 공공데이터 OpenAPI 클라이언트 — 공사 입찰공고/계약.
// 정책: 인증키(G2B_SERVICE_KEY) 가 .env 에 있으면 실 API, 없으면 목업 fallback(데모 무중단).
//   KOSHA 모듈(app/lib/kosha.ts)과 동일한 구조: env 게이트 + 30분 캐시 + tolerant 추출 + 실패 시 강등.
// ⚠ 실 엔드포인트/오퍼레이션/필드명은 data.go.kr Swagger·활용가이드(docx)로 확정 필요.
//   조달청 OpenAPI 도 data.go.kr 표준 봉투(response.header.resultCode + response.body.items.item)를 따른다.
import "server-only";
import type { NoticeDetail, NoticeSummary } from "./safeprocure-types";
import { MOCK_NOTICES } from "./g2b-mock";

// ── 캐시 (KOSHA 모듈과 동일 패턴) ──────────────────────────────────────
type CacheEntry<T> = { ts: number; data: T };
const globalForG2b = globalThis as typeof globalThis & {
  __safeProcureG2bCache?: Map<string, CacheEntry<unknown>>;
};
const cache = globalForG2b.__safeProcureG2bCache ?? (globalForG2b.__safeProcureG2bCache = new Map());
const CACHE_TTL_MS = 30 * 60 * 1000; // 30분

function getCached<T>(key: string): T | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  return null;
}
function setCached<T>(key: string, data: T) {
  cache.set(key, { ts: Date.now(), data });
}

// ── ⚠ 엔드포인트 (확정 필요) ──────────────────────────────────────────
// 조달청 나라장터 입찰공고정보서비스 (data.go.kr 15129394). 기관코드·버전·오퍼레이션명은 추정.
const G2B_BASE = "https://apis.data.go.kr/1230000";
const G2B_PATH = {
  // ⚠ 버전 접미사(04/05 등)·공사 오퍼레이션명은 Swagger 로 확정. 공사=Cnstwk.
  bidListConstruction: "BidPublicInfoService04/getBidPblancListInfoCnstwk",
} as const;

function hasKey(): boolean {
  return typeof process.env.G2B_SERVICE_KEY === "string" && process.env.G2B_SERVICE_KEY.length > 0;
}

// 후보 키 중 첫 존재값 추출 (실 필드명 미확정 대비 tolerant — KOSHA pick 과 동일).
function pick(obj: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const c of candidates) {
    const v = obj[c];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, candidates: string[]): number | null {
  const raw = pick(obj, candidates);
  if (raw == null) return null;
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "YYYYMMDD" / "YYYYMMDDHHMM" / "YYYY-MM-DD ..." → "YYYY-MM-DD"
function normDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return undefined;
}

// data.go.kr 표준 봉투에서 row 배열 추출.
function extractRows(json: unknown): Record<string, unknown>[] {
  if (!json || typeof json !== "object") return [];
  const root = json as Record<string, unknown>;
  const body = ((root.response as Record<string, unknown>)?.body ?? root.body ?? root) as Record<string, unknown>;
  const items = (body?.items ?? body?.list ?? body) as unknown;
  if (Array.isArray(items)) return items as Record<string, unknown>[];
  const item = (items as Record<string, unknown>)?.item;
  if (Array.isArray(item)) return item as Record<string, unknown>[];
  if (item && typeof item === "object") return [item as Record<string, unknown>];
  return [];
}

// 조달청도 HTTP 200 + header.resultCode 로 성공/실패 전달(00=정상).
function assertNormal(json: unknown): void {
  const header = ((json as Record<string, unknown>)?.response as Record<string, unknown>)?.header as
    | Record<string, unknown>
    | undefined;
  const code = header?.resultCode;
  if (code != null && String(code) !== "00" && String(code) !== "0") {
    throw new Error(`G2B ${code} ${header?.resultMsg ?? ""}`.trim());
  }
}

// 실 응답 row → NoticeSummary (⚠ 후보 키는 실응답으로 교정).
function normalizeSummary(row: Record<string, unknown>): NoticeSummary {
  const licenseRaw = pick(row, ["licenseLmt", "lcnsLmtNm", "indstrytyNm", "industryNm"]);
  return {
    id: pick(row, ["bidNtceNo", "ntceNo", "id"]) ?? "(미상)",
    title: pick(row, ["bidNtceNm", "ntceNm", "title"]) ?? "(공고명 없음)",
    kind: "공사",
    agency: pick(row, ["dminsttNm", "ntceInsttNm", "agency"]) ?? "(수요기관 미상)",
    region: pick(row, ["prtcptPsblRgnNm", "cnstrtsiteRgnNm", "region"]),
    estimatedPrice: pickNumber(row, ["presmptPrce", "asignBdgtAmt", "estimatedPrice"]),
    startDate: normDate(pick(row, ["bidNtceDt", "ntceBgnDt", "startDate"])),
    endDate: normDate(pick(row, ["bidClseDt", "opengDt", "endDate"])),
    licenses: licenseRaw ? [licenseRaw] : [],
  };
}

// ── 공개 API ──────────────────────────────────────────────────────────
export type NoticesPayload = { source: "live" | "mock"; items: NoticeSummary[]; page: number; total: number; note?: string };

export async function getNotices(opts: { kind?: string; region?: string; page?: number; rows?: number } = {}): Promise<NoticesPayload> {
  const page = opts.page ?? 1;
  const rows = Math.min(opts.rows ?? 20, 100);

  // 목업: 키 없으면 내장 샘플(지역/종류 필터 적용).
  if (!hasKey()) {
    let items: NoticeSummary[] = MOCK_NOTICES.map(toSummary);
    if (opts.region) items = items.filter((n) => n.region === opts.region);
    if (opts.kind) items = items.filter((n) => n.kind === opts.kind);
    return { source: "mock", items, page, total: items.length, note: "샘플 데이터 — G2B 인증키 연결 시 실데이터로 전환" };
  }

  // MVP 는 공사 부문만 실데이터 지원(용역/물품 오퍼레이션 미확정). 비-공사는 빈 live 응답(목업 오강등 방지).
  const kind = opts.kind ?? "공사";
  if (kind !== "공사") {
    return { source: "live", items: [], page, total: 0, note: "현재 공사 부문만 실데이터 지원(MVP)" };
  }

  const cacheKey = `notices:${kind}:${opts.region ?? ""}:${page}:${rows}`;
  const hit = getCached<NoticesPayload>(cacheKey);
  if (hit) return hit;

  try {
    const url = new URL(`${G2B_BASE}/${G2B_PATH.bidListConstruction}`);
    url.searchParams.set("serviceKey", process.env.G2B_SERVICE_KEY as string);
    url.searchParams.set("pageNo", String(page));
    url.searchParams.set("numOfRows", String(rows));
    url.searchParams.set("inqryDiv", "1"); // ⚠ 조회구분 — 활용가이드로 확정
    url.searchParams.set("type", "json");

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    assertNormal(json);
    const rawRows = extractRows(json);
    // 0건은 '정상 빈 결과' — 목업으로 강등하지 않는다(검색 결과 없음 ≠ API 실패).
    if (rawRows.length === 0) {
      const empty: NoticesPayload = { source: "live", items: [], page, total: 0, note: "검색 결과 없음" };
      setCached(cacheKey, empty);
      return empty;
    }

    let items = rawRows.map(normalizeSummary);
    if (opts.region) items = items.filter((n) => !n.region || n.region.includes(opts.region as string));
    const payload: NoticesPayload = { source: "live", items, page, total: items.length };
    setCached(cacheKey, payload);
    return payload;
  } catch (err) {
    console.error("[g2b] getNotices fallback to mock:", err);
    const items = MOCK_NOTICES.map(toSummary);
    return { source: "mock", items, page, total: items.length, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}

export type NoticeDetailPayload = { source: "live" | "mock"; notice: NoticeDetail | null; note?: string };

export async function getNoticeDetail(id: string): Promise<NoticeDetailPayload> {
  // 목업 우선(키 없거나 목업 id).
  const mock = MOCK_NOTICES.find((n) => n.id === id);
  if (!hasKey()) {
    return { source: "mock", notice: mock ?? null, note: mock ? undefined : "해당 공고 없음(샘플)" };
  }

  try {
    // ⚠ 별도 상세 오퍼레이션 미확정 → 목록 창에서 id 매칭(best-effort). 확정 후 상세 API 로 교체.
    const list = await getNotices({ rows: 100 });
    const summary = list.items.find((n) => n.id === id);
    if (!summary) return { source: list.source, notice: mock ?? null, note: "목록에서 미발견 — 샘플 폴백" };
    const notice: NoticeDetail = {
      ...summary,
      taskText: summary.title, // ⚠ 상세 과업텍스트 필드 확정 후 교체
      contractAmount: null,
      winRate: null,
      targetAmount: null, // 대상액 부재 → 안전관리비는 검토필요로 강등됨
      declaredSafetyCost: null,
    };
    return { source: list.source, notice };
  } catch (err) {
    console.error("[g2b] getNoticeDetail fallback to mock:", err);
    return { source: "mock", notice: mock ?? null, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}

function toSummary(d: NoticeDetail): NoticeSummary {
  return {
    id: d.id,
    title: d.title,
    kind: d.kind,
    agency: d.agency,
    region: d.region,
    estimatedPrice: d.estimatedPrice,
    startDate: d.startDate,
    endDate: d.endDate,
    licenses: d.licenses,
  };
}
