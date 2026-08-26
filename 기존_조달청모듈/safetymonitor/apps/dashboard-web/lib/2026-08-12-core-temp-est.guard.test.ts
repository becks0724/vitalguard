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

test("★ 라이브 체온 판정은 칼만 추정으로 한다 — 오염된 손목 실측으로 하지 않는다", () => {
  // ★★ 2026-08-26 — **이 가드의 계약이 뒤집혔다.** 종전 보장은 "추정치를 판정에 넣지 않는다"
  //    였다. 그 근거(문헌 오차 ±0.3℃·약물 시 과소추정·"의료 판정 아님")는 지금도 유효하지만,
  //    같은 주석이 **"판정 연동은 실사용 관찰 후 별도 결정 사항(2026-08-12)"** 이라고 적어 뒀다.
  //    그 관찰이 나왔고 사용자가 결정했다.
  //
  //    관찰 — 종전 판정 입력(손목 실측 + 오프셋 0.5)이 **추정보다 나쁘다**.
  //      · 손목에는 기기 발열이 섞인다. 주변온≥33 구간 평균 37.58 vs 깨끗 36.69(0.89℃ 차),
  //        주변온 최댓값 38.45℃(8월 실내 공기일 수 없다 = 센서가 기기 표면을 읽는다).
  //      · 같은 발열 구간에서 칼만은 +0.019℃ 움직인다(손목은 +0.841℃ · 약 40배 차).
  //      · corr(칼만, 주변온) 0.055 vs corr(손목, 주변온) 0.565.
  //      · 칼만이 둔한 것이 아니다 — 합성 심박 계단에서 83→37.098 · 120→37.997 · 160→39.267 로
  //        생리 범위 전체를 따라간다(관측모델 명세 37.1↔83bpm · 38.5↔137bpm 과 일치).
  //      · 오탐 실측(7일): 손목 판정 58% vs 칼만 판정(임계 상향 동반) 0%.
  //    ⟹ "추정을 판정에 안 넣는다" 를 지키는 대가가 **더 나쁜 입력으로 판정하는 것**이었다.
  //
  // ⚠ 살아 있는 원칙 — 표시 문구의 "의료 판정 아님"·"추정" 표기는 그대로다. 바뀐 것은
  //    **어느 값으로 위험/주의를 가르는가**이지 "이것이 진단이다" 라는 주장이 아니다.
  // ⚠ 남은 한계 — 위쪽 검증(진짜 열스트레스에서 실제로 임계를 넘는가)은 표본이 없다.

  // 앵커 — 금지 검사는 대상이 사라져도 통과한다. 판정 호출이 실재함을 먼저 고정한다.
  assert.match(dash, /coreTempStatusC\(/, "판정 호출이 여기에 없다 — 아래 검사가 공허하다");
  assert.match(dash, /overallStatus\(/, "판정 호출이 여기에 없다 — 아래 검사가 공허하다");

  // ① 라이브 판정이 칼만을 실제로 먹는가.
  assert.match(
    dash,
    /coreTempStatusC\(\s*(coreTempEstC|data\.coreTempEst)/,
    "체온 판정에 칼만이 안 들어간다 — 판정 근거가 사라졌거나 손목으로 되돌아갔다",
  );
  // ①-2 ★ **종합 판정이 인자를 흘려보내는가.** ① 은 파일 어디든 한 곳만 맞으면 통과라,
  //      `overallStatus` 안에서만 `undefined` 로 바꿔 체온을 통째로 죽여도 초록이었다
  //      (2026-08-26 변이 시험에서 실측으로 잡힘 · [[L-104]]). 그 자리를 따로 못 박는다.
  const overallBody = dash.slice(
    dash.indexOf("function overallStatus("),
    dash.indexOf("function overallStatus(") + 900,
  );
  assert.ok(overallBody, "overallStatus 를 못 찾았다 — 가드 재작성 필요");
  assert.match(
    overallBody,
    /coreTempStatusC\(coreTempEstC\)/,
    "overallStatus 가 받은 칼만을 판정에 안 넘긴다 — 종합 판정에서 체온이 조용히 빠진다",
  );
  // ② ★ 손목 실측으로 되돌아가지 않았는가(되돌리면 오탐 58% 가 그대로 돌아온다).
  //    ⚠ 주석을 먼저 걷는다 — 되돌리지 말라고 적어 둔 **설명문 자체**가 이 금지 검사에
  //      걸려 빨간불이 났다(2026-08-26 실측). 근거 서술을 지우게 만드는 가드는 잘못 조준된
  //      가드다. 같은 형태를 오늘만 두 번 밟았다(측정 체온 가드 ④ 매직넘버 검사).
  //    `coreTempStatusC` 는 다른 함수이므로 경계(`\(`)로 가른다 — 접미 C 가 붙으면 안 걸린다.
  const dashCode = dash.replace(/\/\/[^\n]*/g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.doesNotMatch(
    dashCode,
    /\bcoreTempStatus\(/,
    "손목 기반 판정(coreTempStatus)이 화면에 되살아났다 — 기기 발열이 판정에 섞인다",
  );

  // ③ ★ **모든 판정 호출이 칼만을 들고 가는가.** ①·①-2 는 "어딘가 한 곳" 과 "정의부" 만 본다.
  //    호출부에서 세 번째 인자를 빼면 그 화면만 조용히 체온 판정을 잃는데, 위 둘로는 안 잡혔다
  //    (2026-08-26 변이 시험 실측 — 표 행에서 인자를 빼도 초록이었다).
  //    ⚠ 괄호 대응 스캐너로 인자를 뽑는다. `data.coreTempEst?.[id]?.tempC` 처럼 중첩 괄호가
  //      섞여서 정규식 `\(([^)]*)\)` 로는 인자가 중간에 잘린다.
  const argsOf = (src: string, at: number): string => {
    let depth = 0;
    for (let i = at; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) return src.slice(at + 1, i);
      }
    }
    return "";
  };
  const bad: string[] = [];
  for (const m of dashCode.matchAll(/\b(overallStatus|workerStatus)\(/g)) {
    const open = m.index! + m[0].length - 1;
    // 정의부(`function overallStatus(`)는 호출이 아니다 — 건너뛴다.
    if (/function\s+$/.test(dashCode.slice(Math.max(0, m.index! - 10), m.index!))) continue;
    const args = argsOf(dashCode, open);
    // 허용되는 것은 **신선도 게이트를 통과한 값**뿐이다 — `freshCoreTemp(id)` 또는 그것으로
    // 채워진 prop(`coreTempEstC`). 원시 맵(`data.coreTempEst?.[...]`)을 바로 넘기면 안 된다.
    if (!/freshCoreTemp\(|coreTempEstC/.test(args)) bad.push(`${m[1]}(${args.slice(0, 60)})`);
  }
  assert.deepEqual(
    bad,
    [],
    `판정 호출이 신선한 칼만을 안 넘긴다 — 그 화면만 체온 판정을 잃는다: ${bad.join(" | ")}`,
  );

  // ④ ★★ **신선도 게이트가 실재하고, 판정이 원시 맵을 우회하지 않는가.**
  //    2026-08-26 실측 — 서버는 심박이 끊겨도 마지막 추정치를 계속 내려보낸다. EMP-6861 은
  //    **심박 32분 공백인데 행은 3분 전까지** 들어왔다. 행 신선도로는 안 걸리므로, 게이트가
  //    없으면 32분 전 심박에서 나온 값으로 위험/주의를 가른다.
  //    ⚠ 손목 기반 판정에는 없던 성질이다 — 그 값은 행과 함께 와서 자동으로 신선했다.
  //      칼만으로 옮기면서 생긴 구멍이라, 이관과 같은 자리에서 묶는다.
  const gateAt = dashCode.indexOf("const freshCoreTemp = ");
  assert.ok(gateAt > 0, "신선도 게이트가 사라졌다 — 낡은 추정이 판정에 든다");
  // ⚠ 상수의 **존재**만 보면 안 된다 — `if (false) return undefined;` 로 조건을 죽여도 상수는
  //   죽은 코드에 남아 통과한다(2026-08-26 변이 시험 실측). **비교식 자체**를 못 박는다.
  const gateBody = dashCode.slice(gateAt, gateAt + 500);
  assert.match(
    gateBody,
    /ageMs\s*>\s*CORE_TEMP_EST_MAX_AGE_MIN\s*\*\s*60_000/,
    "유효기간 비교가 사라졌다 — 게이트가 껍데기만 남았다(상수는 죽은 코드에도 남는다)",
  );
  assert.match(gateBody, /return undefined;/, "낡았을 때 값을 비우지 않는다");

  // 판정·표시로 가는 경로가 게이트를 우회해 원시 맵을 읽지 않는가.
  assert.doesNotMatch(
    dashCode,
    /(overallStatus|workerStatus|coreTempStatusC)\([^;]{0,80}data\.coreTempEst/,
    "판정이 신선도 게이트를 우회해 원시 추정 맵을 읽는다",
  );
  // ⚠ prop 경유도 막는다 — 행 컴포넌트는 `coreTempEstC` 를 판정·표시·PSI 에 모두 쓴다.
  //   여기로 원시 맵을 넣으면 위 검사를 전부 비켜 간다(변이 시험에서 실제로 비켜 갔다).
  for (const m of dashCode.matchAll(/coreTempEstC=\{([^}]*)\}/g)) {
    assert.match(
      m[1]!,
      /freshCoreTemp\(/,
      `행 prop 이 게이트를 안 거친다 — coreTempEstC={${m[1]}}`,
    );
  }
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
  // ★ 2026-08-26 — 기대값이 `["skinTempC"]` 에서 **`[]`** 로 바뀌었다. 실측 체온 탭에서 점
  //   강조·참고선을 뺐기 때문이다(차트 점의 54~57%가 주의 이상으로 칠해지던 것을 제거).
  //   즉 **체온 계열 탭 어디에도 판정 색이 붙지 않는다** — 실측 탭은 진단용이고 추정 탭은
  //   종전대로 참고선만 둔다. 판정은 차트가 아니라 표 행·카드·신호등이 진다.
  assert.deepEqual(
    owners,
    [],
    `체온 탭에는 점 판정을 붙이지 않는다 — 실제로 붙은 곳: ${owners.join(", ") || "없음"}`,
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
