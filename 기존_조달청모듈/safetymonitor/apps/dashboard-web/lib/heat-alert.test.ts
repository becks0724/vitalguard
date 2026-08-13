// 온열 예방 알림(온열 ③) 단위 테스트 — 단계 판정·전이 결정·문구(수치 미포함) 경계 고정.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  HEAT_SUSTAIN_MINUTES,
  HEAT_MIN_POINTS,
  evaluateHeatStage,
  decideHeatNotify,
  formatHeatMessage,
  type HeatTempPoint,
} from "./heat-alert";

const NOW = Date.parse("2026-08-13T05:00:00.000Z");

// 최근 minutes 분 동안 1분 간격 추정점을 만든다.
function series(minutes: number, tempC: number): HeatTempPoint[] {
  return Array.from({ length: minutes }, (_, i) => ({
    tsMs: NOW - i * 60_000,
    tempC,
  }));
}

test("주의 — 37.8℃ 이상 10분 지속(패턴 무관)", () => {
  assert.equal(evaluateHeatStage(series(12, 37.9), false, NOW), "caution");
});

test("경고 — 38.0℃ 이상 10분 지속 + 저활동·고심박 패턴 동시", () => {
  assert.equal(evaluateHeatStage(series(12, 38.1), true, NOW), "warning");
});

test("경고 요건 미충족 — 38.0℃ 지속이어도 패턴 없으면 주의까지만(특이도 장치)", () => {
  assert.equal(evaluateHeatStage(series(12, 38.1), false, NOW), "caution");
});

test("정상 — 창 안에 임계 미만 점이 하나라도 있으면 지속 아님", () => {
  const s = series(12, 38.0);
  s[3] = { tsMs: s[3]!.tsMs, tempC: 37.6 }; // 창 중간에 내려간 점
  assert.equal(evaluateHeatStage(s, true, NOW), null);
});

test("판단 불가 — 창 내 추정점이 하한 미만이면 null(수신 공백을 지속으로 오독 방지)", () => {
  assert.equal(evaluateHeatStage(series(HEAT_MIN_POINTS - 1, 38.5), true, NOW), null);
});

test("창 밖 점은 판정에 안 들어간다 — 옛 고온이 현재 단계를 만들면 안 된다", () => {
  const old = Array.from({ length: 12 }, (_, i) => ({
    tsMs: NOW - (HEAT_SUSTAIN_MINUTES + 5 + i) * 60_000,
    tempC: 38.5,
  }));
  assert.equal(evaluateHeatStage(old, true, NOW), null);
});

test("전이 — 악화만 발송·호전은 조용히·해제는 발송 이력 있을 때만·동일 단계 무발송", () => {
  assert.deepEqual(decideHeatNotify(null, "caution"), { notify: "caution", nextState: "caution" });
  assert.deepEqual(decideHeatNotify("normal", "warning"), { notify: "warning", nextState: "warning" });
  assert.deepEqual(decideHeatNotify("caution", "warning"), { notify: "warning", nextState: "warning" });
  assert.deepEqual(decideHeatNotify("warning", "caution"), { notify: null, nextState: "caution" });
  assert.deepEqual(decideHeatNotify("caution", "caution"), { notify: null, nextState: "caution" });
  assert.deepEqual(decideHeatNotify("warning", null), { notify: "cleared", nextState: "normal" });
  assert.deepEqual(decideHeatNotify("normal", null), { notify: null, nextState: "normal" });
  assert.deepEqual(decideHeatNotify(null, null), { notify: null, nextState: "normal" });
});

test("문구 — 마스킹+사번 표기·행동 요령 포함·추정 명시", () => {
  const msg = formatHeatMessage({ stage: "caution", workerId: "EMP-6861", workerName: "장우진" });
  assert.match(msg, /\[온열 주의\] 장○진 \(EMP-6861\)/);
  assert.match(msg, /물·그늘·휴식/);
  assert.match(msg, /의료 판정 아님/);
});

test("★ 문구에 생체 수치 미포함 — ℃·bpm·kcal 값이 없다(민감정보 국외이전 최소화·사용자 결정)", () => {
  for (const stage of ["caution", "warning", "cleared"] as const) {
    const msg = formatHeatMessage({ stage, workerId: "EMP-6861", workerName: "장우진" });
    assert.doesNotMatch(msg, /\d+(\.\d+)?\s*(℃|bpm|kcal|%)/, `${stage} 문구에 수치가 실림`);
  }
});

test("해제 문구 — 복귀 사실만", () => {
  const msg = formatHeatMessage({ stage: "cleared", workerId: "EMP-6861", workerName: "장우진" });
  assert.match(msg, /\[온열 해제\] 장○진 \(EMP-6861\)/);
  assert.match(msg, /정상 범위 복귀/);
});
