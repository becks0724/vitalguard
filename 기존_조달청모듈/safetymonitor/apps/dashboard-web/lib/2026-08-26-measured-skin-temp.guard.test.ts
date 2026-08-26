// 실측 체온 가드 — 워치 온도 센서가 잰 값이 추정과 섞이지 않은 채 DB 에서 화면까지 가는가.
//
// 무엇이 있었나. 2026-08-13 에 손목 온도 탭·열을 내렸다. 근거는 "Apple 실시간 온도가 서드파티
// 미개방(수면 전용 API)이라 상시 `--`" 였고, 그때는 맞았다. 그 뒤 갤럭시(Wear OS)가 들어오면서
// 전제가 깨졌는데 **화면은 그대로였다** — DB 에는 실측이 쌓이는데(08-26 실측: EMP-6861 24시간
// 150건 · 34.1~38.9℃) 관제웹은 심박 기반 추정만 보여 주고, 추정이 워밍업 미달인 워커에게는
// "측정값 미수신" 을 그렸다. **값은 오고 있었다.**
//
// ★ 이 가드의 한 문장 보장.
//   "실측 피부온은 추정과 **다른 시리즈**로 DB 조회부터 화면 표기까지 이어지고, 둘이 한 칸·한
//    선으로 합쳐지지 않는다."
//
// 왜 합치면 안 되나. 추정은 심박에서 만든 파생값이라 **센서가 죽어도 계속 나온다.** 한 시리즈로
// 이으면 측정이 없던 구간을 추정이 메워 "측정됨" 으로 보인다 — 이 레포가 반복해 고쳐 온 false-OK
// 형태다([[L-115]] 계열). 그래서 표는 `≈` 로 가르고, 차트는 탭을 나눈다.
//
// ⚠ 양 끝을 함께 단언한다([[L-115]]③) — 중간 변환만 보면 "만들어지는가"는 통과하고
//   "끝까지 가는가"는 놓친다. 여기서 양 끝 = DB 쿼리(skin_temp_c)와 소비부(패널 탭·실시간 표).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const db = read("lib", "db.ts");
const real = read("app", "api", "monitor", "vital", "history", "real.ts");
const route = read("app", "api", "monitor", "vital", "history", "route.ts");
const panel = read("app", "components", "VitalHistoryPanel.tsx");
const dash = read("app", "components", "DemoDashboard.tsx");

test("① DB — 실측을 실측 컬럼에서 읽고, 없는 값을 채우지 않는다", () => {
  const fn = db.slice(db.indexOf("export async function skinTempBucketAverages"), db.indexOf("export async function skinTempBucketAverages") + 1200);
  assert.ok(fn, "skinTempBucketAverages 가 사라졌다 — 실측 시리즈의 유일한 출처다");
  assert.match(fn, /avg\(skin_temp_c\)/, "실측 컬럼을 안 읽는다");
  // NULL 을 거르지 않으면 avg 가 아니라 행 자체가 남아 0/NaN 점이 생긴다. 결측은 메우지 않고 끊는다.
  assert.match(fn, /skin_temp_c IS NOT NULL/, "결측 행을 거르지 않는다 — 빈 버킷이 점으로 그려진다");
  // 심박 추정 입력을 여기서 쓰면 그 순간 '실측'이 아니다.
  assert.doesNotMatch(fn, /heart_rate/, "실측 쿼리에 심박이 섞였다");
});

test("② 서버 경로 — 실측은 실데이터 분기이고 모의 곡선으로 떨어지지 않는다", () => {
  const realMetrics = route.match(/REAL_METRICS: RealMetric\[\] = \[[\s\S]*?\]/)?.[0] ?? "";
  assert.ok(realMetrics, "REAL_METRICS 를 못 찾았다 — 가드 재작성 필요");
  assert.ok(realMetrics.includes('"skinTempC"'), "실측이 모의 경로로 떨어진다 — 없는 체온이 그려진다");
  // 분기가 실제로 실측 쿼리를 부르는가(목록에만 있고 구현이 없으면 추정 분기로 흘러내린다).
  const branch = real.slice(real.indexOf('if (metric === "skinTempC")'));
  assert.match(branch.slice(0, 600), /skinTempBucketAverages\(/, "실측 분기가 실측 쿼리를 안 부른다");
});

test("③ ★ 실측과 추정은 서로 다른 시리즈다 — 이름·색이 갈린다", () => {
  const labels = panel.slice(panel.indexOf("const METRIC_LABEL"), panel.indexOf("const METRICS:"));
  const skin = labels.match(/skinTempC: \{ name: "([^"]+)", unit: "([^"]+)", color: "([^"]+)"/);
  const est = labels.match(/coreTempEst: \{ name: "([^"]+)", unit: "([^"]+)", color: "([^"]+)"/);
  assert.ok(skin, "실측 체온 라벨이 사라졌다");
  assert.ok(est, "추정 체온 라벨이 사라졌다");
  assert.notEqual(skin[1], est[1], "실측과 추정 이름이 같다 — 화면에서 구별이 사라진다");
  assert.notEqual(skin[3], est[3], "실측과 추정 색이 같다 — 한 차트에 겹치면 어느 쪽인지 못 읽는다");
  // 탭 목록에 실제로 실려야 사용자가 도달한다(라벨만 있고 목록에 없으면 영영 안 보인다).
  const metrics = panel.match(/const METRICS: Metric\[\] = \[[^\]]*\]/)?.[0] ?? "";
  assert.ok(metrics.includes('"skinTempC"'), "실측 탭이 목록에 없다 — 라벨만 있고 도달 불가");
});

