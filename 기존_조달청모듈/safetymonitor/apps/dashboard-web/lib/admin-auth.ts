// 관리자 인증 — 로그인 시 발급한 불투명 세션 토큰(서버측 TTL) 또는 직접 자격(id:pw) 검증.
// 발표용 프로토타입 한정. 실 서비스 화 시 NextAuth + Cognito + httpOnly cookie + CSRF 토큰 도입 필요.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { clientIpFromRequest } from "./client-ip";
import { findUserByUsername } from "./db";
import {
  signSessionJwt,
  verifySessionJwt,
  sessionTtlSec,
  type SessionRole,
} from "./session-jwt";

const ADMIN_ID = process.env.ADMIN_ID ?? "admin";
// 소스에 동작하는 기본 비밀번호를 넣지 않는다(fail-closed). 미설정 시 관리자 인증은 항상 거부.
// 데모/운영자는 .env.local 에 ADMIN_PASSWORD 를 직접 설정한다.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

let warnedMissingPassword = false;

// 프로세스 수명 동안 고정된 HMAC 키 — 자격을 고정폭(32바이트) 다이제스트로 만들어 비교한다.
const COMPARE_KEY = randomBytes(32);

// 상수시간 문자열 비교 — 양쪽을 HMAC-SHA256 다이제스트로 변환한 뒤 비교한다.
// 길이 불일치 early-return 을 없애 자격 길이가 응답시간으로 새지 않게 한다(timing 오라클 제거).
function safeEqual(a: string, b: string): boolean {
  const da = createHmac("sha256", COMPARE_KEY).update(a).digest();
  const db = createHmac("sha256", COMPARE_KEY).update(b).digest();
  return timingSafeEqual(da, db);
}

let warnedWeakPassword = false;

// id + password 직접 검증 — /api/admin/login 에서 호출
export function verifyCredentials(id: string, password: string): boolean {
  if (!ADMIN_PASSWORD) {
    if (!warnedMissingPassword) {
      console.warn(
        "[admin-auth] ADMIN_PASSWORD 미설정 — 관리자 인증 비활성(fail-closed). .env.local 에 설정하세요.",
      );
      warnedMissingPassword = true;
    }
    return false;
  }
  // 약한 비번 경고(비차단) — 공개 터널 공유 시 강한 비번 권장. brute-force 자체는 rate limit 으로 차단.
  if (ADMIN_PASSWORD.length < 12 && !warnedWeakPassword) {
    console.warn(
      "[admin-auth] ADMIN_PASSWORD 가 12자 미만 — 공개 URL 공유 시 더 긴 비번 권장(로그인 시도 제한은 적용됨).",
    );
    warnedWeakPassword = true;
  }
  // id·password 를 각각 상수시간 비교한 뒤 결합 — 두 safeEqual 을 항상 평가해(단락 없이)
  // 어느 쪽이 틀렸는지 응답시간으로 새지 않게 한다.
  const idOk = safeEqual(id, ADMIN_ID);
  const pwOk = safeEqual(password, ADMIN_PASSWORD);
  return idOk && pwOk;
}

// ── 로그인 시도 제한(무차별 대입 방어) ──────────────────────────────────────
// 잠금 키(요청 IP + id)별 연속 실패 횟수를 세고, 임계 초과 시 일정 시간 잠근다(in-memory, 프로세스 단위).
// 공개 cloudflared 터널 URL 노출 시 약한 비번 사전대입을 실효성 없게 만든다.
// 키를 'ip:id' 로 두면 한 공격자가 임의 id 로 다른 관리자를 잠그는 targeted lockout(DoS)을 막는다.
const MAX_FAILS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5분
const MAX_ATTEMPT_ENTRIES = 5000; // Map 무한 증식 방지 상한

type AttemptRecord = { fails: number; lockedUntil: number };
const globalForAttempts = globalThis as typeof globalThis & {
  __safetyMonitorLoginAttempts?: Map<string, AttemptRecord>;
};
const loginAttempts: Map<string, AttemptRecord> =
  globalForAttempts.__safetyMonitorLoginAttempts ??
  (globalForAttempts.__safetyMonitorLoginAttempts = new Map());

