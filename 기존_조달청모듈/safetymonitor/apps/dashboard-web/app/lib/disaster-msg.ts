// 긴급재난문자(행정안전부) 순수 로직 — 정규화·재해유형 화이트리스트·신선도·현장 시·도 매칭.
// server-only 인 API 호출부와 분리해 단위테스트 가능하게 유지(kma.ts ↔ kma-regions.ts 와 같은 구조).
// 결정 근거는 docs/disaster-msg/context-notes.md.
import { latLonToSido, nearbySidos, regionMatchesSido, SIDO, splitRegions } from "./kma-regions";

// API/CSV 원본 레코드 — 필드명은 원본 표기(대문자 스네이크) 그대로.
// ⚠️ SN 은 CSV 에서 문자열, 실 API(JSON) 에서 숫자로 온다. 같은 데이터인데 형이 다르다.
export type RawDisasterMsg = {
  SN: string | number;
  CRT_DT: string;
  MSG_CN: string;
  RCPTN_RGN_NM: string;
  EMRG_STEP_NM: string;
  DST_SE_NM: string;
  REG_YMD: string;
  MDFCN_YMD: string;
};

export type EmergencyStep = "긴급재난" | "안전안내";

export type DisasterMsg = {
  sn: number;
  createdAtMs: number;
  message: string;
  regions: string[]; // 최상위 콤마로 분리된 수신지역 토큰(괄호 보존)
  step: EmergencyStep;
  type: string; // DST_SE_NM 원문
  revised: boolean; // MDFCN_YMD ≠ REG_YMD — 정정 발령(샘플 0건, 관측용)
};

// ── 시각 파싱 ────────────────────────────────────────────────────────────────
// CRT_DT = "2023/09/19 12:22:17" (KST). ISO 가 아니라 슬래시 형식이라 new Date() 에 그대로 넣으면
// 실행 환경 로컬 시각으로 해석된다 — Cloud Run 은 UTC 라 9시간이 밀린다(로컬 맥=KST 라 증상이 안 보인다).
// Date.UTC(…, h - 9, …) 로 KST 를 명시 환산한다(음수 시각은 Date.UTC 가 전날로 정규화).
// 구분자는 "/" 와 "-" 를 모두 받는다 — 실 API 응답 형식이 CSV 와 같다는 보장이 없다(Phase 0 미확정).
const KST_OFFSET_HOURS = 9;
const CRT_DT_RE = /^(\d{4})[/-](\d{2})[/-](\d{2})[\sT]+(\d{2}):(\d{2}):(\d{2})$/;

export function parseKstToMs(s: string): number | null {
  const m = CRT_DT_RE.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h) - KST_OFFSET_HOURS,
    Number(mi),
    Number(se),
  );
}

