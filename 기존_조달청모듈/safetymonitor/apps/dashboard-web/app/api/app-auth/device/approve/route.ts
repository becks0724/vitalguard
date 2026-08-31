// 워치 QR 로그인 ② 승인 — 폰(/pair)이 코드 + 관제웹 자격을 보낸다. 자격 판정·잠금·발급은 login 라우트와 **같은 함수**.
import { NextResponse } from "next/server";

import { clientIpFromXff } from "../../../../../lib/admin-auth";
import { isAppJwtConfigured, signAppJwt } from "../../../../../lib/app-jwt";
import { authenticateAppLogin, countsAsPasswordSuccess } from "../../../../../lib/app-login";
import { approveDeviceLogin, readDeviceLogin } from "../../../../../lib/db";
import { normalizeDeviceCode } from "../../../../../lib/device-login";
import { loginLockRemainingMs, recordLoginResult } from "../../../../../lib/login-attempts";

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
  const { code: rawCode, id, password } = (body ?? {}) as { code?: unknown; id?: unknown; password?: unknown };
  const code = normalizeDeviceCode(rawCode);
  if (!code || typeof id !== "string" || typeof password !== "string" || !id || !password) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  // 자격 검증은 login 과 한 경로 — 잠금 키도 같은 접두(app:)라 워치 직접 로그인과 실패 횟수를 공유한다.
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

  // 코드는 자격이 맞은 뒤에만 본다 — 코드 존재 여부가 무인증 탐색에 새지 않는다.
  const row = await readDeviceLogin(code);
  if (!row || row.status !== "pending" || row.expired) {
    return NextResponse.json({ ok: false, error: "code_invalid" }, { status: 404 });
  }
  const { sub, role, name, workerId } = outcome.principal;
  const token = signAppJwt({ sub, role, name, workerId });
  const bound = await approveDeviceLogin(code, { token, sub, workerId, workerName: name });
  if (!bound) {
    return NextResponse.json({ ok: false, error: "code_invalid" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, code, user: { id: sub, name, role, workerId } });
}
