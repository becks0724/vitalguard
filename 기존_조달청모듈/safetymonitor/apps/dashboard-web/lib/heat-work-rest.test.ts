// 고열 작업–휴식 권고 테스트 — KOSHA GUIDE W-12-2017 <표 1> 값을 그대로 고정한다.
// 이 숫자는 우리가 정한 것이 아니라 공식 지침값이라, 바뀌면 지침 개정 확인이 먼저다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  classifyWorkIntensity,
  adjustedWbgt,
  workRestRegimen,
  heatWorkRestAdvice,
  CLOTHING_ADJUSTMENT,
} from "./heat-work-rest";

test("작업강도 분류 — KOSHA 경계 200 / 350 / 500 kcal·hr", () => {
  assert.equal(classifyWorkIntensity(0), "light");
  assert.equal(classifyWorkIntensity(200), "light", "경계값은 경작업에 포함");
  assert.equal(classifyWorkIntensity(200.1), "moderate");
  assert.equal(classifyWorkIntensity(350), "moderate");
  assert.equal(classifyWorkIntensity(350.1), "heavy");
  assert.equal(classifyWorkIntensity(500), "heavy");
});

test("★ 500 kcal/hr 초과는 null — 표에 없는 구간을 우리가 메우지 않는다", () => {
  assert.equal(classifyWorkIntensity(500.1), null);
  assert.equal(classifyWorkIntensity(900), null);
  // 중작업 기준을 끌어다 쓰면 표에 없는 판정을 만드는 것이 된다.
});

test("<표 1> 계속작업 한계 — 경 30.0 · 중등 26.7 · 중 25.0℃", () => {
  assert.equal(workRestRegimen(30.0, "light"), "continuous");
  assert.equal(workRestRegimen(30.01, "light"), "rest25");
  assert.equal(workRestRegimen(26.7, "moderate"), "continuous");
  assert.equal(workRestRegimen(26.71, "moderate"), "rest25");
  assert.equal(workRestRegimen(25.0, "heavy"), "continuous");
  assert.equal(workRestRegimen(25.01, "heavy"), "rest25");
});

test("<표 1> 전 구간 — 휴식을 늘릴수록 허용 WBGT 가 올라간다", () => {
  // 중등작업 행: 26.7 / 28.0 / 29.4 / 31.1
  assert.equal(workRestRegimen(27.5, "moderate"), "rest25");
  assert.equal(workRestRegimen(28.0, "moderate"), "rest25");
  assert.equal(workRestRegimen(28.5, "moderate"), "rest50");
  assert.equal(workRestRegimen(29.4, "moderate"), "rest50");
  assert.equal(workRestRegimen(30.0, "moderate"), "rest75");
  assert.equal(workRestRegimen(31.1, "moderate"), "rest75");
  assert.equal(workRestRegimen(31.2, "moderate"), "exceeded");
});

test("<표 2> 복장 보정 — 여름 0 · 면 +2 · 겨울 +4 · 방수 +6℃", () => {
  assert.equal(CLOTHING_ADJUSTMENT.summer, 0);
  assert.equal(CLOTHING_ADJUSTMENT.cotton, 2);
  assert.equal(CLOTHING_ADJUSTMENT.winter, 4);
  assert.equal(CLOTHING_ADJUSTMENT.waterproof, 6);
  assert.equal(adjustedWbgt(28, "summer"), 28);
  assert.equal(adjustedWbgt(28, "waterproof"), 34);
});

test("★ 복장 보정이 판정을 바꾼다 — 방수복은 6℃ 불리해진다", () => {
  const summer = heatWorkRestAdvice({ wbgt: 26.0, kcalPerHour: 300, clothing: "summer" })!;
  const water = heatWorkRestAdvice({ wbgt: 26.0, kcalPerHour: 300, clothing: "waterproof" })!;
  assert.equal(summer.regimen, "continuous", "여름작업복 26.0 은 중등작업 계속 가능(≤26.7)");
  assert.equal(water.wbgtEff, 32.0);
  assert.equal(water.regimen, "exceeded", "방수복 보정 후 32.0 은 중등작업 표를 넘는다");
});

test("종합 — 작업강도와 WBGT 조합", () => {
  // 중작업(400 kcal/hr) · WBGT 26.5 → 25.9 초과 27.9 이하 → 50% 휴식
  const heavy = heatWorkRestAdvice({ wbgt: 26.5, kcalPerHour: 400 })!;
  assert.equal(heavy.intensity, "heavy");
  assert.equal(heavy.regimen, "rest50");
  assert.equal(heavy.limitC, 27.9);

  // 같은 환경에서 경작업(150)이면 계속작업 가능 — 강도가 판정을 가른다
  const light = heatWorkRestAdvice({ wbgt: 26.5, kcalPerHour: 150 })!;
  assert.equal(light.regimen, "continuous");
});

test("입력 결측·범위 밖은 null(판정 불가)", () => {
  assert.equal(heatWorkRestAdvice({ wbgt: null, kcalPerHour: 300 }), null);
  assert.equal(heatWorkRestAdvice({ wbgt: 28, kcalPerHour: null }), null);
  assert.equal(heatWorkRestAdvice({ wbgt: 28, kcalPerHour: undefined }), null);
  assert.equal(heatWorkRestAdvice({ wbgt: 28, kcalPerHour: 600 }), null, "표 범위 초과");
});
