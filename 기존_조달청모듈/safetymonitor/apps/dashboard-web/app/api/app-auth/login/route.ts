// 앱(iPhone/Apple Watch) 로그인 — 관제웹 계정(users)으로 id/비번 검증 후 JWT 발급. 앱은 이후 요청에 이 토큰 사용.
import { NextResponse } from "next/server";

import {
  loginLockRemainingMs,
  recordLoginResult,
  verifyCredentials,
} from "../../../../lib/admin-auth";
import { isAppJwtConfigured, signAppJwt } from "../../../../lib/app-jwt";
import { findUserByUsername } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/password";

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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const lockKey = `app:${ip}:${id}`;
  const lockMs = loginLockRemainingMs(lockKey);
  if (lockMs > 0) {
    return NextResponse.json(
      { ok: false, error: "too_many_attempts", retryAfterSec: Math.ceil(lockMs / 1000) },
      { status: 429 },
    );
  }

  // 1) env owner(부트스트랩 관리자) 우선.
  if (verifyCredentials(id, password)) {
    recordLoginResult(lockKey, true);
    const token = signAppJwt({ sub: id, role: "owner", name: null, workerId: null });
    return NextResponse.json({
      ok: true,
      token,
      user: { id, name: null, role: "owner", workerId: null },
    });
  }

  // 2) DB 계정(관리자·근로자) — scrypt 검증 후 승인 상태 확인.
  const account = await findUserByUsername(id);
  const pwOk =
    account && account.password_hash
      ? await verifyPassword(password, account.password_hash)
      : false;
  recordLoginResult(lockKey, !!pwOk);
  if (!account || !pwOk) {
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }
  if (account.status !== "approved") {
    return NextResponse.json({ ok: false, error: "not_approved" }, { status: 403 });
  }

  const name = account.name ?? null;
  const workerId = account.employee_id ?? null; // 사번 — 생체/미디어 데이터와 매칭
  const token = signAppJwt({ sub: account.username, role: account.role, name, workerId });
  return NextResponse.json({
    ok: true,
    token,
    user: { id: account.username, name, role: account.role, workerId }, // role = owner | admin | worker
  });
}
