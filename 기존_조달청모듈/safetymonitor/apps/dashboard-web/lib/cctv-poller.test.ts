// cctv-poller 단위 테스트 — fallen 상승 전이 감지 변환(순수 함수).
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { cctvStatsToEvent, fallenCount } from "./cctv-poller.js";

const CTX = { cameraId: "CAM-02", zone: "지하 기계실", ts: "2026-05-21T10:00:00.000Z" };

test("fallenCount — fallen 필드 우선", () => {
  assert.equal(fallenCount({ fallen: 2, total: 5 }), 2);
});

test("fallenCount — fallen 없으면 byStatus 에서 추출", () => {
  assert.equal(
    fallenCount({ byStatus: [{ status: "fallen", label: "낙상", count: 1 }] }),
    1,
  );
});

test("fallenCount — fallen 정보 없으면 0", () => {
  assert.equal(fallenCount({ total: 3 }), 0);
});

test("상승 전이(0→1) → CctvFallEvent 생성", () => {
  const e = cctvStatsToEvent({ fallen: 1, total: 3 }, 0, CTX);
  assert.ok(e);
  assert.equal(e?.status, "fallen");
  assert.equal(e?.fallenCount, 1);
  assert.equal(e?.cameraId, "CAM-02");
  assert.equal(e?.source, "poller");
});

test("변화 없음(1→1) → null(중복 이벤트 방지)", () => {
  assert.equal(cctvStatsToEvent({ fallen: 1 }, 1, CTX), null);
});

test("감소(2→1) → null(상승 전이 아님)", () => {
  assert.equal(cctvStatsToEvent({ fallen: 1 }, 2, CTX), null);
});

test("fallen 0 유지(0→0) → null", () => {
  assert.equal(cctvStatsToEvent({ fallen: 0, total: 4 }, 0, CTX), null);
});
