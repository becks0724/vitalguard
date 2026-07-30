// 가입 아이디·비밀번호·생년월일 규칙 단위 테스트 — 길이 경계와 생년월일/연락처 포함 차단.
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPassword, checkUsername, isValidBirthDate } from "./account-policy";

test("아이디 — 길이 경계(4~20자)", () => {
  assert.equal(checkUsername("abc"), "invalid");
  assert.equal(checkUsername("abcd"), "ok");
  assert.equal(checkUsername("a".repeat(20)), "ok");
  assert.equal(checkUsername("a".repeat(21)), "invalid");
});

test("아이디 — 형식 자유(한글·대문자·특수기호 허용)", () => {
  assert.equal(checkUsername("김태곤"), "invalid"); // 3자라 길이에서 걸린다
  assert.equal(checkUsername("김태곤2026"), "ok");
  assert.equal(checkUsername("Kim-TaeGon"), "ok");
  assert.equal(checkUsername("user@site"), "ok");
});

test("아이디 — 공백·제어문자는 거부", () => {
  assert.equal(checkUsername("kim taegon"), "invalid");
  assert.equal(checkUsername("  kimtaegon  "), "ok"); // 앞뒤 공백은 trim
  assert.equal(checkUsername("kim\ttaegon"), "invalid");
});

test("아이디 — 예약어는 대소문자 무관 거부", () => {
  assert.equal(checkUsername("admin"), "reserved");
  assert.equal(checkUsername("OWNER"), "reserved");
  assert.equal(checkUsername("administrator"), "reserved");
});

const OWNER = { birthDate: "1990-01-02", phone: "010-1234-5678" };

test("비밀번호 — 길이 경계(8~19자)", () => {
  assert.equal(checkPassword("Abcdef!", OWNER), "too_short");
  assert.equal(checkPassword("Abcdefg!", OWNER), "ok");
  assert.equal(checkPassword("A".repeat(19), OWNER), "ok");
  assert.equal(checkPassword("A".repeat(20), OWNER), "too_long");
});

test("비밀번호 — 생년월일 포함 거부(8자리·6자리 표기 모두)", () => {
  assert.equal(checkPassword("pw19900102!", OWNER), "has_birth");
  assert.equal(checkPassword("pw900102!", OWNER), "has_birth");
  assert.equal(checkPassword("pw1990-01-02", OWNER), "has_birth"); // 구분자 무시
});

test("비밀번호 — 연락처 포함 거부(전체·뒤 8자리)", () => {
  assert.equal(checkPassword("pw01012345678", OWNER), "has_phone");
  assert.equal(checkPassword("pw12345678!", OWNER), "has_phone");
});

test("비밀번호 — 무관한 숫자·특수기호·대문자는 통과", () => {
  assert.equal(checkPassword("Vg!Safe2026", OWNER), "ok");
  assert.equal(checkPassword("NoDigitsHere!", OWNER), "ok");
  // 생년월일·연락처를 모르는 경우(구버전 계정)는 길이만 본다
  assert.equal(checkPassword("pw19900102!", { birthDate: null, phone: null }), "ok");
});

test("생년월일 — 형식·실재 날짜·미래 여부", () => {
  assert.equal(isValidBirthDate("1990-01-02"), true);
  assert.equal(isValidBirthDate("1990-1-2"), false);
  assert.equal(isValidBirthDate("1990-02-31"), false); // 존재하지 않는 날짜
  assert.equal(isValidBirthDate("1899-12-31"), false);
  assert.equal(isValidBirthDate("2999-01-01"), false); // 미래
});
