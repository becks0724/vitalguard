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

// ── ① 캘린더 진입점은 탭 하나다
// ⚠ 전제가 바뀌었다(2026-08-20 사용자 결정) — 헤더 아이콘·팝업을 걷어냈다.
//   종전 이 가드는 "팝업·탭 2곳"을 못 박았는데, 탭으로 기능이 이전돼 **1곳**이 맞다.
test("캘린더 진입점은 탭 하나뿐이다 — 헤더 아이콘·팝업은 걷어냈다", () => {
  const uses = dash.match(/<HeaderCalendarPopup/g) ?? [];
  assert.equal(uses.length, 1, `HeaderCalendarPopup 사용이 ${uses.length}곳 — 탭 1곳이어야 한다`);
  assert.match(dash, /variant="inline"/, "탭이 inline 변형을 안 쓴다");
  // 팝업을 여는 경로가 남아 있으면 걷어낸 의미가 없다.
  assert.doesNotMatch(dash, /setCalendarOpen\(true\)/, "팝업을 여는 호출이 되살아났다");
  assert.doesNotMatch(dash, /tooltip: "일정 캘린더 — 새 현장 사진 알림"/, "헤더 캘린더 아이콘이 되살아났다");
});

// ★ 아이콘을 지우면서 알림을 잃지 않았는지 — 토스트·칩이 탭으로 보내야 한다.
test("새 현장 사진 토스트와 위험작업 칩이 캘린더 탭으로 보낸다", () => {
  assert.match(dash, /const CALENDAR_PAGE_IDX = \d/, "캘린더 탭 인덱스 상수 소실");
  const jumps = dash.match(/goCalendarTab\(\);/g) ?? [];
  assert.equal(jumps.length, 2, `탭 이동 호출이 ${jumps.length}곳 — 토스트·칩 2곳이어야 한다`);
  assert.match(dash, /gotoSignal=\{calendarJump\}/, "페이저에 이동 신호가 연결되지 않았다");
  // 미확인 배지 해소가 함께 남아 있어야 한다 — 안 그러면 배지가 영영 안 꺼진다.
  const seen = dash.match(/markCalendarSeen\(\);/g) ?? [];
  assert.ok(seen.length >= 2, `markCalendarSeen 이 ${seen.length}곳 — 이동 지점마다 있어야 한다`);
});

// ⚠ 이 가드가 처음엔 없어서 구멍이 있었다 — 클릭 대상(토스트·칩)만 옮기고 **배지 숫자 자체**는
//   표시할 자리가 사라진 것을 못 잡았다. lint 의 `calendarNewCount 미사용`이 대신 드러냈다.
//   "알림을 옮겼다"는 진입점을 옮긴 것이지 표시를 옮긴 것이 아니다 — 둘을 따로 검사한다.
test("미확인 배지가 표시될 자리가 있다 — 숫자가 화면에서 사라지지 않았다", () => {
  assert.match(dash, /badge: calendarNewCount/, "탭 배지가 사라졌다 — 미확인 개수가 화면 어디에도 안 남는다");
  const pager = readFileSync(join(ROOT, "app/components/SectionPager.tsx"), "utf8");
  assert.match(pager, /badge\?: number/, "PagerPage 배지 타입 소실");
  assert.match(pager, /badges=\{pages\.map\(\(p\) => p\.badge\)\}/, "페이저가 배지를 탭바에 안 넘긴다");
  const bar = readFileSync(join(ROOT, "app/components/GlassTabBar.tsx"), "utf8");
  assert.match(bar, /\{!!badges\?\.\[i\] && \(/, "탭바가 배지를 안 그린다");
  // 0 을 그리면 "0건이 있다"로 읽힌다 — falsy 를 걸러야 한다.
  assert.doesNotMatch(bar, /\{badges\?\.\[i\] !== undefined && \(/, "0 도 그리게 바뀌었다");
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
