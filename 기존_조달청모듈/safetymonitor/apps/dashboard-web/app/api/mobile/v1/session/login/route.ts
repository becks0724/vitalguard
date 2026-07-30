// 모바일 세션 로그인 — 단기 access + 회전 refresh 발급(레거시 /api/app-auth/login 과 병행).
// 자격 검증은 lib/app-login 이 담당한다. 라우트마다 계정 조회·사번 결정을 복제하면 한쪽만 고친 채
// 다른 쪽이 남는다 — 2026-07-29 에 사번이 빈 문자열로 토큰에 실려 수집이 401 이 되고 배포를 4회
// 롤백한 사고가 그 형태였다. 여기는 특히 위험한데, 발급한 사번이 세션 행에 저장돼 refresh 마다
// 30일 동안 그대로 재발급되기 때문이다.
import { NextResponse } from "next/server";

import { clientIpFromXff } from "../../../../../../lib/admin-auth";
import {
  createMobileRefreshToken,
  isAppJwtConfigured,
  mobileRefreshExpiryIso,
  signMobileAccessJwt,
} from "../../../../../../lib/app-jwt";
import { authenticateAppLogin, countsAsPasswordSuccess } from "../../../../../../lib/app-login";
import { createMobileAppSession } from "../../../../../../lib/db";
import { loginLockRemainingMs, recordLoginResult } from "../../../../../../lib/login-attempts";

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
  const lockMs = await loginLockRemainingMs(lockKey);
  if (lockMs > 0) {
    return NextResponse.json(
      { ok: false, error: "too_many_attempts", retryAfterSec: Math.ceil(lockMs / 1000) },
      { status: 429 },
    );
  }

  const outcome = await authenticateAppLogin(id, password);
  await recordLoginResult(lockKey, countsAsPasswordSuccess(outcome));

  if (!outcome.ok) {
    const status = outcome.reason === "not_approved" ? 403 : 401;
    return NextResponse.json({ ok: false, error: outcome.reason }, { status });
  }

  const { sub, role, name, workerId } = outcome.principal;
  const refresh = createMobileRefreshToken();
  const expiresAt = mobileRefreshExpiryIso();
  await createMobileAppSession({
    sessionId: refresh.sessionId,
    username: sub,
    role,
    name,
    workerId,
    refreshTokenHash: refresh.tokenHash,
    deviceName: optionalText(body.deviceName, 120),
    platform: optionalText(body.platform, 32),
    expiresAt,
  });
  const accessToken = signMobileAccessJwt({
    sub,
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
    user: { id: sub, name, role, workerId },
  });
}
