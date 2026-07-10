// 법제처 국가법령정보 공동활용 OPEN API 클라이언트 — 안전관리비 고시 개정 감지.
// 「건설업 산업안전보건관리비 계상 및 사용기준」(고용노동부 고시)의 최신 발령·시행 정보를
// 행정규칙 목록 API(target=admrul)로 조회해, 요율표(safety-cost.ts)가 근거한 버전과 비교한다.
//   env 게이트(MOLEG_OC = open.law.go.kr 가입 이메일 ID) + 실패 시 적용 버전 폴백(KOSHA/G2B 패턴).
//   별표1(계상기준표)은 별표·서식 API(admbyl)로 HWP 를 받아 PrvText 를 파싱(lib/hwp-prvtext) —
//   요율 실값을 내장 요율표와 자동 대조하고, 파싱 요율표(rateCheck.rates)를 소비처에 제공한다.
//   어느 단계든 실패하면 rateCheck=null 로 강등(계상 산출은 내장 요율표 폴백 — 검증 결과 오염 없음).
import "server-only";

import { diffRates, extractHwpPrvText, parseRateTableFromPrvText } from "./hwp-prvtext";
import { APPLIED_RATE_NOTICE, type RateRow } from "./safety-cost";
import type { ConstructionType } from "./safeprocure-types";

const MOLEG_BASE = "https://www.law.go.kr/DRF/lawSearch.do";

// 법제처 검증 방식(실호출 확인 2026-07-10): OC + "Referer 헤더 = 신청에 등록한 도메인" 대조.
// 등록 도메인 외 환경(로컬 dev 포함)에서도 이 Referer 를 보내면 통과한다.
const MOLEG_REFERER = "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/";

export type RateNoticeStatus = {
  source: "live" | "fallback";
  applied: typeof APPLIED_RATE_NOTICE;
  latest: {
    name: string;
    noticeNo: string; // 발령번호(예: "2025-11")
    issueDate: string | null; // 발령일자(YYYY-MM-DD)
    effectiveDate: string | null; // 시행일자(YYYY-MM-DD)
    detailLink: string | null; // 법제처 상세 링크
  } | null;
  /** 최신 시행일자가 적용 버전보다 뒤면 true — 요율표 대조·갱신 필요 신호. */
  drift: boolean;
  /** 별표1 HWP 를 내려받아 파싱한 고시 요율과 내장 요율표의 대조 결과. null = 파싱 불가(수동 대조 필요).
   *  rates = 법제처 별표1 실시간 파싱 요율표 — 소비처(ERP 데모 등)가 계상 산출에 직접 사용 가능. */
  rateCheck: { verified: boolean; diffs: string[]; rates: Record<ConstructionType, RateRow> } | null;
  note?: string;
};

function oc(): string | null {
  // OC = open.law.go.kr 가입 이메일 ID(공개 URL 파라미터라 비밀 아님). env 로 교체 가능.
  const v = process.env.MOLEG_OC ?? "rlaxorhs77";
  return typeof v === "string" && v.length > 0 ? v : null;
}

