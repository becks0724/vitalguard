// 관리자 로그인 — id/password 검증 후 비밀번호와 무관한 세션 토큰 반환 (sessionStorage 저장용)
import { NextResponse } from "next/server";

import {
  createSession,
  loginLockRemainingMs,
  recordLoginResult,
  verifyCredentials,
} from "../../../../lib/admin-auth";
import { findUserByUsername } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/password";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { ok: false, error: "id / password 필수" },
      { status: 400 },
    );
  }

  const { id, password } = body as { id?: unknown; password?: unknown };
  if (typeof id !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { ok: false, error: "id / password 필수" },
      { status: 400 },
    );
  }

  // 잠금 키 = 요청 IP + id. id 단독으로 키잉하면 임의 id 로 다른 관리자를 잠그는
  // targeted lockout(DoS)이 가능 + Map 무한 증식. IP(프록시 헤더 첫 값) 로 범위를 한정.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const lockKey = `${ip}:${id}`;

  // 무차별 대입 방어 — (ip,id) 별 연속 실패 임계 초과 시 일정 시간 잠금(429).
  const lockMs = loginLockRemainingMs(lockKey);
  if (lockMs > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `로그인 시도 초과 — ${Math.ceil(lockMs / 1000)}초 후 다시 시도하세요.`,
      },
      { status: 429 },
    );
  }

  // 1) env owner(최초 승인자) 우선 — 일치 시 owner 세션 발급.
  if (verifyCredentials(id, password)) {
    recordLoginResult(lockKey, true);
    return NextResponse.json({
      ok: true,
      token: createSession("owner", id),
      role: "owner",
    });
  }

  // 2) DB 가입 관리자 — 비번 검증 후 승인 상태에 따라 분기.
  const user = await findUserByUsername(id);
  const pwOk = user ? await verifyPassword(password, user.password_hash) : false;
  // 비번 일치=잠금 리셋(미승인이라도 brute-force 아님), 불일치=실패 누적.
  recordLoginResult(lockKey, pwOk);
  if (!user || !pwOk) {
    return NextResponse.json(
      { ok: false, error: "관리자 ID 또는 비밀번호가 일치하지 않습니다." },
      { status: 401 },
    );
  }
  if (user.status === "pending") {
    return NextResponse.json(
      { ok: false, error: "가입 승인 대기 중입니다. 관리자 승인 후 로그인할 수 있습니다." },
      { status: 403 },
    );
  }
  if (user.status !== "approved") {
    return NextResponse.json(
      { ok: false, error: "가입이 거절된 계정입니다. 관리자에게 문의하세요." },
      { status: 403 },
    );
  }

  // 승인된 관리자 — admin 역할 세션 발급(비밀번호 무관 랜덤 토큰, 서버측 TTL).
  return NextResponse.json({
    ok: true,
    token: createSession("admin", user.username),
    role: "admin",
  });
}
