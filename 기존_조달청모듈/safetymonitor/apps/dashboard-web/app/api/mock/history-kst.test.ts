// buildHistory 라벨 KST 검증 — Cloud Run(서버 로컬 UTC) 에서도 24시간 뷰 버킷 라벨이 현장 시각(KST=UTC+9)으로
// 표시되는지. 수정 전에는 getHours()(UTC)로 라벨을 만들어 KST 11시가 "02:00" 으로 9시간 밀려 보였다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildHistory } from "./history/data";

test("buildHistory 24시간 — 마지막 버킷 라벨은 KST(UTC+9), UTC 아님", () => {
  const now = new Date("2026-07-07T02:20:00Z"); // UTC 02:20 = KST 11:20
  const pts = buildHistory("EMP-1", "heartRate", 1, now);
  assert.equal(pts.length, 24);
  const last = pts[pts.length - 1];
  assert.equal(last?.label, "11:00"); // KST 11시(수정 전이면 UTC "02:00")
  assert.notEqual(last?.label, "02:00");
});

test("buildHistory 24시간 — 첫 버킷은 24시간 전 KST 시각", () => {
  const now = new Date("2026-07-07T02:20:00Z");
  const pts = buildHistory("EMP-1", "spo2", 1, now);
  // i=23: (KST 11:00 = 02:00Z) - 23h = 전일 03:00Z → KST 12:00
  assert.equal(pts[0]?.label, "12:00");
});

test("buildHistory 24시간 — 마지막 버킷 date(ISO)는 절대시각 보존", () => {
  const now = new Date("2026-07-07T02:20:00Z");
  const pts = buildHistory("EMP-1", "heartRate", 1, now);
  const last = pts[pts.length - 1];
  // 라벨만 KST 표기, date 는 UTC ISO(절대시각) 유지 — 02:00Z.
  assert.equal(last?.date, "2026-07-07T02:00:00.000Z");
});
