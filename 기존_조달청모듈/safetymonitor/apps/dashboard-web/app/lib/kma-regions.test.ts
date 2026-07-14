// 기상특보 구역 파싱 단위 테스트 — 괄호-보존 분리 + head 매칭(광주광역시 vs 경기 광주시 오매칭 회귀 고정).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  latLonToSido,
  localizeRegions,
  nearbySidos,
  regionMatchesSido,
  splitRegions,
} from "./kma-regions";

// 2026-07-14 실측 t6 폭염주의보 구역 축약.
const T6_REGIONS =
  "경기도(동두천, 여주동남부, 여주서부 제외), 전라남도(담양, 장성, 화순), 서울, 인천(인천남부, 인천북부), 대전, 광주, 부산";
// 2026-07-14 실측 t6 열대야주의보 — 경기도 괄호 안에 경기 광주시("광주")가 들어있는 함정 케이스.
const T6_TRAP = "경기도(광명, 과천, 부천, 광주, 여주동남부), 강원도(동해평지), 서울";

test("splitRegions — 괄호 안 콤마 보존(시·군·구가 독립 토큰으로 흩어지지 않음)", () => {
  assert.deepEqual(splitRegions(T6_REGIONS), [
    "경기도(동두천, 여주동남부, 여주서부 제외)",
    "전라남도(담양, 장성, 화순)",
    "서울",
    "인천(인천남부, 인천북부)",
    "대전",
    "광주",
    "부산",
  ]);
  assert.deepEqual(splitRegions(""), []);
  assert.deepEqual(splitRegions("남해동부바깥먼바다"), ["남해동부바깥먼바다"]);
});

test("광주광역시 — head 단독 토큰 '광주' 매칭(구 키워드 '광주광역시'는 영원히 미매칭이던 버그)", () => {
  const regions = splitRegions(T6_REGIONS);
  const gwangju = ["광주"]; // kma.ts 광주 keywords
  assert.equal(regions.some((r) => regionMatchesSido(r, gwangju)), true);
});

test("경기 광주시 함정 — 경기도 괄호 안 '광주'는 광주광역시로 오매칭되지 않음", () => {
  const regions = splitRegions(T6_TRAP);
  const gwangju = ["광주"];
  // 광주광역시 단독 토큰이 없으므로 미매칭이어야 함(괄호 안 경기 광주시 무시).
  assert.equal(regions.some((r) => regionMatchesSido(r, gwangju)), false);
  // 반면 경기 현장은 정상 매칭.
  assert.equal(regions.some((r) => regionMatchesSido(r, ["경기"])), true);
});

test("nearbySidos — 광주 현장은 전남·전북이 인근(120km), 서울·제주는 아님", () => {
  const site = { lat: 35.15, lon: 126.92 }; // 광주
  assert.equal(latLonToSido(site.lat, site.lon).name, "광주");
  const names = nearbySidos(site.lat, site.lon).map((s) => s.name);
  assert.ok(names.includes("전남"), `전남 누락: ${names}`);
  assert.ok(names.includes("전북"), `전북 누락: ${names}`);
  assert.ok(!names.includes("광주")); // 자기 자신 제외
  assert.ok(!names.includes("서울"));
  assert.ok(!names.includes("제주"));
});

test("localizeRegions — 전국 나열을 현장·인근만 남기고 제외 수 집계", () => {
  const regions = splitRegions(T6_REGIONS); // 경기/전남/서울/인천/대전/광주/부산 = 7토큰
  const site = { lat: 35.15, lon: 126.92 }; // 광주
  const keywordSets = [latLonToSido(site.lat, site.lon), ...nearbySidos(site.lat, site.lon)].map(
    (s) => s.keywords,
  );
  const { local, otherCount } = localizeRegions(regions, keywordSets);
  assert.deepEqual(local, ["광주", "전라남도(담양, 장성, 화순)"]); // 현장(광주) 맨 앞 + 인근(전남)
  assert.equal(otherCount, 5); // 경기·서울·인천·대전·부산 제외분
});

test("기존 시·도 매칭 회귀 없음 — 괄호 붙은 도 단위·특별자치도 표기", () => {
  const regions = splitRegions(T6_REGIONS);
  assert.equal(regions.some((r) => regionMatchesSido(r, ["전라남", "전남"])), true);
  assert.equal(regions.some((r) => regionMatchesSido(r, ["서울"])), true);
  assert.equal(regions.some((r) => regionMatchesSido(r, ["인천"])), true);
  assert.equal(regions.some((r) => regionMatchesSido(r, ["제주"])), false);
  // 전북자치도 표기(2024~)도 head 포함 매칭.
  assert.equal(regionMatchesSido("전북자치도(진안, 장수 제외)", ["전라북", "전북"]), true);
  assert.equal(regionMatchesSido("강원특별자치도", ["강원"]), true);
});