// 만료된(잠금 풀린·실패 0) 항목 정리 + 상한 초과 시 오래된 항목 제거.
function sweepLoginAttempts(): void {
  const now = Date.now();
  for (const [key, rec] of loginAttempts) {
    // 잠금이 풀렸고 누적 실패도 없는 항목은 더 보관할 이유가 없다.
    if (rec.lockedUntil <= now && rec.fails === 0) loginAttempts.delete(key);
  }
  // 그래도 상한을 넘으면 삽입 순서가 오래된 항목부터 제거(Map 은 삽입 순서 유지).
  while (loginAttempts.size > MAX_ATTEMPT_ENTRIES) {
    const oldest = loginAttempts.keys().next().value;
    if (oldest === undefined) break;
    loginAttempts.delete(oldest);
  }
}

// 신뢰 클라이언트 IP — Cloud Run 등 신뢰 프록시는 실제 클라 IP 를 X-Forwarded-For 최우측에 append 한다.
// 최좌측 값은 클라이언트가 임의로 넣을 수 있어(위조), 매 요청 XFF 를 바꿔 (ip,id) 잠금을 절대 발동 안 하게
// 하던 우회를 만든다 → 최우측(신뢰 프록시가 본 실 IP)을 잠금 키 IP 로 사용한다.
export function clientIpFromXff(request: Request): string {
  return clientIpFromRequest(request);
}

// 남은 잠금 시간(ms). 0 이면 잠기지 않음. key = 'ip:id'(login route 에서 조합).
export function loginLockRemainingMs(key: string): number {
  const rec = loginAttempts.get(key);
  if (!rec) return 0;
  const remaining = rec.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

// 로그인 결과 기록 — 성공 시 카운터 리셋, 실패 누적이 임계 도달 시 잠금. key = 'ip:id'.
export function recordLoginResult(key: string, ok: boolean): void {
  if (ok) {
    loginAttempts.delete(key);
    return;
  }
  const rec = loginAttempts.get(key) ?? { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.fails = 0; // 잠금 발동 후 카운터 리셋(잠금 해제 시 다시 MAX_FAILS 기회)
  }
  loginAttempts.set(key, rec);
  sweepLoginAttempts();
}

// ── 세션 토큰(무상태 JWT) ─────────────────────────────────────────────────────
// 로그인 성공 시 비밀번호와 무관한 서명 JWT(HMAC-SHA256)를 발급한다. 서버 저장이 없어 Cloud Run
// 재배포·다중 인스턴스에도 검증되며(→ in-memory 세션 소멸로 인한 GPS redaction 등 방지), 만료(exp)로
// 자동 폐기된다. 서명/검증은 lib/session-jwt(무의존). 만료 임박 시 클라이언트가 refresh 로 재발급(슬라이딩).

// owner = env 관리자(최초 승인자, 사용자 관리 권한), admin = 가입 후 승인된 관리자.
export type { SessionRole };
export type SessionInfo = { expiresAt: number; role: SessionRole; username: string };

// 역할·아이디를 담아 세션 발급(기본은 env owner — 기존 호출 호환). 반환 = 서명 JWT.
export function createSession(
  role: SessionRole = "owner",
  username: string = ADMIN_ID,
): string {
  return signSessionJwt({ sub: username, role });
}

// 유효 세션 정보 반환(서명·만료 검증 실패 시 null).
function getValidSession(token: string): SessionInfo | null {
  const claims = verifySessionJwt(token);
  if (!claims) return null;
  return { expiresAt: claims.exp * 1000, role: claims.role, username: claims.sub };
}

function validateSession(token: string): boolean {
  return getValidSession(token) !== null;
}

// 토큰 문자열로 직접 세션 정보 조회 — OAuth 핸드오프(쿠키→sessionStorage)에서 role 확인용.
export function sessionInfoForToken(token: string): SessionInfo | null {
  return getValidSession(token);
}

// Authorization 헤더 검증 — 보호된 API route 에서 호출. 스킴별로 받는 자격을 분리한다.
//  - Bearer <token> : 로그인 발급 불투명 세션 토큰만(비밀번호 미포함). base64(id:pw) 는 거부.
//  - Basic <value>  : 세션 토큰(AdminExportModal 이 Basic 으로 전송) 또는 base64(id:pw)(curl 등 직접 호출).
// (이전엔 Bearer 로도 base64(id:pw) 가 복호 통과돼 평문 자격을 Bearer 로 우회 전송 가능했음 → 차단.)
export function verifyBasicAuth(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;
  const match = header.match(/^(basic|bearer)\s+(.+)$/i);
  if (!match) return false;
  const scheme = match[1]?.toLowerCase();
  const value = match[2]?.trim();
  if (!value) return false;

  // 세션 토큰은 두 스킴 모두 허용(기존 클라이언트 호환: 대시보드=Bearer, 관리자 모달=Basic).
  if (validateSession(value)) return true;

  // base64(id:pw) 직접 자격은 Basic 스킴에서만 허용 — Bearer 로의 자격 우회 전송을 막는다.
  if (scheme !== "basic") return false;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep < 0) return false;
    return verifyCredentials(decoded.slice(0, sep), decoded.slice(sep + 1));
  } catch {
    return false;
  }
}

