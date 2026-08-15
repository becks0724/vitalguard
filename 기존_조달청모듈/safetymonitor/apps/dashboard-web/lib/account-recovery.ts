// 계정 찾기(아이디 찾기·비밀번호 재설정)의 순수 규칙 — 마스킹·임시 비밀번호 생성·만료 판정.
// DB·요청과 분리해 두는 이유는 이 셋이 라우트 3곳과 화면에서 함께 쓰이기 때문이다.
// 규칙이 복제되면 한쪽만 고쳐져 "발급은 되는데 로그인은 안 되는" 임시 비번이 나온다.
import { randomInt } from "node:crypto";

import { PASSWORD_MAX, PASSWORD_MIN } from "./account-policy";

/** 임시 비밀번호 유효기간. 지나면 로그인 자체가 거부된다(변경 강제 화면 대신 쓰는 방어). */
export const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 아이디 마스킹 — 앞 2자와 뒤 2자만 남긴다.
 *
 * 이름·이메일은 명함에 있는 값이라, 전체를 노출하면 그 둘만으로 남의 계정 아이디를 캐낼 수 있다.
 * 본인은 앞뒤 글자만 봐도 알아보므로 실용성은 거의 잃지 않는다.
 * 가입 정책상 아이디는 4~20자(`checkUsername`)지만, 옛 데이터·env 계정처럼 짧은 값이 들어와도
 * 원문이 새지 않도록 짧은 쪽을 먼저 처리한다.
 */
export function maskUsername(username: string): string {
  const u = [...username.trim()];
  if (u.length === 0) return "";
  if (u.length <= 2) return `${u[0]!}*`;
  if (u.length <= 4) return `${u[0]!}${"*".repeat(u.length - 1)}`;
  const head = u.slice(0, 2).join("");
  const tail = u.slice(-2).join("");
  return `${head}${"*".repeat(u.length - 4)}${tail}`;
}

// 임시 비밀번호 문자셋 — 혼동 문자(0 O o 1 l I)를 뺀다. owner 가 전화로 불러주는 값이라
// 한 글자 오해가 곧 재문의가 된다.
const TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TEMP_LENGTH = 12;

/**
 * 임시 비밀번호 생성 — 가입 비밀번호 정책 길이(8~19자) 안에 드는 12자.
 *
 * 정책을 벗어난 값을 발급하면 사용자가 "내 정보"에서 바꿀 때가 아니라 그 전에 막힌다.
 * 길이는 상수라 컴파일 시점에 보장되지만, 정책 상수가 바뀌면 조용히 어긋나므로 단위 테스트로 묶어 둔다.
 */
export function generateTempPassword(): string {
  let out = "";
  for (let i = 0; i < TEMP_LENGTH; i += 1) {
    out += TEMP_ALPHABET[randomInt(0, TEMP_ALPHABET.length)]!;
  }
  return out;
}

/** 임시 비밀번호 만료 시각(ISO). 발급 시점 기준 TTL 을 더한다. */
export function tempPasswordExpiry(nowMs: number = Date.now()): string {
  return new Date(nowMs + TEMP_PASSWORD_TTL_MS).toISOString();
}

/**
 * 임시 비밀번호가 만료됐는가.
 *
 * `null` = 임시 비번 상태가 아님(정상 계정) → 만료 아님. 이 컬럼 하나로 "임시 상태인가"와
 * "언제까지인가"를 함께 표현한다(플래그 컬럼을 따로 두지 않는 이유).
 * 값이 깨져 파싱되지 않으면 만료로 본다 — 판독 불가를 통과시키면 임시 비번이 영구히 산다.
 */
export function tempPasswordExpired(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs > t;
}

// 생성 길이가 정책을 벗어나면 발급 즉시 못 쓰는 비번이 된다 — 모듈 로드 시 걸러낸다.
// (테스트가 있지만, 정책 상수를 고치는 사람이 테스트를 안 돌릴 수도 있다.)
if (TEMP_LENGTH < PASSWORD_MIN || TEMP_LENGTH > PASSWORD_MAX) {
  throw new Error(
    `임시 비밀번호 길이(${TEMP_LENGTH})가 비밀번호 정책(${PASSWORD_MIN}~${PASSWORD_MAX}) 밖입니다.`,
  );
}
