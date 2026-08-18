// 온열 알림(온열 ③) 가드 — 사용자 결정(08-13)으로 그은 세 경계가 조용히 풀리면 실패한다.
//   ① 텔레그램 문구에 생체 수치 미포함(민감정보 국외이전 최소화 — 법적 검토 결과)
//   ② 신호등 점등은 warning 단계만(caution 은 알림·표시 전용)
//   ③ 생체 판정(workerStatus/overallStatus)에는 온열 단계 미주입 — 통제된 예외는 신호등 톤 합성뿐
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const heatAlert = readFileSync(join(ROOT, "lib", "heat-alert.ts"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");
const route = readFileSync(join(ROOT, "app", "api", "app", "vital", "route.ts"), "utf8");
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

test("① 문구 함수는 수치를 받을 수 없다 — formatHeatMessage 시그니처·본문에 temp/bpm/kcal 부재", () => {
  const msgSection = heatAlert.slice(heatAlert.indexOf("formatHeatMessage"));
  assert.ok(msgSection.length > 100, "formatHeatMessage 가 사라짐");
  assert.doesNotMatch(msgSection, /tempC|hrAvg|bpm|kcal/i, "문구 경로에 생체 수치가 유입됨");
});

test("② 신호등 점등은 warning 만 — caution 이 톤을 올리면 실패", () => {
  assert.match(dash, /data\.heatStage\?\.\[slot\.workerId\] === "warning"/, "warning 한정 조건이 사라짐");
  assert.doesNotMatch(
    dash,
    /heatStage[^\n]*=== "caution"[^\n]*worseTone/,
    "caution 단계가 신호등 톤을 올림(결정 위반)",
  );
});

test("③ 생체 판정 미주입 유지 — workerStatus/overallStatus 에 heatStage 없음", () => {
  assert.doesNotMatch(dash, /workerStatus\([^)]*heatStage/, "온열 단계가 작업자 판정에 주입됨");
  assert.doesNotMatch(dash, /overallStatus\([^)]*heatStage/, "온열 단계가 종합 판정에 주입됨");
});

test("발사 경로 — vital POST 가 60초 스로틀 발사를 부르고, 전이·상태는 전용 엔진을 쓴다", () => {
  assert.match(route, /void notifyHeatIfDue\(\);/, "수집 경로의 판정 틱이 사라짐");
  const fn = store.slice(store.indexOf("export async function notifyHeatIfDue"));
  assert.match(fn.slice(0, 2500), /decideHeatNotify\(/, "전이 결정이 순수 함수를 거치지 않음");
  assert.match(fn.slice(0, 2500), /upsertEnvAlertState\(`heat:/, "전이 상태 영속(재기동 내성)이 사라짐");
  assert.match(fn.slice(0, 2500), /sendTelegramMessage\(/, "발송 경로가 사라짐");
});

test("판정 입력 — 단계는 칼만 궤적(estimateCoreTempSeries)+패턴으로만 계산", () => {
  const fn = store.slice(store.indexOf("export async function heatStages"));
  assert.match(fn.slice(0, 1800), /estimateCoreTempSeries\(/);
  assert.match(fn.slice(0, 1800), /evaluateHeatStage\(/);
  assert.match(fn.slice(0, 1800), /isReservedTestWorker/, "예약 워커가 판정 대상에 들어감");
});
