// 작업자 표 열 폭 가드 — 여백이 한 열로 쏠리거나 열 수가 헤더와 어긋나면 실패한다.
//
// 배경(2026-08-14 사용자 제보) — 관제 표에서 「작업자」와 「직급」 사이만 크게 벌어지고
// 나머지 생체 데이터 열들은 서로 붙어 있었다. 원인은 13개 트랙 중 작업자 열만 `1.2fr`(가변)이라
// 넓은 화면의 남는 폭을 그 열 혼자 흡수한 것이다(1267px 폭에서 작업자 열 295px · 이름은 80px).
// 같은 이유로 스트레스 열(5rem)은 「스트레스 38 · 심박 기반」 칩(≈116px)을 담지 못해 넘치고 있었다.
//
// 폭은 tsc·lint·기존 테스트가 전혀 보지 않는 값이라 조용히 되돌아간다. 소스 불변식으로 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dash = readFileSync(join(ROOT, "app", "components", "DemoDashboard.tsx"), "utf8");

// 정규식 첫 그룹을 꺼낸다. 못 찾으면 조용히 통과하지 않고 멈춘다.
function capture(re: RegExp, what: string): string {
  const m = dash.match(re);
  assert.ok(m?.[1], `${what} 를 찾지 못했다 — 가드 재작성 필요`);
  return m[1];
}

// `grid-cols-[a_b_c]` 의 트랙 목록. minmax(...) 안의 콤마는 구분자가 아니므로 `_` 로만 자른다.
// 파일에 다른 grid-cols 가 있으므로 TABLE_GRID 선언 안에서만 찾는다.
function gridTracks(): string[] {
  return capture(
    /const TABLE_GRID =[\s\S]{0,80}?grid-cols-\[([^\]]+)\]/,
    "TABLE_GRID 의 grid-cols-[…]",
  ).split("_");
}

// 헤더 라벨 배열(빈 문자열 포함) — 트랙 수와 1:1 이어야 한다.
function headerLabels(): string[] {
  return capture(/const cols = \[([^\]]+)\]/, "WorkerTableHeader 의 cols 배열").split(",");
}

// 트랙 하나. 열이 사라졌으면 undefined 를 통과시키지 않고 멈춘다.
function trackAt(i: number): string {
  const t = gridTracks()[i];
  assert.ok(t, `${i}번 트랙이 없다 — 열 구성이 바뀌었으니 가드를 다시 맞춰야 한다`);
  return t;
}

test("열 수가 헤더 라벨 수와 일치한다", () => {
  // 어긋나면 헤더와 셀이 통째로 한 칸씩 밀린다(오류 없이 조용히).
  assert.equal(gridTracks().length, headerLabels().length);
});

test("작업자 열이 남는 폭을 혼자 흡수하지 않는다", () => {
  assert.doesNotMatch(
    trackAt(1),
    /fr/,
    "작업자 열이 가변 트랙으로 되돌아갔다 — 넓은 화면에서 직급까지의 여백이 다시 벌어진다",
  );
});

test("남는 폭은 생체 데이터 열들이 나눠 갖는다", () => {
  // 가변 트랙이 하나도 없으면 여백이 마지막 열 뒤에 통째로 남아 표가 오른쪽에서 끊긴다.
  const flexible = gridTracks().filter((t) => t.includes("fr"));
  assert.ok(flexible.length >= 6, `가변 트랙이 ${flexible.length}개뿐 — 여백 분배가 깨졌다`);
});

test("스트레스 열이 「· 심박 기반」 칩 폭을 담는다", () => {
  // 칩은 whitespace-nowrap·shrink-0 이라 열이 좁으면 줄지 않고 이웃 열 위로 넘친다.
  const stress = trackAt(7);
  const m = stress.match(/minmax\(([\d.]+)rem/);
  const min = m?.[1] === undefined ? NaN : Number(m[1]);
  assert.ok(min >= 7.5, `스트레스 열 최소폭 ${stress} — 칩(≈7.25rem)이 이웃 열로 넘친다`);
});
