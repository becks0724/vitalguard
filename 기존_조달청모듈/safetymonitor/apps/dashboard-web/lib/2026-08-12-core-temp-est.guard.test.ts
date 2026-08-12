// 심부체온 추정 가드 — "표시 전용·판정 미주입" 경계가 조용히 풀리면 실패한다.
//
// 왜 가드인가 — 추정치(문헌 오차 ±0.3℃·약물 시 과소추정)를 coreTempStatus/overallStatus 에
// 넣으면 타입이 맞아 tsc·기능 테스트가 전부 통과한 채 "의료 판정 아님" 원칙이 무너진다.
// 판정 연동은 실사용 관찰 후 별도 결정 사항(2026-08-12)이다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");
const route = readFileSync(join(ROOT, "app", "api", "mock", "vital", "route.ts"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "mock", "store.ts"), "utf8");

test("vital GET — coreTempEst 를 응답에 싣는다(별칭 접기 경유)", () => {
  assert.match(route, /coreTempEst: await coreTempEstimates\(aliasMap\)/);
});

test("추정치는 판정 함수에 들어가지 않는다 — coreTempStatus/overallStatus 미주입", () => {
  assert.doesNotMatch(dash, /coreTempStatus\([^)]*coreTempEst/, "추정치가 체온 판정에 주입됨");
  assert.doesNotMatch(dash, /overallStatus\([^)]*coreTempEst/, "추정치가 종합 판정에 주입됨");
});

test("서버 추정 — analyzers 순수 함수 사용 + 예약/테스트 워커 제외 + 무상태 재계산(캐시만)", () => {
  const fn = store.slice(store.indexOf("export async function coreTempEstimates"));
  assert.match(fn, /estimateCoreTemp\(/, "analyzers 의 문헌 계수 구현을 쓰지 않음");
  assert.match(fn.slice(0, 2000), /isReservedTestWorker/, "예약 워커가 추정 대상에 들어감");
});

test("추세 차트 — 심박·추정은 실데이터 경로(real.ts), 추정은 7일 상한을 서버가 강제", () => {
  const histRoute = readFileSync(join(ROOT, "app", "api", "mock", "history", "route.ts"), "utf8");
  assert.match(histRoute, /buildRealHistory\(/, "실데이터 분기가 없다 — 모의 곡선이 추정 추세인 척 그려진다");
  assert.match(histRoute, /CORE_TEMP_EST_MAX_DAYS/, "추정 추세 기간 상한(7일)이 서버에서 빠졌다");
});

test("추세 차트 — 모의 생성기는 coreTempEst 를 만들지 않는다(가짜 추정 곡선 방어선)", () => {
  const data = readFileSync(join(ROOT, "app", "api", "mock", "history", "data.ts"), "utf8");
  assert.match(data, /if \(metric === "coreTempEst"\) return 0;/);
});

test("추세 차트 — 추정 점에 위험도 판정을 붙이지 않는다(참고선만)", () => {
  const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");
  const sevFn = panel.slice(panel.indexOf("function metricPointSeverity"));
  assert.match(sevFn, /case "coreTempEst":[\s\S]{0,200}?return undefined/, "추정 점이 판정 색을 받는다");
  assert.doesNotMatch(panel, /coreTempStatus/, "패널이 추정값에 체온 판정을 다시 붙였다");
});
