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

// 시·도 판정 정확도 시험지 — 채점 도시는 전부 SIDO_SEEDS 에 **넣지 않은** 곳이다.
// 시드에 있는 도시로 채점하면 자기충족이라 판정력이 0 이 된다(홀드아웃 원칙).
// 시드를 늘릴 때 이 목록의 도시를 시드로 옮기면 안 된다 — 옮기는 순간 채점 수단이 사라진다.
const HOLDOUT_CITIES: [name: string, lat: number, lon: number, sido: string][] = [
  ["경기 용인", 37.2411, 127.1776, "경기"],
  ["경기 화성", 37.1996, 126.8312, "경기"],
  ["경기 광주시", 37.4292, 127.2551, "경기"],
  ["경기 여주", 37.2982, 127.6372, "경기"],
  ["경기 동두천", 37.9036, 127.0606, "경기"],
  ["강원 동해", 37.5247, 129.1143, "강원"],
  ["강원 홍천", 37.6971, 127.8888, "강원"],
  ["충북 음성", 36.9403, 127.6906, "충북"],
  ["충남 당진", 36.8895, 126.6459, "충남"],
  ["전북 익산", 35.9483, 126.9576, "전북"],
  ["전남 광양", 34.9407, 127.696, "전남"],
  ["경북 김천", 36.1398, 128.1136, "경북"],
  ["경북 영천", 35.9733, 128.9386, "경북"],
  ["경남 사천", 35.0035, 128.0642, "경남"],
  ["경남 거제", 34.8806, 128.6212, "경남"],
  ["경남 밀양", 35.5038, 128.7465, "경남"],
  ["부산 기장", 35.2445, 129.2222, "부산"],
  ["인천 부평", 37.5074, 126.7218, "인천"],
  ["대구 달성", 35.7747, 128.4313, "대구"],
  ["울산 울주", 35.5222, 129.2422, "울산"],
  ["서울 강남", 37.5172, 127.0473, "서울"],
];

test("latLonToSido — 광역시가 인접 도(道)를 잡아먹지 않는다(다중 시드 회귀 고정)", () => {
  // 중심점 1개 시절 오판하던 대표 사례. 이 6곳이 다시 광역시로 판정되면 회귀다.
  const REGRESSED: [string, number, number, string][] = [
    ["안산", 37.3219, 126.8309, "경기"],
    ["고양", 37.6584, 126.832, "경기"],
    ["창원", 35.2281, 128.6811, "경남"],
    ["구미", 36.1196, 128.3441, "경북"],
    ["순천", 34.9506, 127.4872, "전남"],
    ["천안", 36.8151, 127.1139, "충남"],
  ];
  for (const [name, lat, lon, want] of REGRESSED) {
    assert.equal(latLonToSido(lat, lon).name, want, `${name} 오판`);
  }
});

test("latLonToSido — 홀드아웃 도시 정확도(시드 미포함 21곳)", () => {
  const wrong = HOLDOUT_CITIES.filter(([, lat, lon, want]) => latLonToSido(lat, lon).name !== want);
  const acc = (HOLDOUT_CITIES.length - wrong.length) / HOLDOUT_CITIES.length;
  // 중심점 1개 시절 58%. 경계 인접(공주·정읍·장성 계열)은 최근접 방식의 원리적 한계라 100% 는 못 간다.
  assert.ok(
    acc >= 0.85,
    `정확도 ${(acc * 100).toFixed(0)}% — 오판: ${wrong
      .map(([n, lat, lon]) => `${n}→${latLonToSido(lat, lon).name}`)
      .join(", ")}`,
  );
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
