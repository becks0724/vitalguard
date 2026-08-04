// 긴급재난문자(행정안전부) 순수 로직 — 정규화·재해유형 화이트리스트·신선도·현장 시·도 매칭.
// server-only 인 API 호출부와 분리해 단위테스트 가능하게 유지(kma.ts ↔ kma-regions.ts 와 같은 구조).
// 결정 근거는 docs/disaster-msg/context-notes.md.
import { latLonToSido, nearbySidos, SIDO, splitRegions } from "./kma-regions";

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
  "화재",
] as const;

const WATCHED = new Set<string>(WATCHED_TYPES);

export function isWatchedType(type: string): boolean {
  return WATCHED.has(type.trim());
}

// ── 화재위험경보 정기 캠페인 ─────────────────────────────────────────────────
// 소방청이 하루 2회(약 13:50·19:30) 16개 시·도 전역으로 같은 내용을 보낸다. 지역이 전역이라
// 어느 현장에서든 site 로 잡히고, 신선도 3시간 창 때문에 매일 두 번 알림이 발사된다.
// 내용 자체는 현장에 유용해 화면에는 남기되(전기화재 예방 수칙), 알림에서만 뺀다.
// 실측 2026-07-31~08-03 — 광주 site 화재 7건이 전부 이 문자, 실제 사고 문자는 광주 0건.
// ⚠️ 유형까지 함께 본다 — 문구만 보면 다른 유형(폭염·호우 등)의 알림까지 조용히 막힐 수 있다.
export const FIRE_CAMPAIGN_KEYWORD = "화재위험경보";

export function isFireRiskCampaign(msg: DisasterMsg): boolean {
  return msg.type.trim() === "화재" && msg.message.includes(FIRE_CAMPAIGN_KEYWORD);
}

// ── 긴급재난 단계는 유형으로 거르지 않는다 ───────────────────────────────────
// EMRG_STEP_NM='긴급재난' 은 지자체·기상청이 최고 위급으로 보낸 것이라 유형 화이트리스트로
// 거를 대상이 아니다. 실측 2026-07-01~ 4400건 중 긴급재난 58건의 유형 분포 —
//   수집  산사태 9 · 호우 7 · 화재 2 · 산불 1                = 19건
//   버려짐 (비어있음) 29 · 홍수 6 · 환경오염사고 4            = 39건 (67%)
// 특히 기상청 극한호우("50mm/h 이상 강한 비로 침수 등 우려")는 DST_SE_NM 이 아예 비어서 오고,
// 광주 남구도 1건 있었다(07-19 00:42). 가장 위급한 문자가 통째로 사라지고 있었다.
// 화이트리스트 유형이면 그 유형을 유지하고, 목록 밖이면 단계 이름을 라벨로 묶는다 —
// ALERT_TYPES 는 해제 역할 때문에 고정 목록이어야 해서 유형을 동적으로 늘릴 수 없다(D-07).
export const URGENT_FALLBACK_TYPE = "긴급재난";

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
    else if (m.step === "긴급재난") watched.push({ ...m, type: URGENT_FALLBACK_TYPE });
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
// 괄호 안을 본다 — head 가 시·도이면(예: "경기도(광주, 하남)") 괄호를 보지 않는다.

// ★ 2026 행정통합 — 광주광역시와 전라남도가 "전남광주통합특별시" 한 이름을 쓴다.
// 시·도 문자열만 보면 두 현장이 구별되지 않아, 광주 현장에 목포·여수(100km+) 발령이
// site 로 잡히고 알림까지 나갔다(실측 2026-07-31~08-01 실 API 337건 — 광주 현장 site 50건 중
// 광주 관할은 광산구 1건, 전남 시·군이 47건). 그래서 두 번째 토큰(시·군·구)으로 가른다.
// 하위가 없으면(= 통합시 전역 발령) 양쪽 다 자기 발령으로 본다.
const MERGED_SIDO = "전남광주통합특별시";
const GWANGJU_DISTRICTS = ["동구", "서구", "남구", "북구", "광산구"];

