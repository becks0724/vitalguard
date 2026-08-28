// 2단계 인증 등록·확인·해제 — 본인 계정 전용(세션의 username 으로만 대상을 정한다).
//
// ★ 대상을 본문에서 받지 않는다. 받으면 남의 계정 2단계를 내가 끄거나 새로 심을 수 있다.
//   관리자가 남의 것을 풀어 주는 경로는 여기가 아니라 사용자 관리(/api/admin/users)다.
//
// GET    현재 상태 + (등록 중이면) 시크릿·URI. 화면이 문자열/QR 을 보여줄 재료.
// POST   { action: "begin" }              시크릿 발급(활성화는 안 함)
//        { action: "confirm", code }      6자리 확인 → 활성화
//        { action: "disable", code }      해제 — 활성 상태면 코드 확인을 요구한다
import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/admin-auth";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  findUserByUsername,
  markTotpStepUsed,
} from "../../../../lib/db";
import { formatSecretForDisplay, generateTotpSecret, totpAuthUri, verifyTotp } from "../../../../lib/totp";
import { totpQrDataUri } from "../../../../lib/totp-qr";
import { requiresTwoFactor, twoFactorPending } from "../../../../lib/two-factor";

// 세션 → 본인 행. env owner(부트스트랩 계정)는 DB 행이 없어 여기서 null 이 된다.
async function me(request: Request) {
  const session = getSession(request);
  if (!session) return null;
  return (await findUserByUsername(session.username).catch(() => null)) ?? null;
}

// ⚠ env owner(ADMIN_ID/ADMIN_PASSWORD)는 DB 행이 없어 시크릿을 저장할 곳이 없다 —
//   구조상 2단계를 걸 수 없다. 이 계정은 배포 환경변수로만 회전되므로, 상용화 시에는
//   부트스트랩 전용으로 남기고 일상 운영은 DB 계정으로 하는 것이 맞다(현재 관례와 동일).
const NO_DB_ROW = {
  ok: false,
  error: "이 계정은 2단계 인증을 설정할 수 없습니다(환경변수 부트스트랩 계정).",
} as const;

// 등록 화면에 내려보내는 재료 — GET(등록 중 복귀)과 begin(첫 발급)이 같은 모양을 써야
// 새로고침 전후로 화면이 달라지지 않는다.
// ★ 세 값을 함께 준다: 키 문자열(기본 방식) · otpauth URI · QR(선택 방식).
//   QR 생성이 실패해도 qrDataUri 만 빠지고 문자열 등록은 그대로 된다 — QR 은 편의 경로다.
function enrollmentPayload(username: string, secret: string) {
  const uri = totpAuthUri(username, secret);
  const qr = totpQrDataUri(uri);
  return {
    secret: formatSecretForDisplay(secret),
    uri,
    ...(qr ? { qrDataUri: qr } : {}),
  };
}

export async function GET(request: Request) {
  const user = await me(request);
  if (!user) return NextResponse.json(NO_DB_ROW, { status: 403 });

  // 시크릿은 **아직 활성화되지 않은 등록 중**에만 내려보낸다.
  // 활성 계정의 시크릿을 다시 주면, 세션을 훔친 쪽이 자기 앱에 같은 계정을 등록해 버린다.
  const enrolling = !user.totp_enabled && typeof user.totp_secret === "string" && user.totp_secret.length > 0;
  return NextResponse.json({
    ok: true,
    required: requiresTwoFactor(user),
    enabled: user.totp_enabled,
    pending: twoFactorPending(user),
    ...(enrolling ? enrollmentPayload(user.username, user.totp_secret!) : {}),
  });
}

export async function POST(request: Request) {
  const user = await me(request);
  if (!user) return NextResponse.json(NO_DB_ROW, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { action, code } = (body ?? {}) as { action?: unknown; code?: unknown };

  // ── 등록 시작 — 시크릿만 심는다(활성화는 confirm 에서).
  if (action === "begin") {
    if (user.totp_enabled) {
      return NextResponse.json(
        { ok: false, error: "이미 2단계 인증이 켜져 있습니다. 다시 등록하려면 먼저 해제하세요." },
        { status: 409 },
      );
    }
    const secret = generateTotpSecret();
    const updated = await beginTotpEnrollment(user.id, secret);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "등록을 시작하지 못했습니다." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...enrollmentPayload(user.username, secret) });
  }

  // ── 등록 확인 — 6자리가 맞아야 활성화. 여기서만 켜진다.
  if (action === "confirm") {
    if (user.totp_enabled) {
      return NextResponse.json({ ok: false, error: "이미 켜져 있습니다." }, { status: 409 });
    }
    if (!user.totp_secret) {
      return NextResponse.json(
        { ok: false, error: "등록을 먼저 시작하세요." },
        { status: 409 },
      );
    }
    if (typeof code !== "string") {
      return NextResponse.json({ ok: false, error: "6자리 코드가 필요합니다." }, { status: 400 });
    }
    const result = verifyTotp(user.totp_secret, code);
    if (!result.ok) {
      // ⚠ 시크릿을 지우지 않는다 — 오타 한 번에 등록을 처음부터 다시 하게 만들면,
      //   사람은 QR 을 다시 스캔하지 않고 옛 등록을 그대로 둔 채 계속 틀린다.
      return NextResponse.json(
        { ok: false, error: "코드가 일치하지 않습니다. 앱의 현재 코드를 다시 확인해주세요." },
        { status: 400 },
      );
    }
    const updated = await confirmTotpEnrollment(user.id, result.step);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "활성화에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, enabled: true });
  }

  // ── 해제 — 켜져 있으면 코드를 요구한다.
  // ★ 세션만으로 끄게 두면 세션을 훔친 쪽이 2단계를 지우고 비밀번호만 남길 수 있다.
  //   그러면 2단계를 붙인 의미가 사라진다. 앱을 잃어버린 경우는 관리자가 풀어 준다.
  if (action === "disable") {
    if (user.totp_enabled) {
      if (typeof code !== "string") {
        return NextResponse.json(
          { ok: false, error: "해제하려면 인증 앱의 6자리 코드가 필요합니다." },
          { status: 400 },
        );
      }
      const result = verifyTotp(user.totp_secret ?? "", code);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: "코드가 일치하지 않습니다." }, { status: 400 });
      }
      // 재사용 차단은 해제 경로에도 건다 — 훔친 코드 한 개로 끄지 못하게.
      if (!(await markTotpStepUsed(user.id, result.step))) {
        return NextResponse.json(
          { ok: false, error: "이미 사용한 코드입니다. 다음 코드를 기다려주세요." },
          { status: 400 },
        );
      }
    }
    const updated = await disableTotp(user.id);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "해제에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, enabled: false });
  }

  return NextResponse.json(
    { ok: false, error: "action(begin|confirm|disable) 이 필요합니다." },
    { status: 400 },
  );
}
