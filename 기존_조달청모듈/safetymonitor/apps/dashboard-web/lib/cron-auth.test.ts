// 크론 게이트 판정 단위 테스트.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { cronAuth } from "./cron-auth.js";

test("CRON_SECRET 미설정 — 헤더와 무관하게 notConfigured", () => {
  assert.equal(cronAuth(null, undefined), "notConfigured");
  assert.equal(cronAuth("anything", undefined), "notConfigured");
  assert.equal(cronAuth("anything", ""), "notConfigured");
});

test("헤더 없음/불일치 — unauthorized", () => {
  assert.equal(cronAuth(null, "secret"), "unauthorized");
  assert.equal(cronAuth("wrong", "secret"), "unauthorized");
});

test("헤더 일치 — ok", () => {
  assert.equal(cronAuth("secret", "secret"), "ok");
});
