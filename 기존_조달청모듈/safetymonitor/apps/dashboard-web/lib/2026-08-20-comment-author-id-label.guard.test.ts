// 댓글 작성자 표기 가드 — 로그인 ID 를 `사번` 이라 부르지 않게 못 박는다.
//
// 발단(2026-08-20 실측). 미디어 상세 한 카드 안에서 같은 사람이 두 사번을 가진 것처럼 보였다.
//   작업자        장우진 · EMP-6861      ← 진짜 사번(메타데이터)
//   장우진 · 팀장 · 사번 admin6861        ← 로그인 ID 인데 `사번` 이라 적혀 있었다
// 값은 맞고 라벨이 틀린 형태다. 앱이 댓글에 합류하면서 둘이 나란히 놓여 드러났다.
//
// ★ 고치는 방향은 라벨뿐이다. 값(`author_id` = 앱 JWT `sub` / 관제 세션 username)은
//   댓글 수정·삭제 권한 판정의 대조 키라, 사번으로 바꾸면 관제 로그인 ID 와 갈려
//   **자기 댓글을 자기가 못 고친다**. 그래서 이 가드는 값을 지키고 라벨만 막는다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");
const dash = readFileSync(join(ROOT, "app/components/DemoDashboard.tsx"), "utf8");
const route = readFileSync(join(ROOT, "app/api/calendar/media/comment/route.ts"), "utf8");

// 앵커 — 대상이 사라지면 아래 금지 검사가 조용히 통과한다(L-79).
test("앵커 — 댓글 작성자 표기와 권한 판정이 실재한다", () => {
  assert.match(dash, /\{c\.authorId && \(/, "댓글 작성자 ID 렌더 소실");
  assert.ok(dash.includes("authorTitle"), "작성자 직책 렌더 소실");
  assert.ok(route.includes("function commentScope"), "commentScope 소실");
});

// ⚠ 표현이 한 번 옮겨갔다(2026-08-20 같은 날) — 식별자 통일 작업에서 JSX 리터럴이
//   템플릿 문자열로 바뀌었다. **의도는 그대로다**: 접히지 않는 계정의 로그인 ID 를
//   `사번` 이라 부르지 않는다. 접힌 계정의 사번 표기는 별칭 가드가 따로 지킨다
//   (2026-08-20-calendar-tab-and-author-id.guard.test.ts).
test("로그인 ID 를 `사번` 이라 부르지 않는다", () => {
  // 렌더 블록만 잘라 본다 — 파일 다른 곳의 `사번`(작업자 메타데이터 등)은 정당하다.
  const i = dash.indexOf("{c.authorId && (");
  const block = dash.slice(i, i + 700);
  assert.doesNotMatch(block, /· 사번 [{$]\{?c\.authorId\}/, "로그인 ID 에 `사번` 라벨이 되살아났다");
  assert.match(block, /· ID \$\{c\.authorId\}/, "작성자 ID 표기가 사라졌다");
});

// ★ 값은 지킨다 — 라벨을 고치다 값을 사번으로 바꾸면 권한이 깨진다.
test("작성자 값은 로그인 ID 로 남는다 — 사번으로 바꾸지 않는다", () => {
  const i = dash.indexOf("{c.authorId && (");
  const block = dash.slice(i, i + 200);
  assert.doesNotMatch(
    block,
    /c\.(employeeId|workerId|empId)/,
    "작성자 표기가 사번 계열로 바뀌었다 — 권한 대조 키와 갈린다",
  );
});

test("권한 판정은 여전히 작성자 ID 대조다", () => {
  const i = route.indexOf("function commentScope");
  const body = route.slice(i, route.indexOf("\n}", i));
  assert.match(body, /who\.username/, "commentScope 가 로그인 ID 대조를 그만뒀다");
  assert.doesNotMatch(body, /employeeId|사번/, "권한 판정이 사번을 보기 시작했다");
});