function mergedSidoKeywords(district: string): string[] | null {
  if (district === "" || district === "전체") return null; // 전역 발령 — 광주·전남 둘 다
  const name =
    district.startsWith("광주") || GWANGJU_DISTRICTS.includes(district) ? "광주" : "전남";
  return SIDO.find((s) => s.name === name)?.keywords ?? null;
}

// 재난문자 수신지역은 "시·도 시·군·구" 를 공백으로 이은 한 토큰이다(기상특보처럼 괄호로 감싸지 않는다).
// 토큰 전체를 부분문자열 검사하면 하위 시·군·구 이름까지 시·도로 읽혀 "경기도 광주시" 가
// 광주광역시 현장에 잡힌다(실측 2건). 첫 공백 앞(시·도명)만 본다.
function headSidoMatches(head: string, keywords: string[]): boolean {
  const parts = head.split(/\s+/);
  const sido = parts[0] ?? "";
  if (!keywords.some((k) => sido.includes(k))) return false;
  if (!sido.startsWith(MERGED_SIDO)) return true;
  const owner = mergedSidoKeywords(parts[1] ?? "");
  return owner === null || owner.some((k) => keywords.includes(k));
}

export function msgRegionMatchesSido(region: string, keywords: string[]): boolean {
  const open = region.indexOf("(");
  const head = (open < 0 ? region : region.slice(0, open)).trim();
  if (headSidoMatches(head, keywords)) return true;
  if (open < 0) return false;
  const headSido = head.split(/\s+/)[0] ?? "";
  const headIsSido = SIDO.some((s) => s.keywords.some((k) => headSido.includes(k)));
  if (headIsSido) return false;
  const close = region.lastIndexOf(")");
  const inner = region.slice(open + 1, close > open ? close : undefined);
  return inner.split(",").some((t) => headSidoMatches(t.trim(), keywords));
}

// scope — site = 현장 시·도 발령(알림 대상) / nearby = 인근 시·도(반경 120km, 화면 참고 표시만).
export type MsgScope = "site" | "nearby";
export type MatchedDisasterMsg = {
  msg: DisasterMsg;
  scope: MsgScope;
  matchedRegions: string[];
  sidos: string[]; // 매칭된 시·도 이름 — site 는 현장 시·도, nearby 는 걸린 인근 시·도(복수 가능)
};

// ── 지역 라벨 ────────────────────────────────────────────────────────────────
// 수신지역 토큰 → 신호등 칩에 쓸 짧은 지명. 첫 토큰은 항상 시·도(서울특별시·전남광주통합특별시…)라
// 건너뛰고 두 번째(시·군·구)를 쓴다. "경상남도 전체" 처럼 하위가 없으면 시·도를 줄여 "경남 전역".
const SIDO_SHORT: Array<[RegExp, string]> = [
  [/^서울/, "서울"], [/^부산/, "부산"], [/^대구/, "대구"], [/^인천/, "인천"],
  [/^대전/, "대전"], [/^울산/, "울산"], [/^세종/, "세종"], [/^제주/, "제주"],
  [/^경기/, "경기"], [/^강원/, "강원"], [/^충청북|^충북/, "충북"], [/^충청남|^충남/, "충남"],
  [/^전북|^전라북/, "전북"], [/^전남광주/, "전남·광주"], [/^전라남|^전남/, "전남"],
  [/^경상북|^경북/, "경북"], [/^경상남|^경남/, "경남"], [/^광주/, "광주"],
];

function shortSido(name: string): string {
  for (const [re, short] of SIDO_SHORT) if (re.test(name)) return short;
  return name;
}

export function shortRegionLabel(token: string): string {
  // 괄호 안이 실제 행정구역인 케이스(임진강 수계지역(경기도 연천군,파주시))는 괄호 안을 쓴다.
  const open = token.indexOf("(");
  const head = (open >= 0 ? token.slice(0, open) : token).trim();
  const inner = open >= 0 ? token.slice(open + 1).replace(/\)$/, "").split(",")[0]?.trim() : "";
  const base = /^[가-힣]+(특별시|광역시|특별자치시|특별자치도|도)/.test(head) || !inner ? head : inner;

  const parts = base.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? token.trim();
  const second = parts[1];
  if (!second || second === "전체") return `${shortSido(first)} 전역`;
  return second.replace(/(특별시|광역시|시|군|구)$/, "") || second;
}

