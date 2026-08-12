// SpO₂ 신선도 헬퍼 단위 테스트 — 갱신 구조의 표시·판정 층이 지켜야 할 경계를 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SPO2_FRESH_MS, spo2AgeMs, freshSpo2, formatSpo2Age } from "./spo2-freshness";

const NOW = Date.parse("2026-08-12T04:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

test("spo2AgeMs — 측정 시각 기준 나이, spo2 없으면 null", () => {
  assert.equal(
    spo2AgeMs({ spo2: 94, spo2MeasuredAt: iso(5 * 60_000), ts: iso(0) }, NOW),
    5 * 60_000,
  );
  assert.equal(spo2AgeMs({ ts: iso(0) }, NOW), null);
  assert.equal(spo2AgeMs(undefined, NOW), null);
});

test("spo2AgeMs — 측정 시각 없는 구 데이터는 ts(전송 시각)로 근사, 미래 시각은 0 으로 클램프", () => {
  assert.equal(spo2AgeMs({ spo2: 94, ts: iso(7 * 60_000) }, NOW), 7 * 60_000);
  assert.equal(spo2AgeMs({ spo2: 94, spo2MeasuredAt: iso(-60_000), ts: iso(0) }, NOW), 0);
});

test("freshSpo2 — 30분 경계: 이내는 값, 초과는 undefined(판정 제외)", () => {
  const fresh = { spo2: 88, spo2MeasuredAt: iso(SPO2_FRESH_MS), ts: iso(0) };
  const stale = { spo2: 88, spo2MeasuredAt: iso(SPO2_FRESH_MS + 1), ts: iso(0) };
  assert.equal(freshSpo2(fresh, NOW), 88);
  assert.equal(freshSpo2(stale, NOW), undefined);
});

test("freshSpo2 — 낡은 저산소 값이 위험 판정으로 살아남지 않는다(존재 이유)", () => {
  // 40분 전 측정된 82% — 값만 보면 danger 대역이지만 신선하지 않으므로 판정에서 빠져야 한다.
  const oldDanger = { spo2: 82, spo2MeasuredAt: iso(40 * 60_000), ts: iso(0) };
  assert.equal(freshSpo2(oldDanger, NOW), undefined);
});

test("formatSpo2Age — 방금 전 / N분 전 / N시간 전", () => {
  assert.equal(formatSpo2Age(30_000), "방금 전");
  assert.equal(formatSpo2Age(12 * 60_000), "12분 전");
  assert.equal(formatSpo2Age(90 * 60_000), "1시간 전");
});