// REG_YMD·MDFCN_YMD 의 날짜 부분만 뽑는다.
// CSV 는 "2023-09-19" 인데 실 API 는 "2026/07/31 08:22:17.000000000"(나노초 포함)로 오고,
// 게다가 MDFCN 이 REG 보다 항상 몇 분 뒤(내부 처리 시각)라 문자열 그대로 비교하면
// 전건이 "정정 발령"으로 잡혀 폴링마다 로그를 도배한다. 필드명(YMD)대로 날짜만 본다.
function ymdPart(s: string): string {
  return s.trim().slice(0, 10).replace(/\//g, "-");
}

// ── 정규화 ──────────────────────────────────────────────────────────────────
// 파싱 실패분은 버리지 않고 invalid 로 되돌려준다 — 조용한 0건은 "재난 없음"과 구별되지 않는다.
export function normalize(raws: RawDisasterMsg[]): {
  msgs: DisasterMsg[];
  invalid: RawDisasterMsg[];
} {
  const msgs: DisasterMsg[] = [];
  const invalid: RawDisasterMsg[] = [];
  for (const r of raws) {
    const createdAtMs = parseKstToMs(r.CRT_DT ?? "");
    const sn = Number(String(r.SN ?? "").trim());
    if (createdAtMs === null || !Number.isFinite(sn)) {
      invalid.push(r);
      continue;
    }
    const step: EmergencyStep = (r.EMRG_STEP_NM ?? "").trim() === "긴급재난" ? "긴급재난" : "안전안내";
    msgs.push({
      sn,
      createdAtMs,
      message: (r.MSG_CN ?? "").trim(),
      regions: splitRegions(r.RCPTN_RGN_NM ?? ""),
      step,
      type: (r.DST_SE_NM ?? "").trim(),
      revised: ymdPart(r.MDFCN_YMD ?? "") !== ymdPart(r.REG_YMD ?? ""),
    });
  }
  return { msgs, invalid };
}

// ── 재해유형 화이트리스트 ────────────────────────────────────────────────────
// 재난재해만 받는다. 실종자 찾기(샘플 '기타' 31건 — 실명·인상착의 포함)·교통통제는 제외.
// DST_SE_NM 은 코드값이 아니라 자유 문자열이고 샘플이 나흘치라, 값 목록을 샘플로 확정할 수 없다.
// 그래서 블랙리스트가 아니라 화이트리스트이고, 모르는 값은 버리되 호출부가 로그로 남긴다.
export const WATCHED_TYPES = [
  "호우",
  "산사태",
  "폭염",
  "강풍",
  "대설",
  "지진",
  "태풍",
  "산불",
] as const;

const WATCHED = new Set<string>(WATCHED_TYPES);

export function isWatchedType(type: string): boolean {
  return WATCHED.has(type.trim());
}

// ── '기타' 재승격 ────────────────────────────────────────────────────────────
// DST_SE_NM='기타' 에는 실종자 찾기(개인정보)뿐 아니라 진짜 재난 대피 안내가 섞여 온다.
// 샘플 31건 = 실종자 27 + 도로통제 2 + 하천 수위 대피 2(주암댐 방류·임진강 수위 상승).
// 유형만 보면 후자 2건을 함께 버리므로, 아래 두 조건을 모두 만족할 때만 되살린다(D-15).
//   ① 발신기관이 경찰청이 아님 — 실측상 실종자 27건 = 전부 경찰청, 경찰청 27건 = 전부 실종자
//   ② 본문에 대피 키워드 — 실측상 실종자 문자에 "대피" 0건
// 기관 표기가 없으면 되살리지 않는다(판정 근거가 없을 때는 버리는 쪽이 안전).
export const PROMOTED_TYPE = "대피안내";
export const EVACUATION_KEYWORDS = ["대피"] as const;

// "[경기도청] 임진강 수위…" → "경기도청". 대괄호 표기가 없으면 null.
export function senderOrg(message: string): string | null {
  if (!message.startsWith("[")) return null;
  const close = message.indexOf("]");
  return close > 1 ? message.slice(1, close) : null;
}

export function isEvacuationNotice(msg: DisasterMsg): boolean {
  const org = senderOrg(msg.message);
  if (org === null || org.includes("경찰청")) return false;
  return EVACUATION_KEYWORDS.some((k) => msg.message.includes(k));
}

// 통과분 + 처음 보는 유형 목록(중복 제거) — 후자는 호출부가 로그로 남겨 목록 확장 근거로 쓴다.
// 재승격분은 type 을 PROMOTED_TYPE 으로 바꿔 내보낸다 — 알림 itemKey 가 유형 단위라
// "disaster:기타" 같은 의미 불명 키가 생기지 않게 하기 위해서다(D-09).
export function filterWatched(msgs: DisasterMsg[]): {
  watched: DisasterMsg[];
  unknownTypes: string[];
} {
  const watched: DisasterMsg[] = [];
  const unknown = new Set<string>();
  for (const m of msgs) {
    if (isWatchedType(m.type)) watched.push(m);
    else if (isEvacuationNotice(m)) watched.push({ ...m, type: PROMOTED_TYPE });
    else unknown.add(m.type);
  }
  return { watched, unknownTypes: [...unknown] };
}

// ── 신선도 게이트 ────────────────────────────────────────────────────────────
// 재난문자에는 해제 문자가 없다. 발령만 있고 끝이라, 이 윈도우가 사실상 해제 역할을 한다
// (알림 연결부는 신선분 없는 유형을 normal 로 넘겨야 다음 발령 때 다시 발송된다 — D-07).
export const FRESH_WINDOW_MS = 3 * 60 * 60 * 1000;

export function isFresh(msg: DisasterMsg, nowMs: number): boolean {
  const age = nowMs - msg.createdAtMs;
  return age >= 0 && age <= FRESH_WINDOW_MS;
}

// ── 조회 날짜(KST) ───────────────────────────────────────────────────────────
// 실 API 의 crtDt 는 KST 기준 YYYYMMDD 다. 서버가 UTC(Cloud Run)여도 같은 값이 나와야 한다.
export function kstYmd(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_HOURS * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}`;
}

// 조회할 crtDt 목록 — 신선도 윈도우가 자정을 걸치면 전날 것도 받아야 한다.
// 예: KST 01:30 폴링 시 어제 23:00 발령이 아직 신선(3시간)인데 crtDt=오늘 에는 안 들어온다.
// 대부분의 시간대에는 1건만 반환 → 폴링당 호출 1회(D-17 예산 계산의 근거).
export function queryDates(now: Date): string[] {
  const kstHour = new Date(now.getTime() + KST_OFFSET_HOURS * 3_600_000).getUTCHours();
  const today = kstYmd(now);
  if (kstHour * 3_600_000 >= FRESH_WINDOW_MS) return [today];
  return [kstYmd(new Date(now.getTime() - 24 * 3_600_000)), today];
}

// 두 날짜 조회 결과를 합칠 때의 SN 중복 제거. 증분 커서는 쓰지 않는다(SN 비연속 — D-08).
export function dedupeBySn(raws: RawDisasterMsg[]): RawDisasterMsg[] {
  const seen = new Set<string>();
  return raws.filter((r) => {
    const k = String(r.SN ?? "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── 현장 시·도 매칭 ──────────────────────────────────────────────────────────
// ⚠️ 기상특보와 재난문자는 괄호의 의미가 정반대다.
//   기상특보 t6  "경기도(안산, 시흥)"                 head=시·도 / 괄호=하위 시·군·구
//   재난문자     "임진강 수계지역(경기도 연천군,파주시)" head=하천명(행정구역 아님) / 괄호=실제 행정구역
// 그래서 head 매칭만 쓰면 하천 수계 발령을 통째로 놓친다. head 가 어떤 시·도도 아닐 때에만
// 괄호 안을 본다 — head 가 시·도이면(예: "경기도(광주, 하남)") 괄호를 보지 않으므로
// 경기 광주시가 광주광역시로 오매칭되는 기존 함정은 그대로 막힌다.
export function msgRegionMatchesSido(region: string, keywords: string[]): boolean {
  if (regionMatchesSido(region, keywords)) return true;
  const open = region.indexOf("(");
  if (open < 0) return false;
  const head = region.slice(0, open).trim();
  const headIsSido = SIDO.some((s) => s.keywords.some((k) => head.includes(k)));
  if (headIsSido) return false;
  const close = region.lastIndexOf(")");
  const inner = region.slice(open + 1, close > open ? close : undefined);
  return keywords.some((k) => inner.includes(k));
}

// scope — site = 현장 시·도 발령(알림 대상) / nearby = 인근 시·도(반경 120km, 화면 참고 표시만).
export type MsgScope = "site" | "nearby";
export type MatchedDisasterMsg = {
  msg: DisasterMsg;
  scope: MsgScope;
  matchedRegions: string[];
  sidos: string[]; // 매칭된 시·도 이름 — site 는 현장 시·도, nearby 는 걸린 인근 시·도(복수 가능)
};

// ── 알림 항목 ────────────────────────────────────────────────────────────────
// 알림 상태를 관리할 전체 유형. PROMOTED_TYPE 이 WATCHED_TYPES 에 없으므로 반드시 함께 넣는다(D-15).
export const ALERT_TYPES: readonly string[] = [...WATCHED_TYPES, PROMOTED_TYPE];

// lib/env-alert-notify.ts 의 EnvAlertItem 과 구조가 같다(구조적 타이핑으로 그대로 넘어간다).
// 그쪽은 db(pg)를 import 하므로 여기서 참조하면 순수 모듈이 아니게 되어 단위테스트가 깨진다.
export type DisasterAlertItem = {
  itemKey: string;
  itemLabel: string;
  currentValue: string;
  severity: "normal" | "caution" | "danger";
  detail?: string;
};

function kstHm(ms: number): string {
  const k = new Date(ms + KST_OFFSET_HOURS * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// ★ 화이트리스트 전 유형을 매번 반환한다 — 신선한 발령이 없는 유형은 normal 이다.
// 재난문자에는 해제 문자가 없어서 이 normal 이 곧 해제 역할을 한다(D-07).
// 빠뜨리면 notifyEnvAlerts 의 전이 판정 때문에 유형당 알림이 **딱 한 번만** 가고 영영 안 간다.
// 입력은 현장 시·도 매칭분(site)만 — 인근 시·도는 화면 참고용이라 알림 대상이 아니다(D-05).
export function buildAlertItems(site: MatchedDisasterMsg[], nowMs: number): DisasterAlertItem[] {
  return ALERT_TYPES.map((type) => {
    const hits = site.filter((h) => h.msg.type === type && isFresh(h.msg, nowMs));
    if (hits.length === 0) {
      return { itemKey: `disaster:${type}`, itemLabel: "재난문자", currentValue: type, severity: "normal" as const };
    }
    // 대표 1건 — 긴급재난 우선, 같으면 최신.
    const lead = [...hits].sort(
      (a, b) =>
        Number(b.msg.step === "긴급재난") - Number(a.msg.step === "긴급재난") ||
        b.msg.createdAtMs - a.msg.createdAtMs,
    )[0] as MatchedDisasterMsg;
    const severity = hits.some((h) => h.msg.step === "긴급재난") ? "danger" : "caution";
    const where = lead.matchedRegions.join(", ");
    const more = hits.length > 1 ? ` 외 ${hits.length - 1}건` : "";
    return {
      itemKey: `disaster:${type}`,
      itemLabel: "재난문자",
      currentValue: `${type}${more}`,
      severity: severity as "caution" | "danger",
      detail: `${kstHm(lead.msg.createdAtMs)} 발령 · ${where}\n${lead.msg.message}`,
    };
  });
}

// 작업자 GPS 평균 좌표 → 시·도 단위 매칭. 시·군·구로 좁히지 않는다 —
// 평균 좌표는 특정 지점이 아니고(경계를 넘나든다), 재난은 광역으로 번진다(D-05).
export function matchSite(msgs: DisasterMsg[], lat: number, lon: number): MatchedDisasterMsg[] {
  const own = latLonToSido(lat, lon);
  const near = nearbySidos(lat, lon);
  const out: MatchedDisasterMsg[] = [];
  for (const msg of msgs) {
    const siteHits = msg.regions.filter((r) => msgRegionMatchesSido(r, own.keywords));
    if (siteHits.length > 0) {
      out.push({ msg, scope: "site", matchedRegions: siteHits, sidos: [own.name] });
      continue;
    }
    // 어느 인근 시·도가 걸렸는지 남긴다 — 화면이 "인근 전남·전북" 처럼 지역명을 보여줄 수 있게.
    const nearMatched = near.filter((s) =>
      msg.regions.some((r) => msgRegionMatchesSido(r, s.keywords)),
    );
    if (nearMatched.length > 0) {
      const nearHits = msg.regions.filter((r) =>
        nearMatched.some((s) => msgRegionMatchesSido(r, s.keywords)),
      );
      out.push({
        msg,
        scope: "nearby",
        matchedRegions: nearHits,
        sidos: nearMatched.map((s) => s.name),
      });
    }
  }
  return out;
}
