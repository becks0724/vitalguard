// WBGT 참고 지표 가드 — 법정 판정 자리로 승격되면 실패한다.
//
// 한국 법령이 폭염작업 기준으로 지정한 것은 **체감온도**(31/33/35℃)이고 WBGT 는 국제 표준
// 참고 지표다. WBGT 에 임계를 붙이려면 ACGIH TLV 가 필요한데 그건 **작업 강도(대사율)별로
// 허용한계가 달라** 체표면적(키·체중)이 있어야 한다 — 별도 트랙이다.
// 그 전에 임계를 붙이면 그 숫자는 우리가 정한 것이 되고, 법정 기준과 두 개의 판정이 공존한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const strip = readFileSync(join(ROOT, "app", "components", "WeatherStrip.tsx"), "utf8");
const route = readFileSync(join(ROOT, "app", "api", "weather", "route.ts"), "utf8");
const rules = readFileSync(join(ROOT, "lib", "weather-rules.ts"), "utf8");

function section(src: string, marker: string, len = 1400): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `구간 마커 없음: ${marker}`);
  return src.slice(i, i + len);
}

test("① WBGT 는 정보 항목이다 — 임계·판정 함수를 갖지 않는다", () => {
  const s = section(strip, 'wbgt: infoEvaluation(', 1200);
  assert.match(s, /^\s*wbgt: infoEvaluation\(/m, "정보 항목이 아닌 판정 함수로 바뀜");
  // weather-rules 에 WBGT 판정 함수가 생기면 임계가 붙은 것이다.
  // 앵커 — 판정 모듈이 여기가 맞는지 먼저 고정한다(옮겨가면 아래 금지가 공허하게 통과한다).
  assert.match(rules, /export function evaluateApparentTemp/, "판정 모듈이 여기가 아니다 — 아래 금지가 공허하다");
  assert.doesNotMatch(rules, /evaluateWbgt|WBGT_STEPS/, "WBGT 판정 함수·임계 단계가 생김");
});

test("② WBGT 가 알림 경로에 들어가지 않는다 — 참고 지표는 발송하지 않는다", () => {
  const s = section(route, "await notifyEnvAlerts(", 700);
  assert.doesNotMatch(s, /wbgt|Wbgt|WBGT/, "WBGT 가 텔레그램 알림 목록에 유입됨");
});

test("③ 모달이 '참고 지표'와 '법정 기준은 체감온도'를 명시한다", () => {
  const s = section(strip, 'wbgt: infoEvaluation(', 1200);
  assert.match(s, /법적 판정 기준은 체감온도/, "법정 기준 안내가 사라짐");
  assert.match(s, /참고 지표/, "참고 지표 표기가 사라짐");
  // 입력 혼합(기온·습도=기상청 / 일사=Open-Meteo)을 숨기지 않는다.
  assert.match(s, /일사량 = Open-Meteo/, "입력 출처 혼합 고지가 사라짐");
  // 실외 기준이라는 한계.
  assert.match(s, /실외·직사광 기준/, "적용 범위 한계 표기가 사라짐");
});

test("④ 산출 실패는 '--' — 0 이나 추정치로 때우지 않는다", () => {
  assert.match(
    strip,
    /c\.wbgt === undefined \? "--"/,
    "미산출 시 대체값을 넣으면 없는 값이 있는 것처럼 보인다",
  );
  assert.match(route, /\)\?\.wbgt,/, "computeWbgt 실패 시 undefined 전파가 끊김");
});
