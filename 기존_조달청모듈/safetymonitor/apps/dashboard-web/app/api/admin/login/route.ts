// 관리자 로그인 — id/password 검증 후 비밀번호와 무관한 세션 토큰 반환 (sessionStorage 저장용)
import { NextResponse } from "next/server";

import { tempPasswordExpired } from "../../../../lib/account-recovery";
import {
  clientIpFromXff,
  createSession,
  verifyCredentials,
} from "../../../../lib/admin-auth";
import { loginLockRemainingMs, recordLoginResult } from "../../../../lib/login-attempts";
import { findUserByUsername } from "../../../../lib/db";
import { DEMO_ENABLED, verifyDemoMember } from "../../../../lib/demo-members";
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

  // 잠금 키 = 신뢰 홉 IP + id. id 단독 키잉은 targeted lockout(DoS) + Map 무한 증식 위험.
  // IP 는 신뢰 프록시(Cloud Run)가 append 한 XFF 최우측 홉 — 클라 위조 최좌측으로 잠금 우회 차단.
  const ip = clientIpFromXff(request);
  const lockKey = `${ip}:${id}`;

  // 무차별 대입 방어 — (ip,id) 별 연속 실패 임계 초과 시 일정 시간 잠금(429).
  const lockMs = await loginLockRemainingMs(lockKey);
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
    await recordLoginResult(lockKey, true);
    return NextResponse.json({
      ok: true,
      token: createSession("owner", id),
      role: "owner",
    });
  }

  // 1.5) 로컬 데모 회원 — DATABASE_URL 미설정(로컬 dev) 시만. 실 서버(DB 연결)에선 비활성 → 아래 DB 사용.
  if (DEMO_ENABLED) {
    const ok = verifyDemoMember(id, password);
    await recordLoginResult(lockKey, ok);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "관리자 ID 또는 비밀번호가 일치하지 않습니다." },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: true, token: createSession("admin", id), role: "admin" });
  }

  // 2) DB 가입 관리자 — 비번 검증 후 승인 상태에 따라 분기.
  const user = await findUserByUsername(id);
  // Google 전용 계정(password_hash null)은 비번 로그인 불가 → pwOk false.
  const pwOk =
    user && user.password_hash
      ? await verifyPassword(password, user.password_hash)
      : false;
  // 비번 일치=잠금 리셋(미승인이라도 brute-force 아님), 불일치=실패 누적.
  await recordLoginResult(lockKey, pwOk);
  if (!user || !pwOk) {
    return NextResponse.json(
      { ok: false, error: "관리자 ID 또는 비밀번호가 일치하지 않습니다." },
      { status: 401 },
    );
  }
  // 작업자 계정은 관제 웹 대상이 아니다 — 모바일 앱(/api/app-auth/login) 전용.
  // 승인 상태보다 먼저 본다(승인돼도 들어올 수 없으므로 "승인 대기" 안내는 오해를 준다).
  if (user.role === "worker") {
    return NextResponse.json(
      {
        ok: false,
        error: "작업자 계정은 관제 웹에 로그인할 수 없습니다. 모바일 앱을 이용하세요.",
      },
      { status: 403 },
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

  // 임시 비밀번호(관리자가 재설정 승인 시 발급)는 유효기간이 지나면 더 이상 통하지 않는다.
  // 로그인 시점에 막는 것이 실질 방어다 — 클라이언트 '변경 강제' 화면은 토큰을 쥔 뒤 건너뛰면 그만이다.
  if (tempPasswordExpired(user.temp_password_expires_at)) {
    return NextResponse.json(
      {
        ok: false,
        error: "임시 비밀번호가 만료됐습니다. 비밀번호 찾기로 다시 신청해주세요.",
      },
      { status: 403 },
    );
  }

  // 승인된 관리자 — admin 역할 세션 발급(비밀번호 무관 랜덤 토큰, 서버측 TTL).
  // 임시 비밀번호로 들어온 경우 화면이 "내 정보에서 바꾸라"고 안내하도록 표식을 함께 내린다.
  return NextResponse.json({
    ok: true,
    token: createSession("admin", user.username),
    role: "admin",
    mustChangePassword: user.temp_password_expires_at !== null,
  });
}
