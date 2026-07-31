// 긴급재난문자 API 클라이언트 — safetydata.go.kr DSSP-IF-00247 호출·캐시·목업 폴백.
// 정책: SAFETYDATA_SERVICE_KEY 있으면 실 API, 없으면 목업(데모 무중단 — kma.ts 와 동일).
// 순수 로직(정규화·유형필터·지역매칭)은 단위테스트 가능한 disaster-msg.ts 에 있다.
import "server-only";

import {
  dedupeBySn,
  filterWatched,
  normalize,
  queryDates,
  type DisasterMsg,
  type RawDisasterMsg,
} from "./disaster-msg";

const BASE = "https://www.safetydata.go.kr/V2/api/DSSP-IF-00247";
// 일일 호출 1000건 — 5분 주기(288회/일) + 자정 인근 전날 조회(약 36회) = 약 32%(D-17).
const TTL_MS = 5 * 60 * 1000;
// 하루치 전건을 한 번에 받는다. 응답 정렬이 시각순도 SN순도 아니라 페이징에 기댈 수 없다(D-17).
const NUM_OF_ROWS = 1000;
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
async function fetchDay(key: string, crtDt: string): Promise<RawDisasterMsg[]> {
  const url = `${BASE}?serviceKey=${key}&returnType=json&pageNo=1&numOfRows=${NUM_OF_ROWS}&crtDt=${crtDt}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const json = await res.json();
  const code = json?.header?.resultCode;
  if (code !== "00") {
    throw new Error(`resultCode ${code} · ${json?.header?.resultMsg ?? ""}`);
  }
  // ★ body 가 빈 배열이면 "그날 재난문자가 없었다"는 정상 상태다. 목업으로 떨어뜨리면
  //   재난이 없는 날 관제 화면에 가짜 경보가 뜬다(kma.ts 가 실제로 겪은 사고 — resultCode 03 분기).
  const body = json?.body;
  return Array.isArray(body) ? body : [];
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

    cache.set(cacheKey, { ts: now.getTime(), msgs: watched });
    return { source: "live", msgs: watched };
  } catch (e) {
    // ⚠️ 키가 설정됐는데 목업으로 떨어졌다면 폴백이 아니라 장애다(인증키 만료 2027-07-31 — D-16).
    console.error(`[disaster-msg] 실 API 실패 — 목업 폴백. ${(e as Error).message}`);
    return { source: "mock", msgs: filterWatched(normalize(mockRaws(now)).msgs).watched };
  }
}
