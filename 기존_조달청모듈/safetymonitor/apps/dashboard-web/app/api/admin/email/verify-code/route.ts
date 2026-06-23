// 회원가입 이메일 인증번호 확인 — 입력 코드 검증 후 해당 이메일을 '인증됨'으로 표시(가입 시 확인).
import { NextResponse } from "next/server";

import { verifyCode } from "../../../../../lib/email-verify";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { email, code } = (body as { email?: unknown; code?: unknown }) ?? {};
  if (typeof email !== "string" || typeof code !== "string") {
    return NextResponse.json({ ok: false, error: "입력 형식 오류" }, { status: 400 });
  }
  const r = verifyCode(email.trim(), code);
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
