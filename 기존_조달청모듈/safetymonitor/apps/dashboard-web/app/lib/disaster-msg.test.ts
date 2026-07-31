// disaster-msg.ts 단위 테스트 — 골든 픽스처(샘플 CSV 100건)로 파싱·유형필터·신선도·지역매칭 회귀 방지.
// KST 파싱 테스트는 TZ=UTC 로 돌려야 의미가 있다(로컬 맥=KST 라 증상이 안 보인다 — package.json test 참고).
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  FRESH_WINDOW_MS,
  PROMOTED_TYPE,
  dedupeBySn,
  filterWatched,
  isEvacuationNotice,
  isFresh,
  kstYmd,
  matchSite,
  msgRegionMatchesSido,
  normalize,
  parseKstToMs,
  queryDates,
  senderOrg,
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
