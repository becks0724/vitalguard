// 생체 경보의 위험 값 측정 시각 고르기 단위 테스트 — 09-29 경보 14212(도착 09:13:22 · 산소포화도 측정 09:05:38)를 고정값으로 쓴다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { dangerMeasuredAt, kstClock } from "./vital-measured-at";

// 09-29 EMP-admin3470 실제 표본 — 이 시각 행에는 산소포화도가 없고 86% 는 8분 전 측정이 겹친 것이었다.
const CASE_14212 = {
  ts: "2026-09-29T00:13:22.995Z",
  spo2MeasuredAt: "2026-09-29T00:05:38.939Z",
  heartRateMeasuredAt: "2026-09-29T00:13:02.174Z",
};

test("dangerMeasuredAt — 산소포화도 위험이면 도착 시각이 아니라 산소포화도 측정 시각", () => {
  assert.equal(dangerMeasuredAt(CASE_14212, { spo2: true, hr: false }), CASE_14212.spo2MeasuredAt);
});

test("dangerMeasuredAt — 심박만 위험이면 심박 측정 시각", () => {
  assert.equal(dangerMeasuredAt(CASE_14212, { spo2: false, hr: true }), CASE_14212.heartRateMeasuredAt);
});

test("dangerMeasuredAt — 둘 다 위험이면 산소포화도 측정 시각이 먼저(더 오래됐을 수 있는 값)", () => {
  assert.equal(dangerMeasuredAt(CASE_14212, { spo2: true, hr: true }), CASE_14212.spo2MeasuredAt);
});

test("dangerMeasuredAt — 측정 시각이 없는 옛 표본·피부온만 위험이면 종전처럼 ts", () => {
  assert.equal(dangerMeasuredAt({ ts: CASE_14212.ts }, { spo2: true, hr: true }), CASE_14212.ts);
  assert.equal(dangerMeasuredAt(CASE_14212, { spo2: false, hr: false }), CASE_14212.ts);
  assert.equal(
    dangerMeasuredAt({ ts: CASE_14212.ts, spo2MeasuredAt: null }, { spo2: true, hr: false }),
    CASE_14212.ts,
  );
});

test("kstClock — UTC 를 한국 시각 HH:mm 으로(시간대 고정) · 파싱 실패는 null", () => {
  assert.equal(kstClock(CASE_14212.spo2MeasuredAt), "09:05");
  assert.equal(kstClock("2026-09-29T15:30:00.000Z"), "00:30"); // 날짜가 넘어가는 경계
  assert.equal(kstClock("not-a-date"), null);
});
