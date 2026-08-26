// analyzers 단위 테스트 — node:test runner (낙상·심박이상·SOS·SpO₂·고온 각 1건 이상)
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { detectFall } from "./fall.js";
import { detectCollapse } from "./collapse.js";
import { detectHeartRateAbnormal } from "./heart-rate.js";
import { buildSosEvent } from "./sos.js";
import { detectSpo2Low } from "./spo2.js";
import { detectHyperthermia } from "./hyperthermia.js";
import { THRESHOLDS } from "./thresholds.js";

const NOW = "2026-05-21T10:00:00.000Z";

test("낙상 감지 — 가속도 3G + 무동작 30s 초과 시 danger 이벤트", () => {
  const event = detectFall({
    sample: {
      workerId: "demo01",
      ts: NOW,
      accelMagnitudeG: 3.5,
      motionStillSec: 35,
    },
  });
  assert.ok(event, "낙상 이벤트가 생성되어야 함");
  assert.equal(event.type, "fall");
  assert.equal(event.severity, "danger");
});

test("낙상 미감지 — 가속도만 높고 무동작 짧음", () => {
  const event = detectFall({
    sample: {
      workerId: "demo01",
      ts: NOW,
      accelMagnitudeG: 4.0,
      motionStillSec: 5,
    },
  });
  assert.equal(event, null);
});

test("낙상 미감지 — 무동작 누락 샘플은 null", () => {
  const event = detectFall({
    sample: { workerId: "demo01", ts: NOW, accelMagnitudeG: 3.5 },
  });
  assert.equal(event, null);
});

test("낙상 미감지 — 가속도 누락 샘플은 null", () => {
  const event = detectFall({
    sample: { workerId: "demo01", ts: NOW, motionStillSec: 35 },
  });
  assert.equal(event, null);
});

test("무충격 붕괴 감지 — 저G(충격없음) + 무동작 90s 이상이면 warning collapse", () => {
  const event = detectCollapse({
    sample: {
      workerId: "demo01",
      ts: NOW,
      accelMagnitudeG: 1.0, // 충격 없음
      motionStillSec: 95,
    },
  });
  assert.ok(event, "붕괴 후보 이벤트가 생성되어야 함");
  assert.equal(event.type, "collapse");
  assert.equal(event.severity, "warning"); // 후보 — danger 아님(확인 프롬프트 필요)
});

test("붕괴 미감지 — 고G 충격은 낙상 경로(collapse 아님)", () => {
  const event = detectCollapse({
    sample: {
      workerId: "demo01",
      ts: NOW,
      accelMagnitudeG: 3.5, // 충격 있음 → detectFall 담당
      motionStillSec: 95,
    },
  });
  assert.equal(event, null);
});

test("붕괴 미감지 — 무동작이 짧으면 null(정상 동작)", () => {
  const event = detectCollapse({
    sample: {
      workerId: "demo01",
      ts: NOW,
      accelMagnitudeG: 1.0,
      motionStillSec: 20,
    },
  });
  assert.equal(event, null);
});

test("붕괴 미감지 — 무동작/가속도 누락 샘플은 null", () => {
  assert.equal(
    detectCollapse({ sample: { workerId: "demo01", ts: NOW, accelMagnitudeG: 1.0 } }),
    null,
  );
  assert.equal(
    detectCollapse({ sample: { workerId: "demo01", ts: NOW, motionStillSec: 95 } }),
    null,
  );
});

test("심박 이상 — 최근 5초간 모두 130bpm 이상이면 warning", () => {
  const event = detectHeartRateAbnormal({
    recent: [
      { workerId: "demo01", ts: "2026-05-21T09:59:55.000Z", heartRate: 135 },
      { workerId: "demo01", ts: "2026-05-21T09:59:58.000Z", heartRate: 140 },
      { workerId: "demo01", ts: NOW, heartRate: 145 },
    ],
  });
  assert.ok(event, "심박 이상 이벤트가 생성되어야 함");
  assert.equal(event.type, "hr_abnormal");
  assert.equal(event.severity, "warning");
});

test("심박 미감지 — 임계 미만 샘플이 섞이면 트리거 안 됨", () => {
  const event = detectHeartRateAbnormal({
    recent: [
      { workerId: "demo01", ts: "2026-05-21T09:59:55.000Z", heartRate: 90 },
      { workerId: "demo01", ts: NOW, heartRate: 145 },
    ],
  });
  assert.equal(event, null);
});

test("서맥 — 최근 5초간 모두 40bpm 이하면 warning", () => {
  const event = detectHeartRateAbnormal({
    recent: [
      { workerId: "demo01", ts: "2026-05-21T09:59:55.000Z", heartRate: 38 },
      { workerId: "demo01", ts: "2026-05-21T09:59:58.000Z", heartRate: 40 },
      { workerId: "demo01", ts: NOW, heartRate: 37 },
    ],
  });
  assert.ok(event, "서맥 이벤트가 생성되어야 함");
  assert.equal(event.type, "hr_abnormal");
  assert.equal(event.severity, "warning");
});

