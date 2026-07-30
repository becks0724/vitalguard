// 긴급재난문자(행정안전부) 순수 로직 — 정규화·재해유형 화이트리스트·신선도·현장 시·도 매칭.
// server-only 인 API 호출부와 분리해 단위테스트 가능하게 유지(kma.ts ↔ kma-regions.ts 와 같은 구조).
// 결정 근거는 docs/disaster-msg/context-notes.md.
import { latLonToSido, nearbySidos, regionMatchesSido, SIDO, splitRegions } from "./kma-regions";

// API/CSV 원본 레코드 — 필드명은 원본 표기(대문자 스네이크) 그대로.
export type RawDisasterMsg = {
  SN: string;
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
    const sn = Number((r.SN ?? "").trim());
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
      revised: (r.MDFCN_YMD ?? "").trim() !== (r.REG_YMD ?? "").trim(),
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

// 통과분 + 처음 보는 유형 목록(중복 제거) — 후자는 호출부가 로그로 남겨 목록 확장 근거로 쓴다.
export function filterWatched(msgs: DisasterMsg[]): {
  watched: DisasterMsg[];
  unknownTypes: string[];
} {
  const watched: DisasterMsg[] = [];
  const unknown = new Set<string>();
  for (const m of msgs) {
    if (isWatchedType(m.type)) watched.push(m);
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
};

// 작업자 GPS 평균 좌표 → 시·도 단위 매칭. 시·군·구로 좁히지 않는다 —
// 평균 좌표는 특정 지점이 아니고(경계를 넘나든다), 재난은 광역으로 번진다(D-05).
export function matchSite(msgs: DisasterMsg[], lat: number, lon: number): MatchedDisasterMsg[] {
  const own = latLonToSido(lat, lon);
  const near = nearbySidos(lat, lon);
  const out: MatchedDisasterMsg[] = [];
  for (const msg of msgs) {
    const siteHits = msg.regions.filter((r) => msgRegionMatchesSido(r, own.keywords));
    if (siteHits.length > 0) {
      out.push({ msg, scope: "site", matchedRegions: siteHits });
      continue;
    }
    const nearHits = msg.regions.filter((r) =>
      near.some((s) => msgRegionMatchesSido(r, s.keywords)),
    );
    if (nearHits.length > 0) out.push({ msg, scope: "nearby", matchedRegions: nearHits });
  }
  return out;
}
