// 내 정보 수정 진입 전 step-up 인증 — 현재 세션 사용자의 비밀번호를 재확인(새 토큰 발급 없음).
import { NextResponse } from "next/server";

import { getSession, verifyCredentials } from "../../../../lib/admin-auth";
import { findUserByUsername } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/password";

export async function POST(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const password = (body as { password?: unknown })?.password;
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ ok: false, error: "비밀번호를 입력해주세요." }, { status: 400 });
  }

  // owner = env 자격(verifyCredentials), admin = DB 비밀번호 해시(verifyPassword).
  let ok = false;
  if (session.role === "owner") {
    ok = verifyCredentials(session.username, password);
  } else {
    const user = await findUserByUsername(session.username).catch(() => null);
    ok = !!(user && user.password_hash && (await verifyPassword(password, user.password_hash)));
  }

  if (!ok) {
    return NextResponse.json({ ok: false, error: "비밀번호가 일치하지 않습니다." }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
