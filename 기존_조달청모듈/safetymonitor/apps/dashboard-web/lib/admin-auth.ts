// 관리자 인증 — 로그인 시 발급한 불투명 세션 토큰(서버측 TTL) 또는 직접 자격(id:pw) 검증.
// 발표용 프로토타입 한정. 실 서비스 화 시 NextAuth + Cognito + httpOnly cookie + CSRF 토큰 도입 필요.
import { randomBytes, timingSafeEqual } from "node:crypto";

import { findUserByUsername } from "./db";

const ADMIN_ID = process.env.ADMIN_ID ?? "admin";
// 소스에 동작하는 기본 비밀번호를 넣지 않는다(fail-closed). 미설정 시 관리자 인증은 항상 거부.
// 데모/운영자는 .env.local 에 ADMIN_PASSWORD 를 직접 설정한다.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

let warnedMissingPassword = false;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
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
  return safeEqual(id, ADMIN_ID) && safeEqual(password, ADMIN_PASSWORD);
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

// ── 세션 토큰 ─────────────────────────────────────────────────────────────
// 로그인 성공 시 비밀번호와 무관한 랜덤 불투명 토큰을 발급해 서버측에 TTL 과 함께 보관한다.
// 클라이언트는 이 토큰만 저장/재전송하므로 sessionStorage 노출(XSS 등) 시에도 평문 비밀번호는 새지 않고,
// TTL 만료 또는 프로세스 재시작으로 자동 폐기된다.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8시간

const MAX_SESSION_ENTRIES = 10000; // 24/7 누수 방지 상한

// owner = env 관리자(최초 승인자, 사용자 관리 권한), admin = 가입 후 승인된 관리자.
export type SessionRole = "owner" | "admin";
export type SessionInfo = { expiresAt: number; role: SessionRole; username: string };

type SessionStore = Map<string, SessionInfo>; // token → 세션 정보(만료·역할·아이디)
const globalForSessions = globalThis as typeof globalThis & {
  __safetyMonitorAdminSessions?: SessionStore;
};
const sessions: SessionStore =
  globalForSessions.__safetyMonitorAdminSessions ??
  (globalForSessions.__safetyMonitorAdminSessions = new Map());

// 만료 토큰 일괄 정리 + 상한 초과 시 오래된 토큰 제거(lazy 삭제만으로는 24/7 누수).
function sweepSessions(): void {
  const now = Date.now();
  for (const [token, info] of sessions) {
    if (now > info.expiresAt) sessions.delete(token);
  }
  while (sessions.size > MAX_SESSION_ENTRIES) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

// 역할·아이디를 담아 세션 발급(기본은 env owner — 기존 호출 호환).
export function createSession(
  role: SessionRole = "owner",
  username: string = ADMIN_ID,
): string {
  sweepSessions();
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS, role, username });
  return token;
}

// 유효 세션 정보 반환(만료 시 삭제 후 null).
function getValidSession(token: string): SessionInfo | null {
  const info = sessions.get(token);
  if (!info) return null;
  if (Date.now() > info.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return info;
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
          expiresAt: Date.now() + SESSION_TTL_MS,
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

// 관리자 메뉴(CSV 내보내기·데이터 조회) 접근 — owner 거나 owner가 admin_access 부여한 가입 사용자만.
// UI 숨김만이 아니라 서버 데이터 엔드포인트에서 실제 차단(자가취득 불가).
export async function hasAdminMenuAccess(request: Request): Promise<boolean> {
  const session = getSession(request);
  if (!session) return false;
  if (session.role === "owner") return true;
  const user = await findUserByUsername(session.username).catch(() => null);
  return !!user?.admin_access;
}