test("④ 참고선 — 실측 탭은 심부 임계를 손목 스케일로 역산한다", () => {
  const refs = panel.slice(panel.indexOf("function metricReferenceLines"));
  const caseBody = refs.slice(refs.indexOf('case "skinTempC":'), refs.indexOf('case "coreTempEst":'));
  assert.ok(caseBody.length > 0, "실측 참고선 분기가 사라졌다");
  // 손목값 위에 심부 임계(38.0/37.5)를 그대로 그으면 위험 구간이 화면 밖으로 밀린다.
  assert.match(caseBody, /wristToCoreOffsetC/, "역산 없이 심부 임계를 손목 스케일에 그린다");
  // 임계를 여기 숫자로 적으면 analyzers 와 두 벌이 된다.
  // ⚠ 주석을 먼저 걷는다 — 근거를 적은 문장("심부 임계(38.0/37.5℃)")이 매직넘버로 잡혀
  //   첫 실행에서 실제로 빨간불이 났다. 근거 서술을 지우게 만드는 가드는 잘못 조준된 가드다.
  const code = caseBody.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /3[0-9]\.[0-9]/, "임계를 매직넘버로 박았다 — THRESHOLDS 에서 파생할 것");
});

test("⑤ ★ 실시간 표 — 행 자신의 실측이 먼저이고, 추정 폴백에는 마크가 붙는다", () => {
  const cell = dash.slice(dash.indexOf("if (sample.skinTempC != null) return formatTemp"), dash.indexOf("if (sample.skinTempC != null) return formatTemp") + 500);
  assert.ok(cell.length > 0, "실시간 표가 행 실측을 안 쓴다 — 워커 단위 추정만 반복 표기된다");
  // 폴백이 마크 없이 나가면 추정이 측정으로 읽힌다. `≈` 가 그 경계다.
  assert.match(cell, /`≈\$\{formatTemp\(est\)\}`/, "추정 폴백에서 ≈ 마크가 사라졌다 — 추정이 실측으로 읽힌다");
  // 열 이름도 함께 고정한다 — "체온 추정" 으로 되돌리면 실측이 추정으로 표기된다.
  const header = dash.slice(dash.indexOf("체온 (℃)") - 400, dash.indexOf("체온 (℃)") + 20);
  assert.ok(header.includes("체온 (℃)"), "열 이름이 '체온' 이 아니다");
});

test("⑥ ★ 메트릭 집합이 양쪽에서 같다 — 한쪽만 늘면 탭이 400 을 부른다", () => {
  // 실제로 밟은 함정이다(2026-08-26 — 패널만 늘렸다가 tsc 가 잡았다). tsc 가 잡아 주는 것은
  // 두 타입이 **직접 대입될 때**뿐이라, 문자열 목록끼리 어긋나는 형태는 여기서 잡는다.
  const pick = (src: string, re: RegExp) =>
    [...(src.match(re)?.[0] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
  const panelSet = pick(panel, /type Metric =[\s\S]*?;/);
  const dashSet = pick(dash, /type HistoryMetric =[\s\S]*?;/);
  const allowed = pick(route, /const ALLOWED_METRICS: HistoryMetric\[\] = \[[\s\S]*?\]/);
  assert.ok(panelSet.length > 0 && dashSet.length > 0 && allowed.length > 0, "세 목록 중 못 읽은 것이 있다");
  assert.deepEqual(dashSet, panelSet, "대시보드와 패널의 메트릭 집합이 갈렸다");
  assert.deepEqual(allowed, panelSet, "서버 허용 목록과 화면 탭 집합이 갈렸다 — 탭을 누르면 400");
});
