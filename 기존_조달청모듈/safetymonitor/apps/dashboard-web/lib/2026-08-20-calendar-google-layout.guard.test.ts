// 일정 캘린더 레이아웃 가드 — 구글 캘린더식 격자를 되돌리지 않게 못 박는다(2026-08-20 · 사용자 지시).
//
// 발단. 캘린더를 탭으로 옮기니 **580px 팝업용 격자가 전폭으로 늘어나** 칸이 성기고,
// 패널 자체 높이 상한 때문에 하단(`선택 날짜 일정`)이 잘리며 스크롤바가 둘이 됐다.
//
// 바꾼 것 셋.
//   ① 선택을 **셀 통째 칠하기 → 숫자 원형·연한 배경**으로. 종전엔 셀이 파랗게 차서 그 안의
//      일정 칩·배지가 전부 "흰 글자" 분기를 따로 가졌고(10곳) 하루치 정보가 색으로 뭉개졌다.
//   ② `auto-rows-fr` — 주 행이 균등해진다(없으면 일정 많은 주만 길어져 들쭉날쭉).
//   ③ inline 은 높이 상한·자체 스크롤을 안 쓴다 — 페이지가 이미 스크롤한다.
//
// ★ 팝업과 탭이 **같은 컴포넌트**다. 한쪽만 고치면 두 화면이 갈리므로 variant 로만 가른다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");

const cal = (() => {
  const i = dash.indexOf("function HeaderCalendarPopup(");
  assert.ok(i >= 0, "캘린더 컴포넌트 소실(앵커)");
  return dash.slice(i, i + 80_000);
})();

test("앵커 — 격자와 셀이 실재한다", () => {
  assert.match(cal, /grid-cols-7/, "요일 격자 소실");
  assert.match(cal, /aria-pressed=\{isSelected\}/, "날짜 셀 버튼 소실");
});

// ── ① 선택은 셀을 통째로 칠하지 않는다
test("선택이 셀 전체를 파랗게 칠하지 않는다", () => {
  assert.doesNotMatch(
    cal,
    /isSelected\s*\n\s*\? "bg-primary text-on-primary"/,
    "선택이 다시 셀 통째 칠하기로 돌아갔다 — 그 안의 칩·배지가 흰 글자 분기를 다시 요구한다",
  );
  assert.match(cal, /isSelected\s*\n\s*\? "bg-primary-subtle ring-1 ring-primary-ring"/, "선택 표시가 사라졌다");
});

test("흰 글자 분기가 되살아나지 않았다 — 셀 안 배지·칩", () => {
  // 셀이 더는 파랗지 않으므로 `bg-white/20 text-white` 는 읽히지 않는 조합이 된다.
  assert.doesNotMatch(cal, /isSelected\s*\n?\s*\?\s*"bg-white\/20 text-white"/, "흰 글자 배지 분기가 되살아났다");
  assert.match(cal, /inverted=\{false\}/, "일정 칩 반전이 되살아났다");
});

test("오늘만 채운 원 — 원형이 유일해야 눈에 띈다", () => {
  assert.match(
    cal,
    /isToday\s*\n\s*\? "bg-primary font-bold text-on-primary"/,
    "오늘 표시(채운 원)가 사라졌다",
  );
});

// ── ② 주 행 균등
test("주 행이 균등하다 — auto-rows-fr", () => {
  assert.match(cal, /grid auto-rows-fr grid-cols-7/, "auto-rows-fr 소실 — 일정 많은 주만 길어진다");
});

// ── ③ inline 은 자체 스크롤·높이 상한을 안 쓴다
test("탭 본문은 두 번째 스크롤바를 만들지 않는다", () => {
  assert.doesNotMatch(
    cal,
    /inline\s*$[\s\S]{0,200}?\? "flex max-h-\[calc\(100dvh/m,
    "inline 패널에 높이 상한이 되살아났다 — 하단이 잘리고 스크롤바가 둘이 된다",
  );
  assert.match(
    cal,
    /inline\s*\n\s*\? "flex-1 overflow-visible"/,
    "inline 본문이 자체 스크롤을 다시 쓴다",
  );
});

// ★ 팝업 회귀 방지 — 두 화면이 갈리지 않게 variant 로만 가른다.
test("팝업 경로는 살아 있다 — 자체 스크롤·드래그 유지", () => {
  assert.match(cal, /wx-cards-scroll flex-1 overflow-y-auto/, "팝업 자체 스크롤이 사라졌다");
  assert.match(cal, /pointer-events-none fixed inset-0 z-50/, "팝업 오버레이가 사라졌다");
});
