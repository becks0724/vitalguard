// 관리자 로그인 — id/password 검증 후 비밀번호와 무관한 세션 토큰 반환 (sessionStorage 저장용)
import { NextResponse } from "next/server";

import { tempPasswordExpired } from "../../../../lib/account-recovery";
import {
  clientIpFromXff,
  createSession,
  verifyCredentials,
} from "../../../../lib/admin-auth";
import { loginLockRemainingMs, recordLoginResult } from "../../../../lib/login-attempts";
import { findUserByUsername, markTotpStepUsed } from "../../../../lib/db";
import { DEMO_ENABLED, getDemoProfile, verifyDemoMember } from "../../../../lib/demo-members";
import { verifyPassword } from "../../../../lib/password";
import { verifyTotp } from "../../../../lib/totp";
import { shouldChallenge, twoFactorPending } from "../../../../lib/two-factor";

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

  // totpCode = 2단계 인증 6자리. 1단계 요청엔 없다(서버가 twoFactorRequired 로 되물으면
  // 화면이 비밀번호를 그대로 쥔 채 코드만 더해 다시 보낸다 — 중간 토큰을 만들지 않는 이유는
  // 발급·만료·폐기가 통째로 늘어나는데 잠금 카운터가 이미 무차별 대입을 막고 있어서다).
  const { id, password, totpCode } = body as {
    id?: unknown;
    password?: unknown;
    totpCode?: unknown;
  };
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
      token: createSession("owner", id, "vitalguard"),
      role: "owner",
      orgType: "vitalguard",
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
    const demoOrg = getDemoProfile(id)?.org_type;
    return NextResponse.json({ ok: true, token: createSession("admin", id, demoOrg), role: "admin", orgType: demoOrg });
  }

  // 2) DB 가입 관리자 — 비번 검증 후 승인 상태에 따라 분기.
  const user = await findUserByUsername(id);
  // Google 전용 계정(password_hash null)은 비번 로그인 불가 → pwOk false.
  const pwOk =
    user && user.password_hash
      ? await verifyPassword(password, user.password_hash)
      : false;
  // ⚠ 비번이 맞아도 여기서 잠금을 리셋하지 않는다(2026-08-28) — 2단계 인증이 붙으면서
  //   "비번 통과 = 성공" 이 아니게 됐다. 여기서 리셋하면 비번을 아는 사람이 6자리를 무한정
  //   시도할 수 있다(30초마다 100만분의 1이 아니라, 잠금 없는 전수 탐색이 된다).
  //   리셋은 **2단계까지 끝난 뒤** 아래에서 한 번만 한다.
  if (!pwOk) await recordLoginResult(lockKey, false);
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

  // ── 2단계 인증(2026-08-28) — 고권한 계정만. 대상·활성 판정은 lib/two-factor 하나가 쥔다.
  if (shouldChallenge(user)) {
    // 1단계만 보낸 요청 = 실패가 아니라 다음 단계 요청이다. 잠금 카운터를 건드리지 않는다.
    if (typeof totpCode !== "string" || totpCode.trim().length === 0) {
      return NextResponse.json(
        { ok: false, twoFactorRequired: true, error: "인증 앱의 6자리 코드를 입력하세요." },
        { status: 401 },
      );
    }
    const result = verifyTotp(user.totp_secret ?? "", totpCode);
    if (!result.ok) {
      await recordLoginResult(lockKey, false);
      return NextResponse.json(
        { ok: false, twoFactorRequired: true, error: "코드가 일치하지 않습니다. 다시 확인해주세요." },
        { status: 401 },
      );
    }
    // ★ 같은 30초 창의 재사용 차단 — 코드가 30초 살아 있어 어깨너머로 본 사람이 곧바로 다시 쓸 수 있다.
    //   판정을 DB 조건에 둔 이유는 Cloud Run 이 다중 인스턴스라 메모리로 세면 인스턴스마다
    //   따로 세어 같은 코드가 인스턴스 수만큼 통과하기 때문이다(markTotpStepUsed 주석).
    if (!(await markTotpStepUsed(user.id, result.step))) {
      await recordLoginResult(lockKey, false);
      return NextResponse.json(
        { ok: false, twoFactorRequired: true, error: "이미 사용한 코드입니다. 다음 코드를 기다려주세요." },
        { status: 401 },
      );
    }
  }

  // 여기까지 와야 성공이다 — 잠금 리셋은 단 한 번, 모든 단계를 통과한 뒤.
  await recordLoginResult(lockKey, true);

  // 승인된 관리자 — admin 역할 세션 발급(비밀번호 무관 랜덤 토큰, 서버측 TTL).
  // 임시 비밀번호로 들어온 경우 화면이 "내 정보에서 바꾸라"고 안내하도록 표식을 함께 내린다.
  return NextResponse.json({
    ok: true,
    token: createSession("admin", user.username, user.org_type),
    role: "admin",
    orgType: user.org_type,
    mustChangePassword: user.temp_password_expires_at !== null,
    // 대상인데 아직 등록을 안 한 계정 — 화면이 등록을 권한다. 여기서 막지 않는다(막으면
    // 등록 화면이 로그인 뒤에 있어 계정이 잠긴다).
    twoFactorPending: twoFactorPending(user),
  });
}
