// 관제 대시보드 세션 토큰 — HMAC-SHA256 서명 JWT(무의존·무상태). 서버 저장 없이 어느 인스턴스든 검증.
// in-memory 세션은 Cloud Run 재배포·다중 인스턴스에 소멸(→ GPS redaction 등) → 무상태 JWT 로 세션 유지.
// 서명 키 = APP_JWT_SECRET 에서 대시보드 전용으로 파생(앱 로그인 JWT 와 crypto 분리, 새 시크릿 불필요).
//   - APP_JWT_SECRET 미설정 시 per-process 랜덤 키 폴백(프로세스 단위 — 재시작 시 무효, 로컬 전용 안전망).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type SessionRole = "owner" | "admin";
export type SessionClaims = {
  sub: string; // username
  role: SessionRole;
  /** 가입 유형(vitalguard|member|contractor) — 시공사 세션의 관제 데이터 차단 판정용(2026-08-27).
   *  ⚠ 옵셔널인 이유 = 배포 시점에 살아 있는 구 토큰엔 이 클레임이 없다. 구 토큰은 전부
   *  직원(관제) 계정이므로 "없음 = 직원"으로 해석한다 — 시공사 실계정은 아직 발급 전이다. */
  orgType?: string;
  iat: number; // 발급(초)
  exp: number; // 만료(초)
};

// TTL — 분 단위 env(기본 480=8시간). 테스트 시 짧게 두면 만료 팝업을 빨리 확인 가능(재빌드 불필요, env 만).
function ttlSec(): number {
  const raw = Number(process.env.DASHBOARD_SESSION_TTL_MIN);
  const min = Number.isFinite(raw) && raw >= 1 && raw <= 1440 ? raw : 480;
  return min * 60;
}

export function sessionTtlSec(): number {
  return ttlSec();
}

// 대시보드 세션 전용 서명 키 — APP_JWT_SECRET 파생(앱 토큰과 분리). 미설정 시 per-process 랜덤.
let cachedKey: Buffer | null = null;
let warnedNoSecret = false;
function signingKey(): Buffer {
  if (cachedKey) return cachedKey;
  const base = process.env.APP_JWT_SECRET?.trim();
  if (base) {
    cachedKey = createHmac("sha256", base).update("vitalguard-dashboard-session-v1").digest();
  } else {
    // 미설정 폴백 = per-process 랜덤. 단일 프로세스(로컬)엔 무해하나 다중 인스턴스 배포 시
    // 인스턴스마다 키가 달라 세션 검증이 분절된다(로그인 후 간헐 401). 프로덕션은 APP_JWT_SECRET 필수.
    if (!warnedNoSecret) {
      console.warn(
        "[session-jwt] APP_JWT_SECRET 미설정 — per-process 랜덤 키 폴백. 다중 인스턴스 배포 시 세션 검증 분절(프로덕션은 APP_JWT_SECRET 설정 필수).",
      );
      warnedNoSecret = true;
    }
    cachedKey = randomBytes(32);
  }
  return cachedKey;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function sign(data: string): string {
  return createHmac("sha256", signingKey()).update(data).digest("base64url");
}

export function signSessionJwt(input: { sub: string; role: SessionRole; orgType?: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({
    sub: input.sub,
    role: input.role,
    ...(input.orgType ? { orgType: input.orgType } : {}),
    iat: now,
    exp: now + ttlSec(),
  });
  const sig = sign(`${header}.${payload}`);
  return `${header}.${payload}.${sig}`;
}

export function verifySessionJwt(token: string | null | undefined): SessionClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  if (!header || !payload || !sig) return null;

  // 서명 검증(timing-safe). 길이 다르면 즉시 실패.
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.role !== "owner" && claims.role !== "admin") return null;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) > claims.exp) {
    return null;
  }
  return claims;
}
