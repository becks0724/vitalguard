// Google OAuth 2.0 (Authorization Code) — 동의 URL 생성·code 교환·id_token 파싱.
// 의존성 0: code 를 서버에서 구글과 직접 교환하므로 id_token 은 신뢰 채널로 받는다 → 페이로드 디코드만으로 안전.
// 신규 가입자 신원(sub/email/name)은 HMAC 서명 쿠키로 무상태 전달(추가정보 폼 제출까지).
import { createHmac, timingSafeEqual } from "node:crypto";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// 요청 Cookie 헤더에서 단일 쿠키 값 추출(route handler 공용).
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_CLIENT_ID 미설정");
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_CLIENT_SECRET 미설정");
  return v;
}

// 외부 공개 origin 추정 — Cloud Run(x-forwarded-proto=https) / 로컬(localhost=http) 모두 대응.
export function publicOrigin(request: Request): string {
  const host = request.headers.get("host") ?? "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export function redirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/auth/google/callback`;
}

// 구글 동의 화면 URL — scope: openid email profile.
export function buildAuthUrl(request: Request, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

// code → 토큰 교환 후 id_token 페이로드에서 신원 추출.
export async function exchangeCodeForProfile(
  request: Request,
  code: string,
): Promise<GoogleProfile | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(request),
    }).toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) return null;
  return parseIdToken(json.id_token);
}

function parseIdToken(idToken: string): GoogleProfile | null {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
    };
    if (!payload.sub || !payload.email) return null;
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified:
        payload.email_verified === true || payload.email_verified === "true",
      name: payload.name ?? null,
    };
  } catch {
    return null;
  }
}

// ── HMAC 서명 쿠키(무상태) — 신규 가입자 신원을 추가정보 폼 제출까지 전달 ──────────
type SignedPayload = Record<string, unknown> & { exp: number };

export function signPayload(obj: Record<string, unknown>, ttlMs: number): string {
  const data = Buffer.from(
    JSON.stringify({ ...obj, exp: Date.now() + ttlMs }),
  ).toString("base64url");
  const mac = createHmac("sha256", clientSecret()).update(data).digest("base64url");
  return `${data}.${mac}`;
}

export function verifyPayload(value: string | undefined | null): SignedPayload | null {
  if (!value) return null;
  const [data, mac] = value.split(".");
  if (!data || !mac) return null;
  const expect = createHmac("sha256", clientSecret()).update(data).digest("base64url");
  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expect);
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) return null;
  try {
    const obj = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as SignedPayload;
    if (typeof obj.exp !== "number" || Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}