test("서맥 미감지 — 일부만 낮으면 트리거 안 됨", () => {
  const event = detectHeartRateAbnormal({
    recent: [
      { workerId: "demo01", ts: "2026-05-21T09:59:55.000Z", heartRate: 38 },
      { workerId: "demo01", ts: NOW, heartRate: 70 },
    ],
  });
  assert.equal(event, null);
});

test("심박 미감지 — 단일 샘플은 지속 미충족으로 트리거 안 됨", () => {
  const event = detectHeartRateAbnormal({
    recent: [{ workerId: "demo01", ts: NOW, heartRate: 145 }],
  });
  assert.equal(event, null, "지속(sustain) 미강제 시 단일 샘플 오발화 방지");
});

test("SOS — 수동 호출은 즉시 danger 이벤트", () => {
  const event = buildSosEvent({ workerId: "demo01", ts: NOW });
  assert.equal(event.type, "manual_sos");
  assert.equal(event.severity, "danger");
  assert.equal(event.workerId, "demo01");
});

test("SpO₂ — 87% 단일 샘플은 즉시 danger", () => {
  const event = detectSpo2Low({
    recent: [{ workerId: "demo01", ts: NOW, spo2: 87 }],
  });
  assert.ok(event);
  assert.equal(event.type, "spo2_low");
  assert.equal(event.severity, "danger");
});

test("SpO₂ — 30s 동안 90% 지속 시 caution", () => {
  const event = detectSpo2Low({
    recent: [
      { workerId: "demo01", ts: "2026-05-21T09:59:30.000Z", spo2: 90 },
      { workerId: "demo01", ts: "2026-05-21T09:59:45.000Z", spo2: 91 },
      { workerId: "demo01", ts: NOW, spo2: 90 },
    ],
  });
  assert.ok(event);
  assert.equal(event.type, "spo2_low");
  assert.equal(event.severity, "caution");
});

test("SpO₂ 미감지 — 윈도에 정상 1건 섞이면 caution 트리거 안 됨", () => {
  const event = detectSpo2Low({
    recent: [
      { workerId: "demo01", ts: "2026-05-21T09:59:30.000Z", spo2: 90 },
      { workerId: "demo01", ts: "2026-05-21T09:59:45.000Z", spo2: 95 },
      { workerId: "demo01", ts: NOW, spo2: 90 },
    ],
  });
  assert.equal(event, null);
});

test("SpO₂ 미감지 — 단일 caution 샘플은 지속 미충족으로 트리거 안 됨", () => {
  const event = detectSpo2Low({
    recent: [{ workerId: "demo01", ts: NOW, spo2: 90 }],
  });
  assert.equal(event, null, "지속(sustain) 미강제 시 단일 샘플 오발화 방지");
});

test("SpO₂ 미감지 — 빈 입력은 null", () => {
  const event = detectSpo2Low({ recent: [] });
  assert.equal(event, null);
});

test("SpO₂ 미감지 — spo2 미측정(undefined) 샘플은 null", () => {
  const event = detectSpo2Low({
    recent: [{ workerId: "demo01", ts: NOW }],
  });
  assert.equal(event, null);
});

// ⚠ 손목 값을 리터럴로 박지 않는다 — 2026-08-26 임계 상향(37.5/38.0 → 38.0/38.5)에서 이 두
//   시험이 옛 숫자에 묶여 빨개졌다. 시험이 지키려는 것은 "37.6℃ 가 danger" 가 아니라
//   **"임계를 넘으면 danger, 그 아래 주의대면 caution"** 이다. 상수에서 역산해 계약만 고정한다.
const skinFor = (coreC: number) => coreC - THRESHOLDS.coreTemp.wristToCoreOffsetC;

test("고온 — 위험 임계를 넘긴 손목 온도는 danger", () => {
  const event = detectHyperthermia({
    sample: { workerId: "demo01", ts: NOW, skinTempC: skinFor(THRESHOLDS.coreTemp.dangerC + 0.1) },
  });
  assert.ok(event);
  assert.equal(event.type, "hyperthermia");
  assert.equal(event.severity, "danger");
});

test("고온 — 주의 임계와 위험 임계 사이는 caution", () => {
  const event = detectHyperthermia({
    sample: { workerId: "demo01", ts: NOW, skinTempC: skinFor(THRESHOLDS.coreTemp.cautionC + 0.1) },
  });
  assert.ok(event);
  assert.equal(event.severity, "caution");
});

test("고온 미감지 — 손목 36.5℃ (추정 37.0℃) 는 null", () => {
  const event = detectHyperthermia({
    sample: { workerId: "demo01", ts: NOW, skinTempC: 36.5 },
  });
  assert.equal(event, null);
});
