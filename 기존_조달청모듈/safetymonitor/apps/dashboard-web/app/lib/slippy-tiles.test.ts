// 슬리피맵 좌표 변환 단위 테스트 — 왕복 복원·줌 배율·타일 경계·축척(km→px).
// 태풍 지도와 레이더 지도가 이 변환을 공유하므로, 어긋나면 두 지도가 다른 위치를 가리킨다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TILE,
  kmToPx,
  latToWorldY,
  lonToWorldX,
  worldXToLon,
  worldYToLat,
} from "./slippy-tiles";

const near = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("경도 왕복 — 변환 후 되돌리면 원래 값", () => {
  for (const z of [2, 6, 11]) {
    for (const lon of [-180, -37.5, 0, 127.85, 180]) {
      near(worldXToLon(lonToWorldX(lon, z), z), lon, 1e-9);
    }
  }
});

test("위도 왕복 — 변환 후 되돌리면 원래 값", () => {
  for (const z of [2, 6, 11]) {
    for (const lat of [-70, -33.4, 0, 35.85, 38.7, 70]) {
      near(worldYToLat(latToWorldY(lat, z), z), lat, 1e-9);
    }
  }
});

test("원점·중앙 기준점", () => {
  // 경도 -180 = 월드 왼쪽 끝(0), 경도 0 = 한가운데, 위도 0(적도) = 세로 한가운데.
  near(lonToWorldX(-180, 0), 0);
  near(lonToWorldX(0, 0), TILE / 2);
  near(latToWorldY(0, 0), TILE / 2);
});

test("줌 한 단계 = 좌표 2배", () => {
  const z = 5;
  near(lonToWorldX(127.85, z + 1), lonToWorldX(127.85, z) * 2, 1e-9);
  near(latToWorldY(35.85, z + 1), latToWorldY(35.85, z) * 2, 1e-9);
});

test("한국 bbox — 북쪽이 위(작은 y), 동쪽이 오른쪽(큰 x)", () => {
  const z = 7;
  assert.ok(latToWorldY(38.7, z) < latToWorldY(33.0, z));
  assert.ok(lonToWorldX(124.5, z) < lonToWorldX(131.2, z));
});

test("타일 인덱스 — 월드 좌표를 TILE 로 나눈 몫", () => {
  const z = 6;
  // 한국 서쪽 끝(124.5°E)이 속한 타일 x 는 z6 에서 54번.
  assert.equal(Math.floor(lonToWorldX(124.5, z) / TILE), 54);
  assert.equal(Math.floor(latToWorldY(38.7, z) / TILE), 24);
});

test("kmToPx — 줌이 오르면 같은 거리가 더 많은 픽셀", () => {
  const a = kmToPx(100, 35.85, 6);
  const b = kmToPx(100, 35.85, 7);
  near(b, a * 2, 1e-9);
  assert.ok(a > 0);
});

test("kmToPx — 고위도일수록 같은 거리가 더 많은 픽셀(메르카토르 축척)", () => {
  assert.ok(kmToPx(100, 60, 6) > kmToPx(100, 35.85, 6));
  assert.ok(kmToPx(100, 35.85, 6) > kmToPx(100, 0, 6));
});
