// 회원 본인 정보 — 로그인한 가입 회원(role=admin)이 자기 가입 정보를 조회/수정. 세션의 username 기준(클라가 보낸 id 신뢰 안 함).
import { NextResponse } from "next/server";

import { checkPassword, passwordMessage } from "../../../../lib/account-policy";
import { getSession } from "../../../../lib/admin-auth";
import { isAllowedCompanyForOrgType } from "../../../../lib/companies";
import { employeeIdTakenByOther, findUserByUsername, updateUserProfile } from "../../../../lib/db";
import { DEMO_ENABLED, getDemoProfile, updateDemoProfile } from "../../../../lib/demo-members";
import { DEFAULT_ORG_TYPE, canApproveUsers, isOrgType } from "../../../../lib/org-type";
import { hashPassword, verifyPassword } from "../../../../lib/password";

// 내 정보 조회 — 폼 프리필용(민감값 제외).
export async function GET(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  // env owner 는 DB 행이 없어 자가 수정 대상 아님 — 단 관리자메뉴 접근은 항상 허용(owner).
  if (session.role !== "admin") {
    return NextResponse.json({
      ok: true,
      editable: false,
      profile: null,
      role: session.role,
      adminAccess: true,
      canManageUsers: true, // env owner = 부트스트랩 승인자
    });
  }
  // 로컬 데모 회원 — DATABASE_URL 미설정 시 DB 대신 in-memory 프로필.
  if (DEMO_ENABLED) {
    const p = getDemoProfile(session.username);
    if (!p) {
      return NextResponse.json({ ok: true, editable: false, profile: null, role: "admin", adminAccess: false });
    }
    return NextResponse.json({ ok: true, editable: true, role: "admin", adminAccess: p.admin_access, profile: p });
  }
  const u = await findUserByUsername(session.username);
  if (!u) {
    return NextResponse.json({ ok: true, editable: false, profile: null, role: "admin", adminAccess: false });
  }
  return NextResponse.json({
    ok: true,
    editable: true,
    role: "admin",
    adminAccess: u.admin_access,
    // 사용자 관리 화면 노출 여부 — 서버 게이트(verifyUserAdmin)와 같은 판정을 그대로 내려준다.
    // 클라가 규칙을 다시 구현하면 둘이 어긋난다.
    canManageUsers: canApproveUsers(u),
    profile: {
      username: u.username,
      name: u.name,
      company: u.company,
      org_type: u.org_type,
      birth_date: u.birth_date,
      phone: u.phone,
      carrier: u.carrier,
      email: u.email,
      auth_provider: u.auth_provider,
      department: u.department,
      job_title: u.job_title,
      employee_id: u.employee_id,
      guardian_name: u.guardian_name,
      guardian_phone: u.guardian_phone,
      admin_access: u.admin_access,
    },
  });
}

