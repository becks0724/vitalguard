// 캘린더 탭 어시스턴트 숨김 가드 (2026-08-20 · 사용자 결정).
//
// 캘린더 탭에서는 우하단 배치 어시스턴트(LLM) 위젯을 띄우지 않는다.
//
// ★ 이 연결은 프롭이 아니라 **body 표식 + CSS** 다. 위젯은 `createPortal(document.body)` 로
//   DemoDashboard 밖에 나가 있고, 그것을 렌더하는 `app/page.tsx` 는 서버 컴포넌트라
//   상태를 프롭으로 못 내린다. 그래서 세 조각이 **함께** 있어야 동작한다 —
//   ① DemoDashboard 가 표식을 쓴다  ② 위젯 루트에 클래스가 있다  ③ CSS 가 받는다.
//   하나만 빠져도 조용히 안 숨는다(에러가 안 난다).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");
const widget = readFileSync(join(ROOT, "app/components/AssignmentChatWidget.tsx"), "utf8");
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

test("앵커 — 세 파일이 실재한다", () => {
  assert.ok(dash.includes("const CALENDAR_PAGE_IDX"), "캘린더 탭 인덱스 소실");
  assert.ok(widget.includes("createPortal"), "위젯 포털 소실");
  assert.ok(css.length > 500, "globals.css 앵커 — 파일이 비면 금지 검사가 조용히 통과한다");
});

// ── 사슬 3고리. 하나라도 빠지면 안 숨는데 에러는 안 난다.
test("① DemoDashboard 가 탭 활성 시 body 표식을 쓴다", () => {
  assert.match(
    dash,
    /document\.body\.dataset\.hideAssistant = "1"/,
    "표식 쓰기가 사라졌다 — 캘린더 탭에서도 위젯이 뜬다",
  );
  assert.match(
    dash,
    /const hide = pagerIdx === CALENDAR_PAGE_IDX/,
    "숨김 조건이 캘린더 탭이 아니다",
  );
});

test("② 위젯 루트에 표식 클래스가 있다", () => {
  assert.match(widget, /className="assignment-chat-dock"/, "위젯 루트 클래스가 사라졌다 — CSS 가 붙을 데가 없다");
});

test("③ CSS 가 그 조합을 받는다", () => {
  assert.match(
    css,
    /body\[data-hide-assistant="1"\][\s\S]{0,40}\.assignment-chat-dock[\s\S]{0,40}display:\s*none/,
    "숨김 규칙이 사라졌다",
  );
});

// ★ 정리 없이 두면 다른 탭·로그아웃 후에도 위젯이 숨은 채 남는다.
test("탭을 벗어나면 표식을 지운다 — 위젯이 영영 숨지 않게", () => {
  const i = dash.indexOf("document.body.dataset.hideAssistant");
  const block = dash.slice(Math.max(0, i - 400), i + 400);
  const deletes = block.match(/delete document\.body\.dataset\.hideAssistant;/g) ?? [];
  assert.ok(
    deletes.length >= 2,
    `표식 삭제가 ${deletes.length}곳 — else 분기와 cleanup 둘 다 있어야 한다`,
  );
});

// ⚠ 다른 탭까지 숨기면 기능을 잃는다 — 조건이 캘린더 탭 하나여야 한다.
test("다른 탭에서는 위젯이 그대로다", () => {
  const i = dash.indexOf("const hide = pagerIdx === CALENDAR_PAGE_IDX");
  const block = dash.slice(i, i + 300);
  assert.doesNotMatch(block, /MONITOR_PAGE_IDX|pagerIdx !== /, "숨김 조건이 캘린더 탭 밖으로 번졌다");
});
