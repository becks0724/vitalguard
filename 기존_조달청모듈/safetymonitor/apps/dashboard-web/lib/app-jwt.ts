// 앱(iPhone/Apple Watch) 인증 토큰 — HMAC-SHA256 서명 JWT(무의존, node:crypto). 서버 저장 없이 어느 인스턴스든 검증.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TTL_SEC = 30 * 24 * 60 * 60; // 30일 — 현장 앱은 재로그인 빈도를 낮춘다.

export type AppJwtClaims = {
  sub: string; // 로그인 ID(username)
  role: string; // owner | admin | worker
  name: string | null;
  workerId: string | null; // 사번(employee_id)
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

export type AppAuthFailure = "no_token" | "verify_failed" | "no_worker_id";

/** 클라이언트가 스스로 복구할 수 있는가. 응답에 이 값만 실어 앱이 재로그인을 띄우게 한다. */
export type AppAuthAction = "reauth" | "none";

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
  const claims = verifyAppJwt(raw);
  const reason: AppAuthFailure = !raw
    ? "no_token"
    : !claims
      ? "verify_failed"
      : "no_worker_id";
  // 재로그인으로 풀리는 경우 — 토큰이 없거나(로그아웃 상태), 만료·구 스키마(사번 누락).
  // 서명 자체가 틀린 경우는 앱이 재로그인해도 같은 결과라 none 으로 둔다.
  const action: AppAuthAction = reason === "verify_failed" ? "none" : "reauth";
  const iso = (t?: number) => (t ? new Date(t * 1000).toISOString() : "n/a");
  const logLine =
    `인증 거부(${reason}) — sub=${claims?.sub ?? "n/a"}` +
    ` workerId=${JSON.stringify(claims?.workerId ?? null)}` +
    ` iat=${iso(claims?.iat)} exp=${iso(claims?.exp)}` +
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

// {sub, role, name, workerId} 로 30일 만료 JWT 발급. 시크릿 미설정 시 throw(라우트가 사전 차단).
export function signAppJwt(input: {
  sub: string;
  role: string;
  name: string | null;
  workerId: string | null;
}): string {
  const secret = process.env.APP_JWT_SECRET ?? "";
  if (!secret) throw new Error("APP_JWT_SECRET 미설정");
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const payload = b64urlJson({ ...input, iat: now, exp: now + TTL_SEC });
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// Bearer 토큰 검증 — 서명·만료 확인 후 클레임 반환. 실패/미설정/변조 시 null.
export function verifyAppJwt(token: string | null | undefined): AppJwtClaims | null {
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
  if (typeof claims.exp !== "number" || Math.floor(Date.now() / 1000) > claims.exp) return null;
  return claims;
}

// Authorization: Bearer <token> 에서 토큰만 추출(없으면 null).
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.match(/^bearer\s+(.+)$/i)?.[1] ?? null;
}