// 내 정보 수정 — 이름·회사·연락처·통신사 + (선택)비밀번호 변경. 아이디·이메일·상태는 자가 수정 불가.
export async function POST(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "환경 관리자 계정은 자가 수정 대상이 아닙니다." },
      { status: 403 },
    );
  }

  // 로컬 데모 회원 — in-memory 프로필 수정(비밀번호 변경 미지원).
  if (DEMO_ENABLED) {
    const p = getDemoProfile(session.username);
    if (!p) {
      return NextResponse.json({ ok: false, error: "계정을 찾을 수 없습니다." }, { status: 404 });
    }
    let demoBody: unknown;
    try {
      demoBody = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
    }
    const d = (demoBody ?? {}) as {
      name?: unknown;
      company?: unknown;
      phone?: unknown;
      carrier?: unknown;
      department?: unknown;
      jobTitle?: unknown;
      employeeId?: unknown;
      guardianName?: unknown;
      guardianPhone?: unknown;
    };
    if (typeof d.name !== "string" || typeof d.company !== "string" || typeof d.phone !== "string") {
      return NextResponse.json({ ok: false, error: "입력 형식 오류" }, { status: 400 });
    }
    const nm = d.name.trim();
    const co = d.company.trim();
    const tel = d.phone.trim();
    const car = typeof d.carrier === "string" ? d.carrier.trim() : "";
    if (!nm) return NextResponse.json({ ok: false, error: "이름을 입력해주세요." }, { status: 400 });
    // 회사(상호)는 이 계정의 가입 유형이 쓸 수 있는 것만 — 유형은 자가 수정 대상이 아니라 저장된 값을 쓴다.
    if (!isAllowedCompanyForOrgType(co, isOrgType(p.org_type) ? p.org_type : DEFAULT_ORG_TYPE)) {
      return NextResponse.json(
        { ok: false, error: "가입 유형에 맞지 않는 회사(상호)입니다." },
        { status: 400 },
      );
    }
    if (!/^[0-9+\-\s]{7,20}$/.test(tel)) {
      return NextResponse.json({ ok: false, error: "연락처 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const gPhoneRaw = typeof d.guardianPhone === "string" ? d.guardianPhone.trim() : "";
    if (gPhoneRaw && !/^[0-9+\-\s]{7,20}$/.test(gPhoneRaw)) {
      return NextResponse.json({ ok: false, error: "보호자 전화번호 형식이 올바르지 않습니다." }, { status: 400 });
    }
    updateDemoProfile(session.username, {
      name: nm.slice(0, 60),
      company: co.slice(0, 100),
      phone: tel.slice(0, 20),
      carrier: car ? car.slice(0, 20) : null,
      department: typeof d.department === "string" && d.department.trim() ? d.department.trim().slice(0, 40) : null,
      job_title: typeof d.jobTitle === "string" && d.jobTitle.trim() ? d.jobTitle.trim().slice(0, 40) : null,
      employee_id: typeof d.employeeId === "string" && d.employeeId.trim() ? d.employeeId.trim().slice(0, 40) : null,
      guardian_name: typeof d.guardianName === "string" && d.guardianName.trim() ? d.guardianName.trim().slice(0, 40) : null,
      guardian_phone: gPhoneRaw ? gPhoneRaw.slice(0, 20) : null,
    });
    return NextResponse.json({ ok: true, message: "내 정보가 수정됐습니다." });
  }

  const u = await findUserByUsername(session.username);
  if (!u) {
    return NextResponse.json({ ok: false, error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { name, company, phone, carrier, department, jobTitle, employeeId, guardianName, guardianPhone, currentPassword, newPassword } =
    (body ?? {}) as {
      name?: unknown;
      company?: unknown;
      phone?: unknown;
      carrier?: unknown;
      department?: unknown;
      jobTitle?: unknown;
      employeeId?: unknown;
      guardianName?: unknown;
      guardianPhone?: unknown;
      currentPassword?: unknown;
      newPassword?: unknown;
    };

  if (
    typeof name !== "string" ||
    typeof company !== "string" ||
    typeof phone !== "string"
  ) {
    return NextResponse.json({ ok: false, error: "입력 형식 오류" }, { status: 400 });
  }
  const personName = name.trim();
  const coName = company.trim();
  const tel = phone.trim();
  const carrierName = typeof carrier === "string" ? carrier.trim() : "";

  if (!personName) {
    return NextResponse.json({ ok: false, error: "이름을 입력해주세요." }, { status: 400 });
  }
  // 회사(상호)는 이 계정의 가입 유형이 쓸 수 있는 것만 — 유형은 자가 수정 대상이 아니라 DB 값을 그대로 쓴다.
  // 가입 때만 막으면 가입 후 프로필에서 바꿔 우회할 수 있다.
  if (!isAllowedCompanyForOrgType(coName, isOrgType(u.org_type) ? u.org_type : DEFAULT_ORG_TYPE)) {
    return NextResponse.json(
      { ok: false, error: "가입 유형에 맞지 않는 회사(상호)입니다." },
      { status: 400 },
    );
  }
  if (!/^[0-9+\-\s]{7,20}$/.test(tel)) {
    return NextResponse.json(
      { ok: false, error: "연락처 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  // 보호자(선택) — 전화번호가 있으면 연락처와 동일 형식 검증. 이름/전화 모두 미입력 허용.
  const gName = typeof guardianName === "string" ? guardianName.trim() : "";
  const gPhone = typeof guardianPhone === "string" ? guardianPhone.trim() : "";
  if (gPhone && !/^[0-9+\-\s]{7,20}$/.test(gPhone)) {
    return NextResponse.json(
      { ok: false, error: "보호자 전화번호 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  // 비밀번호 변경(선택) — 비번 로그인 계정만, 현재 비번 확인 후 변경.
  let passwordHash: string | undefined;
  if (typeof newPassword === "string" && newPassword.length > 0) {
    if (u.auth_provider !== "password" || !u.password_hash) {
      return NextResponse.json(
        { ok: false, error: "비밀번호 로그인 계정만 비밀번호를 변경할 수 있습니다." },
        { status: 400 },
      );
    }
    if (typeof currentPassword !== "string" || !currentPassword) {
      return NextResponse.json(
        { ok: false, error: "현재 비밀번호를 입력해주세요." },
        { status: 400 },
      );
    }
    const ok = await verifyPassword(currentPassword, u.password_hash);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "현재 비밀번호가 일치하지 않습니다." },
        { status: 400 },
      );
    }
    // 가입과 같은 정책 — 길이 + 본인 생년월일·연락처 포함 금지(값은 DB 의 본인 행에서 읽는다).
    const pwVerdict = checkPassword(newPassword, {
      birthDate: u.birth_date,
      phone: u.phone,
    });
    if (pwVerdict !== "ok") {
      return NextResponse.json(
        { ok: false, error: passwordMessage(pwVerdict) },
        { status: 400 },
      );
    }
    passwordHash = await hashPassword(newPassword);
  }

  const dept = typeof department === "string" ? department.trim() : "";
  const title = typeof jobTitle === "string" ? jobTitle.trim() : "";
  const empId = typeof employeeId === "string" ? employeeId.trim() : "";
  // 귀속 위조 방지 — 사번을 다른 계정이 쓰는 값으로 바꾸면 생체·미디어·낙상 기록이 그 사람에게 귀속된다.
  if (empId && (await employeeIdTakenByOther(empId, session.username))) {
    return NextResponse.json(
      { ok: false, error: "이미 다른 계정에서 사용 중인 사번입니다." },
      { status: 409 },
    );
  }
  const updated = await updateUserProfile(session.username, {
    name: personName.slice(0, 60),
    company: coName.slice(0, 100),
    phone: tel.slice(0, 20),
    carrier: carrierName ? carrierName.slice(0, 20) : null,
    department: dept ? dept.slice(0, 40) : null,
    jobTitle: title ? title.slice(0, 40) : null,
    employeeId: empId ? empId.slice(0, 40) : null,
    guardianName: gName ? gName.slice(0, 40) : null,
    guardianPhone: gPhone ? gPhone.slice(0, 20) : null,
    passwordHash,
  });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "수정에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: "내 정보가 수정됐습니다." });
}
