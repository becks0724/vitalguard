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
const route = readFileSync(join(ROOT, "app", "api", "app", "vital", "route.ts"), "utf8");
const store = readFileSync(join(ROOT, "app", "api", "app", "vital", "store.ts"), "utf8");

test("vital GET — coreTempEst 를 응답에 싣는다(별칭 접기 경유)", () => {
  assert.match(route, /coreTempEst: await coreTempEstimates\(aliasMap\)/);
});

test("추정치는 판정 함수에 들어가지 않는다 — coreTempStatus/overallStatus 미주입", () => {
  // 앵커 — 금지 검사는 대상이 사라져도 통과한다. 판정 호출이 이 파일에 실재함을 먼저 고정한다.
  // 없으면 판정이 다른 파일로 옮겨갔거나 이름이 바뀐 것이고, 아래 두 줄은 공허하게 통과한다.
  assert.match(dash, /coreTempStatus\(/, "판정 호출이 여기에 없다 — 아래 금지 검사가 공허하다");
  assert.match(dash, /overallStatus\(/, "판정 호출이 여기에 없다 — 아래 금지 검사가 공허하다");
  assert.doesNotMatch(dash, /coreTempStatus\([^)]*coreTempEst/, "추정치가 체온 판정에 주입됨");
  assert.doesNotMatch(dash, /overallStatus\([^)]*coreTempEst/, "추정치가 종합 판정에 주입됨");
});

test("서버 추정 — analyzers 순수 함수 사용 + 예약/테스트 워커 제외 + 무상태 재계산(캐시만)", () => {
  const fn = store.slice(store.indexOf("export async function coreTempEstimates"));
  assert.match(fn, /estimateCoreTemp\(/, "analyzers 의 문헌 계수 구현을 쓰지 않음");
  assert.match(fn.slice(0, 2000), /isReservedTestWorker/, "예약 워커가 추정 대상에 들어감");
});

test("추세 차트 — 심박·추정은 실데이터 경로(real.ts), 추정은 7일 상한을 서버가 강제", () => {
  const histRoute = readFileSync(join(ROOT, "app", "api", "monitor", "vital", "history", "route.ts"), "utf8");
  assert.match(histRoute, /buildRealHistory\(/, "실데이터 분기가 없다 — 모의 곡선이 추정 추세인 척 그려진다");
  assert.match(histRoute, /CORE_TEMP_EST_MAX_DAYS/, "추정 추세 기간 상한(7일)이 서버에서 빠졌다");
});

test("추세 차트 — 모의 생성기는 coreTempEst 를 만들지 않는다(가짜 추정 곡선 방어선)", () => {
  const data = readFileSync(join(ROOT, "app", "api", "monitor", "vital", "history", "data.ts"), "utf8");
  assert.match(data, /if \(metric === "coreTempEst"\) return 0;/);
});

test("추세 차트 — 추정 점에 위험도 판정을 붙이지 않는다(참고선만)", () => {
  const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");
  const sevFn = panel.slice(panel.indexOf("function metricPointSeverity"));
  assert.match(sevFn, /case "coreTempEst":[\s\S]{0,200}?return undefined/, "추정 점이 판정 색을 받는다");

  // ⚠ 종전엔 **파일 전체**에서 `coreTempStatus` 를 금지했다. 그 대리 지표는 패널에 실측 체온
  //    시리즈가 없던 동안만 성립했다 — 2026-08-26 에 `skinTempC`(워치 온도 센서 실측) 탭이
  //    생겼고, 실측은 표 행·카드와 **같은 판정 함수**를 써야 화면끼리 숫자·색이 갈리지 않는다.
  //    그래서 금지를 없애지 않고 **추정 경로로 좁힌다** — 지키려는 한 문장은 그대로다:
  //    "판정이 붙는 체온 시리즈는 실측뿐이고, 추정에는 붙지 않는다."
  //    case 블록으로 쪼개 소유자를 뽑는다(정규식 창으로 재면 앞 case 에서 뒤 case 의 return 까지
  //    건너뛰어 엉뚱한 메트릭을 범인으로 지목한다).
  const owners = sevFn
    .split(/\bcase "/)
    .slice(1)
    .filter((c) => /return coreTempStatus\b/.test(c))
    .map((c) => c.slice(0, c.indexOf('"')));
  assert.deepEqual(
    owners,
    ["skinTempC"],
    `체온 판정은 실측(skinTempC)에만 붙어야 한다 — 실제로 붙은 곳: ${owners.join(", ") || "없음"}`,
  );
});

test("SpO₂ 추세 — 실데이터 경로 편입 + 24시간 뷰는 측정 시각 위치의 점(dot)", () => {
  const histRoute = readFileSync(join(ROOT, "app", "api", "monitor", "vital", "history", "route.ts"), "utf8");
  // 정확 목록이 아니라 멤버십으로 본다 — 새 실데이터 지표(activity 등) 추가가 이 가드를 깨면 안 된다.
  // 지키려는 것은 "spo2 가 실데이터 경로에 있다"이지 "목록이 셋뿐이다"가 아니다(2026-08-13 완화).
  const realMetricsLine = histRoute.match(/REAL_METRICS: RealMetric\[\] = \[[^\]]*\]/)?.[0] ?? "";
  for (const m of ["heartRate", "coreTempEst", "spo2"]) {
    assert.ok(realMetricsLine.includes(`"${m}"`), `${m} 이 실데이터 경로에서 빠짐`);
  }
  const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");
  assert.match(panel, /RechartsTimeDotChart/, "24시간 점 차트 미배선 — 균등 간격이 측정 분포를 오독시킨다");
  const real = readFileSync(join(ROOT, "app", "api", "monitor", "vital", "history", "real.ts"), "utf8");
  assert.match(real, /spo2MeasurementsBetween/, "SpO₂ 추세가 실측 행을 읽지 않는다");
});
