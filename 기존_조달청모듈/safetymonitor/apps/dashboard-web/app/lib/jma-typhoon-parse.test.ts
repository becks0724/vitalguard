// JMA 태풍 예보 파싱 단위 테스트 — 실 응답(2026-08-06 제13호 ドルフィン) 축약 픽스처 기준.
// 형식이 아니라 **형(type)·표현**이 어긋나는 경우까지 고정한다(D-19 교훈 — 픽스처는 형식만 지킨다).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isoJstToTm,
  jmaSeqOf,
  parseJmaSpecifications,
  parseTargetTc,
} from "./jma-typhoon-parse";

// 실 응답 축약 — title + 実況 + 推定 + 予報 2건.
const SPEC = [
  {
    part: "title",
    issue: { JST: "2026-08-06T14:45:00+09:00", UTC: "2026-08-06T05:45:00Z" },
    typhoonNumber: "2613",
    name: { jp: "ドルフィン", en: "Dolphin" },
    category: { jp: "台風", en: "TY" },
  },
  {
    part: { jp: "実況", en: "Analysis" },
    advancedHours: 0,
    position: { deg: [26.5, 132.9] },
    pressure: "950",
    maximumWind: { sustained: { "m/s": "40", kt: "80" } },
    galeWarning: [{ area: "北", range: { km: 700 } }],
    stormWarning: [{ area: { jp: "全域" }, range: { km: 220 } }],
    validtime: { JST: "2026-08-06T15:00:00+09:00", UTC: "2026-08-06T06:00:00Z" },
  },
  {
    part: { jp: "推定　１時間後" },
    advancedHours: 1,
    position: { deg: [26.5, 132.8] },
    pressure: "950",
    maximumWind: { sustained: { "m/s": "40" } },
    validtime: { JST: "2026-08-06T16:00:00+09:00", UTC: "2026-08-06T07:00:00Z" },
  },
  {
    part: { jp: "予報　４時間後" },
    advancedHours: 4,
    position: { deg: [26.6, 132.1] },
    pressure: "950",
    maximumWind: { sustained: { "m/s": "40" } },
    probabilityCircleRadius: { km: 35, nm: 19 },
    validtime: { JST: "2026-08-06T18:00:00+09:00", UTC: "2026-08-06T09:00:00Z" },
  },
  {
    part: { jp: "予報　１１５時間後" },
    advancedHours: 115,
    position: { deg: [29.5, 116.6] },
    pressure: "994",
    maximumWind: { sustained: { "m/s": "20" } },
    probabilityCircleRadius: { km: 220 },
    validtime: { JST: "2026-08-11T09:00:00+09:00", UTC: "2026-08-11T00:00:00Z" },
  },
];

test("태풍번호 → 순번 — 기상청 typSeq 와 같은 축", () => {
  assert.equal(jmaSeqOf("2613"), 13);
  assert.equal(jmaSeqOf("2601"), 1);
  assert.equal(jmaSeqOf("2699"), 99);
});

test("태풍번호 형식이 다르면 매칭을 포기한다(다른 태풍에 붙이지 않는다)", () => {
  assert.equal(jmaSeqOf("13"), null);
  assert.equal(jmaSeqOf("26130"), null);
  assert.equal(jmaSeqOf(""), null);
  assert.equal(jmaSeqOf("2600"), null); // 순번 0 은 없다
});

test("JST ISO → tm(KST yyyyMMddHHmm) — 기상청 typTm 과 같은 표기", () => {
  assert.equal(isoJstToTm("2026-08-06T15:00:00+09:00"), "202608061500");
  assert.equal(isoJstToTm("bad"), "");
});

test("실황 + 예보를 시간순 진로로 만든다", () => {
  const r = parseJmaSpecifications(SPEC);
  assert.ok(r);
  assert.equal(r.seq, 13);
  assert.equal(r.numberRaw, "2613");
  assert.equal(r.name, "ドルフィン");
  assert.equal(r.track.length, 4);
  assert.deepEqual(
    r.track.map((p) => p.tm),
    ["202608061500", "202608061600", "202608061800", "202608110900"],
  );
});

test("현재 위치 = advancedHours 0(実況) — 일본어 문구로 판정하지 않는다", () => {
  const r = parseJmaSpecifications(SPEC);
  assert.equal(r?.currentIndex, 0);
  assert.equal(r?.track[0]?.lat, 26.5);
  // 문구가 바뀌어도 advancedHours 로 잡힌다(D-25 — 남이 쓰는 문장은 계약이 아니다).
  const renamed = SPEC.map((e) =>
    (e as { advancedHours?: number }).advancedHours === 0
      ? { ...e, part: { jp: "現在の実況（改）" } }
      : e,
  );
  assert.equal(parseJmaSpecifications(renamed)?.currentIndex, 0);
});

test("확률반경·기압·풍속을 우리 필드로 옮긴다", () => {
  const r = parseJmaSpecifications(SPEC);
  const fc = r?.track[2];
  assert.equal(fc?.radPr, "35"); // 70% 확률반경(중심이 있을 범위 — 강풍 범위 아님)
  assert.equal(fc?.pressureHpa, 950);
  assert.equal(fc?.maxWindMs, 40);
  assert.equal(r?.track[0]?.radPr, undefined); // 실황에는 확률원이 없다
});

test("좌표가 깨진 원소는 버린다 — NaN 마커가 지도에 찍히지 않게", () => {
  const broken = [
    SPEC[0],
    SPEC[1],
    { ...SPEC[2], position: { deg: ["x", 132.8] } },
    { ...SPEC[3], position: { deg: [999, 132.1] } }, // 위도 범위 밖
    { ...SPEC[4], position: {} },
  ];
  const r = parseJmaSpecifications(broken);
  assert.equal(r?.track.length, 1);
  assert.ok(r?.track.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)));
});

test("표시할 진로가 없으면 null — 빈 진로를 그리지 않는다", () => {
  assert.equal(parseJmaSpecifications([SPEC[0]]), null);
  assert.equal(parseJmaSpecifications([]), null);
  assert.equal(parseJmaSpecifications(null), null);
  assert.equal(parseJmaSpecifications({ part: "title" }), null);
});

test("title 이 없으면 매칭 근거가 없으므로 null", () => {
  assert.equal(parseJmaSpecifications(SPEC.slice(1)), null);
});

test("targetTc — 형식이 맞는 ID 만 통과", () => {
  assert.deepEqual(
    parseTargetTc([
      { tropicalCyclone: "TC2615", typhoonNumber: "2613" },
      { tropicalCyclone: "TC2617" },
      { tropicalCyclone: "bad" },
      { typhoonNumber: "2614" },
      null,
    ]),
    ["TC2615", "TC2617"],
  );
  assert.deepEqual(parseTargetTc(null), []);
  assert.deepEqual(parseTargetTc([]), []);
});
