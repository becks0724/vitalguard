// TOTP 단위 테스트 — RFC 6238 부록 B 공식 시험 벡터로 계산 자체를 못 박는다.
//
// ★ 시험 벡터가 이 파일의 핵심이다. 우리 구현끼리만 대조하면 "우리는 일관되게 틀린" 코드를
//   낼 수 있고, 그러면 인증 앱이 만드는 숫자와 영원히 안 맞는다. 외부 기준이 필요하다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TOTP_PERIOD_SEC,
  base32Decode,
  base32Encode,
  formatSecretForDisplay,
  generateTotpSecret,
  totpAuthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from "./totp";

// RFC 6238 부록 B 의 SHA-1 시드 = ASCII "12345678901234567890"(20바이트).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("RFC 6238 시험 벡터 — SHA-1 구간이 그대로 재현된다", () => {
  // [유닉스초, 기대 8자리] → 우리는 6자리라 뒤 6자리를 본다.
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [sec, expected8] of vectors) {
    assert.equal(
      totpCode(RFC_SECRET, sec * 1000),
      expected8.slice(-6),
      `t=${sec} 에서 시험 벡터와 다르다 — 인증 앱과 숫자가 안 맞는다`,
    );
  }
});

test("Base32 왕복 — 인증 앱이 읽는 표기를 잃지 않는다", () => {
  for (const s of ["", "a", "ab", "abc", "abcd", "abcde", "hello world", "12345678901234567890"]) {
    const buf = Buffer.from(s, "ascii");
    const decoded = base32Decode(base32Encode(buf));
    assert.deepEqual(decoded ?? Buffer.alloc(0), buf, `"${s}" 왕복 실패`);
  }
});

test("Base32 입력은 관대하게 받는다 — 손으로 옮겨 적는 값이다", () => {
  const secret = generateTotpSecret();
  const pretty = formatSecretForDisplay(secret); // 4글자씩 공백
  assert.deepEqual(base32Decode(pretty), base32Decode(secret), "공백 낀 표기를 못 읽는다");
  assert.deepEqual(base32Decode(secret.toLowerCase()), base32Decode(secret), "소문자를 못 읽는다");
  assert.deepEqual(base32Decode(`${secret}==`), base32Decode(secret), "패딩을 못 읽는다");
});

test("Base32 알파벳 밖 문자는 거부한다 — 조용히 다른 시크릿이 되면 안 된다", () => {
  // 0·1·8·9 는 Base32 알파벳에 없다(O/I 와 혼동해서 빠진 글자들).
  for (const bad of ["ABC0", "ABC1", "ABC8", "ABC9", "AB!C", "한글"]) {
    assert.equal(base32Decode(bad), null, `"${bad}" 를 통과시켰다`);
  }
  assert.equal(base32Decode(""), null);
});

test("시크릿은 160비트다 — RFC 4226 권고치", () => {
  const secret = generateTotpSecret();
  assert.equal(base32Decode(secret)?.length, 20);
  // 매번 달라야 한다(고정 시크릿이면 전 계정이 같은 코드를 쓴다).
  assert.notEqual(generateTotpSecret(), secret);
});

test("코드는 6자리 숫자 문자열 — 앞자리 0 이 잘리면 안 된다", () => {
  const secret = generateTotpSecret();
  for (let i = 0; i < 200; i += 1) {
    const code = totpCode(secret, i * 30_000);
    assert.match(code ?? "", /^\d{6}$/, `${i} 번째 코드가 6자리가 아니다`);
  }
});

test("같은 30초 창 안에서는 코드가 안 바뀐다", () => {
  const secret = generateTotpSecret();
  const base = 1_700_000_000_000;
  const step0 = base - (base % (TOTP_PERIOD_SEC * 1000));
  assert.equal(totpCode(secret, step0), totpCode(secret, step0 + 29_999));
  assert.notEqual(totpCode(secret, step0), totpCode(secret, step0 + 30_000), "창이 넘어가도 그대로다");
});

