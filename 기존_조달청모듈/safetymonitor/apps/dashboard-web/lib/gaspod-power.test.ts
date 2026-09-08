// 가스포드 전원 상태 판정 — 실측 곡선을 합성 시계열로 재현해 상태 전이를 고정한다.
//   · 방전 −0.114V/h · 사망 3.70V · 접속 점프 +0.34V · 충전 +0.009V/min · 저전압 스파이크 5.92%
//   · 외부 전원 판별 = 평탄 지속(배터리 최장 46분 vs 어댑터 910분)
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { GASPOD_POWER_THRESHOLDS as T, gaspodPowerState, vbatToPercentMeasured } from "./gaspod-power.js";

const NOW = Date.parse("2026-09-07T07:00:00.000Z");

// 5초 표본 시계열 생성 — fn(분 전) → V. 최근이 마지막.
function series(minutes: number, fn: (minAgo: number) => number, noise = 0): { vbat: number; ts: string }[] {
  const out: { vbat: number; ts: string }[] = [];
  for (let s = minutes * 60; s >= 0; s -= 5) {
    const minAgo = s / 60;
    const n = noise ? (((s * 7919) % 100) / 100) * noise - noise / 2 : 0; // 결정적 의사 노이즈
    out.push({ vbat: Number((fn(minAgo) + n).toFixed(3)), ts: new Date(NOW - s * 1000).toISOString() });
  }
  return out;
}

// everyNth 표본마다 저전압 스파이크 — 실측은 4.14 평탄에 3.95~4.02 가 5.92% 섞였다.
function withSpikes(minutes: number, flatV: number, everyNth: number): { vbat: number; ts: string }[] {
  return series(minutes, () => flatV).map((s, i) => (i % everyNth === 0 ? { ...s, vbat: Number((flatV - 0.19).toFixed(3)) } : s));
}

// ── 창 길이 (2026-09-08 실측 근거) ─────────────────────────────────────────────
// 기울기는 60분 창이 차야 신뢰한다. 10분 창은 배터리에서도 32.8% 가 평탄으로 나와 못 가른다.
const SLOPE_MIN = 70; // 60분 창 + 여유

test("방전 — 실측 기울기(−0.114V/h)로 4.0V 부근이면 discharging + 남은 시간", () => {
  const r = gaspodPowerState(series(SLOPE_MIN, (m) => 4.0 + (m * 0.114) / 60), NOW);
  assert.equal(r.state, "discharging");
  assert.ok(r.slopeVpm! < T.DISCHARGE_SLOPE_VPM, `slope=${r.slopeVpm}`);
  // 4.0V 부근 5분 중앙값 ≈4.005 → 30Q 곡선 85.5 → 실측 2점 보정 (85.5−45)×2 ≈ 81
  assert.ok(r.percent! > 70 && r.percent! < 90, `pct=${r.percent}`);
  // (4.0−3.70)/0.0019 ≈ 158분
  assert.ok(r.remainingMin! > 120 && r.remainingMin! < 200, `remain=${r.remainingMin}`);
});

test("임박 — 3.75V 하강이면 critical", () => {
  const r = gaspodPowerState(series(SLOPE_MIN, (m) => 3.75 + (m * 0.3) / 60), NOW);
  assert.equal(r.state, "critical");
  assert.ok(r.remainingMin! < 40, `remain=${r.remainingMin}`);
});

test("접속 점프 — 3.70 에서 마지막 1분 4.03 이면 즉시 charging (창이 차기 전에 화면이 바뀐다)", () => {
  const r = gaspodPowerState(series(15, (m) => (m < 1 ? 4.03 : 3.7)), NOW);
  assert.equal(r.state, "charging");
  assert.ok(r.jumpV! >= T.CONNECT_JUMP_V, `jump=${r.jumpV}`);
  assert.equal(r.percent, null);
});

test("접속 점프 — 입력이 이미 분 중앙값이어도 잡는다 (서버 판정 경로에서 null 이었다)", () => {
  // 서버는 SQL 에서 date_trunc('minute') 으로 접어 보낸다 — 분 경계에 정렬된 1분 간격 표본.
  const rows = [];
  for (let m = 14; m >= 0; m--) {
    rows.push({ vbat: m < 1 ? 4.03 : 3.7, ts: new Date(Math.floor((NOW - m * 60_000) / 60_000) * 60_000).toISOString() });
  }
  const r = gaspodPowerState(rows, NOW);
  assert.equal(r.state, "charging", `jump=${r.jumpV}`);
});

test("충전 상승 — +0.009V/min 이면 charging", () => {
  const r = gaspodPowerState(series(SLOPE_MIN, (m) => 4.03 - m * 0.009), NOW);
  assert.equal(r.state, "charging");
});

test("USB 단독 — 4.30V 이면 usb_only, % 없음", () => {
  const r = gaspodPowerState(series(15, () => 4.3), NOW);
  assert.equal(r.state, "usb_only");
  assert.equal(r.percent, null);
});

test("표본 부족 — 5분 미만이면 unknown (개수가 아니라 시간 범위로 잰다)", () => {
  assert.equal(gaspodPowerState(series(3, () => 4.0), NOW).state, "unknown");
});

