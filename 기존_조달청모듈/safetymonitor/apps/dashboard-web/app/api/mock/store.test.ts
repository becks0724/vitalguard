// store.ts 순수 로직 단위 테스트 — reserved 필터 + mergeLatestByWorker(sticky / ts-ordering / 이벤트 비-sticky)
// + vitalDanger(안정 임계 판정) + addSample 게이트(reserved 차단 / 스키마 위반 throw).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { VitalSample } from "@safetymonitor/schemas";

import { addSample, isReservedTestWorker, mergeLatestByWorker, vitalDanger } from "./store";

const TS = "2026-06-03T10:00:00.000Z";

function s(partial: Partial<VitalSample> & { workerId: string; ts: string }): VitalSample {
  return partial as VitalSample;
}

test("isReservedTestWorker — 진단/예약 ID 는 차단, 실 작업자는 통과", () => {
  assert.equal(isReservedTestWorker("infra_check"), true);
  assert.equal(isReservedTestWorker("warmup"), true);
  assert.equal(isReservedTestWorker("test_abc"), true);
  assert.equal(isReservedTestWorker("smoke_x"), true);
  assert.equal(isReservedTestWorker("reserved_test_worker"), true);
  assert.equal(isReservedTestWorker("EMP-1024"), false);
  assert.equal(isReservedTestWorker("demo_ios_01"), false);
});

test("mergeLatestByWorker — reserved 워커는 결과에서 제외", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "reserved_test_worker", ts: "2026-06-03T10:00:00.000Z", heartRate: 80 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 75 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.workerId, "EMP-1");
});

test("mergeLatestByWorker — null 메트릭은 직전 실측값 sticky 유지", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 80, spo2: 97 }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:05.000Z" }), // 잠금 등으로 vital 미동봉
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.heartRate, 80); // 직전값 유지
  assert.equal(out[0]?.spo2, 97);
  assert.equal(out[0]?.ts, "2026-06-03T10:00:05.000Z"); // ts 는 최신
});

test("mergeLatestByWorker — 워치 backlog(역순 삽입) 시 ts 가 역행하지 않는다 (L1)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:10.000Z", heartRate: 80 }), // 최신이 먼저 삽입
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", heartRate: 60 }), // 더 오래된 backlog 가 나중 삽입
  ]);
  assert.equal(out[0]?.ts, "2026-06-03T10:00:10.000Z"); // 최신 ts 유지(역행 X)
  assert.equal(out[0]?.heartRate, 80); // 최신 샘플 값 유지
});

test("mergeLatestByWorker — 이벤트 플래그는 비-sticky(최신 샘플 값만)", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z", manualSos: true }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:05.000Z", heartRate: 80 }), // SOS 미동봉
  ]);
  assert.equal(out[0]?.manualSos, undefined); // sticky 안 됨
  assert.equal(out[0]?.heartRate, 80);
});

test("mergeLatestByWorker — 여러 워커는 workerId 정렬로 반환", () => {
  const out = mergeLatestByWorker([
    s({ workerId: "EMP-2", ts: "2026-06-03T10:00:00.000Z" }),
    s({ workerId: "EMP-1", ts: "2026-06-03T10:00:00.000Z" }),
  ]);
  assert.deepEqual(out.map((o) => o.workerId), ["EMP-1", "EMP-2"]);
});

test("vitalDanger — 안정 임계로 판정(활동 메트릭 동봉해도 작업 게이트로 가려지지 않음)", () => {
  // 심박 140 은 작업 메트릭(고활동)을 동봉해도 안정 임계(≥130)로 danger — false-negative 0.
  assert.equal(
    vitalDanger(
      s({
        workerId: "EMP-1",
        ts: TS,
        heartRate: 140,
        activeEnergyKcal: 150,
        steps: 4000,
        flightsClimbed: 20,
      }),
    ),
    true,
  );
  assert.equal(vitalDanger(s({ workerId: "EMP-1", ts: TS, spo2: 85 })), true); // dangerPct 88 미만
  assert.equal(vitalDanger(s({ workerId: "EMP-1", ts: TS, skinTempC: 38.5 })), true); // 추정 심부 39.0℃
});

test("vitalDanger — 정상치/undefined 는 위험 아님", () => {
  assert.equal(
    vitalDanger(s({ workerId: "EMP-1", ts: TS, heartRate: 75, spo2: 97, skinTempC: 35.5 })),
    false,
  );
  assert.equal(vitalDanger(undefined), false);
});

test("addSample — reserved 워커 입력은 null 반환(DB 미접근)", () => {
  // 스키마는 통과하지만 예약 ID 이므로 persist 전에 차단되어 .runtime DB 를 건드리지 않는다.
  assert.equal(addSample({ workerId: "smoke_x", ts: TS, heartRate: 80 }), null);
});

test("addSample — 스키마 위반 입력은 throw(persist 도달 전 거부)", () => {
  assert.throws(() => addSample({ ts: TS })); // workerId 누락
  assert.throws(() => addSample({ workerId: "", ts: TS })); // 빈 workerId(min 1)
});
