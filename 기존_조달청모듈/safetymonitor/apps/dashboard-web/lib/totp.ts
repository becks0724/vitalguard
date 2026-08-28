// TOTP(RFC 6238) — 2단계 인증의 6자리 코드 생성·검증. 의존성 0(node:crypto 만).
//
// ★ 특정 앱에 묶이지 않는다. Google Authenticator·Microsoft Authenticator·1Password·
//   Bitwarden·아이폰 내장 '암호' 앱이 모두 같은 표준을 쓴다. 서버와 앱이 비밀 문자열을
//   나눠 갖고 현재 시각을 섞어 계산할 뿐이라 통신도, 외부 서비스도, 계약도 없다.
//
// ⚠ HMAC-SHA1 인 것은 취약해서가 아니라 **표준이 그렇게 정해져 있어서**다(RFC 4226 §5.3).
//   SHA-256 으로 바꾸면 인증 앱 대부분이 못 읽는다 — 여기서 알고리즘을 '개선'하지 말 것.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 표준 파라미터 — 인증 앱의 기본값과 맞춘다. 바꾸면 앱이 다른 숫자를 낸다.
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;

// 시계 오차 허용 창 — 앞뒤 1스텝(±30초). 총 90초가 유효하다.
// ⚠ 넓히면 훔친 코드의 수명이 같이 늘어난다. 사람 손목시계 오차엔 1스텝이면 충분하다.
export const TOTP_WINDOW = 1;

// ── Base32(RFC 4648) — 인증 앱이 읽는 시크릿 표기 ────────────────────────────
// node:crypto 에 Base32 가 없어 직접 짠다(hex·base64 는 인증 앱이 못 읽는다).
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  // 패딩('=')은 붙이지 않는다 — otpauth URI 규약이 패딩 없는 표기를 쓴다.
  return out;
}

export function base32Decode(input: string): Buffer | null {
  // 사람이 손으로 옮겨 적는 값이라 공백·하이픈·소문자를 관대하게 받는다.
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) return null; // 알파벳 밖 문자 = 잘못 옮겨 적은 값
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── 시크릿 발급 ──────────────────────────────────────────────────────────────
// 20바이트 = 160비트. RFC 4226 §4 R6 의 권고치이고 SHA-1 블록과도 맞는다.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// ── 코드 계산 ────────────────────────────────────────────────────────────────
function hotp(secret: Buffer, counter: number): string {
  // 카운터는 8바이트 빅엔디안. Number 로는 2^53 까지라 시각 기반(2^31 수준)엔 충분하다.
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", secret).update(buf).digest();
  // 동적 절단(RFC 4226 §5.4) — 마지막 니블이 가리키는 위치에서 4바이트를 뽑는다.
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

// 특정 시각의 스텝 번호 — 검증 결과(usedStep)를 저장해 재사용을 막는 데 쓴다.
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SEC);
}

// 지금 이 시각의 코드 — 테스트와 등록 확인에 쓴다.
export function totpCode(secretBase32: string, atMs: number = Date.now()): string | null {
  const secret = base32Decode(secretBase32);
  if (!secret || secret.length === 0) return null;
  return hotp(secret, totpStep(atMs));
}

export type TotpVerifyResult = { ok: true; step: number } | { ok: false };

// 코드 검증 — 성공하면 그 코드가 속한 스텝을 함께 준다.
//
// ★ 호출부는 **반환된 step 을 저장하고, 같은 step 의 재사용을 거부해야 한다.**
//   TOTP 코드는 30초 동안 유효해서, 어깨너머로 본 사람이 같은 창 안에 다시 쓸 수 있다.
//   이 함수는 상태를 갖지 않으므로(무상태 검증) 재사용 차단은 저장하는 쪽 몫이다.
//
// ⚠ 비교는 timingSafeEqual 로 한다 — 문자열 === 는 앞자리부터 끊어 응답시간으로 새고,
//   6자리는 탐색 공간이 좁아 그 누출이 실제로 쓸모가 있다.
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
): TotpVerifyResult {
  const secret = base32Decode(secretBase32);
  if (!secret || secret.length === 0) return { ok: false };

  const clean = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(clean)) return { ok: false };

  const current = totpStep(atMs);
  // 창 전체를 항상 돌아 응답시간이 "몇 번째 스텝에서 맞았는지"를 흘리지 않게 한다.
  let matched: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d += 1) {
    const step = current + d;
    const expected = hotp(secret, step);
    const a = Buffer.from(clean);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) matched = step;
  }
  return matched === null ? { ok: false } : { ok: true, step: matched };
}

// ── 인증 앱 등록용 URI ───────────────────────────────────────────────────────
// QR 코드에 담기는 값이자, QR 없이 손으로 옮겨 적을 때 보여 주는 값의 원본.
// 형식: otpauth://totp/{issuer}:{account}?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30
export const TOTP_ISSUER = "VitAlGuard";

export function totpAuthUri(account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// 손으로 옮겨 적기 좋게 4글자씩 끊어 준다(표시 전용 — 검증은 base32Decode 가 공백을 무시한다).
export function formatSecretForDisplay(secretBase32: string): string {
  return (secretBase32.match(/.{1,4}/g) ?? []).join(" ");
}
