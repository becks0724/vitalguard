import { NextResponse } from "next/server";

import { bearerToken, mobileUnauthorizedAction, verifyMobileAccessJwt } from "../../../../../../lib/app-jwt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = bearerToken(request);
  const claims = verifyMobileAccessJwt(token);
  if (!claims) {
    // action 을 하드코딩하지 않는다 — 만료(refresh 로 회복)와 재로그인 필요를 구분해야 한다.
    // 앱은 action=="reauth" 를 받으면 refresh 토큰까지 지워 회복 수단을 스스로 없앤다.
    return NextResponse.json(
      { ok: false, error: "unauthorized", action: mobileUnauthorizedAction(token) },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    user: {
      id: claims.sub,
      name: claims.name,
      role: claims.role,
      workerId: claims.workerId,
    },
  });
}
