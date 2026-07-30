import { NextResponse } from "next/server";

import {
  clientIpFromXff,
  loginLockRemainingMs,
  recordLoginResult,
  verifyCredentials,
} from "../../../../../../lib/admin-auth";
import {
  bootstrapOwnerWorkerId,
  createMobileRefreshToken,
  isAppJwtConfigured,
  mobileRefreshExpiryIso,
  signMobileAccessJwt,
} from "../../../../../../lib/app-jwt";
import { createMobileAppSession, findUserByUsername } from "../../../../../../lib/db";
import { verifyPassword } from "../../../../../../lib/password";

export const dynamic = "force-dynamic";

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export async function POST(request: Request) {
  if (!isAppJwtConfigured()) {
    return NextResponse.json({ ok: false, error: "app_auth_not_configured" }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const id = optionalText(body.id, 128);
  const password = typeof body.password === "string" ? body.password : "";
  if (!id || !password) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  const lockKey = `mobile-v1:${clientIpFromXff(request)}:${id}`;
  const lockMs = loginLockRemainingMs(lockKey);
  if (lockMs > 0) {
    return NextResponse.json(
      { ok: false, error: "too_many_attempts", retryAfterSec: Math.ceil(lockMs / 1000) },
      { status: 429 },
    );
  }

  let role: string;
  let name: string | null;
  let workerId: string | null;
  if (verifyCredentials(id, password)) {
    role = "owner";
    name = null;
    workerId = bootstrapOwnerWorkerId(id);
  } else {
    const account = await findUserByUsername(id);
    const passwordOK = account?.password_hash
      ? await verifyPassword(password, account.password_hash)
      : false;
    if (!account || !passwordOK) {
      recordLoginResult(lockKey, false);
      return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
    }
    if (account.status !== "approved") {
      return NextResponse.json({ ok: false, error: "not_approved" }, { status: 403 });
    }
    role = account.role;
    name = account.name ?? null;
    workerId = account.employee_id ?? null;
  }
  recordLoginResult(lockKey, true);

  const refresh = createMobileRefreshToken();
  const expiresAt = mobileRefreshExpiryIso();
  await createMobileAppSession({
    sessionId: refresh.sessionId,
    username: id,
    role,
    name,
    workerId,
    refreshTokenHash: refresh.tokenHash,
    deviceName: optionalText(body.deviceName, 120),
    platform: optionalText(body.platform, 32),
    expiresAt,
  });
  const accessToken = signMobileAccessJwt({
    sub: id,
    role,
    name,
    workerId,
    sessionId: refresh.sessionId,
  });
  return NextResponse.json({
    ok: true,
    accessToken,
    refreshToken: refresh.token,
    accessExpiresInSec: 15 * 60,
    refreshExpiresAt: expiresAt,
    user: { id, name, role, workerId },
  });
}
