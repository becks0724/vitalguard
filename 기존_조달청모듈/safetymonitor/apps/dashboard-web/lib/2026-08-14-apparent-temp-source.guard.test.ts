// 체감온도 산출 출처 가드 — 법정 폭염 판정(31/33/35℃)의 입력이 조용히 되돌아가면 실패한다.
//   법령은 '기상청이 측정한 체감온도'를 폭염작업 기준으로 지정한다. 업스트림(Open-Meteo)의
//   apparent_temperature 는 Steadman 식이라 정의가 다르고, 실측 대조에서 습한 무풍일 최대 +9.7℃
//   과대·건조 강풍일 과소(법정 휴식 의무 누락)로 양방향 어긋났다. 결정 = docs/apparent-temp-kma/
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "weather", "route.ts"), "utf8");
const formula = readFileSync(join(ROOT, "lib", "apparent-temp.ts"), "utf8");
const rules = readFileSync(join(ROOT, "lib", "weather-rules.ts"), "utf8");

test("① 라우트 — 체감온도는 기상청 식으로 산출한다(업스트림 값 직결 금지)", () => {
  assert.match(
    route,
    /apparentTempC: apparentTempKma\(/,
    "체감온도가 자체 산출 경로를 벗어남",
  );
  assert.doesNotMatch(
    route,
    /apparentTempC:\s*forecast\?\.current\?\.apparent_temperature/,
    "업스트림 apparent_temperature 직결이 되살아남 — 법정 기준과 다른 정의로 판정하게 된다",
  );
});

test("② 여름철 식에 풍속이 들어가지 않는다 — 기상청 식에는 풍속 항이 없다", () => {
  const i = formula.indexOf("export function apparentTempSummer");
  assert.ok(i >= 0, "여름철 산출 함수가 사라짐");
  const body = formula.slice(i, formula.indexOf("}", i));
  assert.doesNotMatch(body, /wind|Kmh|ws\b/i, "여름철 식에 풍속이 섞임");
});

test("③ 기상청 계수가 바뀌지 않았다 — 개정 없이 값이 흔들리면 판정이 흔들린다", () => {
  // 여름철(2022-06-02 개정) · 겨울철(JAG/TI 2001) 계수.
  for (const c of ["0.55399", "0.45535", "0.0022", "0.00278", "0.2442"]) {
    assert.ok(formula.includes(c), `여름철 계수 ${c} 가 사라짐`);
  }
  for (const c of ["13.12", "0.6215", "11.37", "0.3965"]) {
    assert.ok(formula.includes(c), `겨울철 계수 ${c} 가 사라짐`);
  }
  // Stull 습구온도 추정식 계수.
  for (const c of ["0.151977", "8.313659", "1.67633", "0.00391838", "4.686035"]) {
    assert.ok(formula.includes(c), `Stull 계수 ${c} 가 사라짐`);
  }
});

test("④ 법정 임계 3단계(31/33/35℃)가 그대로다", () => {
  const i = rules.indexOf("export function evaluateApparentTemp");
  assert.ok(i >= 0, "체감온도 판정 함수가 사라짐");
  const body = rules.slice(i, i + 600);
  assert.match(body, /t >= 35/, "35℃ 단계 소실");
  assert.match(body, /t >= 33/, "33℃ 법정 휴식 의무 단계 소실");
  assert.match(body, /t >= 31/, "31℃ 폭염작업 단계 소실");
});
