// disaster-msg.ts 단위 테스트 — 골든 픽스처(샘플 CSV 100건)로 파싱·유형필터·신선도·지역매칭 회귀 방지.
// KST 파싱 테스트는 TZ=UTC 로 돌려야 의미가 있다(로컬 맥=KST 라 증상이 안 보인다 — package.json test 참고).
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { shouldSendEnv } from "../../lib/env-alert-notify";

import {
  ALERT_TYPES,
  FRESH_WINDOW_MS,
  PROMOTED_TYPE,
  URGENT_FALLBACK_TYPE,
  WATCHED_TYPES,
  buildAlertItems,
  dedupeBySn,
  filterWatched,
  isEvacuationNotice,
  isFireRiskCampaign,
  isFresh,
  isWatchedType,
  kstYmd,
  matchSite,
  msgRegionMatchesSido,
  normalize,
  parseKstToMs,
  queryDates,
  senderOrg,
  shortRegionLabel,
  type DisasterMsg,
  type RawDisasterMsg,
} from "./disaster-msg";
import { DISASTER_MSG_SAMPLE } from "./disaster-msg-sample";
import { latLonToSido } from "./kma-regions";

const { msgs: ALL, invalid: INVALID } = normalize(DISASTER_MSG_SAMPLE);
const { watched: WATCHED, unknownTypes: UNKNOWN } = filterWatched(ALL);

// ── 파싱 ────────────────────────────────────────────────────────────────────
test("normalize — 샘플 100건 전건 파싱, 유실 0", () => {
  assert.equal(DISASTER_MSG_SAMPLE.length, 100);
  assert.equal(ALL.length, 100);
  assert.equal(INVALID.length, 0);
});

test("parseKstToMs — KST 를 명시 환산한다(실행 환경 TZ 무관)", () => {
  // 2023-09-19 12:22:17 KST = 2023-09-19 03:22:17 UTC
  const ms = parseKstToMs("2023/09/19 12:22:17");
  assert.equal(ms, Date.UTC(2023, 8, 19, 3, 22, 17));
  assert.equal(new Date(ms as number).toISOString(), "2023-09-19T03:22:17.000Z");
});

test("parseKstToMs — 09시 이전은 UTC 전날로 정규화된다", () => {
  // 2023-09-19 05:00:00 KST = 2023-09-18 20:00:00 UTC
  assert.equal(parseKstToMs("2023/09/19 05:00:00"), Date.UTC(2023, 8, 18, 20, 0, 0));
});

test("parseKstToMs — 하이픈 구분자도 받는다(실 API 형식 미확정)", () => {
  assert.equal(parseKstToMs("2023-09-19 12:22:17"), parseKstToMs("2023/09/19 12:22:17"));
  assert.equal(parseKstToMs("2023-09-19T12:22:17"), parseKstToMs("2023/09/19 12:22:17"));
});

test("parseKstToMs — 형식 불일치는 null", () => {
  assert.equal(parseKstToMs("2023/9/19 12:22"), null);
  assert.equal(parseKstToMs(""), null);
});

test("normalize — 파싱 실패분은 조용히 사라지지 않고 invalid 로 나온다", () => {
  const broken = { ...(DISASTER_MSG_SAMPLE[0] as (typeof DISASTER_MSG_SAMPLE)[number]), CRT_DT: "어제" };
  const r = normalize([broken]);
  assert.equal(r.msgs.length, 0);
  assert.equal(r.invalid.length, 1);
});

test("normalize — SN 이 숫자로 와도 파싱된다(실 API=number · CSV=string)", () => {
  // 2026-07-31 실 API 호출에서 터진 회귀. 골든 픽스처는 CSV 출신이라 전부 문자열이었고
  // JSON 응답의 SN 만 number 라 .trim() 이 죽었다 — 픽스처로는 잡을 수 없는 종류의 결함이다.
  const numeric = { ...(DISASTER_MSG_SAMPLE[0] as RawDisasterMsg), SN: 263732 };
  const r = normalize([numeric]);
  assert.equal(r.invalid.length, 0);
  assert.equal(r.msgs[0]?.sn, 263732);
});

test("normalize — 실 API 의 나노초 타임스탬프를 정정 발령으로 오탐하지 않는다", () => {
  // 실 API 는 REG_YMD/MDFCN_YMD 를 "2026/07/31 08:22:17.000000000" 으로 주고
  // MDFCN 이 항상 REG 보다 몇 분 뒤(내부 처리 시각)라, 그대로 비교하면 전건이 정정으로 잡힌다.
  const base = DISASTER_MSG_SAMPLE[0] as RawDisasterMsg;
  const sameDay = normalize([
    { ...base, REG_YMD: "2026/07/31 08:22:17.000000000", MDFCN_YMD: "2026/07/31 08:32:07.000000000" },
  ]);
  assert.equal(sameDay.msgs[0]?.revised, false, "같은 날 처리시각 차이는 정정이 아니다");

  const nextDay = normalize([
    { ...base, REG_YMD: "2026/07/31 23:58:00.000000000", MDFCN_YMD: "2026/08/01 00:10:00.000000000" },
  ]);
  assert.equal(nextDay.msgs[0]?.revised, true, "날짜가 바뀌면 정정으로 본다");
});

