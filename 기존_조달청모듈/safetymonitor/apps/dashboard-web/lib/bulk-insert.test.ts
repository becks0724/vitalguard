// 다건 INSERT 빌더 자기 시험.
//
// 이 파일이 지키는 한 문장.
//   "행이 몇 개든 플레이스홀더 번호가 1부터 빈틈없이 이어지고, 값 배열의 순서가 그 번호와
//    정확히 대응한다 — 그래서 한 왕복으로 접어도 컬럼이 밀리지 않는다."
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { PG_MAX_BIND_PARAMS, buildBulkInsert, chunkSizeFor } from "./bulk-insert";

test("① 행 2개면 플레이스홀더가 1..6 으로 이어진다", () => {
  const { text, values } = buildBulkInsert(
    "t",
    ["a", "b", "c"],
    [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
    ],
  );
  assert.equal(text, "INSERT INTO t (a, b, c) VALUES ($1, $2, $3), ($4, $5, $6)");
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6]);
});

test("② 값은 keys 순서를 따른다 — 행의 키 순서가 달라도 밀리지 않는다", () => {
  const { values } = buildBulkInsert(
    "t",
    ["a", "b"],
    [
      { b: "second", a: "first" },
      { a: "third", b: "fourth" },
    ],
  );
  assert.deepEqual(values, ["first", "second", "third", "fourth"]);
});

test("③ 행에 없는 키는 null 로 메운다 — VALUES 개수가 어긋나지 않는다", () => {
  const { text, values } = buildBulkInsert("t", ["a", "b"], [{ a: 1 }, { b: 2 }]);
  assert.equal(text, "INSERT INTO t (a, b) VALUES ($1, $2), ($3, $4)");
  assert.deepEqual(values, [1, null, null, 2]);
});

test("④ 0 과 빈 문자열은 null 로 접히지 않는다", () => {
  const { values } = buildBulkInsert("t", ["a", "b"], [{ a: 0, b: "" }]);
  assert.deepEqual(values, [0, ""]);
});

test("⑤ 꼬리말이 문 끝에 붙는다", () => {
  const { text } = buildBulkInsert("t", ["a"], [{ a: 1 }], "ON CONFLICT (a) DO NOTHING");
  assert.equal(text, "INSERT INTO t (a) VALUES ($1) ON CONFLICT (a) DO NOTHING");
});

test("⑥ 빈 입력은 문을 만들지 않고 던진다", () => {
  assert.throws(() => buildBulkInsert("t", [], [{ a: 1 }]), /컬럼이 없습니다/);
  assert.throws(() => buildBulkInsert("t", ["a"], []), /행이 없습니다/);
});

test("⑦ 청크 × 컬럼 수가 Postgres 바인드 상한을 넘지 않는다", () => {
  for (const cols of [1, 7, 55, 120, 1000]) {
    const n = chunkSizeFor(cols);
    assert.ok(n >= 1, `컬럼 ${cols} 에서 청크가 0 이면 안 된다`);
    assert.ok(
      n * cols <= PG_MAX_BIND_PARAMS,
      `컬럼 ${cols} × 청크 ${n} = ${n * cols} 가 상한 ${PG_MAX_BIND_PARAMS} 초과`,
    );
  }
});

test("⑧ 현재 컬럼 수(55)에서는 배치 상한 500건이 한 왕복에 들어간다", () => {
  // 이 성질이 깨지면 500건이 두 왕복으로 갈라져 수리 효과가 절반이 된다.
  assert.ok(chunkSizeFor(55) >= 500, `55컬럼 청크가 ${chunkSizeFor(55)} 로 500 미만`);
});

test("⑨ 컬럼이 늘면 청크가 줄어든다 — 상수로 박히지 않았다", () => {
  assert.ok(chunkSizeFor(500) < chunkSizeFor(55));
});
