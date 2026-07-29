// 일정 캘린더 일정 수정·삭제의 소유권 조건 회귀.
// 수정 전에는 POST(업서트)·DELETE 가 id 만 보고 처리해, 로그인한 누구나 남의 일정을
// 덮어쓰거나 지울 수 있었다. created_by 는 저장만 되고 대조되지 않았다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  calendarEventMatchesScope,
  calendarEventScopeClause,
  type CalendarEventScope,
} from "./calendar-event-scope";

test("작성자 범위는 created_by 조건을 붙이고 값을 바인딩한다", () => {
  const params: unknown[] = ["evt-1"];
  const clause = calendarEventScopeClause({ createdBy: "admin6861" }, params);
  assert.equal(clause, " AND calendar_event.created_by = $2");
  assert.deepEqual(params, ["evt-1", "admin6861"]);
});

test("자리표시자 번호는 기존 파라미터 수를 따라간다(업서트 $9 / 삭제 $2)", () => {
  // 업서트는 컬럼 8개를 이미 쓰고, 삭제는 [id] 만 쓴다. 번호를 상수로 박으면 한쪽이 어긋난다.
  const upsertParams: unknown[] = ["id", "2026-07-31", "제목", "lbl", null, null, null, "admin6861"];
  assert.equal(
    calendarEventScopeClause({ createdBy: "admin6861" }, upsertParams),
    " AND calendar_event.created_by = $9",
  );

  const deleteParams: unknown[] = ["id"];
  assert.equal(
    calendarEventScopeClause({ createdBy: "admin6861" }, deleteParams),
    " AND calendar_event.created_by = $2",
  );
});

// 업서트의 ON CONFLICT DO UPDATE 안에서는 기존 행을 테이블명으로, 새 값을 excluded 로 가리킨다.
// 수식어를 빼면 excluded 쪽과 모호해지거나(에러) 엉뚱한 값을 비교한다.
test("조건은 테이블명으로 수식해 excluded 와 섞이지 않는다", () => {
  const clause = calendarEventScopeClause({ createdBy: "u" }, []);
  assert.match(clause, /calendar_event\.created_by/);
  assert.doesNotMatch(clause, /excluded/);
});

test("총괄 관리자는 조건 없이 전체 허용이고 파라미터를 늘리지 않는다", () => {
  const params: unknown[] = ["evt-1"];
  assert.equal(calendarEventScopeClause("moderator", params), "");
  assert.deepEqual(params, ["evt-1"]);
});

// 핵심 회귀 — 이 단언이 깨지면 IDOR 이 되살아난 것이다.
// "작성자 범위인데 조건이 비어 나오는" 경우가 정확히 수정 전 동작이다.
test("작성자 범위에서는 조건이 절대 비어 있지 않다", () => {
  for (const createdBy of ["a", "admin6861", "233276656+becks0724@users.noreply.github.com", "이름있는계정"]) {
    const params: unknown[] = ["evt-1"];
    const clause = calendarEventScopeClause({ createdBy }, params);
    assert.notEqual(clause, "", `${createdBy} 에서 소유권 조건이 사라졌다`);
    assert.match(clause, /AND calendar_event\.created_by = \$\d+$/);
    assert.equal(params.at(-1), createdBy);
  }
});

// 타입만으로는 못 막는 실수 하나 — "moderator" 오타를 객체로 넘기면 조건이 붙어야 한다
// (전체 허용으로 새면 안 된다). 런타임 방향이 안전한 쪽인지 고정한다.
test("moderator 리터럴이 아닌 값은 전체 허용으로 취급되지 않는다", () => {
  const notModerator = { createdBy: "moderator" } satisfies CalendarEventScope;
  assert.notEqual(calendarEventScopeClause(notModerator, []), "");
  assert.equal(calendarEventMatchesScope("someone", notModerator), false);
});

test("canEdit 판정 — 본인 것만 true, 총괄은 전부 true", () => {
  const mine: CalendarEventScope = { createdBy: "admin6861" };
  assert.equal(calendarEventMatchesScope("admin6861", mine), true);
  assert.equal(calendarEventMatchesScope("admin3470", mine), false);
  assert.equal(calendarEventMatchesScope("admin3470", "moderator"), true);
});

// created_by 가 비어 있는 행(옛 localStorage 마이그레이션분 등)은 작성자 본인일 수 없다.
// null 을 "일치"로 흘리면 등록자 없는 일정을 아무나 지우게 된다.
test("등록자 없는 일정은 작성자 범위에서 거부, 총괄만 다룬다", () => {
  assert.equal(calendarEventMatchesScope(null, { createdBy: "admin6861" }), false);
  assert.equal(calendarEventMatchesScope("", { createdBy: "admin6861" }), false);
  assert.equal(calendarEventMatchesScope(null, "moderator"), true);
});

// 화면 버튼(canEdit)과 서버 쓰기(WHERE 절)가 같은 규칙을 봐야 한다.
// 한쪽만 고치면 "버튼은 보이는데 눌러도 안 된다" 또는 그 반대가 된다.
test("canEdit 가 false 인 행은 소유권 조건에도 걸리지 않는다", () => {
  const scope: CalendarEventScope = { createdBy: "admin6861" };
  const rows = [
    { created_by: "admin6861" },
    { created_by: "admin3470" },
    { created_by: null },
  ];
  for (const row of rows) {
    const params: unknown[] = ["evt"];
    calendarEventScopeClause(scope, params);
    const boundValue = params.at(-1);
    assert.equal(
      calendarEventMatchesScope(row.created_by, scope),
      row.created_by === boundValue,
    );
  }
});
