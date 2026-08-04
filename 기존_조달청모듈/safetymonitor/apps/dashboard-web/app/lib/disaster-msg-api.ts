// 긴급재난문자 API 클라이언트 — safetydata.go.kr DSSP-IF-00247 호출·캐시·목업 폴백.
// 정책: SAFETYDATA_SERVICE_KEY 있으면 실 API, 없으면 목업(데모 무중단 — kma.ts 와 동일).
// 순수 로직(정규화·유형필터·지역매칭)은 단위테스트 가능한 disaster-msg.ts 에 있다.
import "server-only";

import {
  buildAlertItems,
  dedupeBySn,
  filterWatched,
  isFresh,
  isWithinHistory,
  matchSite,
  normalize,
  queryDates,
  type DisasterAlertItem,
  type DisasterMsg,
  type EmergencyStep,
  type MatchedDisasterMsg,
  type RawDisasterMsg,
} from "./disaster-msg";
import { latLonToSido } from "./kma-regions";

const BASE = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247";
// 일일 호출 1000건 — 5분 주기(288회/일) = 약 29%(D-17).
// 3일 누적 표시로 넓힌 뒤에도 조회는 폴링당 1회다(crtDt 누적 특성 — D-29). 종전에 자정 인근만
// 2회 조회하던 것이 사라져 오히려 줄었다.
const TTL_MS = 5 * 60 * 1000;
// 한 번에 받는 최대 건수 — 서버가 1000 으로 캡한다(10000 을 요청해도 응답 numOfRows 가 1000).
// crtDt 는 그 날짜 "이후" 누적을 주므로 발령이 몰리는 날에는 이 상한을 넘고, 넘으면 조용히 잘린다.
// 응답 최상위 totalCount 로 잘림을 탐지해 다음 페이지를 이어받는다(실측 2026-08-03 — totalCount
// 3491 건을 1000×4 페이지로 받으면 고유 SN 3491, 누락·중복 0). 정렬은 여전히 시각순이 아니지만
// 전건을 다 받으므로 순서에 기대지 않는다(D-17 의 "페이징에 기댈 수 없다" 는 정렬에 관한 것).
const NUM_OF_ROWS = 1000;
// 페이지 상한 — 폴링당 최대 호출수를 묶어 일일 1000건 예산을 지킨다(평소 하루 200~270건이라 1페이지).
const MAX_PAGES = 3;
// 화이트리스트 밖이지만 이미 판단이 끝난 유형 — 로그로 알릴 필요가 없다(실종자 안내·도로 통제).
const KNOWN_IGNORED_TYPES = new Set(["기타", "교통통제"]);

type CacheEntry = { ts: number; msgs: DisasterMsg[] };
const g = globalThis as typeof globalThis & {
  __smDisasterMsgCache?: Map<string, CacheEntry>;
};
const cache = g.__smDisasterMsgCache ?? (g.__smDisasterMsgCache = new Map());

function serviceKey(): string | null {
  return process.env.SAFETYDATA_SERVICE_KEY?.trim() || null;
}

