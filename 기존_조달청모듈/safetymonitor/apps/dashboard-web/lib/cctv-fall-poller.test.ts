// CCTV 낙상 폴러 → 융합 판정 E2E(순수 파이프라인) — 폴러가 만드는 이벤트를 decideFusion 이
// ingestCctvEvent 와 동일하게 처리했을 때 나오는 판정을 검증한다. DB 무접촉(L-04).
// 시나리오: (A) 폴러 상승전이 (B) 워치+CCTV·zone 미지정 → danger_watch (C) zone 일치 → confirmed
//          (D) CCTV 단독(워치 없음) → warning_zone.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { decideFusion, type FusionInputs } from "@safetymonitor/analyzers";
import type { CctvFallEvent } from "@safetymonitor/schemas";

import { isPollableUrl } from "./cctv-fall-poller.js";
import { cctvStatsToEvent } from "./cctv-poller.js";

const VISION_TS = "2026-05-21T10:00:05.000Z"; // 영상 관측
const WATCH_TS = "2026-05-21T10:00:00.000Z"; // 워치 낙상(5초 전 — ±10/15초 창 안)

// ingestCctvEvent 와 동일한 vision 입력 구성.
function visionFrom(event: CctvFallEvent): FusionInputs["vision"] {
  return {
    fallen: event.status === "fallen" || (event.fallenCount ?? 0) > 0,
    lying: event.status === "lying",
    cameraId: event.cameraId,
    zone: event.zone,
    ts: event.ts,
    availability: "available",
  };
}

test("isPollableUrl — 서버에서 폴링 가능한 절대 URL 만 통과", () => {
  assert.equal(isPollableUrl("https://cctv-ai-569797426568.asia-northeast3.run.app"), true);
  assert.equal(isPollableUrl("http://localhost:8000"), true);
  // ★ 회귀 고정 — 브라우저 프록시 경로는 서버 fetch 에서 Invalid URL 이라 폴러가 무한 실패했다.
  assert.equal(isPollableUrl("/ai-cctv"), false);
  assert.equal(isPollableUrl("localhost:8000"), false); // 스킴 없음
  assert.equal(isPollableUrl(""), false);
  assert.equal(isPollableUrl("   "), false);
});

test("A. 폴러 — fallen 상승전이에서만 이벤트 생성", () => {
  const ctx = { cameraId: "CAM-02", ts: VISION_TS };
  // 0 → 1 : 상승전이 = 이벤트
  const up = cctvStatsToEvent({ fallen: 1, total: 3 }, 0, ctx);
  assert.ok(up, "0→1 상승은 이벤트여야 함");
  assert.equal(up?.status, "fallen");
  assert.equal(up?.fallenCount, 1);
  // 1 → 1 : 유지 = 이벤트 없음(중복 방지)
  assert.equal(cctvStatsToEvent({ fallen: 1 }, 1, ctx), null);
  // 1 → 0 : 하강 = 이벤트 없음
  assert.equal(cctvStatsToEvent({ fallen: 0 }, 1, ctx), null);
});

test("B. 워치 낙상 + CCTV, zone 미지정 → danger_watch (워치 경보·영상 흡수)", () => {
  const event = cctvStatsToEvent({ fallen: 1 }, 0, { cameraId: "CAM-02", ts: VISION_TS })!;
  const watch: FusionInputs["watch"] = {
    confirmed: true,
    candidate: false,
    workerId: "EMP-6861",
    zone: undefined, // 미지정
    ts: WATCH_TS,
    availability: "available",
  };
  const d = decideFusion({ watch, vision: visionFrom(event) });
  assert.equal(d.stage, "danger_watch");
  assert.equal(d.target.kind, "worker");
  assert.deepEqual(d.recommendedActions.includes("sos.modal"), true);
});

test("C. 워치 낙상 + CCTV, zone 일치(시드 시) → confirmed(0.95)", () => {
  const event = cctvStatsToEvent({ fallen: 1 }, 0, {
    cameraId: "CAM-02",
    zone: "지하 기계실",
    ts: VISION_TS,
  })!;
  const watch: FusionInputs["watch"] = {
    confirmed: true,
    candidate: false,
    workerId: "EMP-6861",
    zone: "지하 기계실", // setWorkerZone 로 시드된 경우
    ts: WATCH_TS,
    availability: "available",
  };
  const d = decideFusion({ watch, vision: visionFrom(event) });
  assert.equal(d.stage, "confirmed");
  assert.equal(d.confidence, 0.95);
  assert.deepEqual(d.recommendedActions.includes("alert.record"), true);
});

test("D. CCTV 단독(워치 없음) → warning_zone (구역 위험)", () => {
  const event = cctvStatsToEvent({ fallen: 1 }, 0, { cameraId: "CAM-02", ts: VISION_TS })!;
  const watch: FusionInputs["watch"] = {
    confirmed: false,
    candidate: false,
    availability: "unavailable",
  };
  const d = decideFusion({ watch, vision: visionFrom(event) });
  assert.equal(d.stage, "warning_zone");
  assert.equal(d.target.kind, "zone");
});