test("normalize — 샘플은 정정 발령(MDFCN≠REG) 0건", () => {
  assert.equal(
    ALL.filter((m) => m.revised).length,
    0,
    "정정 발령이 생기면 처리 방침을 정해야 한다(context-notes D-08)",
  );
});

test("normalize — 긴급재난은 샘플 1건(경기 안산 단원구·호우)", () => {
  const urgent = ALL.filter((m) => m.step === "긴급재난");
  assert.equal(urgent.length, 1);
  assert.equal(urgent[0]?.sn, 205260);
  assert.equal(urgent[0]?.type, "호우");
});

// ── 재해유형 화이트리스트 ────────────────────────────────────────────────────
test("filterWatched — 호우 61 + 산사태 4 + 재승격 2 = 67건 통과", () => {
  assert.equal(WATCHED.length, 67);
  assert.equal(WATCHED.filter((m) => m.type === "호우").length, 61);
  assert.equal(WATCHED.filter((m) => m.type === "산사태").length, 4);
  assert.equal(WATCHED.filter((m) => m.type === PROMOTED_TYPE).length, 2);
});

test("filterWatched — 실종자 27건·도로통제·교통통제는 계속 차단", () => {
  assert.deepEqual(UNKNOWN.sort(), ["교통통제", "기타"]);
  assert.equal(ALL.length - WATCHED.length, 33);
});

test("filterWatched — 통과분에 개인정보(실종자 안내) 문자가 한 건도 없다", () => {
  // 실종자 문자는 실명·나이·키·몸무게·인상착의를 담는다. 화이트리스트가 저장 이전에 막아야 한다(D-10).
  const leaked = WATCHED.filter((m) => m.message.includes("찾습니다"));
  assert.deepEqual(leaked, [], "개인정보 포함 문자가 화이트리스트를 통과했다");
});

// ── '기타' 재승격 (D-15) ─────────────────────────────────────────────────────
test("재승격 — '기타' 중 하천 수위 대피 안내 2건만 되살아난다", () => {
  const promoted = WATCHED.filter((m) => m.type === PROMOTED_TYPE);
  assert.equal(promoted.length, 2);
  const orgs = promoted.map((m) => senderOrg(m.message)).sort();
  assert.deepEqual(orgs, ["경기도청", "한국수자원공사"]);
  assert.ok(promoted.every((m) => m.message.includes("대피")));
});

test("★ 재승격 불변식 — 통과분 전체에 개인정보(실종자) 문자가 0건", () => {
  // 재승격은 개인정보 차단을 뚫는 경로가 될 수 있다. 조건을 바꿔도 이 불변식은 유지돼야 한다.
  assert.deepEqual(WATCHED.filter((m) => m.message.includes("찾습니다")), []);
  assert.deepEqual(WATCHED.filter((m) => senderOrg(m.message)?.includes("경찰청")), []);
});

test("재승격 — 경찰청 발신은 대피 키워드가 있어도 되살아나지 않는다", () => {
  const police: DisasterMsg = {
    ...(ALL[0] as DisasterMsg),
    type: "기타",
    message: "[서울경찰청] 실종자 수색 중 인근 주민은 대피 바랍니다",
  };
  assert.equal(isEvacuationNotice(police), false);
  assert.equal(filterWatched([police]).watched.length, 0);
});

test("재승격 — 기관 표기가 없으면 되살리지 않는다(판정 근거 없음)", () => {
  const anon: DisasterMsg = {
    ...(ALL[0] as DisasterMsg),
    type: "기타",
    message: "하천 수위 상승으로 즉시 대피 바랍니다",
  };
  assert.equal(senderOrg(anon.message), null);
  assert.equal(isEvacuationNotice(anon), false);
});

test("재승격 — 대피 키워드가 없으면 되살리지 않는다(사천시 도로통제 케이스)", () => {
  const roadwork = ALL.find((m) => m.message.includes("싱크홀 복구작업")) as DisasterMsg;
  assert.equal(roadwork.type, "기타");
  assert.equal(isEvacuationNotice(roadwork), false);
});

test("senderOrg — 대괄호 발신기관 추출", () => {
  assert.equal(senderOrg("[경기도청] 임진강 수위"), "경기도청");
  assert.equal(senderOrg("발신기관 없음"), null);
  assert.equal(senderOrg("[] 빈 기관"), null);
});

