// 워치 QR 로그인 유틸 단위시험 — 코드 형식·정규화·secret 해시·QR 행렬
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEVICE_CODE_ALPHABET,
  DEVICE_LOGIN_TTL_SEC,
  hashDeviceSecret,
  newDeviceCode,
  newDeviceSecret,
  normalizeDeviceCode,
  pairUrl,
  qrMatrix,
  secretMatches,
} from "./device-login";

test("newDeviceCode — XXXX-XXXX · 혼동 글자(0 O 1 I L) 없음 · 매번 다름", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const c = newDeviceCode();
    assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    for (const ch of c.replace("-", "")) assert.ok(DEVICE_CODE_ALPHABET.includes(ch), `혼동 글자 ${ch}`);
    seen.add(c);
  }
  assert.ok(seen.size > 190);
  for (const bad of "0O1IL") assert.ok(!DEVICE_CODE_ALPHABET.includes(bad), `${bad} 가 알파벳에 있다`);
});

test("normalizeDeviceCode — 소문자·공백·하이픈 관대 · 글자 밖·길이 다름·비문자열은 null", () => {
  assert.equal(normalizeDeviceCode("k7mz 4qpd"), "K7MZ-4QPD");
  assert.equal(normalizeDeviceCode("K7MZ-4QPD"), "K7MZ-4QPD");
  assert.equal(normalizeDeviceCode("k7mz4qpd"), "K7MZ-4QPD");
  assert.equal(normalizeDeviceCode("K7MZ-4QP"), null);
  assert.equal(normalizeDeviceCode("K7MZ-4QP0"), null); // 0 은 알파벳 밖
  assert.equal(normalizeDeviceCode(12345678), null);
  assert.equal(normalizeDeviceCode(null), null);
});

test("secret — 32바이트 hex · 해시 대조는 secret 원문으로만 · 짧은 값 거부", () => {
  const s = newDeviceSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
  const h = hashDeviceSecret(s);
  assert.equal(secretMatches(s, h), true);
  assert.equal(secretMatches(h, h), false);       // 해시를 secret 인 척
  assert.equal(secretMatches(s.slice(0, 31), h), false);
  assert.equal(secretMatches(undefined, h), false);
});

test("qrMatrix — 정사각 · '0/1' 행 · 워치 480px 에서 모듈 ≥ 8px", () => {
  const url = pairUrl("https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/", "K7MZ-4QPD");
  assert.equal(url, "https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/pair?code=K7MZ-4QPD");
  const m = qrMatrix(url);
  assert.equal(m.rows.length, m.size);
  for (const r of m.rows) assert.match(r, new RegExp(`^[01]{${m.size}}$`));
  assert.ok(m.size <= 45, `버전이 커서 워치에서 못 읽는다: ${m.size}`);   // 480/45 ≈ 10.7px/모듈
  assert.equal(DEVICE_LOGIN_TTL_SEC, 300);
});
