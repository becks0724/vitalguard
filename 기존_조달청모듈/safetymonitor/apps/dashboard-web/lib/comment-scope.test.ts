// 감사 BE-AUTHZ-03 회귀 — 미디어 댓글 수정·삭제의 소유권 조건.
// 수정 전에는 PATCH/DELETE 가 id 만 보고 처리해, 로그인한 누구나 타인 댓글을 바꾸거나 지울 수 있었다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { commentScopeClause, type CommentScope } from "./comment-scope";

test("작성자 범위는 author_id 조건을 붙이고 값을 바인딩한다", () => {
  const params: unknown[] = ["comment-1", "새 본문"];
  const clause = commentScopeClause({ authorId: "worker7" }, params);
  assert.equal(clause, " AND author_id = $3");
  assert.deepEqual(params, ["comment-1", "새 본문", "worker7"]);
});

test("자리표시자 번호는 기존 파라미터 수를 따라간다(update $3 / delete $2)", () => {
  // update 는 [id, body] 뒤에, delete 는 [id] 뒤에 붙는다. 번호를 상수로 박으면 한쪽이 어긋난다.
  const updateParams: unknown[] = ["c1", "본문"];
  assert.equal(commentScopeClause({ authorId: "u" }, updateParams), " AND author_id = $3");

  const deleteParams: unknown[] = ["c1"];
  assert.equal(commentScopeClause({ authorId: "u" }, deleteParams), " AND author_id = $2");
});

test("모더레이터는 조건 없이 전체 허용이고 파라미터를 늘리지 않는다", () => {
  const params: unknown[] = ["comment-1"];
  assert.equal(commentScopeClause("moderator", params), "");
  assert.deepEqual(params, ["comment-1"]);
});

// 핵심 회귀 — 이 단언이 깨지면 IDOR 이 되살아난 것이다.
// "작성자 범위인데 조건이 비어 나오는" 경우가 정확히 수정 전 동작이다.
test("작성자 범위에서는 조건이 절대 비어 있지 않다", () => {
  for (const authorId of ["a", "worker-1", "admin7276", "이름있는사번"]) {
    const params: unknown[] = ["c1"];
    const clause = commentScopeClause({ authorId }, params);
    assert.notEqual(clause, "", `${authorId} 에서 소유권 조건이 사라졌다`);
    assert.match(clause, /AND author_id = \$\d+$/);
    assert.equal(params.at(-1), authorId);
  }
});

// 타입만으로는 못 막는 실수 하나 — "moderator" 오타를 객체로 넘기면 조건이 붙어야 한다
// (전체 허용으로 새면 안 된다). 런타임 방향이 안전한 쪽인지 고정한다.
test("moderator 리터럴이 아닌 값은 전체 허용으로 취급되지 않는다", () => {
  const notModerator = { authorId: "moderator" } satisfies CommentScope;
  const params: unknown[] = ["c1"];
  assert.notEqual(commentScopeClause(notModerator, params), "");
});
