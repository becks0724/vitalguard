// 로그인한 관제웹·현장 앱의 현장 목록.
import { NextResponse } from "next/server";

import { getSession, hasAdminMenuAccess } from "../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import { listSites } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // site-info GET과 같은 인증: 앱 JWT 우선, 관제웹 세션은 관리자 메뉴 권한까지 확인한다.
  const appClaims = verifyAppJwt(bearerToken(request));
  const username = appClaims?.sub ?? getSession(request)?.username;
  if (!username || (!appClaims && !(await hasAdminMenuAccess(request)))) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, sites: await listSites() });
}
