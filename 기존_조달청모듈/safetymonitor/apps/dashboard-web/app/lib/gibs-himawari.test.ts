// GIBS Himawari 타일 URL·시각 계산 단위 테스트 — 줌 상한(빈 타일 구간)과 10분 내림을 고정한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOUD_LAYERS,
  GIBS_LAG_MS,
  cloudTileUrl,
  cloudZoomFor,
  gibsTimeFor,
} from "./gibs-himawari";

const IR = CLOUD_LAYERS[0]!;
const VIS = CLOUD_LAYERS[1]!;

test("타일 시각 — 70분 지연 + 10분 내림", () => {
  // 2026-08-06T07:36Z 기준 → 06:26 → 내림 06:20
  assert.equal(gibsTimeFor(Date.UTC(2026, 7, 6, 7, 36)), "2026-08-06T06:20:00Z");
  // 정각 경계 — 08:00 → 06:50
  assert.equal(gibsTimeFor(Date.UTC(2026, 7, 6, 8, 0)), "2026-08-06T06:50:00Z");
});

test("타일 시각 — 날짜·월 경계를 넘겨도 UTC 로 정확", () => {
  assert.equal(gibsTimeFor(Date.UTC(2026, 7, 1, 0, 30)), "2026-07-31T23:20:00Z");
});

test("지연 상수는 실측 근거(현재-50분 빈 타일 / -70분 실데이터)", () => {
  assert.equal(GIBS_LAG_MS, 70 * 60 * 1000);
});

test("타일 URL — z/y/x 순서(WMTS 는 x/y 가 아니다)", () => {
  const u = cloudTileUrl(IR, "2026-08-06T06:20:00Z", 4, 13, 6);
  assert.ok(u);
  assert.ok(u.endsWith("/GoogleMapsCompatible_Level6/4/6/13.png"), u);
  assert.ok(u.includes("Himawari_AHI_Band13_Clean_Infrared"));
});

test("줌 상한을 넘으면 null — 빈 타일(HTTP 200 · 400B)이 조용히 깔리지 않게", () => {
  assert.equal(cloudTileUrl(IR, "T", 6, 0, 0) === null, false); // 상한 정확히 = 허용
  assert.equal(cloudTileUrl(IR, "T", 7, 0, 0), null);
  assert.equal(cloudTileUrl(VIS, "T", 7, 0, 0) === null, false);
  assert.equal(cloudTileUrl(VIS, "T", 8, 0, 0), null);
});

test("레이어마다 다른 TileMatrixSet — 섞으면 빈 타일이 온다", () => {
  assert.equal(IR.matrixSet, "GoogleMapsCompatible_Level6");
  assert.equal(VIS.matrixSet, "GoogleMapsCompatible_Level7");
  assert.notEqual(IR.matrixSet, VIS.matrixSet);
});

test("버튼 순환 순서 — 적외가 먼저(야간에도 나오는 쪽)", () => {
  assert.equal(CLOUD_LAYERS[0]?.key, "ir");
  assert.equal(CLOUD_LAYERS[1]?.key, "vis");
});

test("업스케일 — 상한 이하는 1배, 넘으면 상한 타일을 2^n 배로", () => {
  assert.deepEqual(cloudZoomFor(IR, 4), { z: 4, scale: 1 });
  assert.deepEqual(cloudZoomFor(IR, 6), { z: 6, scale: 1 });
  assert.deepEqual(cloudZoomFor(IR, 7), { z: 6, scale: 2 });
  assert.deepEqual(cloudZoomFor(IR, 9), { z: 6, scale: 8 });
  // 상한이 한 단계 높은 가시광은 같은 줌에서 배율이 절반이다.
  assert.deepEqual(cloudZoomFor(VIS, 8), { z: 7, scale: 2 });
});

test("업스케일 줌은 항상 URL 이 나오는 구간 — 빈 타일을 만들지 않는다", () => {
  for (let zoom = 2; zoom <= 11; zoom++) {
    const { z } = cloudZoomFor(IR, zoom);
    assert.ok(cloudTileUrl(IR, "T", z, 0, 0) !== null, `zoom ${zoom} → z ${z}`);
  }
});