test("검증 — 현재 코드는 통과하고 엉뚱한 코드는 거부", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const code = totpCode(secret, now)!;
  const r = verifyTotp(secret, code, now);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.step, totpStep(now), "스텝을 안 돌려준다 — 재사용 차단을 못 한다");
  assert.equal(verifyTotp(secret, "000000", now).ok === true && code !== "000000", false);
});

test("시계 오차 ±30초는 받아 주고 그 밖은 거부", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  // 앞뒤 1스텝은 통과.
  for (const drift of [-30_000, 0, 30_000]) {
    const code = totpCode(secret, now + drift)!;
    assert.equal(verifyTotp(secret, code, now).ok, true, `${drift}ms 어긋난 코드를 거부했다`);
  }
  // 2스텝은 거부 — 창을 넓히면 훔친 코드의 수명이 같이 늘어난다.
  for (const drift of [-90_000, 90_000]) {
    const code = totpCode(secret, now + drift)!;
    assert.equal(verifyTotp(secret, code, now).ok, false, `${drift}ms 어긋난 코드를 통과시켰다`);
  }
});

test("검증이 돌려준 스텝은 코드가 만들어진 창과 같다 — 재사용 차단의 근거", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  for (const drift of [-30_000, 0, 30_000]) {
    const r = verifyTotp(secret, totpCode(secret, now + drift)!, now);
    assert.equal(r.ok && r.step, totpStep(now + drift), `${drift}ms 코드의 스텝이 틀리다`);
  }
});

test("형식이 아닌 입력은 계산 전에 거부", () => {
  const secret = generateTotpSecret();
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78", "-12345"]) {
    assert.equal(verifyTotp(secret, bad).ok, false, `"${bad}" 를 통과시켰다`);
  }
  // 공백은 다듬어 받는다(입력칸에서 흔히 섞인다).
  const code = totpCode(secret, 1_700_000_000_000)!;
  assert.equal(verifyTotp(secret, ` ${code} `, 1_700_000_000_000).ok, true);
});

test("망가진 시크릿으로는 아무 코드도 통과하지 않는다", () => {
  for (const bad of ["", "!!!!", "0189"]) {
    assert.equal(totpCode(bad), null, `"${bad}" 로 코드를 만들었다`);
    assert.equal(verifyTotp(bad, "000000").ok, false, `"${bad}" 로 검증을 통과시켰다`);
  }
});

test("otpauth URI 는 인증 앱이 읽는 표준 형식이다", () => {
  const secret = generateTotpSecret();
  const uri = totpAuthUri("test.jodal", secret);
  assert.match(uri, /^otpauth:\/\/totp\//);
  const parsed = new URL(uri);
  assert.equal(parsed.searchParams.get("secret"), secret);
  assert.equal(parsed.searchParams.get("issuer"), "VitAlGuard");
  // 알고리즘·자릿수·주기를 명시한다 — 앱 기본값에 기대면 앱마다 다른 숫자가 나온다.
  assert.equal(parsed.searchParams.get("algorithm"), "SHA1");
  assert.equal(parsed.searchParams.get("digits"), "6");
  assert.equal(parsed.searchParams.get("period"), "30");
});

test("계정 이름의 특수문자가 URI 를 깨뜨리지 않는다", () => {
  for (const account of ["a b", "a@b.com", "한글계정", "a/b", "a?c=1"]) {
    const uri = totpAuthUri(account, generateTotpSecret());
    assert.doesNotThrow(() => new URL(uri), `"${account}" 가 URI 를 깨뜨린다`);
  }
});

test("표시용 서식은 4글자씩 끊고 값은 보존한다", () => {
  const secret = generateTotpSecret();
  const pretty = formatSecretForDisplay(secret);
  assert.equal(pretty.replace(/ /g, ""), secret);
  assert.ok(pretty.split(" ").every((g) => g.length <= 4));
});
