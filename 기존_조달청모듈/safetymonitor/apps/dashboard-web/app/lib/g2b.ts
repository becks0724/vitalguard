// 조달청 나라장터(G2B) 공공데이터 OpenAPI 클라이언트 — 공사 입찰공고 + 계약.
// VitAlGuard 는 '착공/진행 중 현장'을 검증하므로 핵심은 계약(getContracts, 체결=진행 중).
// 입찰공고(getNotices)는 부가(발주 위험선별 /safeprocure). 둘 다 NoticeSummary/Detail 로 정규화.
//   env 게이트 + 30분 캐시 + tolerant 추출 + 실패 시 목업 강등(KOSHA 모듈 패턴).
import "server-only";
import type { NoticeDetail, NoticeSummary } from "./safeprocure-types";
import { MOCK_NOTICES } from "./g2b-mock";

// ── 캐시 ──────────────────────────────────────────────────────────────
type CacheEntry<T> = { ts: number; data: T };
const globalForG2b = globalThis as typeof globalThis & {
  __safeProcureG2bCache?: Map<string, CacheEntry<unknown>>;
  __safeProcureG2bDetail?: Map<string, CacheEntry<NoticeDetail>>;
};
const cache = globalForG2b.__safeProcureG2bCache ?? (globalForG2b.__safeProcureG2bCache = new Map());
const detailCache = globalForG2b.__safeProcureG2bDetail ?? (globalForG2b.__safeProcureG2bDetail = new Map());
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  return null;
}
function setCached<T>(key: string, data: T) {
  cache.set(key, { ts: Date.now(), data });
}

// ── 엔드포인트 ────────────────────────────────────────────────────────
const G2B_BASE = "https://apis.data.go.kr/1230000";
const G2B_PATH = {
  // 입찰공고 목록(공사) — 발주 단계. data.go.kr 15129394 / Base ad/BidPublicInfoService.
  bidListConstruction: "ad/BidPublicInfoService/getBidPblancListInfoCnstwk",
  // 계약 목록(공사) — 체결=착공/진행 중 현장. data.go.kr 15129427 / Base ao/CntrctInfoService.
  contractListConstruction: "ao/CntrctInfoService/getCntrctInfoListCnstwk",
} as const;

function hasKey(): boolean {
  return typeof process.env.G2B_SERVICE_KEY === "string" && process.env.G2B_SERVICE_KEY.length > 0;
}

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
function normDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return undefined;
}
function fmtG2bDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

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

function assertNormal(json: unknown): void {
  const header = ((json as Record<string, unknown>)?.response as Record<string, unknown>)?.header as
    | Record<string, unknown>
    | undefined;
  const code = header?.resultCode;
  if (code != null && String(code) !== "00" && String(code) !== "0") {
    throw new Error(`G2B ${code} ${header?.resultMsg ?? ""}`.trim());
  }
}

// ── 입찰공고(부가) 정규화 ──────────────────────────────────────────────
function normalizeSummary(row: Record<string, unknown>): NoticeSummary {
  const licenseRaw = pick(row, ["mainCnsttyNm", "indstrytyEvlRt", "licenseLmt", "lcnsLmtNm", "indstrytyNm"]);
  return {
    id: pick(row, ["bidNtceNo", "ntceNo", "id"]) ?? "(미상)",
    title: pick(row, ["bidNtceNm", "ntceNm", "title"]) ?? "(공고명 없음)",
    kind: "공사",
    agency: pick(row, ["dminsttNm", "ntceInsttNm", "agency"]) ?? "(수요기관 미상)",
    region: pick(row, ["cnstrtsiteRgnNm", "prtcptPsblRgnNm", "region"]),
    estimatedPrice: pickNumber(row, ["presmptPrce", "bdgtAmt", "asignBdgtAmt", "estimatedPrice"]),
    startDate: normDate(pick(row, ["bidNtceDt", "bidBeginDt", "ntceBgnDt", "startDate"])),
    endDate: normDate(pick(row, ["opengDt", "bidClseDt", "endDate"])),
    licenses: licenseRaw ? [licenseRaw] : [],
  };
}
function normalizeDetail(row: Record<string, unknown>): NoticeDetail {
  const summary = normalizeSummary(row);
  const specFiles: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const f = pick(row, [`ntceSpecFileNm${i}`]);
    if (f) specFiles.push(f);
  }
  const taskText = [summary.title, pick(row, ["mainCnsttyNm"]), ...specFiles, pick(row, ["refNo"])].filter(Boolean).join(" · ");
  return {
    ...summary,
    taskText: taskText || summary.title,
    contractAmount: null,
    winRate: null,
    declaredSafetyCost: null,
    targetAmount: null,
  };
}

