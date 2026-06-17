// VitalSampleSchema 단위 테스트 — 수신 게이트의 필수 필드·경계값 회귀 방지
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { VitalSampleSchema } from "./vital-stream.ts";

const TS = "2026-06-03T10:00:00.000Z";

test("최소 유효 샘플(workerId+ts)은 통과한다", () => {
  const r = VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS });
  assert.equal(r.success, true);
});

test("workerId 누락은 거부한다", () => {
  assert.equal(VitalSampleSchema.safeParse({ ts: TS }).success, false);
});

test("빈 workerId(min 1)는 거부한다", () => {
  assert.equal(VitalSampleSchema.safeParse({ workerId: "", ts: TS }).success, false);
});

test("ts 누락은 거부한다", () => {
  assert.equal(VitalSampleSchema.safeParse({ workerId: "EMP-1" }).success, false);
});

test("datetime 형식이 아닌 ts는 거부한다", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: "2026-06-03" }).success,
    false,
  );
});

test("heartRate 경계 — 20~250 안은 통과, 밖은 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, heartRate: 250 }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, heartRate: 19 }).success,
    false,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, heartRate: 300 }).success,
    false,
  );
});

test("spo2 경계 — 50~100 안은 통과, 밖은 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, spo2: 50 }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, spo2: 49 }).success,
    false,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, spo2: 101 }).success,
    false,
  );
});

test("skinTempC 경계 — 20~45 안은 통과, 밖은 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, skinTempC: 36.5 }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, skinTempC: 50 }).success,
    false,
  );
});

test("latitude/longitude 경계는 -90~90 / -180~180", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, latitude: 91 }).success,
    false,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, longitude: 181 }).success,
    false,
  );
});

test("skinTempC 하한 — 20 미만은 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, skinTempC: 19 }).success,
    false,
  );
});

test("manualSos 는 boolean — 문자열 'yes'는 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, manualSos: "yes" }).success,
    false,
  );
});

test("fallDecision enum — 'fall'은 통과, 'bogus'는 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, fallDecision: "fall" }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, fallDecision: "bogus" }).success,
    false,
  );
});

test("fall HR 궤적 필드 — candidate/followup 페이즈와 UUID는 통과", () => {
  assert.equal(
    VitalSampleSchema.safeParse({
      workerId: "EMP-1",
      ts: TS,
      fallCandidateId: "123e4567-e89b-12d3-a456-426614174000",
      fallUpdatePhase: "candidate",
      hrPreMean10s: 82.4,
      hrAtImpact: 88,
      hrPostMean30s: 96.5,
      hrPostPeak30s: 104,
      hrDeltaMean: 14.1,
      hrDeltaPeak: 21.6,
    }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({
      workerId: "EMP-1",
      ts: TS,
      fallCandidateId: "not-a-uuid",
      fallUpdatePhase: "later",
    }).success,
    false,
  );
});

test("fall 확인 프롬프트 결과 — outcome/responseSec 는 통과", () => {
  assert.equal(
    VitalSampleSchema.safeParse({
      workerId: "EMP-1",
      ts: TS,
      fallCandidateId: "123e4567-e89b-12d3-a456-426614174000",
      fallUpdatePhase: "prompt_result",
      fallPromptOutcome: "auto_escalated",
      fallPromptResponseSec: 18.4,
    }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({
      workerId: "EMP-1",
      ts: TS,
      fallPromptOutcome: "unknown",
      fallPromptResponseSec: -1,
    }).success,
    false,
  );
});

test("peakRotationRadS 경계 — 0~50 안은 통과, 초과는 거부", () => {
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, peakRotationRadS: 50 }).success,
    true,
  );
  assert.equal(
    VitalSampleSchema.safeParse({ workerId: "EMP-1", ts: TS, peakRotationRadS: 51 }).success,
    false,
  );
});
