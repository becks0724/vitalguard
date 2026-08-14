// 추세 차트 시간축 가드 — 카테고리 축으로 되돌아가면 실패한다.
//
// 왜 가드인가 — 카테고리 축은 점을 시간 간격과 무관하게 균등 배치한다. 밤새 측정이 없어
// 16시간이 비어도 2시간 간격과 같은 폭으로 그려지고 곡선이 매끄럽게 지나가
// "계속 측정됐다"로 읽힌다(2026-08-13 사용자 제보 — 체온 1주일 뷰).
// 되돌려도 tsc·lint·기존 테스트가 전부 통과하므로(렌더 인프라 없음) 소스 불변식으로 고정한다.
//
// 뿌리는 B1.8 이었다 — SpO₂ 점 차트에만 시간축을 넣고 선 차트는 카테고리로 남겼다.
// 그래서 "SpO₂ 는 맞고 심박·체온만 틀린" 상태가 한동안 보이지 않았다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatTimeTick, hasFullTimestamps, medianStepMs, withTimeGaps } from "./chart-gaps";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const charts = readFileSync(join(ROOT, "app", "components", "VitalChartsRecharts.tsx"), "utf8");
const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");
const real = readFileSync(join(ROOT, "app", "api", "mock", "history", "real.ts"), "utf8");

// ── 서버: 시간축의 원재료 ───────────────────────────────────────────────

test("real.ts — 심박·체온 점에 tsMs 를 싣는다(없으면 시간축이 발동하지 않는다)", () => {
  assert.match(real, /value: Math\.round\(Number\(r\.bpm\)\), tsMs: at/, "심박 점에 tsMs 없음");
  assert.match(real, /value: Math\.round\(\(b\.sum \/ b\.n\) \* 10\) \/ 10, tsMs: at/, "체온 점에 tsMs 없음");
});

// ── 클라: 축 종류와 선 끊기 ─────────────────────────────────────────────

test("선 차트 — 시간축(type=number)과 창 도메인을 쓴다", () => {
  // 2026-08-14 — 막대와 공유하려고 축 계산을 `timeAxis` 로 분리했다. 검사 대상도 그리로 옮긴다
  // (검사 위치를 안 옮기면 이 가드가 "축이 사라졌다"로 오탐한다 — 실제로 이 리팩터에서 걸렸다).
  const fn = charts.slice(charts.indexOf("function timeAxis("), charts.indexOf("function timeAxisProps"));
  assert.ok(fn.length > 0, "timeAxis 를 찾지 못했다 — 가드 재작성 필요");
  assert.match(fn, /type: "number" as const/, "카테고리 축으로 되돌아감");
  assert.match(fn, /\n\s*domain,/, "조회 창을 X 도메인으로 쓰지 않음");
});

test("선 차트 — 결측에서 선을 끊는다(withTimeGaps + connectNulls={false})", () => {
  // ⚠ 파일 전체를 대상으로 하면 **주석 문장**이 매칭돼 가드가 통과한다(실제로 겪음 —
  //    145행 설명 주석에 같은 문자열이 있어 음성 대조가 실패를 못 잡았다).
  //    그래서 ① 선 차트 함수 구간으로 좁히고 ② 줄머리 공백 뒤에 오는 실제 속성만 본다.
  const line = charts.slice(
    charts.indexOf("export function RechartsLineChart"),
    charts.indexOf("export function RechartsBarChart"),
  );
  assert.ok(line.length > 0, "선 차트 함수를 못 찾았다 — 가드 재작성 필요");
  assert.match(line, /\n\s*connectNulls=\{false\}/, "공백을 가로지르는 직선이 그려진다");
  // 결측 점을 실제로 만드는 곳(timeAxisProps)과 그걸 그리는 배선은 아래 테스트가 본다.
});

