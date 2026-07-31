// 앱(iPhone/Apple Watch) 인증 토큰 — HMAC-SHA256 서명 JWT(무의존, node:crypto). 서버 저장 없이 어느 인스턴스든 검증.
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const LEGACY_TTL_SEC = 30 * 24 * 60 * 60;
const MOBILE_ACCESS_TTL_SEC = 15 * 60;
export const MOBILE_REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

export type AppJwtClaims = {
  sub: string; // 로그인 ID(username)
  role: string; // owner | admin | worker
  name: string | null;
  workerId: string | null; // 사번(employee_id)
  aud?: "vitalguard-mobile";
  tokenUse?: "access";
  sessionId?: string;
  v?: number;
  iat: number;
  exp: number;
};

// 시크릿 미설정이면 앱 인증 비활성(로그인 라우트는 503, 검증은 null).
export function isAppJwtConfigured(): boolean {
  return Boolean(process.env.APP_JWT_SECRET);
}

// ── 인증 거부 진단 ──────────────────────────────────────────────────────────
// 왜 필요한가 — 토큰 인증은 네 가지 이유로 실패하는데(무토큰·서명오류·만료·클레임누락)
// 응답은 전부 401 하나다. 2026-07-29 에 앱이 토큰을 정상 전송하는데도 401 이 나면서
// 원인을 못 찾아 배포를 4회 롤백했다. 사유는 **서버 로그로만** 남기고 응답에는 넣지 않는다
// (서명 성공/실패를 외부에 알려주면 키 추측의 성공 여부를 흘리게 된다).

export type AppAuthFailure = "no_token" | "verify_failed" | "expired" | "no_worker_id";

/**
 * 클라이언트가 스스로 복구할 수 있는가. 응답에 이 값만 실어 앱이 무엇을 할지 정하게 한다.
 *
 * refresh — 액세스 토큰만 만료. 세션은 살아 있으므로 /session/refresh 로 회복된다.
 * reauth  — ID·비밀번호 재입력이 필요(토큰 없음·구 스키마).
 * none    — 서명 불일치. 재로그인해도 같은 결과라 반복 시도를 유도하지 않는다.
 *
 * ★ refresh 를 reauth 와 분리하는 이유(2026-07-31 실측):
 * 앱은 401 + action:"reauth" 를 받으면 deleteMobileSession() 으로 키체인을 비우는데
 * 거기엔 refresh 토큰도 들어 있다. 액세스 토큰 수명이 15분이라 앱을 그 이상 놔뒀다 켜면
 * 만료 401 → 세션 삭제 → 뒤이은 refresh 시도가 토큰을 못 찾아 실패 → "다시 로그인 필요".
 * mobile_app_session 13건이 전부 updated_at == created_at(회전 0회)였던 원인이 이것이다.
 * 만료를 refresh 로 내보내면 앱의 삭제 가드에 걸리지 않아 기존 회복 경로가 그대로 살아난다.
 */
export type AppAuthAction = "reauth" | "refresh" | "none";

export type AppAuthDiagnosis = {
  reason: AppAuthFailure;
  action: AppAuthAction;
  /** 로그 전용 요약. 토큰 문자열·서명은 절대 포함하지 않는다. */
  logLine: string;
};

/**
 * 401 을 내기 직전에 호출해 사유를 판별한다.
 * requireWorkerId=true 면 사번이 없는 토큰도 실패로 본다(생체 수집 경로).
 */
export function diagnoseAppAuth(
  request: Request,
  opts: { requireWorkerId?: boolean } = {},
): AppAuthDiagnosis {
  const raw = bearerToken(request);
  const signedClaims = verifiedAppJwtClaims(raw);
  const claims = verifyAppJwt(raw);
  const reason: AppAuthFailure = !raw
    ? "no_token"
    : !signedClaims
      ? "verify_failed"
      : !claims
        ? "expired"
      : "no_worker_id";
  // 서명 자체가 틀린 경우는 앱이 재로그인해도 같은 결과라 none.
  // 만료(서명은 정상)는 세션이 살아 있으므로 refresh 로 회복된다 — 재로그인을 요구하면
  // 앱이 refresh 토큰까지 지워 회복 수단을 스스로 없앤다.
  // 사번 누락·구 스키마는 refresh 해도 같은 클레임이 나오므로 재로그인이 맞다.
  const action: AppAuthAction =
    reason === "verify_failed" ? "none" : reason === "expired" ? "refresh" : "reauth";
  const iso = (t?: number) => (t ? new Date(t * 1000).toISOString() : "n/a");
  const logLine =
    `인증 거부(${reason}) — sub=${(claims ?? signedClaims)?.sub ?? "n/a"}` +
    ` workerId=${JSON.stringify((claims ?? signedClaims)?.workerId ?? null)}` +
    ` iat=${iso((claims ?? signedClaims)?.iat)} exp=${iso((claims ?? signedClaims)?.exp)}` +
    ` requireWorkerId=${opts.requireWorkerId ? "y" : "n"}` +
    ` ua=${request.headers.get("user-agent") ?? "n/a"}`;
  return { reason, action, logLine };
}

