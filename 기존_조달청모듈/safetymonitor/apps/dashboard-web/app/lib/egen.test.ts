// E-Gen 공공데이터 유틸 단위 테스트 — 지역 파라미터·진료시간 포맷·XML 파싱·병원 매칭.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  egenRegionParams,
  formatDutyHours,
  hhmm,
  matchEgenPlace,
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
