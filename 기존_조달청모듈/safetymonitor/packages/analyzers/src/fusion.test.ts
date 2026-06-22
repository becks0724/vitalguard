// fusion 결합 판정 단위 테스트 — node:test runner. 설계 fusion-design.md §13 검증 시나리오 T1~T12.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { decideFusion, timeMatched, zoneCompatible, type FusionInputs } from "./fusion.js";

const T_WATCH = "2026-05-21T10:00:00.000Z";
const T_VISION_NEAR = "2026-05-21T10:00:05.000Z"; // +5s (윈도 안)
const T_VISION_FAR = "2026-05-21T10:01:30.000Z"; // +90s (윈도 밖)
const ZONE = "지하 기계실";

// 기본 입력 — 각 테스트가 필요한 부분만 덮어쓴다(둘 다 미감지·available 기준).
function base(): FusionInputs {
  return {
    watch: {
      confirmed: false,
      candidate: false,
      workerId: "EMP-9001",
      zone: ZONE,
      ts: T_WATCH,
      availability: "available",
    },
    vision: {
      fallen: false,
      lying: false,
      cameraId: "CAM-02",
      zone: ZONE,
      ts: T_VISION_NEAR,
      availability: "available",
    },
  };
}

test("T1 — 워치 확정 + 영상 fallen 정합 + zone호환 → confirmed", () => {
  const i = base();
  i.watch.confirmed = true;
  i.vision.fallen = true;
  const d = decideFusion(i);
  assert.equal(d.stage, "confirmed");
  assert.deepEqual(d.target, { kind: "worker", workerId: "EMP-9001" });
  assert.ok(d.basis.includes("vision.fallen"));
});

test("T2 — 워치 확정 + 영상 unavailable → danger_watch(깎지 않음)", () => {
  const i = base();
  i.watch.confirmed = true;
  i.vision.fallen = true; // fallen 이어도
  i.vision.availability = "unavailable";
  const d = decideFusion(i);
  assert.equal(d.stage, "danger_watch");
});

test("T3 — 워치 확정 + 영상 blind → danger_watch(부재≠음성)", () => {
  const i = base();
  i.watch.confirmed = true;
  i.vision.availability = "blind";
  const d = decideFusion(i);
  assert.equal(d.stage, "danger_watch");
});

test("T4 — 워치 확정 + 영상 standing(상충) → danger_watch(워치 음성화 금지)", () => {
  const i = base();
  i.watch.confirmed = true;
  i.vision.fallen = false;
  i.vision.lying = false; // standing 상태
  const d = decideFusion(i);
  assert.equal(d.stage, "danger_watch");
});

test("T5 — 영상 fallen 단독 + 워치 부재 → warning_zone(대상 미특정)", () => {
  const i = base();
  i.watch.availability = "unavailable";
  i.vision.fallen = true;
  const d = decideFusion(i);
  assert.equal(d.stage, "warning_zone");
  assert.deepEqual(d.target, { kind: "zone", cameraId: "CAM-02" });
});

test("T6 — 영상 lying 단독 → suspect(앉기/눕기 오인 방지)", () => {
  const i = base();
  i.watch.availability = "unavailable";
  i.vision.lying = true;
  const d = decideFusion(i);
  assert.equal(d.stage, "suspect");
});

test("T7 — 워치 확정 + 영상 fallen 시간창 밖 → danger_watch(confirmed 아님)", () => {
  const i = base();
  i.watch.confirmed = true;
  i.vision.fallen = true;
  i.vision.ts = T_VISION_FAR;
  const d = decideFusion(i);
  assert.equal(d.stage, "danger_watch");
});

test("T8 — 워치 stale + 영상 fallen → warning_zone(confirmed 아님)", () => {
  const i = base();
  // 워치가 stale 이고 confirmed/candidate 둘 다 아니면, 영상 단독 트랙으로 떨어진다.
  i.watch.availability = "stale";
  i.vision.fallen = true;
  const d = decideFusion(i);
  assert.equal(d.stage, "warning_zone");
});

test("T9 — 양측 음성/없음 → none(오발화 0)", () => {
  const d = decideFusion(base());
  assert.equal(d.stage, "none");
});

test("T10 — 워치 후보 + 영상 fallen 정합 + zone호환 → confirmed(조기격상)", () => {
  const i = base();
  i.watch.candidate = true;
  i.vision.fallen = true;
  const d = decideFusion(i);
  assert.equal(d.stage, "confirmed");
  assert.equal(d.earlyEscalated, true);
  assert.ok(d.recommendedActions.includes("alert.record"));
});

test("T11 — 워치 후보 + 영상 부재 → none(워치 자체 프롬프트 유지)", () => {
  const i = base();
  i.watch.candidate = true;
  i.vision.availability = "unavailable";
  const d = decideFusion(i);
  assert.equal(d.stage, "none");
  assert.ok(d.basis.includes("watch.candidate.pendingPrompt"));
});

test("T12 — 워치 확정 + 영상 fallen 정합이나 zone 불명 → danger_watch(오귀속 방지)", () => {
  const i = base();
  i.watch.confirmed = true;
  i.vision.fallen = true;
  i.vision.zone = undefined; // zone 매핑 없음 → zoneCompatible=false
  const d = decideFusion(i);
  assert.equal(d.stage, "danger_watch");
});

test("timeMatched — ts 누락 시 false(시각 없으면 매칭 안 함)", () => {
  const i = base();
  i.watch.ts = undefined;
  assert.equal(timeMatched(i), false);
});

test("zoneCompatible — 한쪽 zone 없으면 false(unknown 취급)", () => {
  const i = base();
  i.vision.zone = undefined;
  assert.equal(zoneCompatible(i), false);
});

// 코덱스 R(슬라이스1+2) 지적 — 워치 후보가 영상 단독 경보를 먹어선 안 된다(두 트랙 분리).
test("T13 — 워치 후보 + 영상 fallen + zone불명(비확증) → warning_zone(영상 경보 보존)", () => {
  const i = base();
  i.watch.candidate = true;
  i.vision.fallen = true;
  i.vision.zone = undefined; // zoneCompatible=false → 비확증
  const d = decideFusion(i);
  assert.equal(d.stage, "warning_zone");
  assert.deepEqual(d.target, { kind: "zone", cameraId: "CAM-02" });
});

test("T14 — 워치 후보 + 영상 lying(비확증) → suspect(후보가 약신호도 안 먹음)", () => {
  const i = base();
  i.watch.candidate = true;
  i.vision.lying = true; // fallen 아님 → 비확증
  const d = decideFusion(i);
  assert.equal(d.stage, "suspect");
});

test("timeMatched — 음수 시간차(영상이 워치보다 이른 시각)도 preSec 안이면 true", () => {
  const i = base();
  i.watch.ts = "2026-05-21T10:00:08.000Z";
  i.vision.ts = "2026-05-21T10:00:00.000Z"; // diff=-8s, preSec=10 안
  assert.equal(timeMatched(i), true);
});

test("timeMatched — 영상이 preSec 보다 더 이른 시각이면 false(경계 밖)", () => {
  const i = base();
  i.watch.ts = "2026-05-21T10:00:15.000Z";
  i.vision.ts = "2026-05-21T10:00:00.000Z"; // diff=-15s, preSec=10 밖
  assert.equal(timeMatched(i), false);
});
