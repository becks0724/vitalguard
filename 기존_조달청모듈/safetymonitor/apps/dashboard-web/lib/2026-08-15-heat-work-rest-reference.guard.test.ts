// 작업–휴식 권고 참고성 가드 — KOSHA 표가 법정 판정으로 승격되면 실패한다.
//
// 이 표(KOSHA GUIDE W-12-2017 <표 1>)의 대상은 **용광로 등 실내 열원 작업**이고,
// 옥외 폭염작업의 법정 기준은 **체감온도**(31/33/35℃)다. 값이 그럴듯해 보인다고 판정에
// 올리면 법이 지정하지 않은 표로 의무를 발동시키게 된다.
//
// 표 값 자체도 고정한다 — 우리가 정한 숫자가 아니라 공식 지침값이라, 바뀌면 지침 개정
// 확인이 먼저다. ACGIH TLV 를 못 쓴 이유(저작권)도 주석에 남아 있어야 다음 사람이
// "더 유명한 ACGIH 로 바꾸자"고 되돌리지 않는다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const lib = readFileSync(join(ROOT, "lib", "heat-work-rest.ts"), "utf8");
const strip = readFileSync(join(ROOT, "app", "components", "WeatherStrip.tsx"), "utf8");
const rules = readFileSync(join(ROOT, "lib", "weather-rules.ts"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "mock", "store.ts"), "utf8");

test("① KOSHA <표 1> 12칸이 그대로다 — 지침값이지 우리 숫자가 아니다", () => {
  assert.match(lib, /light: \{ continuous: 30\.0, rest25: 30\.6, rest50: 31\.4, rest75: 32\.2 \}/);
  assert.match(lib, /moderate: \{ continuous: 26\.7, rest25: 28\.0, rest50: 29\.4, rest75: 31\.1 \}/);
  assert.match(lib, /heavy: \{ continuous: 25\.0, rest25: 25\.9, rest50: 27\.9, rest75: 30\.0 \}/);
});

test("② 작업강도 경계·복장 보정이 그대로다", () => {
  assert.match(lib, /LIGHT_MAX_KCAL_H = 200/);
  assert.match(lib, /MODERATE_MAX_KCAL_H = 350/);
  assert.match(lib, /HEAVY_MAX_KCAL_H = 500/);
  assert.match(lib, /summer: 0[,\s]/);
  assert.match(lib, /cotton: 2[,\s]/);
  assert.match(lib, /winter: 4[,\s]/);
  assert.match(lib, /waterproof: 6[,\s]/);
});

test("③ 표 범위 밖(500 초과)은 null — 없는 구간을 메우지 않는다", () => {
  const i = lib.indexOf("export function classifyWorkIntensity");
  assert.ok(i >= 0, "분류 함수가 사라짐");
  const fn = lib.slice(i, lib.indexOf("}", lib.indexOf("return null;", i)));
  assert.match(fn, /return null;/, "상한 초과 시 null 반환이 사라짐");
});

test("④ 법정 판정으로 승격되지 않았다 — 판정 함수·알림 경로 무유입", () => {
  // weather-rules 에 작업–휴식 판정이 생기면 체감온도와 두 개의 법정 판정이 공존하게 된다.
  // 앵커 — 두 대상이 실제로 판정 모듈·알림 조립부인지 먼저 고정한다. 내용이 다른 파일로
  // 옮겨가면 아래 금지 두 줄은 빈 파일을 검사하며 조용히 통과한다.
  assert.match(rules, /export function evaluateApparentTemp/, "판정 모듈이 여기가 아니다 — 아래 금지가 공허하다");
  assert.match(store, /recordAlert\(/, "알림 조립부가 여기가 아니다 — 아래 금지가 공허하다");
  assert.doesNotMatch(rules, /workRest|WorkRest|작업휴식|작업–휴식/, "판정 모듈에 유입됨");
  // 알림은 참고 지표로 보내지 않는다.
  assert.doesNotMatch(store, /heatWorkRestAdvice|workRestRegimen/, "알림 조립부에 유입됨");
});

test("⑤ 모달이 적용 범위 한계를 명시한다", () => {
  const i = strip.indexOf("function workRestAdviceText");
  assert.ok(i >= 0, "권고 생성 함수가 사라짐");
  const fn = strip.slice(i, i + 1400);
  assert.match(fn, /실내 열원 작업/, "적용 범위(실내 열원) 고지가 사라짐");
  assert.match(fn, /참고로만 적용/, "참고 성격 표기가 사라짐");
  assert.match(fn, /여름작업복 기준/, "복장 보정 전제 표기가 사라짐");
  assert.match(fn, /WBGT 미산출로 판정 불가/, "미산출 시 판정 불가 표기가 사라짐");
});
