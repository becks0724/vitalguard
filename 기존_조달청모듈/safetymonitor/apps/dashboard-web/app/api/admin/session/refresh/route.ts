// 세션 연장 — 현재 유효 세션 JWT 로 새 만료 JWT 재발급(슬라이딩). 만료/무효면 401.
// 은행식 "세션 연장" 팝업의 [연장] 이 호출. 무상태 JWT 라 재배포 후에도 유효 세션이면 연장됨.
import { NextResponse } from "next/server";

import { createSession, getSession } from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "session_invalid" },
      { status: 401 },
    );
  }
  const token = createSession(session.role, session.username);
  return NextResponse.json({ ok: true, token, role: session.role });
}
