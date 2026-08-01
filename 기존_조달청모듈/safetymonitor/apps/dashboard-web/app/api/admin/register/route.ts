// 관리자 회원가입 — 신규 계정을 status=pending 으로 저장(승인제). 승인 전엔 로그인 불가.
// 가입 유형(VitAlGuard 관리자 / 회원사 관리자)은 role 이 아니라 org_type 으로 저장한다(앱 호환).
import { NextResponse } from "next/server";

import {
  checkPassword,
  checkUsername,
  isValidBirthDate,
  passwordMessage,
  usernameMessage,
} from "../../../../lib/account-policy";
import { isAllowedCompanyForOrgType } from "../../../../lib/companies";
import { createUser } from "../../../../lib/db";
import { DEFAULT_ORG_TYPE, isOrgType } from "../../../../lib/org-type";
import { hashPassword } from "../../../../lib/password";

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

  const { username, password, name, company, phone, carrier, email, birthDate, orgType } =
    body as {
      username?: unknown;
      password?: unknown;
      name?: unknown;
      company?: unknown;
      phone?: unknown;
      carrier?: unknown;
      email?: unknown;
      birthDate?: unknown;
      orgType?: unknown;
    };
  // 7개 항목 전부 필수 — 회사·아이디·비밀번호·이름·연락처·생년월일·이메일.
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    typeof name !== "string" ||
    typeof company !== "string" ||
    typeof phone !== "string" ||
    typeof email !== "string" ||
    typeof birthDate !== "string"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "모든 항목(회사·아이디·비밀번호·이름·연락처·생년월일·이메일)을 입력해주세요.",
      },
      { status: 400 },
    );
  }

  const uname = username.trim();
  const coName = company.trim();
  const personName = name.trim();
  const tel = phone.trim();
  const mail = email.trim();
  const birth = birthDate.trim();
  if (!coName || !personName || !tel || !mail || !birth) {
    return NextResponse.json(
      { ok: false, error: "모든 항목을 입력해주세요." },
      { status: 400 },
    );
  }
  // 가입 유형 — 미지정이면 회원사 관리자. 목록 밖 값은 거부(API 직접 호출 우회 차단).
  if (orgType !== undefined && !isOrgType(orgType)) {
    return NextResponse.json(
      { ok: false, error: "가입 유형이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  const kind = isOrgType(orgType) ? orgType : DEFAULT_ORG_TYPE;
  // B2B — 승인된 기업(상호)만, 그리고 그 가입 유형이 쓸 수 있는 상호만 허용.
  // 화면에서 선택지를 좁히는 것만으로는 이 요청을 직접 만들어 보내는 것을 못 막는다.
  if (!isAllowedCompanyForOrgType(coName, kind)) {
    return NextResponse.json(
      { ok: false, error: "가입 유형에 맞지 않는 회사(상호)입니다." },
      { status: 400 },
    );
  }
  const idVerdict = checkUsername(uname);
  if (idVerdict !== "ok") {
    return NextResponse.json(
      { ok: false, error: usernameMessage(idVerdict) },
      { status: 400 },
    );
  }
  if (!isValidBirthDate(birth)) {
    return NextResponse.json(
      { ok: false, error: "생년월일이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  // 비밀번호 — 길이 + 본인 생년월일·연락처 포함 금지(클라와 같은 함수).
  const pwVerdict = checkPassword(password, { birthDate: birth, phone: tel });
  if (pwVerdict !== "ok") {
    return NextResponse.json(
      { ok: false, error: passwordMessage(pwVerdict) },
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
  const carrierName = typeof carrier === "string" ? carrier.trim().slice(0, 20) : "";

  const passwordHash = await hashPassword(password);
  const user = await createUser({
    username: uname,
    name: personName.slice(0, 60),
    company: coName.slice(0, 100),
    phone: tel.slice(0, 20),
    carrier: carrierName || null,
    email: mail.slice(0, 120),
    emailVerified: false,
    passwordHash,
    birthDate: birth,
    orgType: kind,
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "이미 사용 중인 아이디입니다." },
      { status: 409 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      status: "pending",
      message: "가입 신청이 완료됐습니다. 관리자 승인 후 로그인할 수 있습니다.",
    },
    { status: 201 },
  );
}
