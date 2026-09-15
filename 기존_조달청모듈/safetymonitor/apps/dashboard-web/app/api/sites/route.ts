// 로그인한 관제웹·현장 앱의 현장 목록.
import { NextResponse } from "next/server";

import { getSession } from "../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import { listSites } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // site-info POST의 selectOnly와 마찬가지로 현장 선택에는 관리자 메뉴 권한이 필요 없다.
  // 현장 목록만 읽고 쓰지 않는 라우트이므로 앱 JWT 또는 유효한 관제웹 세션만 확인한다.
  // 단, 제출 화면 전용 contractor는 selectOnly의 verifyBasicAuth와 동일하게 거부한다.
  const appClaims = verifyAppJwt(bearerToken(request));
  const session = appClaims ? null : getSession(request);
  const username = appClaims?.sub ?? session?.username;
  if (!username || session?.orgType === "contractor") {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, sites: await listSites() });
}