// DB 행이 없는 부트스트랩 소유자도 생체 전송의 사번 바인딩을 만족해야 한다.
// 로그인 ID 원문은 생체 레코드에 남기지 않고, 안정적인 불투명 식별자로만 사용한다.
export function bootstrapOwnerWorkerId(id: string): string {
  const normalized = id.trim();
  if (!normalized) throw new Error("bootstrap owner ID가 비어 있습니다");
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `owner-${digest}`;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signJwt(input: {
  sub: string;
  role: string;
  name: string | null;
  workerId: string | null;
  aud?: "vitalguard-mobile";
  tokenUse?: "access";
  sessionId?: string;
  v?: number;
}, ttlSec: number): string {
  const secret = process.env.APP_JWT_SECRET ?? "";
  if (!secret) throw new Error("APP_JWT_SECRET 미설정");
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({ ...input, iat: now, exp: now + ttlSec });
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// 기존 앱과의 호환용 JWT. 새 모바일 클라이언트는 아래의 15분 access token을 사용한다.
export function signAppJwt(input: {
  sub: string;
  role: string;
  name: string | null;
  workerId: string | null;
}): string {
  return signJwt(input, LEGACY_TTL_SEC);
}

export function createMobileRefreshToken(): { token: string; tokenHash: string; sessionId: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashMobileRefreshToken(token), sessionId: randomUUID() };
}

export function hashMobileRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mobileRefreshExpiryIso(now = Date.now()): string {
  return new Date(now + MOBILE_REFRESH_TTL_SEC * 1000).toISOString();
}

export function signMobileAccessJwt(input: {
  sub: string;
  role: string;
  name: string | null;
  workerId: string | null;
  sessionId: string;
}): string {
  return signJwt({ ...input, aud: "vitalguard-mobile", tokenUse: "access", v: 2 }, MOBILE_ACCESS_TTL_SEC);
}

// 서명만 확인한다. 만료 판단과 401 action 판정을 같은 검증 결과에 기반하게 해,
// 변조 토큰을 "재로그인"으로 오인하지 않는다.
function verifiedAppJwtClaims(token: string | null | undefined): AppJwtClaims | null {
  const secret = process.env.APP_JWT_SECRET ?? "";
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(sig ?? "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: AppJwtClaims;
  try {
    claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as AppJwtClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number") return null;
  return claims;
}

// Bearer 토큰 검증 — 서명·만료 확인 후 클레임 반환. 실패/미설정/변조 시 null.
export function verifyAppJwt(token: string | null | undefined): AppJwtClaims | null {
  const claims = verifiedAppJwtClaims(token);
  if (!claims || Math.floor(Date.now() / 1000) > claims.exp) return null;
  return claims;
}

export function verifyMobileAccessJwt(token: string | null | undefined): AppJwtClaims | null {
  const claims = verifyAppJwt(token);
  if (
    claims?.aud !== "vitalguard-mobile" ||
    claims.tokenUse !== "access" ||
    claims.v !== 2 ||
    typeof claims.sessionId !== "string" ||
    claims.sessionId.length === 0
  ) {
    return null;
  }
  return claims;
}

// 401 본문의 action 계약. 서명 불일치/변조는 none 으로 둬 반복 시도를 유도하지 않는다.
// 만료는 refresh(세션 살아 있음), 구 스키마·무토큰은 reauth(재로그인해야 클레임이 바뀐다).
// 판정 순서 주의 — 구 스키마 검사가 만료보다 앞이다. 만료된 구 스키마 토큰을 refresh 로
// 보내면 같은 결함을 가진 토큰이 다시 발급돼 무한 반복에 빠진다.
export function mobileUnauthorizedAction(token: string | null | undefined): AppAuthAction {
  if (!token) return "reauth";
  const claims = verifiedAppJwtClaims(token);
  if (!claims) return "none";
  if (!claims.workerId) return "reauth";
  if (claims.aud === "vitalguard-mobile" && (claims.tokenUse !== "access" || claims.v !== 2)) {
    return "reauth";
  }
  if (Math.floor(Date.now() / 1000) > claims.exp) return "refresh";
  return "none";
}

// Authorization: Bearer <token> 에서 토큰만 추출(없으면 null).
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.match(/^bearer\s+(.+)$/i)?.[1] ?? null;
}