test("입력 밀도가 달라도 같은 판정 — 5초 원본과 1분 중앙값이 갈리지 않는다", () => {
  const raw = series(SLOPE_MIN, (m) => 4.0 + (m * 0.114) / 60);
  const perMinute = raw.filter((_, i) => i % 12 === 0); // 1분에 1개
  assert.equal(gaspodPowerState(raw, NOW).state, gaspodPowerState(perMinute, NOW).state);
});

test("오래된 표본만 있으면(수신 끊김) unknown — 5분 창 밖", () => {
  const stale = series(15, () => 4.0).map((s) => ({ ...s, ts: new Date(Date.parse(s.ts) - 3_600_000).toISOString() }));
  assert.equal(gaspodPowerState(stale, NOW).state, "unknown");
});

// ── ★ 외부 전원 판별 = 평탄 지속 (2026-09-08 실측) ────────────────────────────
// 전압 높이로는 못 가른다: 배터리 최대 4.08V vs 어댑터 4.03~4.14V 로 겹친다.
// 60분 기울기 하나로도 못 가른다: 평탄 판정의 28.8% 가 4.05V 미만(3.55V 에서도 평탄).
// 갈리는 것은 지속 시간 — 같은 ±0.03V 폭에서 배터리 46분 vs 어댑터 910분(약 20배).

test("★ 라이브 오판 재현 — 어댑터 물린 4.07V 평탄은 full_on_power (전압만 보면 방전과 못 가른다)", () => {
  const r = gaspodPowerState(series(150, () => 4.07), NOW);
  assert.equal(r.state, "full_on_power");
  assert.equal(r.percent, null); // 외부 전원일 땐 % 를 보이지 않는다
  assert.ok(r.flatRunMin! >= T.FLAT_RUN_EXTERNAL_MIN, `flatRun=${r.flatRunMin}`);
});

test("★ 스파이크 5.9% 가 섞여도 평탄 지속을 놓치지 않는다 (1분 중앙값이 먼저 죽인다)", () => {
  const r = gaspodPowerState(withSpikes(150, 4.135, 17), NOW);
  assert.equal(r.state, "full_on_power");
  assert.ok(Math.abs(r.slopeVpm!) < T.FLAT_SLOPE_VPM, `slope=${r.slopeVpm}`);
});

test("평탄이 짧으면 외부 전원이라 하지 않는다 — 배터리 최장 평탄 46분보다 긴 것만 인정", () => {
  const r = gaspodPowerState(series(60, () => 4.07), NOW); // 60분 < 120분
  assert.notEqual(r.state, "full_on_power");
  assert.ok(r.flatRunMin! < T.FLAT_RUN_EXTERNAL_MIN, `flatRun=${r.flatRunMin}`);
  // 하강이 확인되지 않았으므로 남은 시간을 지어내지 않는다.
  assert.equal(r.remainingMin, null);
});

test("낮은 전압에서도 오래 평탄하면 외부 전원이다 — 4.05V 미만이 평탄 판정의 28.8% 였다", () => {
  assert.equal(gaspodPowerState(series(150, () => 3.9), NOW).state, "full_on_power");
});

test("수신이 끊기면 평탄이 이어졌다고 보지 않는다", () => {
  const rows = series(150, () => 4.07).filter((s) => {
    const minAgo = (NOW - Date.parse(s.ts)) / 60_000;
    return !(minAgo > 20 && minAgo < 40); // 20분 구멍
  });
  const r = gaspodPowerState(rows, NOW);
  assert.ok(r.flatRunMin! <= 21, `구멍 너머까지 평탄으로 셌다 — flatRun=${r.flatRunMin}`);
  assert.notEqual(r.state, "full_on_power");
});

test("로버스트해도 진짜 방전은 방전이다 — 스파이크 5.9% + 실측 방전율", () => {
  const rows = withSpikes(SLOPE_MIN, 4.0, 17).map((s) => ({
    ...s,
    vbat: Number((s.vbat + ((NOW - Date.parse(s.ts)) / 60_000) * (0.114 / 60)).toFixed(3)),
  }));
  const r = gaspodPowerState(rows, NOW);
  assert.equal(r.state, "discharging");
  assert.ok(r.slopeVpm! < T.DISCHARGE_SLOPE_VPM, `slope=${r.slopeVpm}`);
});

test("노이즈 — 방전 중 ±0.15V 스파이크가 섞여도 charging 으로 튀지 않는다", () => {
  const r = gaspodPowerState(series(SLOPE_MIN, (m) => 3.95 + (m * 0.114) / 60, 0.15), NOW);
  assert.equal(r.state, "discharging");
});

test("실측 2점 보정 — 3.70=0 · 4.10=100 · 4.05≈90 · 3.78≈24", () => {
  assert.equal(vbatToPercentMeasured(3.7), 0);
  assert.equal(vbatToPercentMeasured(4.1), 100);
  assert.equal(vbatToPercentMeasured(4.05), 90);
  assert.equal(vbatToPercentMeasured(3.78), 24);
  assert.equal(vbatToPercentMeasured(3.5), 0); // 사망선 아래는 0 으로 고정
});
