// OAuth 세션 핸드오프 — 콜백이 심은 httpOnly 쿠키의 세션 토큰을 클라이언트(sessionStorage)로 1회 전달.
import { NextResponse } from "next/server";

import { sessionInfoForToken } from "../../../../lib/admin-auth";
import { readCookie } from "../../../../lib/google-oauth";

export async function GET(request: Request) {
  const token = readCookie(request, "vg_handoff");
  const info = token ? sessionInfoForToken(token) : null;

  const clear = (res: NextResponse) => {
    res.cookies.set("vg_handoff", "", { maxAge: 0, path: "/" });
    return res;
  };

  if (!token || !info) {
    return clear(NextResponse.json({ ok: false }, { status: 401 }));
  }
  return clear(
    NextResponse.json({ ok: true, token, role: info.role }),
  );
}