// ── 알림 항목 ────────────────────────────────────────────────────────────────
// 알림 상태를 관리할 전체 유형. PROMOTED_TYPE·URGENT_FALLBACK_TYPE 이 WATCHED_TYPES 에
// 없으므로 반드시 함께 넣는다 — 빠뜨리면 그 유형은 영영 해제되지 않는다(D-15·D-07).
export const ALERT_TYPES: readonly string[] = [
  ...WATCHED_TYPES,
  PROMOTED_TYPE,
  URGENT_FALLBACK_TYPE,
];

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

// ── 인근 시·도 발령 중 알림으로 올릴 것 ─────────────────────────────────────
// 기본은 현장(site)만 알림이었다(D-05). 사용자 요청으로 인근까지 넓히되 전부는 아니다 —
// 인근 발령은 광주 현장 기준 하루 32~51건이고 거의 전부 폭염 안전안내다(실측 08-01~08-04 182건).
// 폭염·대설 같은 광역 기상은 인근에서 나도 현장 대응이 달라지지 않으므로 화면 참고에 그대로 둔다.
// 알림으로 올리는 것은 ① 긴급재난 단계(위급도 자체가 근거) ② 현장으로 번질 수 있는 유형.
export const SPREADING_TYPES: readonly string[] = ["호우", "태풍", "산사태", "산불"];

export function isNearbyAlertWorthy(msg: DisasterMsg): boolean {
  return msg.step === "긴급재난" || SPREADING_TYPES.includes(msg.type);
}

// ★ 화이트리스트 전 유형을 매번 반환한다 — 신선한 발령이 없는 유형은 normal 이다.
// 재난문자에는 해제 문자가 없어서 이 normal 이 곧 해제 역할을 한다(D-07).
// 빠뜨리면 notifyEnvAlerts 의 전이 판정 때문에 유형당 알림이 **딱 한 번만** 가고 영영 안 간다.
// site 는 전부, nearby 는 isNearbyAlertWorthy 통과분만 알림 대상이다(D-24).
export function buildAlertItems(
  site: MatchedDisasterMsg[],
  nowMs: number,
  nearby: readonly MatchedDisasterMsg[] = [],
): DisasterAlertItem[] {
  const pool = [...site, ...nearby.filter((h) => isNearbyAlertWorthy(h.msg))];
  return ALERT_TYPES.map((type) => {
    // 화재위험경보 캠페인은 화면에만 남기고 알림에서 뺀다 — 매일 2회 같은 문자가 발사된다.
    const hits = pool.filter(
      (h) => h.msg.type === type && isFresh(h.msg, nowMs) && !isFireRiskCampaign(h.msg),
    );
    if (hits.length === 0) {
      return { itemKey: `disaster:${type}`, itemLabel: "재난문자", currentValue: type, severity: "normal" as const };
    }
    // 대표 1건 — 긴급재난 우선(위급도), 같으면 현장 우선(관련도), 그다음 최신.
    const lead = [...hits].sort(
      (a, b) =>
        Number(b.msg.step === "긴급재난") - Number(a.msg.step === "긴급재난") ||
        Number(b.scope === "site") - Number(a.scope === "site") ||
        b.msg.createdAtMs - a.msg.createdAtMs,
    )[0] as MatchedDisasterMsg;
    const severity = hits.some((h) => h.msg.step === "긴급재난") ? "danger" : "caution";
    // 인근 발령이 대표가 되면 반드시 밝힌다 — 안 밝히면 관제자가 현장 발령으로 읽는다.
    const where = `${lead.scope === "nearby" ? "인근 " : ""}${lead.matchedRegions.join(", ")}`;
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