// Authorization 헤더에서 유효 세션 정보(역할 포함) 추출 — owner 전용 API 게이트용.
// 세션 토큰(Bearer/Basic) 우선, 없으면 Basic base64(id:pw) 직접 자격을 env owner 로 인정.
export function getSession(request: Request): SessionInfo | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^(basic|bearer)\s+(.+)$/i);
  if (!match) return null;
  const value = match[2]?.trim();
  if (!value) return null;

  const info = getValidSession(value);
  if (info) return info;

  // base64(id:pw) 직접 자격은 Basic 에서만 — 일치 시 env owner 세션으로 취급(저장은 안 함).
  if (match[1]?.toLowerCase() === "basic") {
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (
        sep >= 0 &&
        verifyCredentials(decoded.slice(0, sep), decoded.slice(sep + 1))
      ) {
        return {
          expiresAt: Date.now() + sessionTtlSec() * 1000,
          role: "owner",
          username: ADMIN_ID,
        };
      }
    } catch {
      // 무시 — 아래에서 null
    }
  }
  return null;
}

// owner(env 관리자) 권한 확인 — 사용자 관리(승인/거절) API 보호용.
export function verifyOwner(request: Request): boolean {
  return getSession(request)?.role === "owner";
}

// 앱 업로드 토큰 일치 검사 — 어디서 온 토큰이든(헤더/폼 필드) env APP_UPLOAD_TOKEN 과 비교.
//  - 미설정 시 항상 거부(fail-closed). 세션 토큰과 충돌하지 않음(세션은 발급분만 매칭).
export function appUploadTokenMatches(token: string | null | undefined): boolean {
  const expected = process.env.APP_UPLOAD_TOKEN ?? "";
  if (!expected || !token) return false;
  return safeEqual(token.trim(), expected);
}

// 앱(현장 단말) 미디어 업로드 전용 토큰 — Authorization: Bearer <APP_UPLOAD_TOKEN>.
export function verifyAppUploadToken(request: Request): boolean {
  const header = request.headers.get("authorization");
  const match = header?.match(/^bearer\s+(.+)$/i);
  return appUploadTokenMatches(match?.[1] ?? null);
}

// 관리자 메뉴(CSV 내보내기·데이터 조회) 접근 — owner 거나 owner가 admin_access 부여한 가입 사용자만.
// UI 숨김만이 아니라 서버 데이터 엔드포인트에서 실제 차단(자가취득 불가).
export async function hasAdminMenuAccess(request: Request): Promise<boolean> {
  const session = getSession(request);
  if (!session) return false;
  if (session.role === "owner") return true;
  const user = await findUserByUsername(session.username).catch(() => null);
  return !!user?.admin_access;
}