// ── 계약(핵심: 진행 중 현장) 정규화 ────────────────────────────────────
// ⚠ 필드명은 추정(tolerant pick). 사용자 환경 실응답([g2b-contract-raw] 로그)으로 교정 예정.
function normalizeContractSummary(row: Record<string, unknown>): NoticeSummary {
  const licenseRaw = pick(row, ["mainCnsttyNm", "cntrctCorpNm", "corpNm", "indstrytyNm"]);
  return {
    id: pick(row, ["untyCntrctNo", "cntrctNo", "cntrctRefNo", "bidNtceNo", "id"]) ?? "(미상)",
    title: pick(row, ["cntrctNm", "bidNtceNm", "ntceNm", "title"]) ?? "(계약명 없음)",
    kind: "공사",
    agency: pick(row, ["dminsttNm", "ntceInsttNm", "agency"]) ?? "(수요기관 미상)",
    region: pick(row, ["cntrctsiteRgnNm", "cnstrtsiteRgnNm", "region"]),
    // 계약금액(대상액 근사) — 총계약금액/이번계약금액 후보.
    estimatedPrice: pickNumber(row, ["totCntrctAmt", "thtmCntrctAmt", "cntrctAmt", "presmptPrce"]),
    startDate: normDate(pick(row, ["cntrctDt", "cntrctBgnDt", "cntrctCnclsDt", "startDate"])),
    endDate: normDate(pick(row, ["cntrctEndDt", "cntrctPrdEndDt", "endDate"])),
    licenses: licenseRaw ? [licenseRaw] : [],
  };
}
function normalizeContractDetail(row: Record<string, unknown>): NoticeDetail {
  const summary = normalizeContractSummary(row);
  const taskText = [summary.title, pick(row, ["mainCnsttyNm"]), ...summary.licenses].filter(Boolean).join(" · ");
  return {
    ...summary,
    taskText: taskText || summary.title,
    contractAmount: summary.estimatedPrice, // 계약금액
    winRate: null,
    declaredSafetyCost: null,
    targetAmount: summary.estimatedPrice, // 계약금액을 안전관리비 대상액 근사로 사용
  };
}

