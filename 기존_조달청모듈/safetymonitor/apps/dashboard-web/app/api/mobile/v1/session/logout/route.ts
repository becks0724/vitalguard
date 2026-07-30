import { NextResponse } from "next/server";

import { bearerToken, verifyMobileAccessJwt } from "../../../../../../lib/app-jwt";
import { revokeMobileAppSession } from "../../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const claims = verifyMobileAccessJwt(bearerToken(request));
  if (!claims?.sessionId) {
    return NextResponse.json({ ok: false, error: "unauthorized", action: "reauth" }, { status: 401 });
  }
  await revokeMobileAppSession(claims.sessionId);
  return NextResponse.json({ ok: true });
}
