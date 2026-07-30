import { NextResponse } from "next/server";

import { bearerToken, verifyMobileAccessJwt } from "../../../../../../lib/app-jwt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const claims = verifyMobileAccessJwt(bearerToken(request));
  if (!claims) {
    return NextResponse.json({ ok: false, error: "unauthorized", action: "reauth" }, { status: 401 });
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
