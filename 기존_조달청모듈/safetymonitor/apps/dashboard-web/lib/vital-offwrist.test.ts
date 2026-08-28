// 벗음 의심 순수 함수 시험 — 평평/잡음/희소/부분/경계
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  OFFWRIST_LABEL,
  OFFWRIST_MASD_MAX,
  OFFWRIST_SD_MAX,
  OFFWRIST_WINDOW_MS,
  flatWindowCount,
  offWristSuspect,
  windowFlat,
  type HrPoint,
} from "./vital-offwrist";
import { STILL_LABEL } from "./vital-still";
import { STALE_LABEL } from "./vital-age";

const NOW = 1_800_000_000_000;
/** stepMs 간격으로 minutes 분치 표본. bpm 은 패턴을 순환. 최신 표본이 NOW. */
function series(minutes: number, pattern: number[], stepMs = 5_000, endMs = NOW): HrPoint[] {
  const n = Math.floor((minutes * 60_000) / stepMs);
  return Array.from({ length: n }, (_, i) => ({ tsMs: endMs - (n - 1 - i) * stepMs, bpm: pattern[i % pattern.length] ?? 0 }));
}
const FLAT = [90, 90, 91, 90, 90, 91]; // sd≈0.47 · masd≈0.4
const NOISY = [80, 90, 100, 90]; // sd≈7 · masd=10

test("평평 15분 → 의심 · flatMs = 창 3개", () => {
  const r = offWristSuspect(series(15, FLAT), NOW);
  assert.ok(r); assert.equal(r.label, OFFWRIST_LABEL); assert.equal(r.flatMs, 3 * OFFWRIST_WINDOW_MS);
});

test("잡음 15분 → 없음", () => {
  assert.equal(offWristSuspect(series(15, NOISY), NOW), undefined);
  assert.equal(flatWindowCount(series(15, NOISY), NOW), 0);
});

test("희소(갤럭시 120초 주기) → 판정 불가 · 의심 없음 — 평평해도", () => {
  const sparse = series(30, [90, 90, 90], 120_000);
  assert.equal(windowFlat(sparse, NOW), undefined);
  assert.equal(offWristSuspect(sparse, NOW), undefined);
});

test("최근 2창만 평평, 3번째가 잡음 → 없음 (count 2)", () => {
  const recent = series(10, FLAT);
  const older = series(5, NOISY, 5_000, NOW - 10 * 60_000);
  const pts = [...older, ...recent];
  assert.equal(flatWindowCount(pts, NOW), 2);
  assert.equal(offWristSuspect(pts, NOW), undefined);
});

test("잡음 뒤 평평 3창 → 의심 (오래된 잡음은 상관없다)", () => {
  const recent = series(15, FLAT);
  const older = series(15, NOISY, 5_000, NOW - 15 * 60_000);
  assert.ok(offWristSuspect([...older, ...recent], NOW));
});

test("경계 — SD·연속차가 정확히 상한이면 평평(≤)", () => {
  // 90/95 교대: sd = 2.5, masd = 5 → masd 초과. 별도로 masd 만 경계: 90,91 교대 sd 0.5 · masd 1.0.
  assert.equal(windowFlat(series(5, [90, 91]), NOW), true, "masd = 1.0 은 포함");
  assert.equal(OFFWRIST_MASD_MAX, 1.0); assert.equal(OFFWRIST_SD_MAX, 2.5);
  // sd 초과: 85/95 교대 sd 5.
  assert.equal(windowFlat(series(5, [85, 95]), NOW), false);
});

test("정렬 무관 — 뒤섞인 입력도 같은 판정", () => {
  const pts = series(15, FLAT).reverse();
  assert.ok(offWristSuspect(pts, NOW));
});

test("라벨은 기존 라벨과 다르다", () => {
  assert.notEqual(OFFWRIST_LABEL, STILL_LABEL);
  assert.notEqual(OFFWRIST_LABEL, STALE_LABEL.disconnected);
  assert.notEqual(OFFWRIST_LABEL, STALE_LABEL.hrSilent);
  assert.notEqual(OFFWRIST_LABEL, "수신 중");
});
