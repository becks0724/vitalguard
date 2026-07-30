import { NextResponse } from "next/server";

import {
  createMobileRefreshToken,
  hashMobileRefreshToken,
  isAppJwtConfigured,
  mobileRefreshExpiryIso,
  signMobileAccessJwt,
} from "../../../../../../lib/app-jwt";
import { findActiveMobileAppSession, rotateMobileAppSession } from "../../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAppJwtConfigured()) {
    return NextResponse.json({ ok: false, error: "app_auth_not_configured" }, { status: 503 });
  }
  let refreshToken = "";
  try {
    const body = (await request.json()) as { refreshToken?: unknown };
    refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  if (!refreshToken) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const previousHash = hashMobileRefreshToken(refreshToken);
  const session = await findActiveMobileAppSession(previousHash);
  if (!session) {
    return NextResponse.json({ ok: false, error: "invalid_session", action: "reauth" }, { status: 401 });
  }
  const next = createMobileRefreshToken();
  const expiresAt = mobileRefreshExpiryIso();
  const rotated = await rotateMobileAppSession({
    sessionId: session.session_id,
    previousRefreshTokenHash: previousHash,
    nextRefreshTokenHash: next.tokenHash,
    expiresAt,
  });
  if (!rotated) {
    return NextResponse.json({ ok: false, error: "invalid_session", action: "reauth" }, { status: 401 });
  }
  const accessToken = signMobileAccessJwt({
    sub: session.username,
    role: session.role,
    name: session.name,
    workerId: session.worker_id,
    sessionId: session.session_id,
  });
  return NextResponse.json({
    ok: true,
    accessToken,
    refreshToken: next.token,
    accessExpiresInSec: 15 * 60,
    refreshExpiresAt: expiresAt,
    user: {
      id: session.username,
      name: session.name,
      role: session.role,
      workerId: session.worker_id,
    },
  });
}
