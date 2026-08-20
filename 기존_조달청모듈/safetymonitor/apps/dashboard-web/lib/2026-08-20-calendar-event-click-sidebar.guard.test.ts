// 주간 격자에서 일정을 누르면 **수정 팝업이 아니라 사이드바 상세**가 뜬다 (2026-08-20 사용자 실측 버그).
//
// 발단 — 같은 격자에서 사진은 사이드바로, 일정만 수정 팝업으로 갔다. **클릭 규칙이 둘**이라
// 사용자가 사진에서 배운 규칙을 일정에 적용했고 화면이 다른 것을 했다. 수정은 사이드바 ✏️ 로
// 이미 갈 수 있어 중복 경로이기도 했다 — 읽으려던 클릭이 편집 모드를 여는 것은 되돌릴 것을 만든다.
//
// 결정 근거 = docs/calendar-week-view/context-notes.md (C-06)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");

test("앵커 — 클릭 핸들러와 사이드바 목록이 실재한다", () => {
  assert.ok(dash.includes("onOpenEvent={(e) => {"), "일정 클릭 핸들러 소실");
  assert.ok(dash.includes("function ScheduleDetail("), "상세 컴포넌트 소실");
  assert.ok(dash.includes("선택 날짜 일정"), "사이드바 목록 소실");
});

// ── ① 클릭이 수정 팝업을 열지 않는다
test("일정 클릭이 수정 폼을 열지 않는다", () => {
  const i = dash.indexOf("onOpenEvent={(e) => {");
  const body = dash.slice(i, dash.indexOf("onOpenMedia={", i));
  assert.doesNotMatch(body, /setFormEditId/, "클릭이 다시 수정 팝업을 연다 — 읽으려던 클릭이 편집 모드로 간다");
  assert.match(body, /setFocusEventId\(e\.id\)/, "사이드바 초점 지정이 사라졌다");
});

// ★ 수정 경로 자체는 남아 있어야 한다 — 팝업을 뗀 대신 갈 곳이 없으면 기능을 죽인 것이다.
test("수정 경로는 사이드바 ✏️ 로 남아 있다", () => {
  assert.match(dash, /aria-label=\{`\$\{event\.title\} 일정 수정`\}/, "사이드바 수정 버튼이 사라졌다");
  assert.match(dash, /aria-label=\{`\$\{event\.title\} 일정 삭제`\}/, "사이드바 삭제 버튼이 사라졌다");
});

// ── ② 기간 띠를 눌러도 선택 날짜가 시작일로 튀지 않는다
test("이미 걸친 날이면 선택 날짜를 옮기지 않는다", () => {
  assert.match(
    dash,
    /const covers = e\.dateKey <= k && \(e\.endDateKey \?\? e\.dateKey\) >= k;\s*\n\s*return covers \? prev : dateFromKey\(e\.dateKey\);/,
    "기간 일정 클릭이 선택 날짜를 시작일로 되돌린다 — 8/20 에서 눌렀는데 화면이 8/16 으로 튄다",
  );
});

// ── ③ 초점 유지 판정은 selectedEvents 기준
// ⚠ 사진 이펙트를 그대로 복사하면 `eventsByDate[selectedKey]` 를 쓰게 되는데, 기간 일정은
//   시작일 키에만 있어서 **걸친 날에서 초점이 즉시 풀린다**.
test("기간 일정이 걸친 날에서 초점이 풀리지 않는다", () => {
  assert.match(dash, /const selectedEventIds = selectedEvents\.map\(\(e\) => e\.id\)\.join\("\|"\);/, "id 서명 소실");
  const i = dash.indexOf("setFocusEventId((prev) => {");
  assert.ok(i >= 0, "초점 해제 이펙트 소실");
  const body = dash.slice(i, i + 400);
  assert.match(body, /selectedEventIds\.split\("\|"\)\.includes\(prev\)/, "초점 유지 판정이 selectedEvents 를 안 본다");
  assert.doesNotMatch(body, /eventsByDate\[selectedKey\]/, "판정이 시작일 키만 보게 됐다 — 기간 일정이 걸친 날에서 초점이 즉시 풀린다");
});

// ⚠ deps 에 배열을 넣으면 매 렌더 이펙트가 돈다.
test("이펙트 deps 는 배열이 아니라 문자열 서명이다", () => {
  const i = dash.indexOf("setFocusEventId((prev) => {");
  const tail = dash.slice(i, i + 500);
  assert.match(tail, /\}, \[selectedEventIds\]\);/, "deps 가 서명 문자열이 아니다 — 매 렌더 이펙트가 돈다");
});

// ── ④ 초점 스크롤은 한 번만 (사진 쪽에서 이미 겪은 버그)
test("초점 스크롤은 초점당 한 번 — 폴링마다 위로 끌려가지 않는다", () => {
  assert.match(dash, /const eventScrolledForRef = useRef<string \| null>\(null\);/, "스크롤 기록 소실");
  assert.match(
    dash,
    /if \(el && focused && eventScrolledForRef\.current !== event\.id\)/,
    "스크롤 1회 제한이 사라졌다 — 2초 폴링마다 사이드바가 위로 튄다",
  );
  assert.match(dash, /eventScrolledForRef\.current = null; \/\/ 같은 일정을 다시 눌러도/, "재클릭 시 기록 해제가 사라졌다");
});

// ── ⑤ 상세가 실제로 무엇을 보여주나 — 칩보다 더 주는 것이 있어야 클릭에 의미가 있다
test("상세는 칩에 없는 정보를 준다", () => {
  const i = dash.indexOf("function ScheduleDetail(");
  const body = dash.slice(i, dash.indexOf("\nfunction ", i + 10));
  for (const k of ["기간", "시각", "라벨", "위험작업", "등록"]) {
    assert.ok(body.includes(`"${k}"`), `상세에서 \`${k}\` 행이 사라졌다`);
  }
  assert.match(body, /event\.note\?\.trim\(\)/, "메모 표시가 사라졌다 — 등록 폼에만 있고 읽을 곳이 없어진다");
  assert.match(body, /whitespace-pre-wrap/, "메모 줄바꿈이 죽었다");
});

// ⚠ 모르는 위험작업 id 를 null 로 흘리면 행이 조용히 사라진다.
test("모르는 위험작업 id 도 화면에서 사라지지 않는다", () => {
  assert.match(
    dash,
    /hazardTypeName\(event\.hazardType\) \?\? event\.hazardType/,
    "모르는 위험작업 id 가 조용히 사라진다",
  );
});
