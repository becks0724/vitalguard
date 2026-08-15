// 라인/막대 토글 정직성 가드 — 눌러도 안 바뀌는 버튼을 보여주면 실패한다.
//
// 배경(2026-08-15 사용자 제보) — SpO₂ 1주일에서 라인/막대를 번갈아 눌러도 **화면이 똑같았다**.
// 사용자 표현 그대로 *"라인/막대 동일한 차트. 구분이 의미 없음"*. 원인은 `isBar` 가 지표로
// 강제하기 때문이고(희소 이벤트를 곡선으로 이으면 "그 사이에도 값이 있었다"가 된다 — 08-12 결정)
// 동작 자체는 옳다. 잘못은 **그 지표에서도 토글을 보여준 것**이다.
//
// 이 레포가 반복해 고쳐 온 계열이다 — 화면이 사실과 다른 것을 말한다.
// 여기서 거짓은 "이 지표에 두 가지 보기가 있다" 이고, 사용자에겐 고장으로 읽힌다.
//
// ★ 가장 위험한 회귀는 "토글을 되살리는 것"이 아니라 **두 목록이 갈리는 것**이다.
//   토글 노출 조건과 `isBar` 강제 목록이 어긋나면, 버튼이 보이는데 눌러도 안 바뀌거나
//   반대로 바뀌는데 버튼이 없다. 그래서 **같은 상수 하나**를 두 곳이 공유하도록 묶었다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");
const charts = readFileSync(join(ROOT, "app", "components", "VitalChartsRecharts.tsx"), "utf8");

test("고정 지표 집합이 상수 하나로 존재한다", () => {
  assert.match(
    panel,
    /const METRIC_FIXED_CHART = new Set\(\["activity", "spo2", "fall"\]\)/,
    "집합이 사라졌거나 목록이 바뀌었다 — 바꿨다면 렌더 분기와 함께 바꿨는지 확인할 것",
  );
});

