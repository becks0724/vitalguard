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

test("④ ★ 참고선 — 실측 탭에는 임계선을 긋지 않는다", () => {
  // ★★ 2026-08-26 같은 날 뒤집힌 계약이다. 처음엔 "심부 임계를 손목 스케일로 역산해 긋는다"
  //    였는데, 그으니 **차트 점의 54~57%가 주의 이상**으로 칠해졌다(24시간 뷰 115점 중
  //    위험 31%·주의 26%). 근거 둘 다 그 선을 지탱하지 못한다 — 입력 오염(기기 발열)과
  //    오프셋 0.5 미검증. 판정은 심박 기반 칼만으로 옮겼고 이 탭은 진단용이 됐다.
  //
  // ⚠ **이 가드가 한 번 거짓 초록이었다.** 종전 단언이 `wristToCoreOffsetC` 문자열의 존재만
  //    봤는데, 코드를 지운 뒤에도 **그 사실을 설명하는 주석**에 같은 단어가 남아 통과했다.
  //    주석을 먼저 걷고 **코드**만 본다. 오늘 같은 계열을 세 번 밟았다(매직넘버 오탐·
  //    coreTempStatus 금지 검사·이것) — 문자열 존재 검사는 주석에 걸린다.
  const refs = panel.slice(panel.indexOf("function metricReferenceLines"));
  const caseBody = refs.slice(refs.indexOf('case "skinTempC":'), refs.indexOf('case "coreTempEst":'));
  assert.ok(caseBody.length > 0, "실측 분기가 사라졌다 — 가드 재작성 필요");
  const code = caseBody.replace(/\/\/[^\n]*/g, "");
  assert.match(code, /return \[\];/, "실측 탭이 참고선을 되살렸다 — 정상 구간의 절반이 주의로 칠해진다");
  assert.doesNotMatch(code, /wristToCoreOffsetC/, "역산 참고선이 되살아났다(오프셋 0.5 는 미검증)");
  assert.doesNotMatch(code, /3[0-9]\.[0-9]/, "임계를 매직넘버로 박았다");
});

test("⑤ ★ 실시간 표 — 행 자신의 실측이 먼저이고, 추정 폴백에는 마크가 붙는다", () => {
  const cell = dash.slice(dash.indexOf("if (sample.skinTempC != null) return formatTemp"), dash.indexOf("if (sample.skinTempC != null) return formatTemp") + 500);
  assert.ok(cell.length > 0, "실시간 표가 행 실측을 안 쓴다 — 워커 단위 추정만 반복 표기된다");
  // 폴백이 마크 없이 나가면 추정이 측정으로 읽힌다. `≈` 가 그 경계다.
  assert.match(cell, /`≈\$\{formatTemp\(est\)\}`/, "추정 폴백에서 ≈ 마크가 사라졌다 — 추정이 실측으로 읽힌다");
  // ★ 열 이름 — **`체온` 이면 안 된다**(2026-08-26 같은 날 정정).
  //   오전에 `체온 추정` → `체온` 으로 바꿨는데, 이 열의 값은 손목 피부온이고 체온이 아니다.
  //   실측 240점 중 8점(3%)이 35.0℃ 미만이고 최저 34.12℃ 다 — "체온 34.1" 은 **저체온증**으로
  //   읽힌다. 같은 시각 칼만 심부체온은 37.34~37.36℃ 로 전부 정상이었다(심박 70~101bpm).
  //   ⚠ 고열 오독(38.9)보다 이쪽이 나쁘다 — 고열은 "덥나 보다" 로 끝나지만 저체온은 후송을 부른다.
  //   내가 위험을 위쪽만 보고 평가했던 자리라, 아래쪽을 가드로 못 박는다.
  const headerIdx = dash.indexOf("손목온도 (℃)");
  assert.ok(headerIdx > 0, "실시간 표 열 이름이 '손목온도' 가 아니다 — 손목값이 체온으로 읽힌다");
  assert.doesNotMatch(
    dash.slice(headerIdx - 60, headerIdx + 20),
    /^\s*체온 \(℃\)/m,
    "열 이름이 '체온' 으로 되돌아갔다 — 34℃ 대 손목값이 저체온증으로 읽힌다",
  );
});

