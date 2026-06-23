// 이메일 인증코드를 메모리에 보관하고 검증하는 저장소(프로세스 한정 · 무상태 인스턴스 데모 OK).
// 세션 Map(admin-auth)과 동일한 메모리 모델 — 재시작 시 초기화. 다중 인스턴스 운영 시 DB 백엔드 검토.
import { randomInt } from "node:crypto";

const CODE_TTL_MS = 10 * 60 * 1000; // 인증번호 유효 10분
const RESEND_COOLDOWN_MS = 60 * 1000; // 재발송 최소 간격 60초
const MAX_ATTEMPTS = 5; // 코드 검증 시도 한도
const VERIFIED_TTL_MS = 30 * 60 * 1000; // 인증 완료 후 가입까지 유효 30분

type CodeEntry = { code: string; expiresAt: number; attempts: number; lastSentAt: number };

// HMR/재import 에도 단일 인스턴스 유지(globalThis 메모이즈).
const g = globalThis as unknown as {
  __vgEmailCodes?: Map<string, CodeEntry>;
  __vgEmailVerified?: Map<string, number>;
};
const codes: Map<string, CodeEntry> = (g.__vgEmailCodes ??= new Map());
const verified: Map<string, number> = (g.__vgEmailVerified ??= new Map());

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

// 6자리 인증번호 발급 + 저장. 쿨다운 내 재요청은 retryAfterSec 로 거부.
export function requestCode(
  email: string,
): { ok: true; code: string } | { ok: false; retryAfterSec: number } {
  const key = normalize(email);
  const now = Date.now();
  const prev = codes.get(key);
  if (prev && now - prev.lastSentAt < RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((RESEND_COOLDOWN_MS - (now - prev.lastSentAt)) / 1000),
    };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  codes.set(key, { code, expiresAt: now + CODE_TTL_MS, attempts: 0, lastSentAt: now });
  return { ok: true, code };
}

// 인증번호 검증. 성공 시 verified 에 기록(가입 시 isVerified 로 확인).
export function verifyCode(
  email: string,
  input: string,
): { ok: true } | { ok: false; error: string } {
  const key = normalize(email);
  const entry = codes.get(key);
  if (!entry) return { ok: false, error: "먼저 인증번호를 요청해주세요." };
  if (Date.now() > entry.expiresAt) {
    codes.delete(key);
    return { ok: false, error: "인증번호가 만료됐습니다. 다시 요청해주세요." };
  }
  if (entry.attempts >= MAX_ATTEMPTS) {
    codes.delete(key);
    return { ok: false, error: "시도 횟수를 초과했습니다. 다시 요청해주세요." };
  }
  entry.attempts += 1;
  if (input.trim() !== entry.code) {
    return { ok: false, error: "인증번호가 일치하지 않습니다." };
  }
  codes.delete(key);
  verified.set(key, Date.now() + VERIFIED_TTL_MS);
  return { ok: true };
}

// 가입 시점에 이메일 인증 완료 여부 확인(만료 시 false).
export function isVerified(email: string): boolean {
  const key = normalize(email);
  const until = verified.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    verified.delete(key);
    return false;
  }
  return true;
}

// 가입 성공 후 인증 기록 소비(재사용 방지).
export function consumeVerified(email: string): void {
  verified.delete(normalize(email));
}
