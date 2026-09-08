// 구획 이탈 히스테리시스 단위 테스트 — 경계 플리커 미발화·연속 초과 발화·복귀 후 재발화·비정상 입력.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GEOFENCE_EXIT_STREAK,
  GEOFENCE_INITIAL,
  geofenceDistanceM,
  stepGeofence,
  type GeofenceEvent,
  type GeofenceState,
} from "./geofence";

const R = 100; // 현장 구획 반경(SITE_CIRCLE_RADIUS_M 과 동일 값)

// 거리 시퀀스를 순서대로 반영해 최종 상태와 이벤트 목록을 얻는다.
function run(dists: number[], initial: GeofenceState = GEOFENCE_INITIAL) {
  let state = initial;
  const events: GeofenceEvent[] = [];
  for (const d of dists) {
    const r = stepGeofence(state, d, R);
    state = r.state;
    if (r.event) events.push(r.event);
  }
  return { state, events };
}

test("구획 내 정상 이동은 무이벤트", () => {
  const { state, events } = run([0, 30, 80, 99, 50]);
  assert.equal(state.outside, false);
  assert.deepEqual(events, []);
});

test("경계 플리커(단발 초과 후 복귀)는 발화하지 않는다", () => {
  // GPS 지터로 반경+마진을 1~2회만 넘었다 돌아오는 패턴.
  const { state, events } = run([95, 115, 92, 118, 111, 90, 96]);
  assert.equal(state.outside, false);
  assert.deepEqual(events, []);
});

test("반경+마진 초과가 연속 3회 지속되면 exit 1회 발화", () => {
  const { state, events } = run([95, 120, 125, 130]);
  assert.equal(state.outside, true);
  assert.deepEqual(events, ["exit"]);
});

test("이탈 확정 후 지속 초과에도 재발화 없음", () => {
  const { events } = run([120, 125, 130, 140, 200, 150]);
  assert.deepEqual(events, ["exit"]);
});

test("회색지대(반경±마진)에서는 현 상태 유지 — 이탈 중 105m 는 복귀 아님", () => {
  const exited = run([120, 125, 130]);
  assert.equal(exited.state.outside, true);
  const { state, events } = run([105, 95, 92], exited.state);
  // 105·95·92 전부 복귀 임계(90m 이내) 밖 → 이탈 유지.
  assert.equal(state.outside, true);
  assert.deepEqual(events, []);
});

test("복귀(반경−마진 이내) 시 return, 재이탈 시 다시 exit", () => {
  const { state, events } = run([120, 125, 130, 85, 120, 125, 130]);
  assert.equal(state.outside, true);
  assert.deepEqual(events, ["exit", "return", "exit"]);
});

test("streak 는 이탈 후보 중단 시 리셋된다", () => {
  // 2회 초과 → 복귀 → 다시 2회 초과 = 연속 3회 미충족이라 미발화.
  const { state, events } = run([120, 125, 95, 120, 125, 95]);
  assert.equal(state.outside, false);
  assert.equal(state.exitStreak, 0);
  assert.deepEqual(events, []);
  assert.equal(GEOFENCE_EXIT_STREAK, 3);
});

test("비정상 입력(NaN 거리·0/음수 반경)은 no-op", () => {
  const outside: GeofenceState = { outside: true, exitStreak: 0 };
  assert.deepEqual(stepGeofence(GEOFENCE_INITIAL, Number.NaN, R), {
    state: GEOFENCE_INITIAL,
    event: null,
  });
  assert.deepEqual(stepGeofence(outside, 500, 0), { state: outside, event: null });
  assert.deepEqual(stepGeofence(outside, 500, -5), { state: outside, event: null });
});

test("거리(m) — 위도 0.001° ≈ 111m", () => {
  const d = geofenceDistanceM(35.15, 126.92, 35.151, 126.92);
  assert.ok(Math.abs(d - 111.2) < 1, `expected ≈111.2m, got ${d}`);
});

test("거리(m) — 동일 좌표 = 0", () => {
  assert.equal(geofenceDistanceM(35.15, 126.92, 35.15, 126.92), 0);
});

