// 등록 폼은 **빈 칸에서만** 열린다 (2026-08-20 사용자 지시).
//
// 발단 — 8/18 은 `행안부 공모전 준비 기간`(8/10~9/30 종일)이 덮는 날인데, 그 날의 시간 칸을 누르니
// 등록 폼이 떠서 **사이드바에 이미 떠 있던 상세를 폼이 덮었다.** 사용자가 보려던 것을 가린 것이다.
//
// 규칙 — 시각이 없는 일정(종일·기간)은 **그 날 전체**를 차지한다. 시각이 있으면 `[시작, 끝)` 만.
// ★ 등록 경로는 안 없어진다 — 사이드바 `+ 일정 추가` 가 그대로다(사용자 확인).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");

test("앵커 — 판정 헬퍼와 시간 칸이 실재한다", () => {
  assert.ok(dash.includes("function eventsOnDate("), "걸치는 일정 헬퍼 소실");
  assert.ok(dash.includes("function eventOccupyingSlot("), "칸 점유 판정 소실");
  assert.ok(dash.includes("onCreateAt(d, `${String(h).padStart(2, \"0\")}:00`)"), "시간 칸 등록 호출 소실");
});

// ── ① 무조건 등록 폼으로 돌아가지 않는다
test("차 있는 칸은 등록 폼이 아니라 그 일정을 연다", () => {
  assert.match(
    dash,
    /occupied \? onOpenEvent\(occupied\) : onCreateAt\(d, `\$\{String\(h\)\.padStart\(2, "0"\)\}:00`\)/,
    "빈 칸 판정이 사라졌다 — 일정이 있어도 등록 폼이 떠서 사이드바 상세를 덮는다",
  );
});

// ★ 등록 경로 자체는 살아 있어야 한다 — 폼을 못 여는 것이 목적이 아니다.
// ⚠ 앵커를 `"선택 날짜 일정"` 문자열로 잡으면 **주석이 먼저 걸린다**(같은 말이 설명에도 있다).
//   실제로 첫 판이 그래서 창 밖 30,934자를 봤다. JSX 텍스트 노드로 못 박는다.
test("등록 경로는 사이드바 `+ 일정 추가` 로 남아 있다", () => {
  const i = dash.indexOf(">선택 날짜 일정</p>");
  assert.ok(i >= 0, "사이드바 목록 앵커 소실");
  const block = dash.slice(i, dash.indexOf("</button>", i) + 9);
  assert.match(block, /일정 추가/, "사이드바 등록 버튼이 사라졌다 — 등록할 길이 없어진다");
  assert.match(block, /setFormEditId\(null\);\s*\n\s*setFormDate\(selected\);/, "등록 버튼이 폼을 안 연다");
});

// ── ② 판정에 걸치는 일정이 들어간다 (이 레포가 세 번 밟은 자리)
test("빈 칸 판정이 기간 일정을 놓치지 않는다", () => {
  assert.match(dash, /const dayAll = eventsOnDate\(eventsByDate, key\);/, "걸치는 일정을 안 본다");
  assert.match(dash, /eventOccupyingSlot\(dayAll, h\)/, "판정이 dayAll 이 아닌 것을 본다");
  // `eventsByDate[key]` 를 그대로 넘기면 기간 일정이 시작일에만 있어 걸친 날에서 빠진다.
  assert.doesNotMatch(dash, /eventOccupyingSlot\(dayEvents, h\)/, "판정이 시작일 키만 본다 — 기간 일정이 빠진다");
});

test("걸치는 일정 규칙이 한 곳에 있다 — 사이드바와 격자가 같은 것을 쓴다", () => {
  assert.match(dash, /const selectedEvents = eventsOnDate\(eventsByDate, toDateKey\(selected\)\);/, "사이드바가 헬퍼를 안 쓴다");
  // 규칙이 두 벌이면 하나만 고쳤을 때 화면이 갈린다(오늘 세 번 난 형태).
  const inline = dash.match(/isSpanEvent\(e\) && !seen\.has\(e\.id\)/g) ?? [];
  assert.equal(inline.length, 1, `걸침 판정이 ${inline.length}곳 — 헬퍼 한 곳이어야 한다`);
});

// ── ③ 점유 규칙 — 종일은 하루 전체, 시각 있으면 그 구간만
test("시각 없는 일정(종일·기간)은 그 날 전체를 차지한다", () => {
  const i = dash.indexOf("function eventOccupyingSlot(");
  const body = dash.slice(i, dash.indexOf("\nfunction ", i + 10));
  assert.match(body, /dayEvents\.find\(\(e\) => hhmmToMinutes\(e\.startTime\) === null\) \?\? null/, "종일 점유가 사라졌다");
});

test("시각 있는 일정은 겹치는 칸만 차지한다 — 끝이 없으면 1시간", () => {
  const i = dash.indexOf("function eventOccupyingSlot(");
  const body = dash.slice(i, dash.indexOf("\nfunction ", i + 10));
  assert.match(body, /const end = en !== null && en > s \? en : s \+ 60;/, "기본 1시간 관례가 어긋났다");
  assert.match(body, /return s < slotEnd && end > slotStart;/, "구간 겹침 판정이 사라졌다");
});

// ⚠ 시각 있는 쪽을 먼저 고른다 — 그 칸을 더 구체적으로 가리키는 일정이 사이드바에 떠야 한다.
test("한 칸에 둘이 겹치면 시각 있는 쪽을 고른다", () => {
  const i = dash.indexOf("function eventOccupyingSlot(");
  const body = dash.slice(i, dash.indexOf("\nfunction ", i + 10));
  const timedIdx = body.indexOf("const timed = dayEvents.find(");
  const allDayIdx = body.indexOf("hhmmToMinutes(e.startTime) === null) ?? null");
  assert.ok(timedIdx >= 0 && allDayIdx > timedIdx, "종일이 시각 있는 일정보다 먼저 잡힌다");
});