test("filterWatched — 모르는 유형은 버리되 목록으로 되돌려준다", () => {
  const fake: DisasterMsg = { ...(ALL[0] as DisasterMsg), type: "화산" };
  const r = filterWatched([fake]);
  assert.equal(r.watched.length, 0);
  assert.deepEqual(r.unknownTypes, ["화산"]);
});

// ── 신선도 ──────────────────────────────────────────────────────────────────
const BASE = ALL.find((m) => m.step === "긴급재난") as DisasterMsg;

test("isFresh — 발령 직후·윈도우 경계 이내는 신선", () => {
  assert.equal(isFresh(BASE, BASE.createdAtMs), true);
  assert.equal(isFresh(BASE, BASE.createdAtMs + FRESH_WINDOW_MS), true);
});

test("isFresh — 윈도우를 1ms 넘기면 만료(= 해제 역할)", () => {
  assert.equal(isFresh(BASE, BASE.createdAtMs + FRESH_WINDOW_MS + 1), false);
});

test("isFresh — 발령 시각이 미래인 문자는 배제(시계 오차·형식 오류 방어)", () => {
  assert.equal(isFresh(BASE, BASE.createdAtMs - 1), false);
});

// ── 조회 날짜(KST) ───────────────────────────────────────────────────────────
test("kstYmd — UTC 자정 전후에도 KST 날짜를 준다(Cloud Run 은 UTC)", () => {
  // 2026-07-30 15:00 UTC = 2026-07-31 00:00 KST → 이미 31일이다.
  assert.equal(kstYmd(new Date(Date.UTC(2026, 6, 30, 15, 0, 0))), "20260731");
  assert.equal(kstYmd(new Date(Date.UTC(2026, 6, 30, 14, 59, 59))), "20260730");
});

test("queryDates — 낮에는 오늘 하루만 조회한다(폴링당 1회)", () => {
  // 2026-07-31 01:00 UTC = 10:00 KST
  assert.deepEqual(queryDates(new Date(Date.UTC(2026, 6, 31, 1, 0, 0))), ["20260731"]);
});

test("queryDates — 신선도 윈도우가 자정을 걸치면 전날도 조회한다", () => {
  // 2026-07-30 16:30 UTC = 2026-07-31 01:30 KST → 어제 23시 발령이 아직 신선하다.
  assert.deepEqual(queryDates(new Date(Date.UTC(2026, 6, 30, 16, 30, 0))), [
    "20260730",
    "20260731",
  ]);
});

test("queryDates — 경계 KST 03:00 부터는 오늘만(윈도우가 자정을 안 넘김)", () => {
  const at = (utcHour: number, min = 0) => new Date(Date.UTC(2026, 6, 30, utcHour, min, 0));
  assert.deepEqual(queryDates(at(18)), ["20260731"]); // KST 03:00
  assert.deepEqual(queryDates(at(17, 59)), ["20260730", "20260731"]); // KST 02:59
});

test("dedupeBySn — SN 중복 제거, 순서 보존, number/string 혼용 허용", () => {
  const mk = (sn: string | number) => ({ ...(DISASTER_MSG_SAMPLE[0] as RawDisasterMsg), SN: sn });
  const out = dedupeBySn([mk(1), mk("1"), mk(2), mk(1)]);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((r) => String(r.SN)),
    ["1", "2"],
  );
});

// ── 지역 토큰 분리 ───────────────────────────────────────────────────────────
test("splitRegions — 괄호 안 콤마가 토큰을 쪼개지 않는다(임진강 수계 케이스)", () => {
  const imjin = ALL.find((m) => m.message.includes("임진강 수위 상승")) as DisasterMsg;
  assert.deepEqual(imjin.regions, ["임진강 수계지역(경기도 연천군,파주시)", "경기도 임진강"]);
});

test("splitRegions — 다지역 나열은 개별 토큰으로(고양시 3개 구)", () => {
  const goyang = ALL.find((m) => m.message.includes("고양시에서 실종된")) as DisasterMsg;
  assert.equal(goyang.regions.length, 3);
  assert.ok(goyang.regions.every((r) => r.startsWith("경기도 고양시")));
});

// ── 재난문자 전용 시·도 매칭 ─────────────────────────────────────────────────
const GYEONGGI = ["경기"];
const GWANGJU = ["광주"];

test("msgRegionMatchesSido — head 가 시·도면 그대로 매칭", () => {
  assert.equal(msgRegionMatchesSido("경기도 안산시 단원구 풍도동", GYEONGGI), true);
  assert.equal(msgRegionMatchesSido("경상남도 전체", GYEONGGI), false);
});

