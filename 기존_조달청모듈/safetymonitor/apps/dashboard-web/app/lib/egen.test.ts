// E-Gen 공공데이터 유틸 단위 테스트 — 지역 파라미터·진료시간 포맷·XML 파싱·병원 매칭.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  egenRegionParams,
  formatDutyHours,
  hhmm,
  matchEgenPlace,
  mergeEgenPlaces,
  normName,
  parseEgenItem,
  parseEgenXml,
  type EgenPlace,
} from "./egen";

test("egenRegionParams — 광역시 단축 → 정식명 + 단축명 + 시·군·구", () => {
  assert.deepEqual(egenRegionParams("광주 동구"), {
    sido: "광주광역시",
    sidoShort: "광주",
    sigungu: "동구",
  });
  assert.deepEqual(egenRegionParams("경기 성남시"), {
    sido: "경기도",
    sidoShort: "경기",
    sigungu: "성남시",
  });
});

test("egenRegionParams — 시·군·구 없는 세종", () => {
  assert.deepEqual(egenRegionParams("세종"), {
    sido: "세종특별자치시",
    sidoShort: "세종",
    sigungu: "",
  });
});

test("hhmm — 4자리만 HH:MM, 그 외 빈 문자열", () => {
  assert.equal(hhmm("0900"), "09:00");
  assert.equal(hhmm("1730"), "17:30");
  assert.equal(hhmm(""), "");
  assert.equal(hhmm("900"), "");
});

test("formatDutyHours — 평일 동일 구간 그룹 + 토 단독 + 일 휴무", () => {
  const times = [
    { start: "0900", end: "1730" }, // 월
    { start: "0900", end: "1730" }, // 화
    { start: "0900", end: "1730" }, // 수
    { start: "0900", end: "1730" }, // 목
    { start: "0900", end: "1730" }, // 금
    { start: "0900", end: "1300" }, // 토
    { start: "", end: "" }, // 일(휴무)
  ];
  assert.equal(
    formatDutyHours(times),
    "월–금 09:00–17:30 · 토 09:00–13:00 · 일 휴무",
  );
});

test("formatDutyHours — 진료시간 전무면 빈 문자열", () => {
  assert.equal(
    formatDutyHours(Array.from({ length: 7 }, () => ({ start: "", end: "" }))),
    "",
  );
});

test("parseEgenItem — 태그·CDATA·좌표 추출", () => {
  const block = `<item>
    <dutyName><![CDATA[조선대학교병원]]></dutyName>
    <dutyTel1>062-220-3000</dutyTel1>
    <dutyTime1s>0830</dutyTime1s><dutyTime1c>1700</dutyTime1c>
    <wgs84Lat>35.1382</wgs84Lat><wgs84Lon>126.9267</wgs84Lon>
  </item>`;
  const p = parseEgenItem(block);
  assert.equal(p.name, "조선대학교병원");
  assert.equal(p.tel, "062-220-3000");
  assert.equal(p.lat, 35.1382);
  assert.equal(p.lon, 126.9267);
  assert.ok(p.hours.startsWith("월 08:30–17:00"));
});

test("parseEgenXml — 여러 item 분해, 이름 없는 항목 제외", () => {
  const xml = `<response><body><items>
    <item><dutyName>가나의원</dutyName><dutyTel1>062-1</dutyTel1></item>
    <item><dutyTel1>062-2</dutyTel1></item>
    <item><dutyName>다라병원</dutyName></item>
  </items></body></response>`;
  const places = parseEgenXml(xml);
  assert.equal(places.length, 2);
  assert.deepEqual(
    places.map((p) => p.name),
    ["가나의원", "다라병원"],
  );
});

test("matchEgenPlace — 좌표 150m 이내 최근접 매칭", () => {
  const places: EgenPlace[] = [
    { name: "먼병원", tel: "1", hours: "", lat: 35.2, lon: 126.9 },
    { name: "전남대학교병원", tel: "062-220-5114", hours: "", lat: 35.1407, lon: 126.9224 },
  ];
  // 응급의료센터(같은 캠퍼스, ~40m 이내)
  const m = matchEgenPlace(
    { name: "전남대학교병원 응급의료센터", lat: 35.1408, lon: 126.9225 },
    places,
  );
  assert.equal(m?.tel, "062-220-5114");
});

test("matchEgenPlace — 좌표 없으면 이름 포함 매칭", () => {
  const places: EgenPlace[] = [
    { name: "전남대학교병원", tel: "062-220-5114", hours: "" },
  ];
  const m = matchEgenPlace(
    { name: "전남대학교병원 응급의료센터", lat: undefined, lon: undefined },
    places,
  );
  assert.equal(m?.name, "전남대학교병원");
});

test("matchEgenPlace — 무관하면 null", () => {
  const places: EgenPlace[] = [
    { name: "가나의원", tel: "1", hours: "", lat: 37.5, lon: 127.0 },
  ];
  assert.equal(
    matchEgenPlace({ name: "다라병원", lat: 35.1, lon: 126.9 }, places),
    null,
  );
});

test("normName — 태그·괄호·공백 제거", () => {
  assert.equal(normName("전남대학교병원 <b>응급</b>의료센터(3층)"), "전남대학교병원응급의료센터");
});

// ── 정식명·단축명 병합 (2026-08-14 광주 연락처 공백 회귀) ────────────────────
// 종전 로직은 "정식명이 0건이면 단축명 재시도" 였는데, 광주는 옛 표기 잔여가 **1건** 이라
// 0 이 아니어서 재시도가 안 열렸다 — 화면의 응급실 3곳 연락처가 전부 비었다.
// 아래 건수는 2026-08-14 E-Gen 실측값이다.
const place = (name: string, tel: string): EgenPlace => ({ name, tel, hours: "" });

test("mergeEgenPlaces — 잔여 1건이 대량 결과를 가리지 않는다(광주 1 vs 234)", () => {
  const full = [place("더스마트병원", "062-229-1000")]; // 정식명 조회 = 옛 표기 잔여 1건
  const short = [
    place("전남대학교병원", "062-220-5893"),
    place("조선대학교병원", "1811-7474"),
  ];
  const merged = mergeEgenPlaces(full, short);
  assert.equal(merged.length, 3, "한쪽만 채택하면 나머지 연락처가 통째로 사라진다");
  assert.ok(merged.some((p) => p.tel === "062-220-5893"));
  assert.ok(merged.some((p) => p.tel === "062-229-1000"), "작은 쪽도 버리지 않는다");
});

test("mergeEgenPlaces — 반대 방향도 같다(충남 847 vs 1)", () => {
  // 약칭이 정식명의 부분문자열이 아닌 지역은 단축명이 1건만 나온다. 순서를 뒤집어도 같은 함정.
  const merged = mergeEgenPlaces([place("천안병원", "041-1111-1111")], [place("잔여의원", "041-2222-2222")]);
  assert.equal(merged.length, 2);
});

test("mergeEgenPlaces — 같은 병원이 양쪽에 있으면 한 번만", () => {
  const dup = place("전남대학교병원", "062-220-5893");
  assert.equal(mergeEgenPlaces([dup], [{ ...dup }]).length, 1);
});

test("mergeEgenPlaces — 한쪽이 비어도 다른 쪽을 그대로 돌려준다", () => {
  const only = [place("청주병원", "043-1111-1111")];
  assert.equal(mergeEgenPlaces(only, []).length, 1);
  assert.equal(mergeEgenPlaces([], only).length, 1);
  assert.equal(mergeEgenPlaces([], []).length, 0);
});
