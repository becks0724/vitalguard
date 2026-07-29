// 앱(iPhone/Apple Watch) 로그인 — 관제웹 계정(users)으로 id/비번 검증 후 JWT 발급. 앱은 이후 요청에 이 토큰 사용.
import { NextResponse } from "next/server";

import {
  clientIpFromXff,
  loginLockRemainingMs,
  recordLoginResult,
  verifyCredentials,
} from "../../../../lib/admin-auth";
import { bootstrapOwnerWorkerId, isAppJwtConfigured, signAppJwt } from "../../../../lib/app-jwt";
import { findUserByUsername } from "../../../../lib/db";
import { defaultEmployeeId } from "../../../../lib/employee-id";
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
  const ip = clientIpFromXff(request);
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
    const workerId = bootstrapOwnerWorkerId(id);
    const token = signAppJwt({ sub: id, role: "owner", name: null, workerId });
    return NextResponse.json({
      ok: true,
      token,
      user: { id, name: null, role: "owner", workerId },
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
  // 사번 — 생체/미디어 데이터와 매칭.
  // `?? null` 만으로는 부족하다. `??` 는 null·undefined 만 거르므로 빈 문자열('')이 그대로 통과해
  // workerId:"" 인 토큰이 발급되고, 수집 라우트의 `!claims?.workerId` 가 falsy 로 잡아 401 을 낸다.
  // 앱은 토큰을 실어 보내는데도 거부되므로 원인이 드러나지 않는다(2026-07-29 배포 4회 롤백의 원인).
  // 값이 비면 서버가 이미 쓰는 규칙(EMP-<username>)으로 되살린다 — 백필·앱 폴백과 같은 값이라
  // 기존 생체·미디어 레코드와 즉시 맞물린다.
  const storedEmployeeId = (account.employee_id ?? "").trim();
  const workerId = storedEmployeeId || defaultEmployeeId(account.username) || null;
  const token = signAppJwt({ sub: account.username, role: account.role, name, workerId });
  return NextResponse.json({
    ok: true,
    token,
    user: { id: account.username, name, role: account.role, workerId }, // role = owner | admin | worker
  });
}