test("msgRegionMatchesSido — head 가 행정구역이 아니면 괄호 안 실제 지역을 본다", () => {
  // 기상특보와 괄호 의미가 정반대다. head="임진강 수계지역"(하천) / 괄호="경기도 연천군,파주시"(행정구역).
  assert.equal(msgRegionMatchesSido("임진강 수계지역(경기도 연천군,파주시)", GYEONGGI), true);
});

test("msgRegionMatchesSido — head 가 시·도면 괄호는 보지 않는다(경기 광주시 오매칭 방지)", () => {
  // 괄호 폴백을 무조건 허용하면 경기 광주시가 광주광역시로 오매칭된다 — 기존 head 매칭이 막던 함정.
  assert.equal(msgRegionMatchesSido("경기도(광주, 하남)", GWANGJU), false);
  assert.equal(msgRegionMatchesSido("경기도(광주, 하남)", GYEONGGI), true);
});

test("msgRegionMatchesSido — 공백 표기 '경기도 광주시' 는 광주광역시가 아니다(실측 오탐)", () => {
  // 재난문자는 시·도와 시·군·구를 공백으로 잇는다. 토큰 전체를 부분문자열 검사하면
  // 하위 지명이 시·도로 읽혀 광주 현장에 경기 광주시 폭염이 뜬다(2026-07-31 19:46 실측).
  assert.equal(msgRegionMatchesSido("경기도 광주시 ", GWANGJU), false);
  assert.equal(msgRegionMatchesSido("경기도 광주시 ", GYEONGGI), true);
});

// ── 2026 행정통합 — '전남광주통합특별시' 안에서 광주·전남 가르기 ─────────────
const JEONNAM = ["전라남", "전남"];

test("msgRegionMatchesSido — 통합시 발령은 시·군·구로 광주/전남을 가른다", () => {
  // 광주 관할 5개 구는 광주만, 전남 시·군은 전남만. 이 구분이 없으면 두 현장이 같은 목록을 본다.
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 광산구 ", GWANGJU), true);
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 광산구 ", JEONNAM), false);
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 목포시 ", GWANGJU), false);
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 목포시 ", JEONNAM), true);
  // '광주시' 표기도 광주 관할로 본다(구 단위가 아니라 시 단위로 오는 경우).
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 광주시 ", GWANGJU), true);
});

test("msgRegionMatchesSido — 통합시 전역 발령은 광주·전남 둘 다 자기 발령", () => {
  // 하위 지명이 없으면 통합시 전체 발령이다. 한쪽만 주면 나머지 현장이 재난을 놓친다.
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 ", GWANGJU), true);
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 ", JEONNAM), true);
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 전체", GWANGJU), true);
  assert.equal(msgRegionMatchesSido("전남광주통합특별시 전체", JEONNAM), true);
});

test("matchSite — 광주 현장이 전남 시·군 발령을 site 로 받지 않는다", () => {
  const gwangju: [number, number] = [35.1595, 126.8526];
  assert.equal(latLonToSido(...gwangju).name, "광주");
  const heat = ["전남광주통합특별시 광산구 ", "전남광주통합특별시 목포시 ", "경기도 광주시 "].map(
    (region, i): DisasterMsg => ({
      sn: 700000 + i,
      createdAtMs: Date.UTC(2026, 7, 1, 3, 0, 0),
      message: `[테스트] ${region.trim()} 폭염`,
      regions: [region],
      step: "안전안내",
      type: "폭염",
      revised: false,
    }),
  );
  const site = matchSite(heat, ...gwangju).filter((h) => h.scope === "site");
  assert.deepEqual(
    site.map((h) => h.matchedRegions[0]?.trim()),
    ["전남광주통합특별시 광산구"],
  );
});

// ── 현장 매칭 ────────────────────────────────────────────────────────────────
// 좌표는 latLonToSido 가 정확히 판정하는 지점만 쓴다(광역시 인접 도 지역은 오판 — 아래 가드 테스트).
const JEONJU: [number, number] = [35.8242, 127.148];

test("matchSite — 전주 현장은 전북 발령을 site 로 잡는다", () => {
  assert.equal(latLonToSido(...JEONJU).name, "전북");
  const site = matchSite(WATCHED, ...JEONJU).filter((h) => h.scope === "site");
  assert.equal(site.length, 8);
  assert.ok(
    site.every((h) => h.matchedRegions.some((r) => r.includes("전북") || r.includes("전라북"))),
    "site 로 잡힌 문자의 매칭 지역이 전부 전북이어야 한다",
  );
});