test("⑧ ★★ 작업자 표 — 판정색은 체온(칼만) 줄에만 붙고 손목 숫자는 중립이다", () => {
  // 이 세션 최대의 안전 계약이다. 손목 숫자에 판정색을 걸면 **라벨을 고쳐도 오독이 난다** —
  // 34.8℃ 가 빨갛게 뜨는 순간 관제자는 저체온증으로 읽고 조치한다. 색과 판정이 같은 줄에
  // 있어야 색이 무엇을 말하는지 어긋나지 않는다.
  const cell = dash.slice(dash.indexOf("{/* 6 체온"), dash.indexOf("{/* 7 낙상"));
  assert.ok(cell.length > 0, "체온 셀 구간을 못 찾았다 — 가드 재작성 필요");

  // ① ★ 이 셀에 상태색은 **정확히 한 군데**만 있다 — 칼만 줄.
  //    "손목 줄 앞 260자에 STATUS_CLASS 가 없다" 로 재려다 말았다. 창 기반이라 색을 숫자
  //    **뒤에** 감싸면 안 걸리고, 실제로 변이 시험에서 그 형태를 못 만들어 미적용으로 끝났다.
  //    개수로 재면 어느 방향으로 붙이든 2가 되어 잡힌다.
  const colored = [...cell.matchAll(/STATUS_CLASS\[/g)].length;
  assert.equal(
    colored,
    1,
    `체온 셀의 판정색이 ${colored}군데 — 1군데(칼만 줄)여야 한다. 손목 숫자가 색을 받으면 34℃ 대가 저체온증으로 읽힌다`,
  );
  // ② 체온(칼만) 줄에는 상태색이 있다 — 판정이 화면에서 사라지지 않았는가.
  assert.match(
    cell,
    /STATUS_CLASS\[coreTempStatusC\(coreTempEstC\)\]/,
    "칼만 줄에 판정색이 없다 — 위험/주의가 화면에 안 나타난다",
  );
  // ③ 헤더가 '손목온도' 다(주값의 정체를 이름이 말한다).
  assert.match(dash, /"SpO₂", "손목온도"/, "작업자 표 헤더가 '손목온도' 가 아니다");
  // ④ 워밍업 전에는 빈칸이 아니라 사유를 적는다 — 빈칸은 "센서 고장" 으로 읽힌다.
  assert.match(cell, /심박 누적 중/, "칼만 미산출 시 사유 표기가 없다 — 빈칸이 고장으로 읽힌다");
});

test("⑦ ★ 체온 임계 — 순서가 서고 상향 근거가 남아 있다", () => {
  // 2026-08-26 에 37.5/38.0 → 38.0/38.5 로 올렸다. 두 가지를 못 박는다.
  //
  // ① **순서** — 주의 < 위험. 뒤집히면 "주의 구간" 이 사라져 caution 이 영영 안 나온다.
  //    실제로 변이 시험에서 주의만 39.0 으로 올려 보고 그 상태를 만들었다(analyzers 시험이 잡음).
  // ② **근거** — 숫자만 남으면 다음 사람이 "임상 기준은 37.5 인데" 하며 되돌린다. 되돌리면
  //    작업 중 정상 심박(100bpm→37.489℃)이 다시 주의로 칠해져 경보 42%가 돌아온다.
  const thr = readFileSync(
    join(ROOT, "..", "..", "packages", "analyzers", "src", "thresholds.ts"),
    "utf8",
  );
  const num = (k: string) => Number(thr.match(new RegExp(`${k}:\\s*([0-9.]+)`))?.[1]);
  const caution = num("cautionC");
  const danger = num("dangerC");
  assert.ok(Number.isFinite(caution) && Number.isFinite(danger), "임계 상수를 못 읽었다");
  assert.ok(caution < danger, `주의(${caution}) 가 위험(${danger}) 이상이다 — 주의 구간이 사라진다`);
  // 임상 발열 기준(37.5)으로 되돌아가지 않았는가 — 그 값이 이 산업 맥락에서 실패한 값이다.
  assert.ok(
    caution >= 38.0,
    `주의 임계 ${caution} — 38.0 미만이면 작업 중 정상 심박 대역이 다시 주의로 칠해진다(2026-08-26 실측 42%)`,
  );
  const near = thr.slice(Math.max(thr.indexOf("coreTemp: {") - 200, 0), thr.indexOf("cautionC:"));
  assert.match(near, /2026-08-26/, "상향 근거의 날짜 표기가 사라졌다");
  assert.match(near, /Buller|100bpm|37\.489/, "왜 37.5 가 작업 맥락에 안 맞는지가 사라졌다");
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
