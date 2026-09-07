// 가스포드 전원 상태 판정 — 2026-09-07 실측 곡선을 합성 시계열로 재현해 상태 전이를 고정한다.
//   · 방전 −0.114V/h · 사망 3.70V · 접속 점프 +0.34V · 충전 +0.009V/min · 분 단위 스파이크 ±0.15V
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { GASPOD_POWER_THRESHOLDS as T, gaspodPowerState, vbatToPercentMeasured } from "./gaspod-power.js";

const NOW = Date.parse("2026-09-07T07:00:00.000Z");

// 5초 표본 시계열 생성 — fn(분 전) → V. 최근이 마지막.
function series(minutes: number, fn: (minAgo: number) => number, noise = 0): { vbat: number; ts: string }[] {
  const out: { vbat: number; ts: string }[] = [];
  for (let s = minutes * 60; s >= 0; s -= 5) {
    const minAgo = s / 60;
    const n = noise ? ((s * 7919) % 100) / 100 * noise - noise / 2 : 0; // 결정적 의사 노이즈
    out.push({ vbat: Number((fn(minAgo) + n).toFixed(3)), ts: new Date(NOW - s * 1000).toISOString() });
  }
  return out;
}

test("방전 — 오늘 기울기(−0.114V/h)로 4.0V 부근이면 discharging + 남은 시간", () => {
  const r = gaspodPowerState(series(15, (m) => 4.0 + (m * 0.114) / 60), NOW);
  assert.equal(r.state, "discharging");
  assert.ok(r.slopeVpm! < T.DISCHARGE_SLOPE_VPM, `slope=${r.slopeVpm}`);
  // 4.0V 부근 5분 중앙값 ≈4.005 → 30Q 곡선 85.5 → 실측 2점 보정 (85.5−45)×2 ≈ 81
  assert.ok(r.percent! > 70 && r.percent! < 90, `pct=${r.percent}`);
  // (4.0−3.70)/0.0019 ≈ 158분
  assert.ok(r.remainingMin! > 120 && r.remainingMin! < 200, `remain=${r.remainingMin}`);
});

test("임박 — 3.75V 하강이면 critical", () => {
  const r = gaspodPowerState(series(15, (m) => 3.75 + (m * 0.3) / 60), NOW);
  assert.equal(r.state, "critical");
  assert.ok(r.remainingMin! < 40, `remain=${r.remainingMin}`);
});

test("접속 점프 — 3.70 에서 마지막 1분 4.03 이면 즉시 charging(충전 시작)", () => {
  const r = gaspodPowerState(series(15, (m) => (m < 1 ? 4.03 : 3.7)), NOW);
  assert.equal(r.state, "charging");
  assert.ok(r.jumpV! >= T.CONNECT_JUMP_V, `jump=${r.jumpV}`);
  assert.equal(r.percent, null);
});

test("충전 상승 — +0.009V/min 이면 charging", () => {
  const r = gaspodPowerState(series(15, (m) => 4.03 - m * 0.009), NOW);
  assert.equal(r.state, "charging");
});

test("CV 평탄 — 4.16V 평탄이면 full_on_power", () => {
  const r = gaspodPowerState(series(15, () => 4.16), NOW);
  assert.equal(r.state, "full_on_power");
  assert.equal(r.percent, null);
});

test("USB 단독 — 4.30V 이면 usb_only, % 없음", () => {
  const r = gaspodPowerState(series(15, () => 4.3), NOW);
  assert.equal(r.state, "usb_only");
  assert.equal(r.percent, null);
});

test("노이즈 — 방전 중 ±0.15V 스파이크가 섞여도 charging 으로 튀지 않는다", () => {
  const r = gaspodPowerState(series(15, (m) => 3.95 + (m * 0.114) / 60, 0.15), NOW);
  assert.equal(r.state, "discharging");
});

test("표본 부족 — 1분 미만이면 unknown", () => {
  const r = gaspodPowerState(series(0.5, () => 4.0), NOW);
  assert.equal(r.state, "unknown");
});

test("오래된 표본만 있으면(수신 끊김) unknown — 5분 창 밖", () => {
  const stale = series(15, () => 4.0).map((s) => ({ ...s, ts: new Date(Date.parse(s.ts) - 3_600_000).toISOString() }));
  assert.equal(gaspodPowerState(stale, NOW).state, "unknown");
});

test("실측 2점 보정 — 3.70=0 · 4.10=100 · 4.05≈90 · 3.78≈24", () => {
  assert.equal(vbatToPercentMeasured(3.7), 0);
  assert.equal(vbatToPercentMeasured(4.1), 100);
  assert.equal(vbatToPercentMeasured(4.05), 90);
  assert.equal(vbatToPercentMeasured(3.78), 24);
  assert.equal(vbatToPercentMeasured(3.5), 0); // 사망선 아래는 0 으로 고정
});