test("matchSite — 제주 현장은 인근 시·도가 없어 전국 발령만 잡힌다", () => {
  const jeju: [number, number] = [33.4996, 126.5312];
  assert.equal(latLonToSido(...jeju).name, "제주");
  const hits = matchSite(WATCHED, ...jeju);
  // 인근 시·도(120km 이내)가 없으므로 nearby 는 구조적으로 0건.
  assert.deepEqual(hits.filter((h) => h.scope === "nearby"), []);
  // 남는 건 "제주특별자치도 전체"를 포함한 행정안전부 전국 발령뿐.
  assert.ok(hits.length > 0);
  assert.ok(
    hits.every((h) => h.matchedRegions.some((r) => r.includes("제주"))),
    "제주 현장에 제주 아닌 발령이 site 로 잡히면 안 된다",
  );
});

test("matchSite — 현장·인근 어디에도 안 걸리는 발령은 제외된다", () => {
  // 부산 전용 발령은 전주 현장(전북·인근에 부산 없음)에서 통째로 빠진다.
  const busanOnly = WATCHED.filter(
    (m) => m.regions.length > 0 && m.regions.every((r) => r.includes("부산")),
  );
  assert.ok(busanOnly.length > 0, "샘플에 부산 전용 발령이 있어야 이 테스트가 의미 있다");
  assert.deepEqual(matchSite(busanOnly, ...JEONJU), []);
});

test("matchSite — 인근 시·도 발령은 nearby 로만 잡힌다(알림 대상 아님)", () => {
  const hits = matchSite(WATCHED, ...JEONJU);
  const nearby = hits.filter((h) => h.scope === "nearby");
  assert.ok(nearby.length > 0);
  assert.ok(
    nearby.every((h) => !h.matchedRegions.some((r) => r.includes("전북") || r.includes("전라북"))),
    "nearby 에 현장 시·도 발령이 섞이면 안 된다",
  );
});

// ── 알림 항목 (D-07 · D-09 · D-15) ──────────────────────────────────────────
const ANSAN: [number, number] = [37.3219, 126.8309];
const URGENT = ALL.find((m) => m.step === "긴급재난") as DisasterMsg; // 경기 안산 · 호우 · 긴급재난
const matchedAt = (msgs: DisasterMsg[], at: [number, number] = ANSAN) =>
  matchSite(msgs, ...at).filter((h) => h.scope === "site");

test("ALERT_TYPES — 화이트리스트 + 재승격 + 긴급재난 라벨을 모두 포함한다", () => {
  for (const t of WATCHED_TYPES) assert.ok(ALERT_TYPES.includes(t), `${t} 누락`);
  assert.ok(ALERT_TYPES.includes(PROMOTED_TYPE), "PROMOTED_TYPE 누락 시 대피안내 알림이 1회만 간다");
  assert.ok(
    ALERT_TYPES.includes(URGENT_FALLBACK_TYPE),
    "URGENT_FALLBACK_TYPE 누락 시 긴급재난 알림이 1회만 간다",
  );
  assert.equal(ALERT_TYPES.length, WATCHED_TYPES.length + 2);
});

test("★ buildAlertItems — 발령 없는 유형도 매번 normal 로 낸다(D-07 해제 역할)", () => {
  const items = buildAlertItems([], Date.now());
  assert.equal(items.length, ALERT_TYPES.length, "일부 유형을 빼면 그 유형은 영영 해제되지 않는다");
  assert.ok(items.every((i) => i.severity === "normal"));
  assert.deepEqual(
    items.map((i) => i.itemKey).sort(),
    ALERT_TYPES.map((t) => `disaster:${t}`).sort(),
  );
});

test("buildAlertItems — itemKey 는 유형 단위다(SN 이 들어가면 안 된다 — D-09)", () => {
  const items = buildAlertItems(matchedAt([URGENT]), URGENT.createdAtMs);
  assert.ok(items.every((i) => /^disaster:[^:]+$/.test(i.itemKey)));
  assert.ok(items.every((i) => !i.itemKey.includes(String(URGENT.sn))));
});

test("buildAlertItems — 긴급재난은 danger, 안전안내는 caution", () => {
  const at = URGENT.createdAtMs;
  const danger = buildAlertItems(matchedAt([URGENT]), at).find((i) => i.itemKey === "disaster:호우");
  assert.equal(danger?.severity, "danger");

  const notice: DisasterMsg = { ...URGENT, step: "안전안내" };
  const caution = buildAlertItems(matchedAt([notice]), at).find((i) => i.itemKey === "disaster:호우");
  assert.equal(caution?.severity, "caution");
});

test("buildAlertItems — 신선도가 지난 발령은 normal 로 떨어진다", () => {
  const stale = URGENT.createdAtMs + FRESH_WINDOW_MS + 1;
  const item = buildAlertItems(matchedAt([URGENT]), stale).find((i) => i.itemKey === "disaster:호우");
  assert.equal(item?.severity, "normal");
});

