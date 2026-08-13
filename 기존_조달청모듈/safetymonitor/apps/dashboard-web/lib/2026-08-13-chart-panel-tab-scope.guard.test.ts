// 하단 차트 패널(작업자 생체·설비)이 관제 탭 밖으로 새는 것을 막는 가드.
//
// 왜 가드인가 — 두 패널은 SectionPager 바깥(페이지 레벨)에 렌더된다. 여는 표는 전부 관제 탭
// 안에 있는데 패널만 밖이라, 탭을 옮겨도 selection/siteChart 상태가 남아 있으면 안전뉴스·
// 안전관리비 검증·ERP 화면 맨 아래에 그대로 따라붙었다(2026-08-13 제보). 조건을 지워도
// 타입·기능 테스트가 전부 통과하므로(렌더 인프라 없음) 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

test("관제 탭 인덱스는 상수로 둔다 — 매직넘버는 탭 삽입 때 조용히 밀린다", () => {
  assert.match(dash, /const MONITOR_PAGE_IDX = 0;/, "페이지 인덱스 상수가 사라졌다");
});

test("작업자 생체 차트 — 관제 탭에서만 렌더한다", () => {
  assert.match(
    dash,
    /\{pagerIdx === MONITOR_PAGE_IDX && selection && \(\s*<VitalHistoryPanel/,
    "탭 조건이 없다 — 안전뉴스·안전관리비 검증·ERP 하단에 생체 차트가 따라붙는다",
  );
});

test("설비(가스·AED) 차트 — 관제 탭에서만 렌더한다", () => {
  assert.match(
    dash,
    /\{pagerIdx === MONITOR_PAGE_IDX && siteChart && \(\s*<SiteMetricChartPanel/,
    "탭 조건이 없다 — 다른 탭 하단에 설비 차트가 따라붙는다",
  );
});

test("실시간 수집 · DB 영속 스트립(+ data_mockup) — 관제 탭에서만 렌더한다", () => {
  // 2026-08-13 사용자 결정으로 안전관리비 검증 탭에서도 뺐다(종전엔 ERP·안전뉴스만 제외).
  // 스트립과 data_mockup 섹션은 같은 프래그먼트라 조건 하나가 둘을 함께 가린다.
  const at = dash.indexOf("실시간 수집 · DB 영속 스트립");
  assert.ok(at > 0, "스트립 주석을 찾지 못했다 — 가드 재작성 필요");
  const gateAt = dash.indexOf("{pagerIdx === MONITOR_PAGE_IDX && (", at);
  assert.ok(gateAt > at, "스트립 게이트가 없다 — 안전관리비 검증·ERP·안전뉴스에도 노출된다");
  const mockAt = dash.indexOf("data_mockup", gateAt);
  assert.ok(mockAt > gateAt, "data_mockup 섹션이 스트립 게이트보다 앞에 있다");
  assert.doesNotMatch(
    dash.slice(gateAt + 40, mockAt),
    /pagerIdx/,
    "게이트와 data_mockup 사이에 다른 탭 조건이 끼었다 — 둘이 한 조건을 공유하지 않는다",
  );
});

test("두 패널은 여전히 페이저 바깥에 있다 — 이 가드가 필요한 이유가 유지되는지 확인", () => {
  // 패널을 관제 탭 content 안으로 옮겼다면 위 두 가드는 형태가 달라져야 한다.
  // 여기서 실패하면 구조가 바뀐 것이니 가드 문구를 함께 손본다(조용히 무력화 방지).
  const pagerEnd = dash.lastIndexOf("<SiteSidePanels");
  const vitalAt = dash.indexOf("<VitalHistoryPanel");
  const siteAt = dash.indexOf("<SiteMetricChartPanel");
  assert.ok(siteAt > 0 && vitalAt > 0, "패널 렌더 지점을 찾지 못했다");
  assert.ok(siteAt < pagerEnd, "설비 차트 위치가 바뀌었다 — 가드 재작성 필요");
  assert.ok(vitalAt > pagerEnd, "생체 차트 위치가 바뀌었다 — 가드 재작성 필요");
});

test("상태는 지우지 않는다 — 탭 전환이 selection/siteChart 를 초기화하지 않는다", () => {
  // 렌더만 막고 상태는 유지해야 관제 탭 복귀 시 보던 차트가 그대로 남는다.
  // onPageChange 가 setSelection(null)/setSiteChart(null) 을 부르면 그 의도가 깨진다.
  assert.match(dash, /onPageChange=\{setPagerIdx\}/, "페이저 콜백이 바뀌었다 — 초기화 여부 재확인 필요");
});