// "20250212" | "2025.2.12" → "2025-02-12" (미상이면 null)
function normDate(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const digits = String(raw).replace(/[^0-9]/g, "");
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

const FALLBACK: RateNoticeStatus = {
  source: "fallback",
  applied: APPLIED_RATE_NOTICE,
  latest: null,
  drift: false,
  rateCheck: null,
  note: "법제처 API 미연결 — 요율표 내장 버전(고시 " + APPLIED_RATE_NOTICE.noticeNo + ") 기준 표시",
};

/** 최신 고시의 별표1(계상기준표) HWP 를 받아 요율을 대조. 어느 단계든 실패하면 null. */
async function checkRateTable(key: string, admRulSerial: string): Promise<RateNoticeStatus["rateCheck"]> {
  try {
    const url = new URL(MOLEG_BASE);
    url.searchParams.set("OC", key);
    url.searchParams.set("target", "admbyl");
    url.searchParams.set("type", "JSON");
    url.searchParams.set("query", "산업안전보건관리비");
    const res = await fetch(url, { headers: { Referer: MOLEG_REFERER }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const search = (json.admRulBylSearch ?? json) as Record<string, unknown>;
    let rows = (search.admrulbyl ?? []) as unknown;
    if (rows && !Array.isArray(rows)) rows = [rows];
    const byl = (rows as Record<string, unknown>[]).find(
      (r) =>
        pick(r, ["관련행정규칙일련번호"]) === admRulSerial &&
        (pick(r, ["별표명"]) ?? "").includes("계상기준표"),
    );
    const fileLink = byl && pick(byl, ["별표서식파일링크"]);
    if (!fileLink) return null;
    const fileRes = await fetch(`https://www.law.go.kr${fileLink}`, {
      headers: { Referer: MOLEG_REFERER },
      signal: AbortSignal.timeout(10000),
    });
    if (!fileRes.ok) return null;
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    const text = extractHwpPrvText(buf);
    if (!text) return null;
    const parsed = parseRateTableFromPrvText(text);
    if (!parsed) return null;
    const diffs = diffRates(parsed);
    return { verified: diffs.length === 0, diffs, rates: parsed };
  } catch (err) {
    console.error("[moleg] 별표1 요율 대조 실패 — 수동 대조 폴백:", err);
    return null;
  }
}

// 6시간 캐시 — 고시 개정은 연 단위 이벤트라 충분.
const globalForMoleg = globalThis as typeof globalThis & {
  __molegNoticeCache?: { ts: number; data: RateNoticeStatus };
};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export async function getRateNoticeStatus(): Promise<RateNoticeStatus> {
  const key = oc();
  if (!key) return FALLBACK;
  const hit = globalForMoleg.__molegNoticeCache;
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;

  try {
    const url = new URL(MOLEG_BASE);
    url.searchParams.set("OC", key);
    url.searchParams.set("target", "admrul");
    url.searchParams.set("type", "JSON");
    url.searchParams.set("query", APPLIED_RATE_NOTICE.name);
    url.searchParams.set("sort", "ddes"); // 발령일자 내림차순 → 최신이 첫 행
    const res = await fetch(url, { headers: { Referer: MOLEG_REFERER }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;

    // 오류 응답: { result: "...실패...", msg: "..." } (미신청·미승인·IP 미등록 포함)
    if (typeof json.result === "string") throw new Error(String(json.msg ?? json.result));

    const search = (json.AdmRulSearch ?? json.admRulSearch ?? json) as Record<string, unknown>;
    let rows = (search.admrul ?? []) as unknown;
    if (rows && !Array.isArray(rows)) rows = [rows];
    // 명칭 정확 일치 우선(query 는 부분일치라 유사 규칙이 섞일 수 있음), 없으면 첫 행.
    const list = (rows as Record<string, unknown>[]).filter(Boolean);
    const exact = list.find((r) => pick(r, ["행정규칙명", "admRulNm"])?.replace(/\s/g, "") === APPLIED_RATE_NOTICE.name.replace(/\s/g, ""));
    const row = exact ?? list[0];
    if (!row) throw new Error("검색 결과 없음");

    const latest = {
      name: pick(row, ["행정규칙명", "admRulNm"]) ?? APPLIED_RATE_NOTICE.name,
      noticeNo: pick(row, ["발령번호", "ldocNo"]) ?? "(미상)",
      issueDate: normDate(pick(row, ["발령일자", "ldocDt"])),
      effectiveDate: normDate(pick(row, ["시행일자", "efYd"])),
      // 상세링크는 상대경로로 옴("/DRF/lawService.do?...") → 절대 URL 로 보정.
      detailLink: (() => {
        const l = pick(row, ["행정규칙상세링크", "admRulLink"]);
        return l ? (l.startsWith("http") ? l : `https://www.law.go.kr${l}`) : null;
      })(),
    };
    const drift = latest.effectiveDate != null && latest.effectiveDate > APPLIED_RATE_NOTICE.effectiveDate;

    // 별표1 실파싱 대조 — 최신 고시의 계상기준표 HWP(PrvText)에서 요율을 뽑아 내장 요율표와 비교.
    const serial = pick(row, ["행정규칙일련번호"]);
    const rateCheck = serial ? await checkRateTable(key, serial) : null;

    const data: RateNoticeStatus = {
      source: "live",
      applied: APPLIED_RATE_NOTICE,
      latest,
      drift,
      rateCheck,
      note: drift
        ? `고시 개정 감지 — 최신 시행 ${latest.effectiveDate}(발령 ${latest.noticeNo}). 별표1 요율 대조·갱신 필요`
        : rateCheck && !rateCheck.verified
          ? `고시 별표1 요율과 내장 요율표 불일치 ${rateCheck.diffs.length}건 — 요율표 확인 필요`
          : undefined,
    };
    globalForMoleg.__molegNoticeCache = { ts: Date.now(), data };
    return data;
  } catch (err) {
    console.error("[moleg] 고시 조회 실패 — 폴백:", err);
    return { ...FALLBACK, note: "법제처 API 조회 실패 — 내장 버전 기준 표시" };
  }
}
