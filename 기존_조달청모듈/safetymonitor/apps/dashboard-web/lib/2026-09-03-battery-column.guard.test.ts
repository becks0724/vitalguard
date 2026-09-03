// 배터리 열·차트 가드 — 열이 한 칸 밀리지 않는가, 그리고 배터리가 모의 곡선을 얻지 않는가
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// ★ 이 가드의 한 문장 보장 = **배터리 열이 신호와 상태 사이에 정확히 한 칸으로 들어가고,
//   그 값은 절대 지어내지 않는다.**
//
// 왜 열 위치를 시험하는가. 표는 `TABLE_GRID`(CSS grid 열 정의)와 `cols`(헤더 라벨 배열)와
// 행의 자식 순서, **셋이 각자** 순서를 갖는다. 하나라도 어긋나면 컴파일도 되고 화면도 뜨지만
// **모든 라벨이 한 칸씩 밀린다** — 심박 자리에 SpO₂ 가 뜨는 식이라 오독이 즉시 사고가 된다.

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const board = read("app", "components", "DemoDashboard.tsx");
const panel = read("app", "components", "VitalHistoryPanel.tsx");
const histData = read("app", "api", "monitor", "vital", "history", "data.ts");
const histReal = read("app", "api", "monitor", "vital", "history", "real.ts");
const histRoute = read("app", "api", "monitor", "vital", "history", "route.ts");
const db = read("lib", "db.ts");

test("① 그리드 열 수 = 헤더 라벨 수", () => {
  const grid = /grid-cols-\[([^\]]+)\]/.exec(board);
  assert.ok(grid, "TABLE_GRID 의 grid-cols 정의를 못 찾았다");
  const gridCols = grid[1]!.split("_").length;
  const colsSrc = /const cols = \[(.*?)\];/s.exec(board);
  assert.ok(colsSrc, "헤더 cols 배열을 못 찾았다");
  const labels = [...colsSrc[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  assert.equal(
    gridCols,
    labels.length,
    `그리드 ${gridCols}열 vs 라벨 ${labels.length}개 — 한 칸이라도 어긋나면 표 전체가 밀린다`,
  );
  assert.equal(gridCols, 14, "배터리를 더해 14열이어야 한다");
});

test("② 배터리는 신호 바로 뒤·상태 바로 앞이다", () => {
  const colsSrc = /const cols = \[(.*?)\];/s.exec(board)!;
  const labels = [...colsSrc[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  const i = labels.indexOf("배터리");
  assert.notEqual(i, -1, "헤더에 배터리 라벨이 없다");
  assert.equal(labels[i - 1], "신호", "배터리가 신호 바로 뒤가 아니다(2026-09-03 사용자 지시)");
  assert.equal(labels[i + 1], "상태", "배터리가 상태 바로 앞이 아니다");
});

test("③ 행의 셀 순서도 같다 - 신호 → 배터리 → 상태", () => {
  // 헤더만 맞고 행이 어긋나면 라벨과 값이 갈린다. 세 자리의 소스 위치로 순서를 확인한다.
  const signal = board.indexOf("<SignalBars level={signal} />");
  const battery = board.indexOf('metricCell(\n        "battery"');
  const status = board.indexOf("{/* 11 상태");
  assert.ok(signal > 0, "신호 셀을 못 찾았다");
  assert.ok(battery > 0, "행에 배터리 셀이 없다 — 헤더만 늘리면 값이 한 칸씩 밀린다");
  assert.ok(status > 0, "상태 셀 주석을 못 찾았다");
  assert.ok(signal < battery, "배터리가 신호보다 앞에 있다");
  assert.ok(battery < status, "배터리가 상태보다 뒤에 있다");
});

test("④ battery 메트릭이 세 곳 모두에 등재돼 있다", () => {
  // 유니온이 세 파일에 각각 있다(서버 data.ts · 표 DemoDashboard · 차트 패널).
  // 하나라도 빠지면 탭은 뜨는데 요청이 400 이거나 타입이 any 로 새어 조용히 빈 차트가 된다.
  for (const [name, src] of [
    ["history/data.ts", histData],
    ["DemoDashboard.tsx", board],
    ["VitalHistoryPanel.tsx", panel],
  ] as const) {
    assert.match(src, /\|\s*"battery"/, `${name} 의 메트릭 유니온에 battery 가 없다`);
  }
  assert.match(histRoute, /"battery",/, "ALLOWED_METRICS·REAL_METRICS 에 battery 가 없다");
  assert.equal(
    (histRoute.match(/"battery",/g) ?? []).length,
    2,
    "battery 가 ALLOWED_METRICS·REAL_METRICS 두 곳에 다 있어야 한다(하나면 400 이거나 모의 경로로 샌다)",
  );
});

test("⑤ ★ 배터리는 모의 곡선을 얻지 않는다", () => {
  // 생체 모의값보다 나쁘다 — 관제자가 가짜 잔량 곡선을 보고 "아직 40% 남았네" 로 조치를 미룬다.
  assert.match(
    histData,
    /if \(metric === "battery"\) return 0;/,
    "모의 생성기가 배터리를 막지 않는다 — PROFILES 에 없어 런타임에 터지거나 가짜 곡선이 난다",
  );
  assert.match(histReal, /metric === "battery"/, "실데이터 경로에 battery 분기가 없다");
});

test("⑥ 충전 판정은 2·5 뿐이고 4는 제외돼 있다", () => {
  // ⚠ 4(NOT_CHARGING)는 이 워치가 배터리 보호 모드(90% 상한)로 독 위에 앉을 때 나올 수 있지만
  //   **실기로 확인한 적이 없다**(09-03 관측값은 3뿐). 근거 없는 음영을 그리지 않는다.
  //   확인되면 여기와 db.ts 한 줄씩만 고친다 — 워치는 원시 정수를 보내므로 재설치가 필요 없다.
  assert.match(
    db,
    /bool_or\(battery_status IN \(2, 5\)\)/,
    "충전 구간 판정이 2·5 가 아니다 — 4 를 넣었다면 실기 확인 근거가 함께 있어야 한다",
  );
  assert.match(
    board,
    /const isCharging = \(status: number \| undefined\) => status === 2 \|\| status === 5;/,
    "표 셀의 충전 판정이 서버(db.ts bool_or)와 갈렸다 — 같은 표본이 표와 차트에서 다르게 읽힌다",
  );
});

test("⑦ 모름(null)을 방전으로 접지 않는다", () => {
  // 구 표본에는 battery_status 가 없다. false 로 접으면 "방전 확인" 이라는 없는 사실이 그려진다.
  assert.match(
    histReal,
    /r\.charging === null \? \{\} : \{ charging: r\.charging \}/,
    "null 상태를 키 없이 넘기지 않는다 — 모름이 방전으로 접힌다",
  );
});
