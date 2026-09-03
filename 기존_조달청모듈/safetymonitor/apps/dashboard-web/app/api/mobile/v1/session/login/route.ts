// 모바일 세션 로그인 — 단기 access + 회전 refresh 발급(레거시 /api/app-auth/login 과 병행).
// 자격 검증은 lib/app-login 이 담당한다. 라우트마다 계정 조회·사번 결정을 복제하면 한쪽만 고친 채
// 다른 쪽이 남는다 — 2026-07-29 에 사번이 빈 문자열로 토큰에 실려 수집이 401 이 되고 배포를 4회
// 롤백한 사고가 그 형태였다. 여기는 특히 위험한데, 발급한 사번이 세션 행에 저장돼 refresh 마다
// 30일 동안 그대로 재발급되기 때문이다.
//
// ── 2단계 인증(2026-09-03 사용자 결정 "관제웹의 로그인 방식도 동일 구조") ────────────────
// 대상 판정은 `lib/two-factor` 하나가 쥔다(웹·앱이 각자 판정하면 규칙이 두 벌이 된다).
// 요청 모양도 관제웹과 같다 — 1단계는 `{id,password}`, 서버가 `twoFactorRequired` 로 되물으면
// 화면이 비밀번호를 그대로 쥔 채 `totpCode` 만 더해 다시 보낸다. 중간 토큰을 만들지 않는 이유도
// 같다(발급·만료·폐기가 통째로 늘어나는데 잠금 카운터가 이미 무차별 대입을 막고 있다).
//
// ⚠ **레거시 `/api/app-auth/login` 에는 절대 걸지 않는다.** 그쪽은 워치·수집 단말이 쓰는데
//   6자리를 입력할 화면이 없다 — 걸면 수집이 그 자리에서 멈춘다(실측 2026-09-03: 워치가 쓰는
//   `admin6861` 은 `admin_access=true` 이고 `totp_enabled=true` 라 `shouldChallenge` 가 곧바로
//   참이 된다). 가드가 그 자리를 막고 있다(`lib/2026-08-28-two-factor.guard.test.ts`).
//
// ★ 두 경로가 갈려도 **2단계를 안 거친 토큰이 관제 데이터에 닿지 못하는 것**은 토큰 모양이
//   구조적으로 다르기 때문이다. 레거시는 `signAppJwt`, 여기는 `signMobileAccessJwt`(aud=
//   `vitalguard-mobile` · tokenUse=`access` · v=2 · sessionId)이고 `verifyMobileAccessJwt` 가
//   그 넷을 모두 요구한다. 관리자 조회는 이 토큰만 받도록 만든다.
import { NextResponse } from "next/server";

import { clientIpFromXff } from "../../../../../../lib/admin-auth";
import {
  createMobileRefreshToken,
  isAppJwtConfigured,
  mobileRefreshExpiryIso,
  signMobileAccessJwt,
} from "../../../../../../lib/app-jwt";
import { authenticateAppLogin, countsAsPasswordSuccess } from "../../../../../../lib/app-login";
import { createMobileAppSession, markTotpStepUsed } from "../../../../../../lib/db";
import { loginLockRemainingMs, recordLoginResult } from "../../../../../../lib/login-attempts";
import { verifyTotp } from "../../../../../../lib/totp";
import { shouldChallenge, twoFactorPending } from "../../../../../../lib/two-factor";

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

  if (!outcome.ok) {
    await recordLoginResult(lockKey, countsAsPasswordSuccess(outcome));
    const status = outcome.reason === "not_approved" ? 403 : 401;
    return NextResponse.json({ ok: false, error: outcome.reason }, { status });
  }

  // ── 2단계 인증 — 관제웹(`app/api/admin/login`)과 같은 규칙·같은 응답 모양.
  //    ⚠ 여기 오기까지 잠금 카운터를 **성공으로 기록하지 않았다.** 비번 통과만으로 리셋하면
  //      비번을 아는 사람이 6자리를 무한정 시도할 수 있다(잠금 없는 전수 탐색이 된다).
  //      성공 기록은 모든 단계를 통과한 뒤 아래에서 딱 한 번 한다.
  const account = outcome.account;
  if (account && shouldChallenge(account)) {
    // 1단계만 보낸 요청 = 실패가 아니라 다음 단계 요청이다. 잠금 카운터를 건드리지 않는다.
    const totpCode = typeof body.totpCode === "string" ? body.totpCode : "";
    if (totpCode.trim().length === 0) {
      return NextResponse.json(
        { ok: false, twoFactorRequired: true, error: "인증 앱의 6자리 코드를 입력하세요." },
        { status: 401 },
      );
    }
    const result = verifyTotp(account.totp_secret ?? "", totpCode);
    if (!result.ok) {
      await recordLoginResult(lockKey, false);
      return NextResponse.json(
        { ok: false, twoFactorRequired: true, error: "코드가 일치하지 않습니다. 다시 확인해주세요." },
        { status: 401 },
      );
    }
    // 같은 30초 창의 재사용 차단 — 판정을 DB 조건에 두는 이유는 Cloud Run 이 다중 인스턴스라
    // 메모리로 세면 인스턴스마다 따로 세어 같은 코드가 인스턴스 수만큼 통과하기 때문이다.
    if (!(await markTotpStepUsed(account.id, result.step))) {
      await recordLoginResult(lockKey, false);
      return NextResponse.json(
        { ok: false, twoFactorRequired: true, error: "이미 사용한 코드입니다. 다음 코드를 기다려주세요." },
        { status: 401 },
      );
    }
  }

  // 여기까지 와야 성공이다 — 잠금 리셋은 단 한 번, 모든 단계를 통과한 뒤.
  await recordLoginResult(lockKey, true);

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
    // 대상인데 아직 등록을 안 한 계정 — 앱이 등록을 권한다. **여기서 막지 않는다.**
    // 등록 화면(`/api/admin/totp`)은 관제웹에 있고 관제 세션으로만 열리므로, 여기서 막으면
    // 앱으로 들어올 길도 등록할 길도 함께 사라져 계정이 잠긴다(관제웹과 같은 판단).
    twoFactorPending: account ? twoFactorPending(account) : false,
  });
}
