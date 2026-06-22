// 비밀번호 해시(scrypt) 단위 테스트 — 솔트 무작위성·검증 정확성·형식 견고성.
import { test } from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword } from "./password";

test("같은 비번도 매번 다른 해시(솔트), 원문은 검증 통과", async () => {
  const h1 = await hashPassword("safety2026!");
  const h2 = await hashPassword("safety2026!");
  assert.notEqual(h1, h2);
  assert.ok(await verifyPassword("safety2026!", h1));
  assert.ok(await verifyPassword("safety2026!", h2));
});

test("틀린 비번은 거부", async () => {
  const h = await hashPassword("correct-horse-battery");
  assert.equal(await verifyPassword("wrong-password", h), false);
});

test("형식이 깨진 저장값은 throw 없이 false", async () => {
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", "scrypt$16384$8$1$only-five-parts"), false);
  assert.equal(await verifyPassword("x", "bcrypt$16384$8$1$AAAA$BBBB"), false);
  assert.equal(await verifyPassword("x", "scrypt$abc$8$1$AAAA$BBBB"), false);
});

test("저장 형식은 scrypt$N$r$p$salt$hash (6필드)", async () => {
  const h = await hashPassword("hello");
  const parts = h.split("$");
  assert.equal(parts.length, 6);
  assert.equal(parts[0], "scrypt");
});
