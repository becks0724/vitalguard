// 활동(작업 강도) 추세 탭 가드 — 설계 경계가 조용히 풀리면 실패한다(2026-08-13 사용자 승인 트랙).
//   ① 활동은 실데이터 경로 전용 — 모의 곡선 생성기가 활동을 만들면 가짜 강도 추세가 된다
//   ② 시계열 계약 — 버킷 합 + tsMs 동봉(시간축·결측 끊기·심박과 동일 계약)
//   ③ 심박 오버레이는 ≤1주 뷰만 — 장기 심박 일평균은 착용 시간의 함수(체온 상한과 같은 원칙)
//   ④ 복합 차트의 심박 선은 결측에서 끊는다(공백 가로지르는 직선 금지)
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const route = readFileSync(join(ROOT, "app", "api", "mock", "history", "route.ts"), "utf8");
const dataTs = readFileSync(join(ROOT, "app", "api", "mock", "history", "data.ts"), "utf8");
const real = readFileSync(join(ROOT, "app", "api", "mock", "history", "real.ts"), "utf8");
const panel = readFileSync(join(ROOT, "app", "components", "VitalHistoryPanel.tsx"), "utf8");
const charts = readFileSync(join(ROOT, "app", "components", "VitalChartsRecharts.tsx"), "utf8");

// 옆 세션 교훈(2026-08-13) 반영 — 파일 전체 매칭은 주석에 속는다. 함수/블록 구간을 잘라 검사한다.
function section(src: string, marker: string, len = 2500): string {
  const i = src.indexOf(marker);
  assert.ok(i >= 0, `구간 마커 없음: ${marker}`);
  return src.slice(i, i + len);
}

test("① 라우트 — activity 는 실데이터 경로(REAL_METRICS) · 모의 생성기는 0 방어선", () => {
  assert.match(route, /REAL_METRICS: RealMetric\[\] = \[[^\]]*"activity"/);
  assert.match(dataTs, /if \(metric === "activity"\) return 0;/, "모의 방어선이 사라짐");
});

test("② real.ts — 활동 = 구간 합 쿼리 + tsMs 동봉(시간축 계약)", () => {
  const s = section(real, 'if (metric === "activity")');
  assert.match(s, /activeEnergyBucketSums\(/, "구간 합 쿼리가 아님");
  assert.match(s, /tsMs: at/, "tsMs 동봉이 빠짐 — 이 시리즈만 카테고리 축으로 떨어져 시간이 어긋난다");
});

test("③ 패널 — 심박 오버레이는 ≤1주 창에서만·활동은 라이브 덮기 제외", () => {
  // 마커는 렌더 분기 고유 주석으로 — `=== "activity" &&` 는 빈 상태 안내문에 먼저 걸린다(실측).
  const s = section(panel, "// 활동 = 복합 차트(막대 kcal", 1600);
  assert.match(s, /spanMs <= 86_400_000 \* 7\.01/, "오버레이 기간 상한이 사라짐");
  assert.match(panel, /selection\.metric !== "activity" &&/, "활동 liveOverride 제외가 사라짐");
});

test("④ 복합 차트 — 심박 선은 withTimeGaps + connectNulls=false + dot 없음", () => {
  // 고정 길이 창은 코드가 자라면 검사 대상이 창 밖으로 밀린다(Customized 추가로 실제 발생) —
  // 컴포넌트 시작~심박 선 블록까지 넉넉히 자르고, 선 속성은 심박 Line 앵커에서 정밀 검사.
  const s = section(charts, "export function RechartsActivityComboChart", 8000);
  assert.match(s, /withTimeGaps\(heartRate\)/, "심박 결측 끊기가 사라짐");
  const hrLine = section(s, 'name="심박 (bpm)"', 500);
  assert.match(hrLine, /^\s*connectNulls=\{false\}/m, "끊긴 자리를 직선으로 잇게 됨");
  assert.match(hrLine, /^\s*dot=\{false\}/m, "결측 null 점에 점이 찍히는 경로가 열림");
});

test("패널 탭 — 활동이 메트릭 목록에 있고 라벨 단위는 kcal", () => {
  assert.match(panel, /"heartRate", "spo2", "coreTempEst", "activity", "fall"/);
  assert.match(panel, /activity: \{ name: "활동", unit: "kcal"/);
});
