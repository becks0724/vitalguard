// 인근 병원 유틸 단위 테스트 — 지역 도출·네이버 항목 파싱(좌표/거리)·태그 제거.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractRegion,
  parseNaverLocalItem,
  stripTags,
  formatDistance,
  haversineKm,
} from "./hospital";

test("extractRegion — 광역시 + 구", () => {
  assert.equal(extractRegion("광주광역시 동구 중앙로 196"), "광주 동구");
  assert.equal(extractRegion("서울특별시 강남구 테헤란로 1"), "서울 강남구");
});

test("extractRegion — 도 + 시(구는 무시하고 시까지)", () => {
  assert.equal(extractRegion("경기도 성남시 분당구 정자일로 1"), "경기 성남시");
  assert.equal(extractRegion("경상남도 창원시 의창구 …"), "경남 창원시");
});

test("extractRegion — 세종(시·군·구 없음) 시·도 단독", () => {
  assert.equal(extractRegion("세종특별자치시 한누리대로 2130"), "세종");
});

test("extractRegion — 강원특별자치도 단축", () => {
  assert.equal(extractRegion("강원특별자치도 춘천시 중앙로 1"), "강원 춘천시");
});

test("extractRegion — 빈 값/공백", () => {
  assert.equal(extractRegion(""), "");
  assert.equal(extractRegion("   "), "");
});

test("stripTags — <b> 강조 제거", () => {
  assert.equal(stripTags("<b>조선대학교</b>병원"), "조선대학교병원");
});

test("parseNaverLocalItem — WGS84×1e7 좌표 파싱 + 거리", () => {
  // 광주 동구 인근 좌표(경도 mapx / 위도 mapy, ×1e7 정수).
  const item = parseNaverLocalItem(
    {
      title: "<b>조선대학교</b>병원",
      category: "의료,건강>병원>종합병원",
      roadAddress: "광주광역시 동구 필문대로 365",
      mapx: "1269240000",
      mapy: "351400000",
    },
    { lat: 35.15, lon: 126.92 },
  );
  assert.equal(item.name, "조선대학교병원");
  assert.equal(item.category, "의료,건강>병원>종합병원");
  assert.ok(item.lat !== undefined && item.lon !== undefined, "한국 범위 좌표는 파싱됨");
  assert.ok(Math.abs((item.lon as number) - 126.924) < 1e-6);
  assert.ok(Math.abs((item.lat as number) - 35.14) < 1e-6);
  assert.ok(item.distanceKm !== undefined && item.distanceKm < 5, "현장 근처(수 km)");
});

test("parseNaverLocalItem — 범위 밖 좌표는 미상(거리 없음)", () => {
  // ×1e7 로 나눠도 한국 밖(구 KATECH 등) → 좌표 드롭.
  const item = parseNaverLocalItem(
    { title: "이상좌표병원", mapx: "5000000000", mapy: "5000000000" },
    { lat: 35.15, lon: 126.92 },
  );
  assert.equal(item.lat, undefined);
  assert.equal(item.lon, undefined);
  assert.equal(item.distanceKm, undefined);
});

test("formatDistance — 1km 미만 m, 이상 km", () => {
  assert.equal(formatDistance(0.42), "420m");
  assert.equal(formatDistance(3.14), "3.1km");
  assert.equal(formatDistance(undefined), "");
});

test("haversineKm — 대략적 정확도(광주 두 지점)", () => {
  const d = haversineKm(35.15, 126.92, 35.14, 126.924);
  assert.ok(d > 0.9 && d < 1.3, "약 1.1km");
});
