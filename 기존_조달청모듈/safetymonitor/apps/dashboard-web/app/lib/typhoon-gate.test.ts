// 태풍 영향권 판정 단위 테스트 — 존 경계(현장/국토·폴백)·예보점 선행 경보·worst-of 합성.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeGate,
  EMPTY_GATE,
  haversineKm,
  parseRadiusKm,
  pickWorst,
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

  // 원거리(하이선 실측 13.3,134.1) → none
  const none = computeGate([{ tm: "t", lat: 13.3, lon: 134.1, rad15: "200" }], 0, SITE.lat, SITE.lon);
  assert.equal(none.zone, "none");
  assert.equal(none.tracking, false);
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

test("computeGate — 예보점 선행 경보(바비 패턴): 현재는 밖, 예보 진로가 현장 강풍권 → approach(진로 예보)", () => {
  // 현재 중국 내륙(현장 ~870km, 강풍반경 300 → none)이지만 예보점이 북한 상공(현장 ~430km, 반경 미제공 → 현재 반경 300 폴백... 430>300 이라 미적중)
  // → 예보점을 현장 인근(전북 근처, 현장 ~100km)으로 두면 적중.
  const g = computeGate(
    [
      { tm: "202607130900", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재(관측)
      { tm: "202607140900", lat: 35.8, lon: 127.1, rad15: "250" }, // 예보 — 현장 ~74km ≤ 250
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(g.zone, "approach");
  assert.equal(g.forecast, true);
  assert.equal(g.tracking, true);

  // 예보점 rad15 가 명시 "0"(강풍역 소멸 예보)이면 현장 코앞이라도 미점등(현재 반경 폴백 금지 — KMA 예보 존중)
  const weakened = computeGate(
    [
      { tm: "1", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재 = none(현장 ~870km)
      { tm: "2", lat: 35.2, lon: 126.9, rad15: "0" }, // 예보 — 현장 인근이지만 강풍역 소멸 예보
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(weakened.zone, "none");
  assert.equal(weakened.forecast, false);

  // 예보점 rad15 미제공(undefined)은 현재 반경 폴백으로 판정
  const noRad = computeGate(
    [
      { tm: "1", lat: 33.5, lon: 117.7, rad15: "300" }, // 현재 = none
      { tm: "2", lat: 35.2, lon: 126.9 }, // 예보 — 반경 미제공 → 현재 300 폴백, 현장 ~6km ≤ 300
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(noRad.zone, "approach");
  assert.equal(noRad.forecast, true);

  // 예보점이 있어도 전부 영향권 밖이면 none 유지
  const far = computeGate(
    [
      { tm: "1", lat: 13.3, lon: 134.1, rad15: "200" },
      { tm: "2", lat: 15.0, lon: 132.0, rad15: "220" },
    ],
    0,
    SITE.lat,
    SITE.lon,
  );
  assert.equal(far.zone, "none");
  assert.equal(far.forecast, false);
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