test("토글 노출이 그 상수를 본다(하드코딩 조건으로 되돌아가지 않았다)", () => {
  assert.match(
    panel,
    /\{!METRIC_FIXED_CHART\.has\(selection\.metric\) && \(/,
    "토글이 항상 보이거나 지표를 직접 나열한다 — 후자는 isBar 와 갈릴 수 있다",
  );
  // 종전 형태(활동만 감춤)로 되돌아가면 SpO₂·낙상에서 다시 죽은 버튼이 뜬다.
  assert.doesNotMatch(
    panel,
    /\{selection\.metric !== "activity" && \(/,
    "활동만 감추던 조건이 되살아났다 — SpO₂·낙상 토글이 다시 거짓말을 한다",
  );
});

test("★ 렌더 분기가 토글 노출과 같은 상수를 쓴다", () => {
  // 두 곳이 각자 목록을 들면 반드시 갈린다 — 이 가드의 핵심.
  assert.match(
    panel,
    /const isBar =\s*\n?\s*METRIC_FIXED_CHART\.has\(selection\.metric\) \|\| chartType === "bar";/,
    "isBar 가 상수를 안 쓰고 지표를 직접 나열한다 — 토글 노출 조건과 갈린다",
  );
  assert.doesNotMatch(
    panel,
    /const isBar = selection\.metric === "fall" \|\| selection\.metric === "spo2"/,
    "isBar 가 하드코딩 목록으로 되돌아갔다",
  );
});

test("라인/막대가 실제로 갈리는 지표는 토글이 남아 있다", () => {
  // 과잉 적용 방지 — 심박·체온추정까지 감추면 기능을 없앤 것이다.
  const m = panel.match(/const METRIC_FIXED_CHART = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "집합을 찾지 못했다");
  for (const keep of ["heartRate", "coreTempEst"]) {
    assert.doesNotMatch(
      m[1] ?? "",
      new RegExp(`"${keep}"`),
      `${keep} 은 라인↔막대가 실제로 갈린다 — 감추면 기능을 잃는다`,
    );
  }
});

test("감추는 이유가 코드에 남아 있다", () => {
  // 근거 없이 목록만 있으면 다음 사람이 "왜 여긴 토글이 없지" 하고 되살린다.
  assert.match(panel, /눌러도 안 변하는 버튼은 고장으로 읽힌다/, "상수 주석의 근거가 사라졌다");
  assert.match(panel, /같은 근거를 공유한다/, "두 곳이 묶여 있다는 설명이 사라졌다");
});

// ── SpO₂ 표현 방식: ≤7일 원본 점 = 점 차트 (2026-08-15) ────────────────────
// 1주일 막대가 1~2px 헤어라인이 되던 문제. 폭으로는 못 고친다 — 넓히면 위치가 왜곡된다.
// 서버(real.ts)가 `spanDays <= 7` 까지 **원본 점**을 주고 30일+ 만 일평균이므로 그 경계와 맞춘다.
test("SpO₂ 점 차트 경계가 서버 원본-점 구간(≤7일)과 일치한다", () => {
  const m = panel.match(/const spo2Dots =[\s\S]*?typeof p\.tsMs === "number"\);/);
  assert.ok(m, "spo2Dots 조건을 찾지 못했다 — 가드 재작성 필요");
  assert.match(
    m[0],
    /86_400_000 \* 7\.01/,
    "24시간으로 되돌아갔다 — 1주일이 다시 헤어라인 막대가 된다",
  );
});

test("30일+ 는 점 차트로 넘기지 않는다(일평균 집계 구간)", () => {
  // 집계값을 '측정 시각의 점'으로 그리면 없는 측정을 있는 것처럼 찍는다.
  const m = panel.match(/const spo2Dots =[\s\S]*?typeof p\.tsMs === "number"\);/);
  assert.ok(m);
  const mult = m[0].match(/86_400_000 \* ([\d.]+)/);
  assert.ok(mult?.[1], "경계 배수를 못 읽었다");
  assert.ok(Number(mult[1]) < 30, `경계 ${mult[1]}일 — 일평균 구간까지 점으로 그린다`);
});

test("주석이 코드와 같은 경계를 말한다", () => {
  // 임계만 바꾸고 주석을 두면 다음 사람이 옛 규칙을 믿는다(이 커밋에서 실제로 한 번 어긋났다).
  const m = panel.match(/\/\/ SpO₂ = 희소 이벤트 측정[\s\S]*?const spo2Dots =/);
  assert.ok(m, "설명 주석이 사라졌다");
  assert.match(m[0], /≤7일/, "주석이 여전히 24시간 기준을 말한다");
  assert.doesNotMatch(m[0], /24시간 뷰는 실제 측정 시각 위치의 점/, "옛 주석이 남아 있다");
});

// ── 점 차트 눈금 라벨: 기간에 맞춰 날짜를 붙인다 (2026-08-15 라이브 회귀) ──────
// 7일 뷰를 열었더니 x축이 `15:05 19:05 23:05 03:05 07:05 11:05 15:05` — **하루처럼 보였다**.
// 데이터·도메인·점 위치는 전부 정확했고 **라벨만** 틀렸다. 원인은 `kstHm`(시:분 고정)이
// 하루 뷰 전용인데 7일에도 쓰인 것 — 눈금 간격 28시간의 24 나머지가 4시간이라
// 정확히 4시간 간격처럼 찍힌다. 값이 맞아서 **더 설득력 있게 틀리는** 형태다.
function dotChartFn(): string {
  const from = charts.indexOf("export function RechartsTimeDotChart");
  assert.ok(from > 0, "RechartsTimeDotChart 를 찾지 못했다 — 가드 재작성 필요");
  const to = charts.indexOf("\nexport function ", from + 10);
  return charts.slice(from, to > from ? to : undefined);
}

test("점 차트 눈금이 기간별 포맷(formatTimeTick)을 쓴다", () => {
  const fn = dotChartFn();
  assert.match(fn, /const spanMs = domain\[1\] - domain\[0\];/, "spanMs 계산이 사라졌다");
  assert.match(
    fn,
    /tickFormatter=\{\(v: number\) => formatTimeTick\(v, spanMs\)\}/,
    "눈금 포맷이 기간을 안 본다",
  );
});

test("★ 시:분 고정 포맷이 되살아나지 않았다", () => {
  // 시:분만 찍는 포맷으로 되돌리면 7일이 하루처럼 보인다 — 값은 맞고 축만 거짓말한다.
  // ⚠ 이름을 그냥 찾으면 **이 결함을 설명하는 주석**이 매칭돼 가드가 실패한다(작성 중 실제로 걸렸다.
  //    08-13 시간축 가드에서 겪은 것과 같은 함정). 그래서 **호출 형태**만 본다.
  assert.doesNotMatch(dotChartFn(), /kstHm\s*\(/, "시:분 고정 포맷 호출이 점 차트에 되살아났다");
  // 포맷터 자리에 시:분만 만드는 인라인 표현이 들어오는 경우도 막는다.
  assert.doesNotMatch(
    dotChartFn(),
    /tickFormatter=\{[^}]*getUTCHours/,
    "포맷터가 시:분을 직접 조립한다 — 기간별 규칙을 우회했다",
  );
});

test("28시간 눈금이 4시간처럼 보이는 조건을 기록해 둔다(재현 계산)", () => {
  // 이 산수가 회귀의 정체다 — 주석이 사라지면 다음 사람이 같은 실수를 한다.
  const tickHours = (7 * 24) / 6;
  assert.equal(tickHours, 28, "7일/6등분 = 28시간");
  assert.equal(tickHours % 24, 4, "24 나머지 4시간 — 시:분만 찍으면 4시간 간격으로 보인다");
  assert.match(dotChartFn(), /28시간/, "이 함정을 설명하는 주석이 사라졌다");
});
