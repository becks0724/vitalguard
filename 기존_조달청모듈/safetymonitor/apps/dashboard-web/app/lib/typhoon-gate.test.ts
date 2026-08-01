// 태풍 영향권 판정 단위 테스트 — 기상청 구역·반경 하이브리드 합성·예보점 선행 경보·리드타임·worst-of.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyKmaZone,
  computeGate,
  EMPTY_GATE,
  haversineKm,
  parseRadiusKm,
  pickWorst,
  tmToMs,
  type GateResult,
} from "./typhoon-gate";

const SITE = { lat: 35.15, lon: 126.92 }; // 광주 근사

test("parseRadiusKm — 문자열/빈값/0 처리", () => {
  assert.equal(parseRadiusKm("300"), 300);
  assert.equal(parseRadiusKm("0"), 0);
  assert.equal(parseRadiusKm(""), 0);
  assert.equal(parseRadiusKm(undefined), 0);
});

test("computeGate — 현장 기준 폭풍역/강풍역/접근/밖", () => {
  // 현장 바로 위 태풍(거리 0) + 폭풍반경 120 → storm
  const storm = computeGate(
    [{ tm: "t", lat: SITE.lat, lon: SITE.lon, rad15: "300", rad25: "120" }],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(storm.zone, "storm");
  assert.equal(storm.tracking, true);

  // 현장에서 ~430km(제주 남쪽 해상) + 강풍반경 500 → gale
  const gale = computeGate([{ tm: "t", lat: 31.3, lon: 126.9, rad15: "500", rad25: "0" }], 0, SITE.lat, SITE.lon);
  assert.equal(gale.zone, "gale");

  // 같은 위치(현장 ~428km) + 강풍반경 300 → 강풍역 밖·300+300(접근 마진) 안 = approach
  const appr = computeGate([{ tm: "t", lat: 31.3, lon: 126.9, rad15: "300", rad25: "0" }], 0, SITE.lat, SITE.lon);
  assert.equal(appr.zone, "approach");
  assert.equal(appr.forecast, false);

  // 원거리(하이선 실측 13.3,134.1) → 반경 축은 none 이지만 구역 축이 감시(watch)로 받친다.
  const far = computeGate([{ tm: "t", lat: 13.3, lon: 134.1, rad15: "200" }], 0, SITE.lat, SITE.lon);
  assert.equal(far.radiusZone, "none");
  assert.equal(far.zone, "watch");
  assert.equal(far.tracking, true);
});

test("computeGate — 현장 GPS 없으면 국토 중앙점 근사, 반경 미제공은 고정거리 폴백", () => {
  // 국토 기준: 한국 중앙에서 ~600km + 강풍반경 300(+버퍼 400) → gale
  const korea = computeGate([{ tm: "t", lat: 30.8, lon: 126.5, rad15: "300" }], 0);
  assert.equal(korea.zone, "gale");
  assert.equal(korea.siteKm, null);

  // 반경 미제공(0) + 현장 500km 이내 → approach 폴백
  const fb = computeGate([{ tm: "t", lat: 33.5, lon: 126.5, rad15: "0" }], 0, SITE.lat, SITE.lon);
  assert.equal(fb.zone, "approach");
});

test("computeGate — 예보점 선행 경보(바비 패턴): 현재는 반경 밖, 예보 진로가 현장 강풍권 → gale(진로 예보)", () => {
  // 현재 중국 내륙(현장 ~870km → 반경 none, 구역은 비상)이고 예보점이 현장 인근(~74km ≤ 250) → 강풍역 예보.
  const g = computeGate(
    [
      { tm: "202607130900", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재(관측)
      { tm: "202607140900", lat: 35.8, lon: 127.1, rad15: "250" }, // 예보 — 현장 ~74km ≤ 250
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.radiusZone, "none"); // 현재 위치 반경 축은 밖
  assert.equal(g.kmaZone, "emergency"); // 현재 위치 구역 축은 비상
  assert.equal(g.zone, "gale"); // 예보가 이겨 강풍역 선행 점등
  assert.equal(g.forecast, true);
  assert.equal(g.tracking, true);
  assert.equal(g.leadHours, 24); // 07-13 09시 → 07-14 09시

  // 예보점 rad15 가 명시 "0"(강풍역 소멸 예보)이면 현장 코앞이라도 반경 축 미점등(KMA 예보 존중).
  // 구역 축(위경도)은 그대로 산출되므로 현재와 동률인 emergency 에 머문다.
  const weakened = computeGate(
    [
      { tm: "1", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재 = 반경 none · 구역 emergency
      { tm: "2", lat: 35.2, lon: 126.9, rad15: "0" }, // 예보 — 현장 인근이지만 강풍역 소멸 예보
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(weakened.zone, "emergency");
  assert.equal(weakened.forecast, false);

  // 예보점 rad15 미제공(undefined)은 현재 반경 폴백으로 판정 — 현장 ~6km ≤ 300 이라 강풍역.
  const noRad = computeGate(
    [
      { tm: "1", lat: 33.5, lon: 117.7, rad15: "300" },
      { tm: "2", lat: 35.2, lon: 126.9 },
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(noRad.zone, "gale");
  assert.equal(noRad.forecast, true);

  // 예보점이 있어도 전부 반경 밖이면 구역 축(감시)만 남는다.
  const far = computeGate(
    [
      { tm: "1", lat: 13.3, lon: 134.1, rad15: "200" },
      { tm: "2", lat: 15.0, lon: 132.0, rad15: "220" },
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(far.zone, "watch");
  assert.equal(far.forecast, false);
  assert.equal(far.leadHours, null);
});

test("classifyKmaZone — 구역 경계값(포함 경계·중첩 포함 구조)", () => {
  // 비상구역 = 28°N 북쪽 AND 132°E 서쪽 (경계선 포함)
  assert.equal(classifyKmaZone(28, 132), "emergency");
  assert.equal(classifyKmaZone(35.15, 126.92), "emergency"); // 한반도 상공
  // 위도만 미달 / 경도만 초과 → 경계구역으로 내려앉는다(사각지대 없음)
  assert.equal(classifyKmaZone(27.9, 132), "alert");
  assert.equal(classifyKmaZone(30, 133), "alert");
  assert.equal(classifyKmaZone(25, 135), "alert");
  // 경계구역 밖은 전부 감시 — 발효 중인 태풍은 최소 watch 라 none 이 나오지 않는다
  assert.equal(classifyKmaZone(24.9, 135), "watch");
  assert.equal(classifyKmaZone(30, 140), "watch");
  assert.equal(classifyKmaZone(13.3, 134.1), "watch"); // 하이선 발생 초기
});

test("computeGate — 하이브리드 worst-of: 소형 태풍이 비상구역이면 반경 밖이어도 emergency", () => {
  // 강풍반경 100km 소형 태풍이 현장 ~580km — 반경 축은 none, 구역 축은 비상 → 구역이 이긴다.
  const g = computeGate([{ tm: "1", lat: 30, lon: 128, rad15: "100" }], 0, SITE.lat, SITE.lon);
  assert.equal(g.radiusZone, "none");
  assert.equal(g.kmaZone, "emergency");
  assert.equal(g.zone, "emergency");
  assert.equal(g.forecast, false);

  // 반대 — 대형 태풍이 경계구역(25°N 남쪽 아님)에 있어도 강풍역이 국토에 닿으면 반경이 이긴다.
  const big = computeGate([{ tm: "1", lat: 30.8, lon: 126.5, rad15: "300" }], 0);
  assert.equal(big.kmaZone, "emergency");
  assert.equal(big.zone, "gale");
});

test("★ computeGate — 예보 스캔은 현재가 영향권 밖이 아니어도 실행된다(구역 도입 회귀 방지)", () => {
  // 과거 구현은 `zone === "none"` 일 때만 예보를 스캔했다. 구역 축 도입 후 발효 태풍은 늘 watch 이상이라
  // 그 조건을 남겨두면 선행 경보가 영영 실행되지 않는다 — 타입 오류도 런타임 오류도 없이 조용히 죽는다.
  const g = computeGate(
    [
      { tm: "202608010900", lat: 30.0, lon: 125.0, rad15: "150" }, // 현재 = 반경 none · 구역 emergency
      { tm: "202608030300", lat: 32.0, lon: 126.5, rad15: "150" }, // 예보 — 현장 ~352km(150~450) = approach
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.radiusZone, "none");
  assert.equal(g.kmaZone, "emergency");
  assert.equal(g.zone, "approach"); // emergency(3) < approach(4) → 예보가 이김
  assert.equal(g.forecast, true);
  assert.equal(g.leadHours, 42); // 08-01 09시 → 08-03 03시 = 42시간(월·자정 경계 통과)
});

test("computeGate — 예보점 폭풍반경(rad25)까지 판정한다", () => {
  const g = computeGate(
    [
      { tm: "202608010000", lat: 20.0, lon: 130.0, rad15: "300", rad25: "100" }, // 현재 = 감시구역
      { tm: "202608040000", lat: SITE.lat, lon: SITE.lon, rad25: "120" }, // 예보 — 현장 직격
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.kmaZone, "watch");
  assert.equal(g.zone, "storm"); // 예보 진로가 폭풍역으로 현장을 덮는다
  assert.equal(g.forecast, true);
  assert.equal(g.leadHours, 72);
});

test("tmToMs — KST 통보문 시각 파싱(형식 이상은 null)", () => {
  assert.equal(tmToMs("202608010900"), Date.UTC(2026, 7, 1, 0, 0)); // KST 09시 = UTC 00시
  assert.equal(tmToMs("202601010000") !== null, true);
  assert.equal(tmToMs("샘플-1"), null);
  assert.equal(tmToMs(""), null);
  // 리드타임은 두 tm 의 차이로만 계산한다(브라우저 시계 미사용) — 자정·월 경계에서도 정확해야 한다.
  const a = tmToMs("202607312100");
  const b = tmToMs("202608010900");
  assert.equal(a !== null && b !== null ? (b - a) / 3_600_000 : null, 12);
});

test("computeGate — 현재 위치가 이미 영향권이면 forecast 플래그 없이 현재 기준 우선", () => {
  const g = computeGate(
    [
      { tm: "1", lat: 31.3, lon: 126.9, rad15: "500" }, // 현재 = gale
      { tm: "2", lat: 35.2, lon: 126.9, rad15: "300" }, // 예보(현장 직격)
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.zone, "gale");
  assert.equal(g.forecast, false);
});

test("pickWorst — 존 등급 우선, 동률이면 최근접(배열 첫 원소가 아니어도 선택)", () => {
  const mk = (zone: GateResult["zone"], siteKm: number | null, koreaKm: number | null): GateResult => ({
    ...EMPTY_GATE,
    zone,
    tracking: zone !== "none",
    siteKm,
    koreaKm,
  });
  // 두 번째가 등급 상위 → 1
  assert.equal(pickWorst([mk("approach", 400, null), mk("gale", 900, null)]), 1);
  // 등급 동률 → 최근접(두 번째)
  assert.equal(pickWorst([mk("gale", 400, null), mk("gale", 200, null)]), 1);
  // siteKm 없으면 koreaKm 폴백으로 tie-break
  assert.equal(pickWorst([mk("none", null, 2601), mk("none", null, 950)]), 1);
  // 단일 원소
  assert.equal(pickWorst([mk("storm", 10, null)]), 0);
});

test("haversineKm — 실측 검산(하이선-광주 ≈ 2,540km 급)", () => {
  const d = haversineKm(13.3, 134.1, SITE.lat, SITE.lon);
  assert.ok(d > 2400 && d < 2700, `expected ~2540, got ${d}`);
});
