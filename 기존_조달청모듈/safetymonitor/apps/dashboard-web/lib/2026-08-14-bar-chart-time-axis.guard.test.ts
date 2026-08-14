// 막대 차트 시간축 가드 — 라인↔막대 토글에서 같은 데이터가 다른 간격으로 보이면 실패한다.
//
// 배경 — 2026-08-13 에 선 차트만 시간축으로 바꾸고 막대는 카테고리 축에 남겼다(SpO₂ 1주일·`막대`
// 토글·낙상). 그래서 16시간 공백이 2시간 간격과 같은 폭으로 그려지고, 같은 데이터를 라인으로
// 보다가 막대로 토글하면 간격이 달라 보였다. **부분 적용이 "일부는 맞고 일부는 틀린" 상태를 만든다.**
//
// ★ recharts 동작은 실측으로 확정했다(SSR · recharts 2.15.4 · 2026-08-14).
//   불균등 6점(0·1·2·11·12·42h)을 600px 에 그렸을 때 —
//     카테고리 축  x=[95,183,272,360,448,537]  ← 균등(결함)
//     시간축      x=[60, 73, 85,199,211,590]  ← 시간 간격 반영
//   폭도 maxBarSize 안에서 자동 조절된다(3점 28px · 24점 19px · 60점 7px · 400점 1px).
//   ⚠ 활동 복합 차트가 `Customized` 로 직접 rect 를 그리는 것은 **시리즈별 `data`**(`<Bar data=…>`)
//     조합에서만 좌표가 깨지기 때문이다. 여기는 차트 레벨 `data` 라 그 우회가 필요 없다 —
//     같은 파일 안에 두 방식이 공존하는 이유를 지우지 말 것.
//
// 렌더 인프라가 없어(ResponsiveContainer 가 SSR 에서 크기 0) 축을 되돌려도 tsc·기존 테스트가
// 전부 통과한다. 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const charts = readFileSync(join(ROOT, "app", "components", "VitalChartsRecharts.tsx"), "utf8");
const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");

// 막대 차트 함수 구간만 — 파일 전체를 보면 설명 주석이 가드를 만족시킨다(08-13 에 실제로 겪었다).
function barFn(): string {
  const from = charts.indexOf("export function RechartsBarChart");
  assert.ok(from > 0, "RechartsBarChart 를 찾지 못했다 — 가드 재작성 필요");
  const to = charts.indexOf("\nexport function ", from + 10);
  return charts.slice(from, to > from ? to : undefined);
}

test("막대 차트가 창(domain)을 받는다", () => {
  assert.match(barFn(), /\n\s*domain: timeDomain,/, "창을 안 받으면 시간축 조건이 성립하지 않는다");
});

test("막대 X축이 시간축 설정을 편다(카테고리 고정으로 되돌아가지 않았다)", () => {
  const body = barFn();
  assert.match(body, /\n\s*const tAxis = timeAxis\(points, timeDomain\)/, "시간축 계산이 사라졌다");
  assert.match(
    body,
    /\n\s*\{\.\.\.\(tAxis \?\? \{ dataKey: xTickLabel \}\)\}/,
    "X축이 시간축을 안 쓰거나 폴백이 사라졌다",
  );
});

test("선·막대가 같은 timeAxis 를 공유한다", () => {
  // 각자 축을 만들면 한쪽만 규칙이 바뀌어 토글에서 간격이 갈린다 — 08-13→08-14 사이가 정확히 그 상태였다.
  assert.match(charts, /\nfunction timeAxis\(points: ChartPoint\[\], domain:/, "공용 헬퍼가 없다");
  assert.match(
    charts,
    /function timeAxisProps[\s\S]{0,200}?const axis = timeAxis\(points, domain\)/,
    "선 차트가 공용 헬퍼를 안 쓰고 축을 따로 만든다",
  );
});

test("막대는 결측 끊기(withTimeGaps)를 쓰지 않는다", () => {
  // 없는 버킷은 빈 공간으로 이미 정직하다. null 점을 넣으면 그리지도 않을 막대가 데이터에 섞여
  // 폭 자동계산만 흐트러진다.
  assert.doesNotMatch(barFn(), /withTimeGaps/, "막대가 결측 점을 데이터에 섞는다");
});

test("패널이 막대 차트에도 창을 넘긴다", () => {
  assert.match(
    panel,
    /<RechartsBarChart \{\.\.\.chartProps\} domain=\{timeDomain\} \/>/,
    "패널이 창을 안 넘기면 막대가 조용히 카테고리 축으로 떨어진다",
  );
});

test("tsMs 없는 경로는 카테고리 축으로 떨어진다(모의 낙상)", () => {
  // 낙상 탭은 아직 모의 데이터라 tsMs 가 없다. timeAxis 가 null 을 돌려 폴백해야 한다.
  const fn = charts.slice(charts.indexOf("function timeAxis("), charts.indexOf("function timeAxisProps"));
  assert.match(fn, /if \(!domain \|\| !hasFullTimestamps\(points\)\) return null;/, "폴백 조건이 사라졌다");
});
