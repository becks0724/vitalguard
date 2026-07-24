// 보호자 이름/관계 parse·compose 단위 테스트 — 저장 포맷 왕복 보존.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { composeGuardian, parseGuardian } from "./guardian.js";

test("parse — 프리셋 관계는 select 값으로", () => {
  assert.deepEqual(parseGuardian("김보호 (배우자)"), { name: "김보호", relation: "배우자", custom: "" });
  assert.deepEqual(parseGuardian("이보호 (자녀)"), { name: "이보호", relation: "자녀", custom: "" });
});

test("parse — 프리셋에 없는 관계는 기타 + custom", () => {
  assert.deepEqual(parseGuardian("김보호 (이모)"), { name: "김보호", relation: "기타", custom: "이모" });
});

test("parse — 괄호 없으면 전체가 이름(관계 없음)", () => {
  assert.deepEqual(parseGuardian("김보호"), { name: "김보호", relation: "", custom: "" });
});

test("parse — 빈 괄호·공백은 관계 없음", () => {
  assert.deepEqual(parseGuardian("김보호 ()"), { name: "김보호", relation: "", custom: "" });
  assert.deepEqual(parseGuardian(""), { name: "", relation: "", custom: "" });
  assert.deepEqual(parseGuardian(null), { name: "", relation: "", custom: "" });
});

test("compose — 이름 + 프리셋 관계", () => {
  assert.equal(composeGuardian("김보호", "배우자", ""), "김보호 (배우자)");
});

test("compose — 기타는 custom 사용, custom 비면 이름만", () => {
  assert.equal(composeGuardian("김보호", "기타", "이모"), "김보호 (이모)");
  assert.equal(composeGuardian("김보호", "기타", ""), "김보호");
});

test("compose — 관계 미선택은 이름만, 이름 없으면 빈 문자열", () => {
  assert.equal(composeGuardian("김보호", "", ""), "김보호");
  assert.equal(composeGuardian("", "배우자", ""), "");
  assert.equal(composeGuardian("  ", "배우자", ""), "");
});

test("왕복 — compose→parse 보존", () => {
  for (const [n, r, c] of [
    ["김보호", "배우자", ""],
    ["박보호", "기타", "이모"],
    ["최보호", "", ""],
  ] as const) {
    const stored = composeGuardian(n, r, c);
    const back = parseGuardian(stored);
    assert.equal(composeGuardian(back.name, back.relation, back.custom), stored);
  }
});