// ── 목업 ────────────────────────────────────────────────────────────────────
// 키 미설정 로컬 개발용. 신선도 게이트를 통과하도록 발령 시각을 호출 시점 기준으로 만든다.
// ⚠️ 화면에 가짜 재난이 뜨므로 호출부는 source 를 반드시 표시하고, 알림은 live 일 때만 발사한다(D-11).
function kstCrtDt(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}/${p(k.getUTCMonth() + 1)}/${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

const ALL_SIDO_REGIONS =
  "서울특별시 전체 ,부산광역시 전체 ,대구광역시 전체 ,인천광역시 전체 ,광주광역시 전체 ," +
  "대전광역시 전체 ,울산광역시 전체 ,세종특별자치시 전체 ,경기도 전체 ,강원특별자치도 전체 ," +
  "충청북도 전체 ,충청남도 전체 ,전북특별자치도 전체 ,전라남도 전체 ,경상북도 전체 ," +
  "경상남도 전체 ,제주특별자치도 전체 ";

function mockRaws(now: Date): RawDisasterMsg[] {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  const ymd = (d: Date) => kstCrtDt(d).slice(0, 10).replace(/\//g, "-");
  const row = (
    sn: number,
    at: Date,
    step: string,
    type: string,
    region: string,
    msg: string,
  ): RawDisasterMsg => ({
    SN: sn,
    CRT_DT: kstCrtDt(at),
    MSG_CN: msg,
    RCPTN_RGN_NM: region,
    EMRG_STEP_NM: step,
    DST_SE_NM: type,
    REG_YMD: ymd(at),
    MDFCN_YMD: ymd(at),
  });
  return [
    row(
      900001,
      ago(20),
      "안전안내",
      "호우",
      ALL_SIDO_REGIONS,
      "[행정안전부] (목업) 반지하주택, 지하상가 등 바닥에 물이 차오르면 즉시 지상으로 대피해주세요.",
    ),
    row(
      900002,
      ago(5),
      "긴급재난",
      "호우",
      ALL_SIDO_REGIONS,
      "[기상청] (목업) 시간당 50mm 이상 강한 비로 침수 우려, 안전확보를 위한 국민행동요령 확인 바람",
    ),
  ];
}

// ── 실 API ──────────────────────────────────────────────────────────────────
async function fetchPage(
  key: string,
  crtDt: string,
  pageNo: number,
): Promise<{ rows: RawDisasterMsg[]; total: number }> {
  const url = `${BASE}?serviceKey=${key}&returnType=json&pageNo=${pageNo}&numOfRows=${NUM_OF_ROWS}&crtDt=${crtDt}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const json = await res.json();
  const code = json?.header?.resultCode;
  if (code !== "00") {
    throw new Error(`resultCode ${code} · ${json?.header?.resultMsg ?? ""}`);
  }
  // ★ body 가 빈 배열이면 "그날 재난문자가 없었다"는 정상 상태다. 목업으로 떨어뜨리면
  //   재난이 없는 날 관제 화면에 가짜 경보가 뜬다(kma.ts 가 실제로 겪은 사고 — resultCode 03 분기).
  const body = json?.body;
  return { rows: Array.isArray(body) ? body : [], total: Number(json?.totalCount) || 0 };
}

async function fetchDay(key: string, crtDt: string): Promise<RawDisasterMsg[]> {
  const first = await fetchPage(key, crtDt, 1);
  const rows = [...first.rows];
  // 첫 페이지가 상한을 채웠고 아직 남았으면 이어받는다. 평소에는 이 루프가 한 번도 돌지 않는다.
  for (let page = 2; rows.length < first.total && page <= MAX_PAGES; page++) {
    const next = await fetchPage(key, crtDt, page);
    if (next.rows.length === 0) break; // 예상보다 일찍 끝났다 — 무한 루프 방지.
    rows.push(...next.rows);
  }
  if (first.total > rows.length) {
    console.warn(
      `[disaster-msg] ${crtDt} 전건 미수집 — ${rows.length}/${first.total}건(페이지 상한 ${MAX_PAGES}). 오래된 발령이 빠질 수 있다.`,
    );
  }
  return rows;
}

// "2026/08/04 15:06:00" → "20260804". queryDates 가 주는 crtDt 형식과 맞춘다.
function crtDtYmd(crtDt: string): string {
  return String(crtDt ?? "").trim().slice(0, 10).replace(/[/-]/g, "");
}

export type DisasterFetch = { source: "live" | "mock"; msgs: DisasterMsg[] };

// 관심 유형 재난문자(신선도·지역 무관 전건). 신선도·현장 매칭은 호출부에서.
export async function fetchDisasterMsgs(now: Date = new Date()): Promise<DisasterFetch> {
  const key = serviceKey();
  if (!key) return { source: "mock", msgs: filterWatched(normalize(mockRaws(now)).msgs).watched };

  const dates = queryDates(now);
  const cacheKey = dates.join(",");
  const hit = cache.get(cacheKey);
  if (hit && now.getTime() - hit.ts < TTL_MS) return { source: "live", msgs: hit.msgs };

  try {
    const pages = await Promise.all(dates.map((d) => fetchDay(key, d)));
    const raws = dedupeBySn(pages.flat());

    const { msgs, invalid } = normalize(raws);
    if (invalid.length > 0) {
      console.warn(`[disaster-msg] 파싱 실패 ${invalid.length}/${raws.length}건 — CRT_DT 형식 확인 필요`);
    }
    const revised = msgs.filter((m) => m.revised);
    if (revised.length > 0) {
      console.warn(`[disaster-msg] 정정 발령 ${revised.length}건 — SN ${revised.map((m) => m.sn).join(",")}`);
    }

    const { watched, unknownTypes } = filterWatched(msgs);
    // 화이트리스트 확장 근거(D-03). '기타'·'교통통제' 는 매일 오는 정상 차단이라 빼지 않으면
    // 폴링마다 같은 줄이 찍혀 정작 처음 보는 유형이 묻힌다.
    const novelTypes = unknownTypes.filter((t) => !KNOWN_IGNORED_TYPES.has(t));
    if (novelTypes.length > 0) {
      console.warn(`[disaster-msg] 처음 보는 유형 ${JSON.stringify(novelTypes)} — 관심 유형이면 WATCHED_TYPES 에 추가`);
    }

    // ★ 조회한 날짜의 발령이 응답에 하나도 없으면 정상 상태가 아니다.
    // 실측 2026-08-04 15:07 — 외부 API 가 crtDt 를 무시하고 과거 데이터만 1000건 돌려줬다
    // (8월인데 한파·전염병 유형이 섞여 왔다). 오늘 것이 없으니 신선도 게이트에서 전멸했고,
    // 그 0건이 캐시되어 **5분 동안 관제 화면이 "재난문자 없음" 으로 굳었다**(실제 발생).
    // 이런 응답은 캐시하지 않고 직전 값을 유지한다 — 다음 폴링이 곧 정상 응답을 받는다.
    // ⚠️ raws 가 0건인 것은 이상이 아니다(그날 재난이 없으면 빈 배열이 정상 — D-19).
    // ⚠️ "조회일 당일" 이 아니라 "조회 시작일 **이후**" 로 본다 — crtDt 는 누적을 주고(D-20 ③)
    //    3일 전 당일에 발령이 0건인 날도 있다. 당일로 비교하면 정상 응답을 이상으로 오판한다.
    const from = dates[0] ?? "";
    if (raws.length > 0 && !raws.some((r) => crtDtYmd(r.CRT_DT) >= from)) {
      console.error(
        `[disaster-msg] 조회 시작일(${from}) 이후 발령이 응답에 없다 — 외부 API 이상(수신 ${raws.length}건). 캐시 갱신을 건너뛴다.`,
      );
      if (hit) return { source: "live", msgs: hit.msgs };
      return { source: "live", msgs: watched };
    }

    cache.set(cacheKey, { ts: now.getTime(), msgs: watched });
    return { source: "live", msgs: watched };
  } catch (e) {
    // ⚠️ 키가 설정됐는데 목업으로 떨어졌다면 폴백이 아니라 장애다(인증키 만료 2027-07-31 — D-16).
    console.error(`[disaster-msg] 실 API 실패 — 목업 폴백. ${(e as Error).message}`);
    return { source: "mock", msgs: filterWatched(normalize(mockRaws(now)).msgs).watched };
  }
}

// ── 현장 위치 기준 조회 ──────────────────────────────────────────────────────
export type DisasterMsgView = {
  sn: number;
  type: string;
  step: EmergencyStep;
  atMs: number;
  regions: string[]; // 매칭된 수신지역 토큰
  sidos: string[]; // 매칭된 시·도(인근은 복수 가능) — 화면이 "인근 전남·전북"을 표기하는 데 쓴다
  message: string;
  fresh: boolean; // 신선도(3시간) 이내인가 — 화면이 "지금" 과 "지난 3일" 을 구분해 그린다(D-29)
};

export type LocationDisasterMsgs = {
  source: "live" | "mock";
  sido: string;
  severity: "normal" | "caution" | "danger";
  summary: string;
  site: DisasterMsgView[]; // 현장 시·도 발령 — **3일 누적**(fresh 로 구분). 알림은 신선분만
  nearby: DisasterMsgView[]; // 인근 시·도(120km) — 신선분만. 화면 참고용, 알림은 선별(D-24)
  alertItems: DisasterAlertItem[]; // notifyEnvAlerts 입력(응답 JSON 에는 싣지 않는다)
};

function toView(h: MatchedDisasterMsg, fresh: boolean): DisasterMsgView {
  return {
    fresh,
    sn: h.msg.sn,
    type: h.msg.type,
    step: h.msg.step,
    atMs: h.msg.createdAtMs,
    regions: h.matchedRegions.map((r) => r.trim()),
    sidos: h.sidos,
    message: h.msg.message,
  };
}

// 작업자 GPS 평균 좌표(시·도)에 발령된 재난문자.
// ★ 두 윈도우를 쓴다(D-29) — 목록은 3일 누적, 판정은 신선분(3시간)만.
//   site      3일 누적 · 각 항목에 fresh 플래그
//   severity  신선분 기준 — 3일 전 위험을 지금 danger 로 칠하면 오해를 부른다
//   summary   신선분 기준 — 상단 한 줄은 "지금" 을 말해야 한다
//   nearby    신선분 기준 — 3일이면 고유 지역 38곳이라 칩이 폭증한다(실측)
//   알림       신선분 기준 — 신선도는 해제 역할을 겸한다(D-07). 넓히면 계속 울린다
export async function disasterMsgsForLocation(
  lat: number,
  lon: number,
  now: Date = new Date(),
): Promise<LocationDisasterMsgs> {
  const { source, msgs } = await fetchDisasterMsgs(now);
  const nowMs = now.getTime();
  const history = msgs.filter((m) => isWithinHistory(m, nowMs));
  const matched = matchSite(history, lat, lon);
  const siteAll = matched.filter((h) => h.scope === "site");
  const siteFresh = siteAll.filter((h) => isFresh(h.msg, nowMs));
  const nearbyFresh = matched.filter((h) => h.scope === "nearby" && isFresh(h.msg, nowMs));

  const severity: LocationDisasterMsgs["severity"] = siteFresh.some(
    (h) => h.msg.step === "긴급재난",
  )
    ? "danger"
    : siteFresh.length > 0
      ? "caution"
      : "normal";
  const types = [...new Set(siteFresh.map((h) => h.msg.type))];
  const newestFirst = (a: DisasterMsgView, b: DisasterMsgView) => b.atMs - a.atMs;

  return {
    source,
    sido: latLonToSido(lat, lon).name,
    severity,
    summary: types.length > 0 ? types.join(" · ") : "재난문자 없음",
    site: siteAll.map((h) => toView(h, isFresh(h.msg, nowMs))).sort(newestFirst),
    nearby: nearbyFresh.map((h) => toView(h, true)).sort(newestFirst),
    alertItems: buildAlertItems(siteFresh, nowMs, nearbyFresh),
  };
}
