// 캘린더 미디어 소유권 회귀 — 사용자 제보 2건(2026-07-27).
//  ① "내가 올리지 않은 사진이 삭제됐다"  → 소유권 검증 자체가 없었다.
//  ② "내가 올린 사진인데 삭제가 안 된다"  → 신원 환산·병합 처리가 빠져 있었다.
// 두 방향(과하게 열림 / 과하게 닫힘)을 모두 고정한다.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  mediaMatchesScope,
  mediaScopeClause,
  workerIdGroup,
  type MediaScope,
} from "./media-scope";

test("작업자 범위는 worker_id 조건을 붙이고 사번 배열을 바인딩한다", () => {
  const params: unknown[] = ["media-1"];
  const clause = mediaScopeClause({ workerIds: ["EMP-6861"] }, params);
  assert.equal(clause, " AND worker_id = ANY($2::text[])");
  assert.deepEqual(params, ["media-1", ["EMP-6861"]]);
});

// DELETE 는 [id] 뒤, PATCH(설명 수정)는 [id, description] 뒤에 붙는다.
// 번호를 상수로 박으면 한쪽이 엉뚱한 값과 비교되며 조용히 통과한다.
test("자리표시자 번호는 기존 파라미터 수를 따라간다(DELETE $2 / PATCH $3)", () => {
  const del: unknown[] = ["m1"];
  assert.equal(mediaScopeClause({ workerIds: ["E1"] }, del), " AND worker_id = ANY($2::text[])");

  const patch: unknown[] = ["m1", "설명"];
  assert.equal(mediaScopeClause({ workerIds: ["E1"] }, patch), " AND worker_id = ANY($3::text[])");
  assert.deepEqual(patch, ["m1", "설명", ["E1"]]);
});

test("모더레이터(owner)는 조건 없이 전체 허용이고 파라미터를 늘리지 않는다", () => {
  const params: unknown[] = ["media-1"];
  assert.equal(mediaScopeClause("moderator", params), "");
  assert.deepEqual(params, ["media-1"]);
});

// 제보 ① 회귀 — 이 단언이 깨지면 "남의 사진이 지워지는" 상태로 되돌아간 것이다.
test("작업자 범위에서는 조건이 절대 비어 있지 않다", () => {
  for (const workerId of ["EMP-6861", "EMP-1024", "worker1"]) {
    const params: unknown[] = ["m1"];
    const clause = mediaScopeClause({ workerIds: [workerId] }, params);
    assert.notEqual(clause, "", `${workerId} 에서 소유권 조건이 사라졌다`);
    assert.match(clause, /AND worker_id = ANY\(\$\d+::text\[\]\)$/);
  }
});

// ── 병합(worker_alias) 그룹 ────────────────────────────────
// 같은 사람이 폰·워치에서 다른 사번으로 들어오고, 관제 웹의 "작업자 ID 병합"이 이를 합친다.
// 제보 ② 의 실제 상황 = EMP-6861 → EMP-admin6861 병합 등록.

test("병합된 두 사번은 어느 쪽으로 조회해도 같은 그룹이 된다", () => {
  const alias = { "EMP-6861": "EMP-admin6861" };
  assert.deepEqual(workerIdGroup("EMP-6861", alias).sort(), ["EMP-6861", "EMP-admin6861"]);
  assert.deepEqual(workerIdGroup("EMP-admin6861", alias).sort(), ["EMP-6861", "EMP-admin6861"]);
});

test("같은 주 ID 로 병합된 별칭이 여럿이면 전부 한 그룹이다", () => {
  const alias = { "EMP-A": "EMP-P", "EMP-B": "EMP-P" };
  assert.deepEqual(workerIdGroup("EMP-A", alias).sort(), ["EMP-A", "EMP-B", "EMP-P"]);
});

test("병합이 없으면 자기 사번 하나뿐이다(남을 끌어오지 않는다)", () => {
  assert.deepEqual(workerIdGroup("EMP-6861", {}), ["EMP-6861"]);
  // 무관한 병합이 있어도 남의 그룹을 흡수하면 안 된다.
  assert.deepEqual(workerIdGroup("EMP-6861", { "EMP-X": "EMP-Y" }), ["EMP-6861"]);
});

// ── 화면 표시용 판정 ──────────────────────────────────────
// GET 의 canDelete 와 실제 삭제가 같은 규칙을 써야 "버튼은 있는데 안 지워짐"이 안 생긴다.

test("canDelete — 그룹에 속한 사번이면 참, 아니면 거짓", () => {
  const scope: MediaScope = { workerIds: ["EMP-6861", "EMP-admin6861"] };
  assert.equal(mediaMatchesScope("EMP-admin6861", scope), true, "제보 ② 상황이 다시 막혔다");
  assert.equal(mediaMatchesScope("EMP-6861", scope), true);
  assert.equal(mediaMatchesScope("EMP-9999", scope), false, "남의 사진이 열렸다");
});

test("canDelete — worker_id 가 비어 있으면 모더레이터만 참", () => {
  // 사번 없이 올라온 과거 사진은 주인을 특정할 수 없다. 일반 작업자에게는 닫고,
  // owner 는 정리할 수 있어야 한다(그러지 않으면 아무도 못 지우는 행이 남는다).
  assert.equal(mediaMatchesScope(null, { workerIds: ["EMP-1"] }), false);
  assert.equal(mediaMatchesScope(null, "moderator"), true);
});