function cacheDetails(details: NoticeDetail[]): void {
  const now = Date.now();
  for (const d of details) detailCache.set(d.id, { ts: now, data: d });
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

// ── 공개 API ──────────────────────────────────────────────────────────
export type NoticesPayload = { source: "live" | "mock"; items: NoticeSummary[]; page: number; total: number; note?: string };

// 공통 목록 fetch — 입찰공고/계약 공용. normalize 로 정규화 함수만 바꾼다.
async function fetchList(
  opPath: string,
  cacheKey: string,
  normalize: (row: Record<string, unknown>) => NoticeDetail,
  rows: number,
  page: number,
  debugTag: string,
): Promise<NoticesPayload> {
  const hit = getCached<NoticesPayload>(cacheKey);
  if (hit) return hit;
  const url = new URL(`${G2B_BASE}/${opPath}`);
  url.searchParams.set("serviceKey", process.env.G2B_SERVICE_KEY as string);
  url.searchParams.set("pageNo", String(page));
  url.searchParams.set("numOfRows", String(rows));
  url.searchParams.set("inqryDiv", "1");
  const nowDt = new Date();
  url.searchParams.set("inqryBgnDt", fmtG2bDate(new Date(nowDt.getTime() - 90 * 24 * 60 * 60 * 1000)));
  url.searchParams.set("inqryEndDt", fmtG2bDate(nowDt));
  url.searchParams.set("type", "json");

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  // ⚠ 임시 디버그(필드 확정 후 제거).
  {
    const dbg = extractRows(json);
    console.log(`[${debugTag}] keys:`, Object.keys(dbg[0] ?? {}).join(","));
    console.log(`[${debugTag}] row0:`, JSON.stringify(dbg[0] ?? {}).slice(0, 2500));
  }
  assertNormal(json);
  const rawRows = extractRows(json);
  if (rawRows.length === 0) {
    const empty: NoticesPayload = { source: "live", items: [], page, total: 0, note: "검색 결과 없음" };
    setCached(cacheKey, empty);
    return empty;
  }
  const details = rawRows.map(normalize);
  cacheDetails(details);
  const items = details.map(toSummary);
  const payload: NoticesPayload = { source: "live", items, page, total: items.length };
  setCached(cacheKey, payload);
  return payload;
}

// 입찰공고(부가 — 발주 위험선별).
export async function getNotices(opts: { kind?: string; region?: string; page?: number; rows?: number } = {}): Promise<NoticesPayload> {
  const page = opts.page ?? 1;
  const rows = Math.min(opts.rows ?? 20, 100);
  if (!hasKey()) {
    let items = MOCK_NOTICES.map(toSummary);
    if (opts.region) items = items.filter((n) => n.region === opts.region);
    return { source: "mock", items, page, total: items.length, note: "샘플 데이터 — G2B 인증키 연결 시 실데이터로 전환" };
  }
  if ((opts.kind ?? "공사") !== "공사") {
    return { source: "live", items: [], page, total: 0, note: "현재 공사 부문만 실데이터 지원(MVP)" };
  }
  try {
    return await fetchList(G2B_PATH.bidListConstruction, `notices:공사:${opts.region ?? ""}:${page}:${rows}`, normalizeDetail, rows, page, "g2b-raw");
  } catch (err) {
    console.error("[g2b] getNotices fallback to mock:", err);
    return { source: "mock", items: MOCK_NOTICES.map(toSummary), page, total: MOCK_NOTICES.length, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}

// 계약(핵심 — 진행 중 현장).
export async function getContracts(opts: { region?: string; page?: number; rows?: number } = {}): Promise<NoticesPayload> {
  const page = opts.page ?? 1;
  const rows = Math.min(opts.rows ?? 20, 100);
  if (!hasKey()) {
    const items = MOCK_NOTICES.map(toSummary);
    return { source: "mock", items, page, total: items.length, note: "샘플(계약) — G2B 인증키 연결 시 실데이터로 전환" };
  }
  try {
    return await fetchList(G2B_PATH.contractListConstruction, `contracts:공사:${opts.region ?? ""}:${page}:${rows}`, normalizeContractDetail, rows, page, "g2b-contract-raw");
  } catch (err) {
    console.error("[g2b] getContracts fallback to mock:", err);
    return { source: "mock", items: MOCK_NOTICES.map(toSummary), page, total: MOCK_NOTICES.length, note: "실 계약 API 응답 실패 — 샘플 데이터 표시" };
  }
}

export type NoticeDetailPayload = { source: "live" | "mock"; notice: NoticeDetail | null; note?: string };

// 상세 — 입찰공고/계약 캐시(목록 호출이 채움) 우선. 미스면 계약→입찰공고 순으로 채워 재조회.
export async function getNoticeDetail(id: string): Promise<NoticeDetailPayload> {
  const mock = MOCK_NOTICES.find((n) => n.id === id);
  if (!hasKey()) {
    return { source: "mock", notice: mock ?? null, note: mock ? undefined : "해당 건 없음(샘플)" };
  }
  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { source: "live", notice: cached.data };
  }
  try {
    // 진행 중 현장(계약) 우선, 없으면 입찰공고.
    await getContracts({ rows: 100 });
    let c = detailCache.get(id);
    if (!c) {
      await getNotices({ rows: 100 });
      c = detailCache.get(id);
    }
    if (c) return { source: "live", notice: c.data };
    return { source: "live", notice: mock ?? null, note: "목록에서 미발견 — 샘플 폴백" };
  } catch (err) {
    console.error("[g2b] getNoticeDetail fallback to mock:", err);
    return { source: "mock", notice: mock ?? null, note: "실 API 응답 실패 — 샘플 데이터 표시" };
  }
}
