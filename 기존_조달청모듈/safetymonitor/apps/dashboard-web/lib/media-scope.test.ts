// 캘린더 미디어 삭제 소유권 회귀 — 사용자 제보(2026-07-27): 내가 올리지 않은 사진이 삭제됐다.
// 수정 전 DELETE 는 로그인 여부만 보고 id 로 바로 지웠다(댓글 IDOR 과 같은 계열, 대상만 다름).
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { mediaScopeClause, type MediaScope } from "./media-scope";

test("작업자 범위는 worker_id 조건을 붙이고 사번을 바인딩한다", () => {
  const params: unknown[] = ["media-1"];
  const clause = mediaScopeClause({ workerId: "EMP-6861" }, params);
  assert.equal(clause, " AND worker_id = $2");
  assert.deepEqual(params, ["media-1", "EMP-6861"]);
});

// DELETE 는 [id] 뒤에, PATCH(설명 수정)는 [id, description] 뒤에 붙는다.
// 번호를 상수로 박으면 둘 중 하나가 반드시 어긋나 조건이 엉뚱한 값과 비교된다.
test("자리표시자 번호는 기존 파라미터 수를 따라간다(DELETE $2 / PATCH $3)", () => {
  const del: unknown[] = ["m1"];
  assert.equal(mediaScopeClause({ workerId: "E1" }, del), " AND worker_id = $2");

  const patch: unknown[] = ["m1", "설명"];
  assert.equal(mediaScopeClause({ workerId: "E1" }, patch), " AND worker_id = $3");
  assert.deepEqual(patch, ["m1", "설명", "E1"]);
});

test("모더레이터(owner)는 조건 없이 전체 허용이고 파라미터를 늘리지 않는다", () => {
  const params: unknown[] = ["media-1"];
  assert.equal(mediaScopeClause("moderator", params), "");
  assert.deepEqual(params, ["media-1"]);
});

// 핵심 회귀 — 이 단언이 깨지면 "남의 사진이 지워지는" 상태로 되돌아간 것이다.
test("작업자 범위에서는 조건이 절대 비어 있지 않다", () => {
  for (const workerId of ["EMP-6861", "EMP-1024", "worker1", "E1"]) {
    const params: unknown[] = ["m1"];
    const clause = mediaScopeClause({ workerId }, params);
    assert.notEqual(clause, "", `${workerId} 에서 소유권 조건이 사라졌다`);
    assert.match(clause, /AND worker_id = \$\d+$/);
    assert.equal(params.at(-1), workerId);
  }
});

// 댓글 규칙과 섞이지 않았는지 — 대조 컬럼이 다르다(author_id vs worker_id).
// 한쪽을 고치다 다른 쪽 컬럼을 쓰면 조건이 항상 불일치해 아무도 못 지우게 된다.
test("미디어는 worker_id 로 판정한다(author_id 가 아니다)", () => {
  const params: unknown[] = ["m1"];
  const clause = mediaScopeClause({ workerId: "EMP-1" } satisfies MediaScope, params);
  assert.match(clause, /worker_id/);
  assert.doesNotMatch(clause, /author_id/);
});
