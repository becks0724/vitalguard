// 저활동·고심박 패턴(온열 ②) 단위 테스트 — 판정 불가(null)/정상(false)/주석(true) 세 상태의 경계 고정.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  detectLowActivityHighHr,
  HEAT_PATTERN_WINDOW_MIN,
  HEAT_PATTERN_MIN_COVERED_MIN,
  HEAT_PATTERN_HR_BPM,
  HEAT_PATTERN_LOW_KCAL_PER_MIN,
  type HrEnergyPoint,
} from "./heat-pattern";

const NOW = Date.parse("2026-08-13T04:00:00.000Z");

// minutesAgo 분 전 시각의 분 안에 hr 1건(+선택 ae)을 만든다 — 분 경계 중앙(+30s)에 놓아 버킷이 명확.
function pt(minutesAgo: number, hr?: number, aeKcal?: number): HrEnergyPoint {
  return { tsMs: NOW - minutesAgo * 60_000 - 30_000, hr, aeKcal };
}

// 창(15분) 안 minutes 개 분을 hr·분당 ae 로 채운다(최근 분부터).
function fill(minutes: number, hr: number, aePerMin?: number): HrEnergyPoint[] {
  const out: HrEnergyPoint[] = [];
  for (let m = 0; m < minutes; m += 1) out.push(pt(m, hr, aePerMin));
  return out;
}

test("주석(true) — 고심박 지속 + 저활동(휴식 수준 소모)", () => {
  const res = detectLowActivityHighHr(fill(15, 105, 0.8), NOW);
  assert.ok(res);
  assert.equal(res.flagged, true);
  assert.equal(res.hrAvg, 105);
  assert.equal(res.coveredMinutes, 15);
  assert.ok(Math.abs(res.aeKcalPerMin - 0.8) < 0.01);
});

test("정상(false) — 같은 고심박이라도 활동 소모가 높으면 운동성(주석 없음)", () => {
  const res = detectLowActivityHighHr(fill(15, 110, 4.5), NOW);
  assert.ok(res);
  assert.equal(res.flagged, false);
});

test("정상(false) — 저활동이어도 심박이 낮으면 휴식(주석 없음)", () => {
  const res = detectLowActivityHighHr(fill(15, 88, 0.3), NOW);
  assert.ok(res);
  assert.equal(res.flagged, false);
});

test("판정 불가(null) — 활동 에너지 파이프라인 없는 워커(구 앱·권한 미허용)는 주석 대상 아님", () => {
  const res = detectLowActivityHighHr(fill(15, 120, undefined), NOW);
  assert.equal(res, null);
});

test("주석(true) — 창 안 에너지 0건이어도 창 밖(조회 구간)에 ae 가 있으면 '완전 휴식'으로 센다", () => {
  // 15분 내내 쉬면 증분 0.01kcal 미만 = 워치가 ae 항목을 아예 안 싣는 것이 정상 동작.
  const points = [
    ...fill(15, 108, undefined),
    pt(HEAT_PATTERN_WINDOW_MIN + 10, 95, 0.4), // 25분 전 — 파이프라인 존재 증거
  ];
  const res = detectLowActivityHighHr(points, NOW);
  assert.ok(res);
  assert.equal(res.flagged, true);
  assert.equal(res.aeKcalPerMin, 0);
});

test("판정 불가(null) — 심박 커버 분이 하한 미만이면 지속성 판단 불가", () => {
  const res = detectLowActivityHighHr(fill(HEAT_PATTERN_MIN_COVERED_MIN - 1, 110, 0.5), NOW);
  assert.equal(res, null);
});

test("경계 포함 — 평균 정확히 100bpm·정확히 1.5kcal/분이면 주석(보수 방향)", () => {
  const res = detectLowActivityHighHr(
    fill(15, HEAT_PATTERN_HR_BPM, HEAT_PATTERN_LOW_KCAL_PER_MIN),
    NOW,
  );
  assert.ok(res);
  assert.equal(res.flagged, true);
});

test("오측 가드 — 범위 밖 bpm(>220)은 버킷에 들어가지 않아 커버 분에서 빠진다", () => {
  const garbage = fill(15, 250, 0.5); // 전부 오측 → 유효 심박 0분
  assert.equal(detectLowActivityHighHr(garbage, NOW), null);
});

test("창 밖 심박은 평균에 들어가지 않는다 — 옛 고심박이 현재 주석을 만들면 안 된다", () => {
  const points = [
    ...fill(12, 92, 0.5), // 창 안 12분 = 정상 심박
    pt(HEAT_PATTERN_WINDOW_MIN + 5, 160, 0.5), // 창 밖 고심박
  ];
  const res = detectLowActivityHighHr(points, NOW);
  assert.ok(res);
  assert.equal(res.flagged, false);
  assert.equal(res.hrAvg, 92);
});
