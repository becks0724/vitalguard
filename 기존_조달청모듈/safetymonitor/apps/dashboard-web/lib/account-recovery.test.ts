// 계정 찾기 규칙 단위 테스트 — 마스킹이 원문을 흘리지 않는지, 임시 비번이 로그인 가능한 값인지, 만료 판정.
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkPassword, PASSWORD_MAX, PASSWORD_MIN } from "./account-policy";
import {
  TEMP_PASSWORD_TTL_MS,
  generateTempPassword,
  maskUsername,
  tempPasswordExpired,
  tempPasswordExpiry,
} from "./account-recovery";

test("마스킹 — 앞 2자·뒤 2자만 남고 길이는 보존된다", () => {
  assert.equal(maskUsername("admin6861"), "ad*****61");
  assert.equal(maskUsername("worker1234"), "wo******34");
  // 길이가 보존되어야 본인이 자기 아이디를 알아본다.
  assert.equal(maskUsername("admin6861").length, "admin6861".length);
});

test("마스킹 — 짧은 아이디도 원문이 새지 않는다", () => {
  // 4자 이하는 앞뒤 2자씩을 남기면 원문 전체가 드러난다 → 첫 글자만 남긴다.
  assert.equal(maskUsername("abcd"), "a***");
  assert.equal(maskUsername("abc"), "a**");
  assert.equal(maskUsername("ab"), "a*");
  assert.equal(maskUsername("a"), "a*");
  assert.equal(maskUsername(""), "");
  // 5자부터 앞2·뒤2 규칙이 적용된다(경계).
  assert.equal(maskUsername("abcde"), "ab*de");
});

test("마스킹 — 한글 아이디를 코드포인트 단위로 센다", () => {
  // 아이디는 형식이 자유라 한글이 허용된다(checkUsername). 바이트로 세면 글자가 쪼개진다.
  assert.equal(maskUsername("장우진관리자"), "장우**리자");
});

test("마스킹 — 앞뒤 공백은 제거하고 센다", () => {
  assert.equal(maskUsername("  admin6861  "), "ad*****61");
});

test("임시 비밀번호 — 가입 비밀번호 정책을 통과한다", () => {
  for (let i = 0; i < 50; i += 1) {
    const pw = generateTempPassword();
    assert.ok(pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX, `길이 이탈: ${pw}`);
    // 생년월일·연락처 포함 금지 규칙도 함께 본다 — 숫자가 섞이므로 우연히 걸릴 수 있다.
    assert.equal(
      checkPassword(pw, { birthDate: "1990-01-01", phone: "010-1234-5678" }),
      "ok",
      `정책 위반: ${pw}`,
    );
  }
});

test("임시 비밀번호 — 혼동 문자를 쓰지 않는다", () => {
  // 전화로 불러주는 값이라 0/O, 1/l/I 가 섞이면 재문의가 된다.
  for (let i = 0; i < 50; i += 1) {
    assert.doesNotMatch(generateTempPassword(), /[0O1lIo]/);
  }
});

test("임시 비밀번호 — 매번 다른 값이 나온다", () => {
  const seen = new Set(Array.from({ length: 30 }, () => generateTempPassword()));
  assert.equal(seen.size, 30);
});

test("만료 — null 은 임시 비번 상태가 아니므로 만료가 아니다", () => {
  assert.equal(tempPasswordExpired(null), false);
  assert.equal(tempPasswordExpired(undefined), false);
  assert.equal(tempPasswordExpired(""), false);
});

test("만료 — TTL 경계 전후", () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0);
  const expiry = tempPasswordExpiry(now);
  assert.equal(tempPasswordExpired(expiry, now), false);
  assert.equal(tempPasswordExpired(expiry, now + TEMP_PASSWORD_TTL_MS), false); // 정확히 만료 시각 = 아직 유효
  assert.equal(tempPasswordExpired(expiry, now + TEMP_PASSWORD_TTL_MS + 1), true);
});

test("만료 — 판독 불가한 값은 만료로 본다", () => {
  // 통과시키면 깨진 값 하나로 임시 비번이 영구히 살아남는다.
  assert.equal(tempPasswordExpired("깨진값"), true);
});