test("buildAlertItems — detail 에 발령시각·지역·본문이 담긴다", () => {
  const item = buildAlertItems(matchedAt([URGENT]), URGENT.createdAtMs).find(
    (i) => i.itemKey === "disaster:호우",
  );
  assert.equal(item?.itemLabel, "재난문자");
  assert.match(item?.detail ?? "", /^\d{2}:\d{2} 발령 · 경기도 안산시 단원구 풍도동\n/);
  assert.ok((item?.detail ?? "").includes("기상청"));
});

test("buildAlertItems — 같은 유형 여러 건이면 '외 N건'", () => {
  const second: DisasterMsg = { ...URGENT, sn: URGENT.sn + 1, step: "안전안내" };
  const item = buildAlertItems(matchedAt([URGENT, second]), URGENT.createdAtMs).find(
    (i) => i.itemKey === "disaster:호우",
  );
  assert.equal(item?.currentValue, "호우 외 1건");
  assert.equal(item?.severity, "danger", "한 건이라도 긴급재난이면 danger");
});

// ── 긴급재난은 유형으로 거르지 않는다 ────────────────────────────────────────
// 실측 2026-07-01~ 4400건 중 긴급재난 58건의 67%(39건)가 유형 때문에 버려지고 있었다.
// 기상청 극한호우는 DST_SE_NM 이 아예 비어서 온다(29건 전부 긴급재난 단계).
const EXTREME_RAIN: DisasterMsg = {
  sn: 820001,
  createdAtMs: Date.UTC(2026, 6, 18, 15, 42, 29), // KST 07-19 00:42
  message: "00:41 나주시 금천면 인근 50mm/h 이상 강한 비로 침수 등 우려(국민행동요령: cbs062.kma.go.kr)",
  regions: ["전남광주통합특별시 남구 구소동 "],
  step: "긴급재난",
  type: "", // ← DST_SE_NM 이 null 로 온다
  revised: false,
};

test("★ 유형이 비어 오는 기상청 극한호우 긴급재난을 버리지 않는다(실측 29건)", () => {
  const { watched, unknownTypes } = filterWatched([EXTREME_RAIN]);
  assert.equal(watched.length, 1, "가장 위급한 문자가 통째로 사라진다");
  assert.equal(watched[0]?.type, URGENT_FALLBACK_TYPE);
  assert.equal(unknownTypes.length, 0);
});

test("★ 화이트리스트 밖 유형이어도 긴급재난이면 받는다(홍수·환경오염사고)", () => {
  const flood: DisasterMsg = { ...EXTREME_RAIN, sn: 820002, type: "홍수" };
  const pollution: DisasterMsg = { ...EXTREME_RAIN, sn: 820003, type: "환경오염사고" };
  const { watched } = filterWatched([flood, pollution]);
  assert.equal(watched.length, 2);
  assert.deepEqual(
    watched.map((m) => m.type),
    [URGENT_FALLBACK_TYPE, URGENT_FALLBACK_TYPE],
  );
});

test("긴급재난이라도 화이트리스트 유형이면 원래 유형을 유지한다", () => {
  const landslide: DisasterMsg = { ...EXTREME_RAIN, sn: 820004, type: "산사태" };
  assert.equal(filterWatched([landslide]).watched[0]?.type, "산사태");
});

test("안전안내 단계의 화이트리스트 밖 유형은 그대로 버린다(무분별 수집 방지)", () => {
  const notice: DisasterMsg = { ...EXTREME_RAIN, sn: 820005, type: "교통사고", step: "안전안내" };
  const { watched, unknownTypes } = filterWatched([notice]);
  assert.equal(watched.length, 0);
  assert.deepEqual(unknownTypes, ["교통사고"]);
});

test("★ 긴급재난 극한호우가 광주 현장에 site 로 잡히고 danger 로 알림된다", () => {
  const GWANGJU: [number, number] = [35.1595, 126.8526];
  const site = matchedAt([EXTREME_RAIN], GWANGJU);
  assert.equal(site.length, 1, "광주 남구 발령이 현장 발령으로 잡혀야 한다");
  const promoted = filterWatched([EXTREME_RAIN]).watched;
  const item = buildAlertItems(matchedAt(promoted, GWANGJU), EXTREME_RAIN.createdAtMs).find(
    (i) => i.itemKey === `disaster:${URGENT_FALLBACK_TYPE}`,
  );
  assert.equal(item?.severity, "danger");
  assert.ok((item?.detail ?? "").includes("50mm/h"));
});

