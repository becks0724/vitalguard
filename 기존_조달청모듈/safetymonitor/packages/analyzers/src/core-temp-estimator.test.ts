// 심부체온 추정 단위 테스트 — 문헌 관측 모델의 고정점·워밍업 경계·갭·오측 가드·결정성.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { estimateCoreTemp, estimateCoreTempSeries, CORE_TEMP_MIN_MINUTES, type HrPoint } from "./core-temp-estimator.js";

const T0 = Date.parse("2026-08-12T00:00:00.000Z");

// minutes 분 동안 5초 간격(분당 12건) bpm 고정 시계열.
function series(minutes: number, bpm: number, startMin = 0): HrPoint[] {
  const out: HrPoint[] = [];
  for (let m = startMin; m < startMin + minutes; m++) {
    for (let s = 0; s < 12; s++) out.push({ tsMs: T0 + m * 60_000 + s * 5_000, bpm });
  }
  return out;
}

test("안정 심박(83bpm ≈ 관측 모델의 37.1℃ 고정점) — 추정이 37.1℃ 에 머문다", () => {
  const est = estimateCoreTemp(series(60, 83));
  assert.ok(est, "60분 데이터인데 null");
  assert.ok(Math.abs(est.tempC - 37.1) < 0.05, `37.1 유지 실패: ${est.tempC}`);
  assert.equal(est.basisMinutes, 60);
});

test("워밍업 경계 — 30분 미만 null, 30분부터 추정", () => {
  assert.equal(estimateCoreTemp(series(CORE_TEMP_MIN_MINUTES - 1, 83)), null);
  assert.ok(estimateCoreTemp(series(CORE_TEMP_MIN_MINUTES, 83)));
});

test("지속 고심박(137bpm ≈ 38.5℃ 대역) — 3시간이면 38.2℃ 이상으로 수렴·과속 없음", () => {
  const est = estimateCoreTemp(series(180, 137));
  assert.ok(est);
  assert.ok(est.tempC > 38.2, `수렴 부족: ${est.tempC}`);
  assert.ok(est.tempC < 38.7, `과대 추정: ${est.tempC}`);
});

test("상승은 단조·점진 — 1시간 시점이 3시간 시점보다 낮다(급점프 없음)", () => {
  const h1 = estimateCoreTemp(series(60, 137))!.tempC;
  const h3 = estimateCoreTemp(series(180, 137))!.tempC;
  assert.ok(h1 < h3, `단조 위반: 1h=${h1} 3h=${h3}`);
  assert.ok(h1 > 37.3, `1시간 반응 부족: ${h1}`);
});

test("오측 가드 — 범위 밖 bpm(<30·>220)은 무시, 전부 오측이면 null", () => {
  const bad: HrPoint[] = series(60, 250);
  assert.equal(estimateCoreTemp(bad), null);
  const mixed = [...series(60, 83), { tsMs: T0 + 61 * 60_000, bpm: 250 }];
  const est = estimateCoreTemp(mixed)!;
  assert.equal(est.basisMinutes, 60, "오측 bpm 이 버킷을 만들면 안 된다");
});

test("갭 — 30분 결측 후에도 이어 추정하고 안정값을 유지한다", () => {
  const withGap = [...series(60, 83), ...series(60, 83, 90)];
  const est = estimateCoreTemp(withGap)!;
  assert.equal(est.basisMinutes, 120);
  assert.ok(Math.abs(est.tempC - 37.1) < 0.05, `갭 후 흔들림: ${est.tempC}`);
});

test("결정성 — 같은 입력이면 항상 같은 출력(무상태 재계산 전제)", () => {
  const a = estimateCoreTemp(series(90, 110))!;
  const b = estimateCoreTemp(series(90, 110))!;
  assert.deepEqual(a, b);
});

test("궤적 — 워밍업(30분) 전에는 점이 없고, 이후 분당 1점씩 이어진다", () => {
  const s = estimateCoreTempSeries(series(60, 83));
  assert.equal(s.length, 60 - 30 + 1, `점 수: ${s.length}`);
  assert.ok(Math.abs(s[s.length - 1].tempC - 37.1) < 0.05);
});

test("궤적 — 60분 초과 공백은 세션을 끊고 재워밍업(끊긴 선), 60분 이내 공백은 이어진다", () => {
  // 60분 수집 → 90분 공백(>60) → 40분 수집: 두 번째 세션은 30분 워밍업 후 11점만.
  const twoSessions = [...series(60, 83), ...series(40, 83, 150)];
  const s2 = estimateCoreTempSeries(twoSessions);
  assert.equal(s2.length, 31 + 11, `세션 분리 실패: ${s2.length}`);
  // 30분 공백(≤60)은 같은 세션 — 끊기지 않고 전 구간 점 유지.
  const oneSession = [...series(60, 83), ...series(40, 83, 90)];
  const s1 = estimateCoreTempSeries(oneSession);
  assert.equal(s1.length, 31 + 40, `동일 세션 유지 실패: ${s1.length}`);
});

test("궤적 마지막 점 == estimateCoreTemp — 카드와 차트 숫자가 어긋나지 않는다", () => {
  const pts = series(120, 110);
  const s = estimateCoreTempSeries(pts);
  const est = estimateCoreTemp(pts);
  assert.ok(est);
  assert.equal(est.tempC, s[s.length - 1].tempC);
});
