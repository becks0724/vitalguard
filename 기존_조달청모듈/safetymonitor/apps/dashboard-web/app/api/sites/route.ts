// 로그인한 관제웹·현장 앱의 현장 목록.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import { listSites } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request) && verifyAppJwt(bearerToken(request)) === null) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, sites: await listSites() });
}