// ── 화재 유형 + 정기 캠페인 알림 제외 ────────────────────────────────────────
// 실측 2026-07-31~08-03 — 소방청이 하루 2회(13:50·19:30) 16개 시·도 전역으로 같은 문자를 보낸다.
// 화면에는 남기되(전기화재 예방 수칙) 알림만 뺀다.
const FIRE_CAMPAIGN: DisasterMsg = {
  sn: 810001,
  createdAtMs: Date.UTC(2026, 7, 3, 4, 50, 0), // KST 13:50
  message:
    "화재위험경보 ‘경계’ 발령 전기화재예방 알림 ▲실외기 주변 가연물 및 문어발식 콘센트 금지 ▲과열 시 중단 ▲손상된 전선 교체 ▲사용 후 플러그 뽑기[소방청]",
  regions: ["경기도  ", "전남광주통합특별시  "],
  step: "안전안내",
  type: "화재",
  revised: false,
};
const FIRE_INCIDENT: DisasterMsg = {
  ...FIRE_CAMPAIGN,
  sn: 810002,
  message: "오늘 08:20 안산시 단원구 페인트 공장 화재 발생. 인근 주민은 먼 곳으로 대피하시기 바랍니다.[안산시]",
  regions: ["경기도 안산시 단원구 "],
};

test("화재는 관심 유형이다 — 화재위험경보·공장화재가 수집 대상", () => {
  assert.ok(isWatchedType("화재"));
  assert.equal(filterWatched([FIRE_CAMPAIGN, FIRE_INCIDENT]).watched.length, 2);
});

test("isFireRiskCampaign — 정기 캠페인만 골라낸다(실제 사고 문자는 아니다)", () => {
  assert.ok(isFireRiskCampaign(FIRE_CAMPAIGN));
  assert.equal(isFireRiskCampaign(FIRE_INCIDENT), false);
});

test("★ isFireRiskCampaign — 유형 게이트: 화재가 아닌 유형은 문구가 같아도 캠페인이 아니다", () => {
  // 문구만 보면 폭염·호우 문자가 이 문구를 인용했을 때 그 유형의 알림까지 조용히 막힌다.
  const heatWithSameWords: DisasterMsg = { ...FIRE_CAMPAIGN, type: "폭염" };
  assert.equal(isFireRiskCampaign(heatWithSameWords), false);
});

test("★ buildAlertItems — 화재위험경보 캠페인은 알림을 발사하지 않는다", () => {
  const item = buildAlertItems(matchedAt([FIRE_CAMPAIGN]), FIRE_CAMPAIGN.createdAtMs).find(
    (i) => i.itemKey === "disaster:화재",
  );
  assert.equal(item?.severity, "normal", "매일 2회 같은 문자가 텔레그램으로 나간다");
});

test("buildAlertItems — 실제 화재 사고는 그대로 알림 대상이다", () => {
  const item = buildAlertItems(matchedAt([FIRE_INCIDENT]), FIRE_INCIDENT.createdAtMs).find(
    (i) => i.itemKey === "disaster:화재",
  );
  assert.equal(item?.severity, "caution");
});

test("★ 캠페인 제외는 알림에만 적용된다 — 화면(site 매칭)에는 그대로 남는다", () => {
  const site = matchedAt([FIRE_CAMPAIGN]);
  assert.equal(site.length, 1, "화면에서도 사라지면 전기화재 예방 수칙을 아예 못 본다");
});

test("★ 폭염 등 날씨 유형은 이번 변경과 무관하게 그대로 알림이 간다", () => {
  const heat: DisasterMsg = { ...URGENT, sn: 810003, type: "폭염", step: "안전안내" };
  const rain: DisasterMsg = { ...URGENT, sn: 810004, type: "호우" };
  const items = buildAlertItems(matchedAt([heat, rain]), URGENT.createdAtMs);
  assert.equal(items.find((i) => i.itemKey === "disaster:폭염")?.severity, "caution");
  assert.equal(items.find((i) => i.itemKey === "disaster:호우")?.severity, "danger");
});

test("★★ D-07 전체 시퀀스 — 해제 후 재발령이 다시 발송된다", () => {
  // notifyEnvAlerts 의 실제 억제 규칙(shouldSendEnv)으로 폴링 흐름을 그대로 재생한다.
  const key = "disaster:호우";
  const sev = (site: ReturnType<typeof matchedAt>, at: number) =>
    buildAlertItems(site, at).find((i) => i.itemKey === key)?.severity ?? "normal";
  const notice: DisasterMsg = { ...URGENT, step: "안전안내" };
  const t = URGENT.createdAtMs;

  let prev: "normal" | "caution" | "danger" | null = null;
  const step = (site: ReturnType<typeof matchedAt>, at: number) => {
    const next = sev(site, at);
    const sent = shouldSendEnv(prev, next);
    prev = next; // notifyEnvAlerts 는 발송 여부와 무관하게 상태를 갱신한다
    return { next, sent };
  };

  assert.deepEqual(step([], t), { next: "normal", sent: false }, "① 발령 없음");
  assert.deepEqual(step(matchedAt([notice]), t), { next: "caution", sent: true }, "② 첫 발령 → 발송");
  assert.deepEqual(step(matchedAt([notice]), t + 60_000), { next: "caution", sent: false }, "③ 같은 발령 지속 → 억제");
  assert.deepEqual(step(matchedAt([URGENT]), t + 120_000), { next: "danger", sent: true }, "④ 긴급재난 승격 → 발송");
  const expired = t + FRESH_WINDOW_MS + 1;
  assert.deepEqual(step(matchedAt([URGENT]), expired), { next: "normal", sent: false }, "⑤ 신선도 만료 = 해제");
  const again: DisasterMsg = { ...notice, sn: 999999, createdAtMs: expired + 60_000 };
  assert.deepEqual(
    step(matchedAt([again]), expired + 60_000),
    { next: "caution", sent: true },
    "⑥ ★ 재발령 → 다시 발송(여기서 false 면 유형당 알림이 평생 1회다)",
  );
});

