// 산소포화도 경보 확인 열쇠 단위 테스트 — 「확인한 뒤 새로고침하면 같은 팝업이 다시 뜬다」(09-29 경보 14212)의 재현과 경계.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SPO2_ACK_KEY_TYPE, isVitalAlertAcked, spo2AckKey } from "./spo2-ack-key";

const W = "EMP-admin3470";
const AT_86 = "2026-09-29T00:05:38.939Z"; // 86% 측정
const AT_NEXT = "2026-09-29T00:32:50.806Z"; // 다음 측정
const SPO2_ONLY = { hr: false, spo2: true, core: false };
const NONE: ReadonlySet<string> = new Set();

test("재현 — 확인한 뒤 새로고침(화면 메모리 비움)해도 같은 측정의 팝업은 건너뛴다", () => {
  const key = spo2AckKey({ workerId: W, spo2MeasuredAt: AT_86 }, SPO2_ONLY);
  assert.notEqual(key, null);
  // 새로고침 직후 — 화면 메모리는 비었고 브라우저 저장에서 되살린 열쇠만 있다.
  assert.equal(isVitalAlertAcked(W, key, NONE, new Set([key!])), true);
});

test("양성 통제 — 새 측정은 열쇠가 달라 다시 울린다", () => {
  const acked = spo2AckKey({ workerId: W, spo2MeasuredAt: AT_86 }, SPO2_ONLY)!;
  const next = spo2AckKey({ workerId: W, spo2MeasuredAt: AT_NEXT }, SPO2_ONLY);
  assert.notEqual(next, acked);
  assert.equal(isVitalAlertAcked(W, next, NONE, new Set([acked])), false);
});

test("심박·체온이 함께 위험이거나 측정 시각이 없으면 열쇠 없음 — 종전 방식(화면 메모리)만", () => {
  assert.equal(spo2AckKey({ workerId: W, spo2MeasuredAt: AT_86 }, { hr: true, spo2: true, core: false }), null);
  assert.equal(spo2AckKey({ workerId: W, spo2MeasuredAt: AT_86 }, { hr: false, spo2: true, core: true }), null);
  assert.equal(spo2AckKey({ workerId: W, spo2MeasuredAt: AT_86 }, { hr: true, spo2: false, core: false }), null);
  assert.equal(spo2AckKey({ workerId: W }, SPO2_ONLY), null);
  assert.equal(spo2AckKey({ workerId: W, spo2MeasuredAt: null }, SPO2_ONLY), null);
});

test("통제 — 화면 메모리의 워커 단위 확인은 종전 그대로 건너뛴다(열쇠 없어도)", () => {
  assert.equal(isVitalAlertAcked(W, null, new Set([W]), NONE), true);
  assert.equal(isVitalAlertAcked(W, null, NONE, NONE), false);
});

test("열쇠 모양 — 되살리는 쪽이 「종류|작업자|시각」 세 칸으로 나눈다", () => {
  const key = spo2AckKey({ workerId: W, spo2MeasuredAt: AT_86 }, SPO2_ONLY)!;
  assert.deepEqual(key.split("|"), [SPO2_ACK_KEY_TYPE, W, AT_86]);
});
