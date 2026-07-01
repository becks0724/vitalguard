// 앱(iPhone/Apple Watch) 인증 토큰 — HMAC-SHA256 서명 JWT(무의존, node:crypto). 서버 저장 없이 어느 인스턴스든 검증.
import { createHmac, timingSafeEqual } from "node:crypto";

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