// ── 광역시 인접 도(道) 현장 — D-14 해소 후 정상 동작 ─────────────────────────
// 다중 시드 판정 이전에는 안산→인천·창원→부산으로 오판돼 아래 발령이 전부 nearby 로 새고
// 알림이 발사되지 않았다. 시드 판정이 되돌아가면 이 테스트들이 먼저 깨진다.
test("matchSite — 안산 현장은 경기 안산 긴급재난을 site 로 잡는다(D-14 회귀 고정)", () => {
  const ansan: [number, number] = [37.3219, 126.8309];
  assert.equal(latLonToSido(...ansan).name, "경기");
  const urgent = WATCHED.filter((m) => m.step === "긴급재난");
  const hits = matchSite(urgent, ...ansan);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.scope, "site", "site 가 아니면 알림 게이트를 못 넘어 미발송된다");
  assert.deepEqual(hits[0]?.matchedRegions, ["경기도 안산시 단원구 풍도동"]);
});

test("matchSite — 창원 현장은 '경상남도 전체' 발령을 site 로 잡는다(D-14 회귀 고정)", () => {
  const changwon: [number, number] = [35.2281, 128.6811];
  assert.equal(latLonToSido(...changwon).name, "경남");
  const site = matchSite(WATCHED, ...changwon).filter((h) => h.scope === "site");
  assert.ok(site.some((h) => h.matchedRegions.includes("경상남도 전체")));
  assert.ok(
    site.every((h) => h.matchedRegions.some((r) => r.includes("경상남") || r.includes("경남"))),
    "site 에 경남 아닌 발령이 섞이면 안 된다",
  );
});

test("msgRegionMatchesSido — 임진강 수계 발령이 경기 현장에 매칭된다(괄호 폴백 통합)", () => {
  // ⚠️ 이 문자는 DST_SE_NM='기타' 라 화이트리스트에서 걸러진다(context-notes D-15).
  //    여기서는 지역 매칭 로직만 검증한다 — 유형 필터 이전 단계.
  const imjin = ALL.find((m) => m.message.includes("임진강 수위 상승")) as DisasterMsg;
  const gyeonggi = latLonToSido(37.6584, 126.832); // 고양
  assert.equal(gyeonggi.name, "경기");
  const hits = matchSite([imjin], 37.6584, 126.832);
  assert.equal(hits[0]?.scope, "site");
  // 첫 토큰은 head 가 하천명이라 괄호 폴백으로, 둘째 토큰은 head 매칭으로 잡힌다.
  assert.equal(hits[0]?.matchedRegions.length, 2);
});

// ── 지역 라벨(신호등 칩) ─────────────────────────────────────────────────────
test("shortRegionLabel — 시·군·구를 짧게(첫 토큰은 시·도라 건너뛴다)", () => {
  assert.equal(shortRegionLabel("전남광주통합특별시 완도군"), "완도");
  assert.equal(shortRegionLabel("전남광주통합특별시 보성군 "), "보성");
  assert.equal(shortRegionLabel("경기도 안산시 단원구 풍도동"), "안산");
  assert.equal(shortRegionLabel("경상북도 포항시 남구"), "포항");
  assert.equal(shortRegionLabel("서울특별시 강남구"), "강남");
});

test("shortRegionLabel — 하위 지역이 없으면 시·도를 줄여 '전역'", () => {
  assert.equal(shortRegionLabel("경상남도 전체"), "경남 전역");
  assert.equal(shortRegionLabel("전북특별자치도 전체"), "전북 전역");
  assert.equal(shortRegionLabel("서울특별시 전체"), "서울 전역");
});

test("shortRegionLabel — 하천 수계 표기는 괄호 안 행정구역을 쓴다", () => {
  assert.equal(shortRegionLabel("임진강 수계지역(경기도 연천군,파주시)"), "연천");
});
