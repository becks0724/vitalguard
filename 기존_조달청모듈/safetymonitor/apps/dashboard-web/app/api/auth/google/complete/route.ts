// Google 가입 추가정보 제출 — 서명 쿠키의 신원 + 회사·연락처로 pending 계정 생성(승인제).
import { NextResponse } from "next/server";

import { createGoogleUser } from "../../../../../lib/db";
import { readCookie, verifyPayload } from "../../../../../lib/google-oauth";

export async function POST(request: Request) {
  const ticket = verifyPayload(readCookie(request, "vg_gsignup"));
  if (!ticket || typeof ticket.sub !== "string" || typeof ticket.email !== "string") {
    return NextResponse.json(
      { ok: false, error: "세션이 만료됐습니다. 구글 로그인을 다시 시도하세요." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { company, phone } = (body ?? {}) as { company?: unknown; phone?: unknown };
  if (typeof company !== "string" || typeof phone !== "string") {
    return NextResponse.json(
      { ok: false, error: "회사(상호)·연락처는 필수입니다." },
      { status: 400 },
    );
  }
  const coName = company.trim();
  const tel = phone.trim();
  if (!coName || !tel) {
    return NextResponse.json({ ok: false, error: "회사(상호)·연락처는 필수입니다." }, { status: 400 });
  }
  if (!/^[0-9+\-\s]{7,20}$/.test(tel)) {
    return NextResponse.json({ ok: false, error: "연락처 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const user = await createGoogleUser({
    googleSub: ticket.sub,
    email: ticket.email,
    name: typeof ticket.name === "string" ? ticket.name : null,
    company: coName.slice(0, 100),
    phone: tel.slice(0, 20),
  });
  if (!user) {
    const dup = NextResponse.json(
      { ok: false, error: "이미 가입된 계정입니다." },
      { status: 409 },
    );
    dup.cookies.set("vg_gsignup", "", { maxAge: 0, path: "/" });
    return dup;
  }

  const res = NextResponse.json(
    {
      ok: true,
      status: "pending",
      message: "가입 신청이 완료됐습니다. 관리자 승인 후 구글 로그인으로 입장할 수 있습니다.",
    },
    { status: 201 },
  );
  res.cookies.set("vg_gsignup", "", { maxAge: 0, path: "/" }); // 1회용 폐기
  return res;
}
