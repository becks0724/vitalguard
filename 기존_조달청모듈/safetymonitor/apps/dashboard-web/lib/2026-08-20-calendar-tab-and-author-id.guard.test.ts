// 일정 캘린더 탭 + 댓글 작성자 식별자 통일 가드 (2026-08-20).
//
// ① 캘린더를 헤더 아이콘과 탭 **두 자리**에서 연다. 본문을 복제하면 한쪽만 고쳐 화면이 갈리므로
//    같은 컴포넌트의 `variant` 로만 가른다.
// ② 탭을 하나 늘렸다 — 파일 상단이 경고한 "매직넘버가 밀린다" 가 실제로 걸리는 순간이라
//    인덱스 참조가 전부 상수여야 한다.
// ③ 댓글 작성자 식별자를 위쪽 메타데이터(`작업자 … · EMP-6861`)와 같은 사번으로 맞춘다.
//    저장값은 로그인 ID 그대로 두고 **표시만** worker_alias 로 접는다 — 값을 바꾸면
//    댓글 수정·삭제 권한 판정이 깨진다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");
const route = readFileSync(join(ROOT, "app/api/calendar/media/comment/route.ts"), "utf8");

test("앵커 — 캘린더 컴포넌트와 권한 판정이 실재한다", () => {
  assert.ok(dash.includes("function HeaderCalendarPopup("), "캘린더 컴포넌트 소실");
  assert.ok(dash.includes("const MONITOR_PAGE_IDX"), "탭 인덱스 상수 소실");
  assert.ok(route.includes("function commentScope"), "commentScope 소실");
});

// ── ① 한 컴포넌트, 두 자리
test("캘린더는 팝업·탭 두 자리에서 같은 컴포넌트를 쓴다", () => {
  const uses = dash.match(/<HeaderCalendarPopup/g) ?? [];
  assert.equal(uses.length, 2, `HeaderCalendarPopup 사용이 ${uses.length}곳 — 팝업·탭 2곳이어야 한다`);
  assert.match(dash, /variant\?: "popup" \| "inline"/, "variant 프롭 소실 — 본문이 복제됐을 수 있다");
  assert.match(dash, /variant="inline"/, "탭이 inline 변형을 안 쓴다");
});

test("inline 은 오버레이·드래그·닫기를 걸치지 않는다", () => {
  const i = dash.indexOf("function HeaderCalendarPopup(");
  const body = dash.slice(i, i + 60_000);
  // 탭 본문이 fixed 오버레이를 쓰면 페이지 전체를 덮는다.
  assert.match(body, /inline \? "" : "pointer-events-none fixed inset-0 z-50"/, "inline 이 오버레이를 벗지 않았다");
  // 페이지가 곧 캘린더라 닫을 대상이 없다 — 닫기가 뜨면 탭이 사라진 것처럼 보인다.
  assert.match(body, /\{!inline && \(\s*<button/, "inline 에서 닫기 버튼이 감춰지지 않는다");
  // 페이저가 표시 여부를 정하므로 open 게이트를 타면 탭이 영영 빈 화면이다.
  assert.match(body, /if \(!inline && !open\) return null;/, "inline 이 open 게이트에 막힌다");
});

// ── ② 탭 인덱스
test("탭 인덱스 참조에 생 리터럴이 없다 — 탭을 늘리면 조용히 밀린다", () => {
  const raw = dash.match(/pagerIdx\s*[=!]==\s*\d/g) ?? [];
  assert.equal(raw.length, 0, `생 리터럴 비교가 ${raw.length}곳 남았다: ${raw.join(", ")}`);
  assert.ok(dash.includes("pagerIdx === MONITOR_PAGE_IDX"), "상수 비교가 사라졌다");
});

// ── ③ 작성자 식별자 — 표시만 접고 값은 지킨다
test("댓글 작성자 식별자를 사번으로 맞춘다 — 접히면 사번, 아니면 정직하게 ID", () => {
  const i = dash.indexOf("{c.authorId && (");
  assert.ok(i >= 0, "작성자 식별자 렌더 소실(앵커)");
  const block = dash.slice(i, i + 700);
  assert.match(block, /workerAliases\?\.\[c\.authorId\]/, "별칭 접힘이 사라졌다 — 로그인 ID 가 그대로 뜬다");
  assert.match(block, /· 사번 \$\{workerAliases\[c\.authorId\]\}/, "접힌 값을 사번으로 안 쓴다");
  // ⚠ 접히지 않는 계정에 `사번` 라벨을 붙이면 원래 결함으로 돌아간다.
  assert.match(block, /· ID \$\{c\.authorId\}/, "미접힘 폴백이 사라졌다");
  assert.doesNotMatch(block, /· 사번 \$\{c\.authorId\}/, "로그인 ID 에 `사번` 라벨이 되살아났다");
});

test("권한 판정은 저장된 작성자 ID 대조 그대로다 — 표시 변경이 새지 않았다", () => {
  const i = route.indexOf("function commentScope");
  const body = route.slice(i, route.indexOf("\n}", i));
  assert.match(body, /who\.username/, "commentScope 가 로그인 ID 대조를 그만뒀다");
  assert.doesNotMatch(body, /alias|사번|employeeId/i, "권한 판정이 별칭·사번을 보기 시작했다");
});