test("결측 삽입은 timeAxisProps 안에서 일어난다(선 차트가 실제로 그 데이터를 그린다)", () => {
  const fn = charts.slice(charts.indexOf("function timeAxisProps"), charts.indexOf("export function RechartsLineChart"));
  assert.match(fn, /\bdata: withTimeGaps\(points\)/, "timeAxisProps 가 원본 points 를 그대로 넘긴다");
  const line = charts.slice(
    charts.indexOf("export function RechartsLineChart"),
    charts.indexOf("export function RechartsBarChart"),
  );
  assert.match(line, /data=\{t \? t\.data : points\}/, "차트가 끊은 데이터를 안 쓰고 원본을 그린다");
});

test("패널 — 선 차트에 창을 넘긴다", () => {
  assert.match(
    panel,
    /<RechartsLineChart \{\.\.\.chartProps\} domain=\{timeDomain\} \/>/,
    "패널이 창을 안 넘기면 차트가 카테고리 축으로 떨어진다",
  );
});

test("tsMs 없는 경로는 카테고리 축으로 안전하게 떨어진다(모의 낙상)", () => {
  // 2026-08-14 — 폴백 조건도 `timeAxis` 로 옮겼다(선·막대 공용).
  const fn = charts.slice(charts.indexOf("function timeAxis("), charts.indexOf("function timeAxisProps"));
  assert.match(fn, /!hasFullTimestamps\(points\)\) return null/, "폴백이 사라짐");
  assert.match(charts, /\{\.\.\.\(t \? t\.axis : \{ dataKey: xTickLabel \}\)\}/, "폴백 축 배선이 사라짐");
});

// ── 순수 함수 동작 ──────────────────────────────────────────────────────

const H = 3_600_000;
const base = 1_786_000_000_000;
const pt = (h: number, v: number) => ({ date: "2026-08-12", value: v, tsMs: base + h * H });

test("withTimeGaps — 정상 간격은 그대로, 큰 공백만 끊는다", () => {
  // 1시간 간격 3개 → 16시간 공백 → 1시간 간격 2개
  const src = [pt(0, 1), pt(1, 2), pt(2, 3), pt(18, 4), pt(19, 5)];
  const out = withTimeGaps(src);
  assert.equal(out.length, 6, "빈 점이 정확히 1개 삽입돼야 한다");
  const nulls = out.filter((p) => p.value === null);
  assert.equal(nulls.length, 1);
  // 공백 한가운데(2시~18시 사이)에 놓여야 양 끝 실측점이 살아남는다.
  assert.ok(nulls[0]!.tsMs > src[2]!.tsMs && nulls[0]!.tsMs < src[3]!.tsMs);
  assert.deepEqual(
    out.filter((p) => p.value !== null).map((p) => p.value),
    [1, 2, 3, 4, 5],
    "실측점이 소실되면 안 된다",
  );
});

test("withTimeGaps — 간격이 고른 계열은 하나도 끊지 않는다", () => {
  const src = [pt(0, 1), pt(1, 2), pt(2, 3), pt(3, 4)];
  assert.equal(withTimeGaps(src).filter((p) => p.value === null).length, 0);
});

test("withTimeGaps — 점 1개면 끊을 근거가 없어 원본 그대로", () => {
  assert.deepEqual(withTimeGaps([pt(0, 1)]).length, 1);
});

test("medianStepMs — 이상치가 있어도 중앙값이 흔들리지 않는다", () => {
  const src = [pt(0, 1), pt(1, 2), pt(2, 3), pt(50, 4)];
  assert.equal(medianStepMs(src), H, "평균이었으면 16시간짜리 이상치에 끌려간다");
});

test("formatTimeTick — 표시 폭에 따라 서버 kstLabel 과 같은 granularity", () => {
  const noon = Date.UTC(2026, 7, 12, 3, 30); // KST 12:30
  assert.equal(formatTimeTick(noon, 86_400_000), "12:30");
  assert.equal(formatTimeTick(noon, 86_400_000 * 7), "08-12 12시");
  assert.equal(formatTimeTick(noon, 86_400_000 * 30), "08-12");
});

test("hasFullTimestamps — 하나라도 빠지면 false(부분 시간축 금지)", () => {
  assert.equal(hasFullTimestamps([{ tsMs: 1 }, { tsMs: 2 }]), true);
  assert.equal(hasFullTimestamps([{ tsMs: 1 }, {}]), false);
  assert.equal(hasFullTimestamps([]), false);
});
