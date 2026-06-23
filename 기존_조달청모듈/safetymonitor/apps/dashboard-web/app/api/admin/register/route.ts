// 관리자 회원가입 — 신규 계정을 status=pending 으로 저장(승인제). 승인 전엔 로그인 불가.
import { NextResponse } from "next/server";

import { isAllowedCompany } from "../../../../lib/companies";
import { createUser } from "../../../../lib/db";
import { consumeVerified, isVerified } from "../../../../lib/email-verify";
import { hashPassword } from "../../../../lib/password";

// env owner 와 혼동되는 아이디는 가입 차단(로그인 1순위가 env owner 라 그림자 계정 방지).
const RESERVED = new Set(["admin", "owner", "root", "administrator", "superuser"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "입력 형식 오류" }, { status: 400 });
  }

  const { username, password, name, company, phone, carrier, email } = body as {
    username?: unknown;
    password?: unknown;
    name?: unknown;
    company?: unknown;
    phone?: unknown;
    carrier?: unknown;
    email?: unknown;
  };
  // 6개 항목 전부 필수 — 회사·아이디·비밀번호·이름·연락처·이메일.
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    typeof name !== "string" ||
    typeof company !== "string" ||
    typeof phone !== "string" ||
    typeof email !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "모든 항목(회사·아이디·비밀번호·이름·연락처·이메일)을 입력해주세요." },
      { status: 400 },
    );
  }

  const uname = username.trim();
  const coName = company.trim();
  const personName = name.trim();
  const tel = phone.trim();
  const mail = email.trim();
  if (!coName || !personName || !tel || !mail) {
    return NextResponse.json(
      { ok: false, error: "모든 항목을 입력해주세요." },
      { status: 400 },
    );
  }
  // B2B — 승인된 기업(상호)만 가입 허용.
  if (!isAllowedCompany(coName)) {
    return NextResponse.json(
      { ok: false, error: "승인되지 않은 회사(상호)입니다." },
      { status: 400 },
    );
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(uname)) {
    return NextResponse.json(
      { ok: false, error: "아이디는 3~40자의 영문·숫자·. _ - 만 사용할 수 있습니다." },
      { status: 400 },
    );
  }
  if (RESERVED.has(uname.toLowerCase())) {
    return NextResponse.json(
      { ok: false, error: "사용할 수 없는 아이디입니다." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "비밀번호는 8자 이상이어야 합니다." },
      { status: 400 },
    );
  }
  // 이메일 형식 — 간단 검증(공백 없이 a@b.c 형태).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return NextResponse.json(
      { ok: false, error: "이메일 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  // 연락처 — 숫자 위주(7~20자, 숫자·+·-·공백 허용).
  if (!/^[0-9+\-\s]{7,20}$/.test(tel)) {
    return NextResponse.json(
      { ok: false, error: "연락처 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  // ★ 이메일 인증 강제 — 인증 완료된 이메일만 가입 허용(가짜 이메일 차단).
  if (!isVerified(mail)) {
    return NextResponse.json(
      { ok: false, error: "이메일 인증을 먼저 완료해주세요." },
      { status: 403 },
    );
  }

  const carrierName = typeof carrier === "string" ? carrier.trim().slice(0, 20) : "";

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    username: uname,
    name: personName.slice(0, 60),
    company: coName.slice(0, 100),
    phone: tel.slice(0, 20),
    carrier: carrierName || null,
    email: mail.slice(0, 120),
    emailVerified: true,
    passwordHash,
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "이미 사용 중인 아이디입니다." },
      { status: 409 },
    );
  }
  // 가입 성공 — 인증 기록 소비(동일 인증 재사용 방지).
  consumeVerified(mail);

  return NextResponse.json(
    {
      ok: true,
      status: "pending",
      message: "가입 신청이 완료됐습니다. 관리자 승인 후 로그인할 수 있습니다.",
    },
    { status: 201 },
  );
}
