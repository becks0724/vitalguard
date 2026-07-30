// 앱(iPhone/Apple Watch) 로그인 — 관제웹 계정(users)으로 id/비번 검증 후 레거시 30일 JWT 발급.
// 워치는 자체 로그인이 없어 폰이 이 토큰을 WCSession 으로 밀어준다(모바일 v1 세션과 별개 경로).
// 자격 검증 자체는 lib/app-login 이 담당한다 — 모바일 세션 API 와 판정을 공유하기 위해.
import { NextResponse } from "next/server";

import { clientIpFromXff } from "../../../../lib/admin-auth";
import { isAppJwtConfigured, signAppJwt } from "../../../../lib/app-jwt";
import { authenticateAppLogin, countsAsPasswordSuccess } from "../../../../lib/app-login";
import { loginLockRemainingMs, recordLoginResult } from "../../../../lib/login-attempts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAppJwtConfigured()) {
    return NextResponse.json({ ok: false, error: "app_auth_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const { id, password } = (body ?? {}) as { id?: unknown; password?: unknown };
  if (typeof id !== "string" || typeof password !== "string" || !id || !password) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  // 무차별 대입 방어 — (ip,id) 별 연속 실패 임계 초과 시 잠금(웹 로그인과 동일 메커니즘, 키 접두사만 분리).
  const ip = clientIpFromXff(request);
  const lockKey = `app:${ip}:${id}`;
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
  const token = signAppJwt({ sub, role, name, workerId });
  return NextResponse.json({
    ok: true,
    token,
    user: { id: sub, name, role, workerId }, // role = owner | admin | worker
  });
}
