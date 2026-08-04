// 회원 본인 정보 — 로그인한 계정이 자기 정보를 조회/수정. 세션의 username 기준(클라가 보낸 id 신뢰 안 함).
// 대상 3종 — env 관리자(owner, users 행 없음 → owner_profile) · 로컬 데모 회원 · DB 가입 회원(role=admin).
import { NextResponse } from "next/server";

import { checkPassword, passwordMessage } from "../../../../lib/account-policy";
import { getSession } from "../../../../lib/admin-auth";
import { isAllowedCompanyForOrgType } from "../../../../lib/companies";
import {
  employeeIdTakenByOther,
  findUserByUsername,
  getOwnerProfile,
  updateUserProfile,
  upsertOwnerProfile,
  type OwnerProfileRow,
  type OwnerProfilePatch,
} from "../../../../lib/db";
import {
  DEMO_ENABLED,
  getDemoOwnerProfile,
  getDemoProfile,
  setDemoOwnerProfile,
  updateDemoProfile,
  type DemoOwnerProfile,
} from "../../../../lib/demo-members";
import { DEFAULT_ORG_TYPE, canApproveUsers, isOrgType, type OrgType } from "../../../../lib/org-type";
import { hashPassword, verifyPassword } from "../../../../lib/password";

// env 관리자의 가입 유형 — 이 계정은 서비스 운영 주체(VitAlGuard)라 회사(상호) 선택지도 자사로 고정한다.
// 회원가입을 거치지 않아 org_type 이 DB 에 없으므로 여기서 정한다.
const OWNER_ORG_TYPE: OrgType = "vitalguard";

// env 관리자 프로필 → 회원 프로필과 같은 모양. 이메일·생년월일·비밀번호는 env 계정에 없는 값이라 null.
// (auth_provider "env" 로 구분한다 — 화면이 비밀번호 변경란을 그리지 않게 하는 표식.)
function ownerProfileView(username: string, p: OwnerProfileRow | DemoOwnerProfile | null) {
  return {
    username,
    name: p?.name ?? null,
    company: p?.company ?? null,
    org_type: OWNER_ORG_TYPE,
    birth_date: null,
    phone: p?.phone ?? null,
    carrier: p?.carrier ?? null,
    email: null,
    auth_provider: "env",
    department: p?.department ?? null,
    job_title: p?.job_title ?? null,
    employee_id: p?.employee_id ?? null,
    guardian_name: p?.guardian_name ?? null,
    guardian_phone: p?.guardian_phone ?? null,
    admin_access: true,
  };
}

// 공통 입력 검증 — env 관리자·데모 회원·DB 회원 세 경로가 같은 규칙을 쓰게 한 곳에 둔다.
// 경로마다 복사하면 한쪽만 느슨해진다(회사 유형 게이트가 특히 그렇다).
// ★ 이 파일 안에 둔다 — lib 으로 빼면 companies.test 의 "라우트가 유형 게이트를 쓴다" 가드가 못 본다.
function normalizeProfile(
  body: unknown,
  orgType: OrgType,
): { error: string; status: number } | { value: OwnerProfilePatch } {
  const d = (body ?? {}) as {
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
    return { error: "입력 형식 오류", status: 400 };
  }
  const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const cut = (v: string, n: number) => (v ? v.slice(0, n) : null);

  const name = d.name.trim();
  if (!name) return { error: "이름을 입력해주세요.", status: 400 };
  // 회사(상호)는 이 계정의 가입 유형이 쓸 수 있는 것만 — 유형은 자가 수정 대상이 아니라 저장된 값을 쓴다.
  // 가입 때만 막으면 가입 후 프로필에서 바꿔 우회할 수 있다.
  const company = d.company.trim();
  if (!isAllowedCompanyForOrgType(company, orgType)) {
    return { error: "가입 유형에 맞지 않는 회사(상호)입니다.", status: 400 };
  }
  const phone = d.phone.trim();
  if (!/^[0-9+\-\s]{7,20}$/.test(phone)) {
    return { error: "연락처 형식이 올바르지 않습니다.", status: 400 };
  }
  // 보호자(선택) — 전화번호가 있으면 연락처와 동일 형식 검증. 이름/전화 모두 미입력 허용.
  const guardianPhone = trim(d.guardianPhone);
  if (guardianPhone && !/^[0-9+\-\s]{7,20}$/.test(guardianPhone)) {
    return { error: "보호자 전화번호 형식이 올바르지 않습니다.", status: 400 };
  }
  return {
    value: {
      name: name.slice(0, 60),
      company: company.slice(0, 100),
      phone: phone.slice(0, 20),
      carrier: cut(trim(d.carrier), 20),
      department: cut(trim(d.department), 40),
      job_title: cut(trim(d.jobTitle), 40),
      employee_id: cut(trim(d.employeeId), 40),
      guardian_name: cut(trim(d.guardianName), 40),
      guardian_phone: cut(guardianPhone, 20),
    },
  };
}

// 내 정보 조회 — 폼 프리필용(민감값 제외).
export async function GET(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  }
  // env owner — users 행이 없어 프로필을 owner_profile(실서버)/메모리(데모)에 따로 담는다.
  // 관리자 메뉴·사용자 관리 권한은 자격 자체에서 나오므로 항상 허용.
  if (session.role !== "admin") {
    const p = DEMO_ENABLED
      ? getDemoOwnerProfile(session.username)
      : await getOwnerProfile(session.username);
    return NextResponse.json({
      ok: true,
      editable: true,
      role: session.role,
      adminAccess: true,
      canManageUsers: true, // env owner = 부트스트랩 승인자
      profile: ownerProfileView(session.username, p),
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // ── env 관리자(owner) ─────────────────────────────────────────────────────
  if (session.role !== "admin") {
    // 비밀번호만 예외 — 자격이 배포 환경변수(ADMIN_PASSWORD)라 앱에서 바꿀 수 없다.
    // 조용히 무시하면 "바꿨다고 생각했는데 옛 비번이 그대로"가 되므로 사유를 돌려준다.
    const newPw = (body as { newPassword?: unknown })?.newPassword;
    if (typeof newPw === "string" && newPw.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "환경 관리자 계정의 비밀번호는 서버 환경변수(ADMIN_PASSWORD)에서만 변경할 수 있습니다.",
        },
        { status: 400 },
      );
    }
    const parsed = normalizeProfile(body, OWNER_ORG_TYPE);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
    }
    if (DEMO_ENABLED) {
      setDemoOwnerProfile(session.username, parsed.value);
      return NextResponse.json({ ok: true, message: "내 정보가 수정됐습니다." });
    }
    // 귀속 위조 방지 — 회원이 쓰는 사번을 가져다 쓰면 그 사람의 생체·알람이 이 계정으로 묶인다.
    if (
      parsed.value.employee_id &&
      (await employeeIdTakenByOther(parsed.value.employee_id, session.username))
    ) {
      return NextResponse.json(
        { ok: false, error: "이미 다른 계정에서 사용 중인 사번입니다." },
        { status: 409 },
      );
    }
    const saved = await upsertOwnerProfile(session.username, parsed.value);
    if (!saved) {
      return NextResponse.json({ ok: false, error: "수정에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, message: "내 정보가 수정됐습니다." });
  }

  // ── 로컬 데모 회원 — in-memory 프로필 수정(비밀번호 변경 미지원) ──────────
  if (DEMO_ENABLED) {
    const p = getDemoProfile(session.username);
    if (!p) {
      return NextResponse.json({ ok: false, error: "계정을 찾을 수 없습니다." }, { status: 404 });
    }
    const parsed = normalizeProfile(body, isOrgType(p.org_type) ? p.org_type : DEFAULT_ORG_TYPE);
    if ("error" in parsed) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
    }
    updateDemoProfile(session.username, parsed.value);
    return NextResponse.json({ ok: true, message: "내 정보가 수정됐습니다." });
  }

  // ── DB 가입 회원 ─────────────────────────────────────────────────────────
  const u = await findUserByUsername(session.username);
  if (!u) {
    return NextResponse.json({ ok: false, error: "계정을 찾을 수 없습니다." }, { status: 404 });
  }

  const parsed = normalizeProfile(body, isOrgType(u.org_type) ? u.org_type : DEFAULT_ORG_TYPE);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: parsed.status });
  }
  const { currentPassword, newPassword } = (body ?? {}) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };

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

  // 귀속 위조 방지 — 사번을 다른 계정이 쓰는 값으로 바꾸면 생체·미디어·낙상 기록이 그 사람에게 귀속된다.
  if (
    parsed.value.employee_id &&
    (await employeeIdTakenByOther(parsed.value.employee_id, session.username))
  ) {
    return NextResponse.json(
      { ok: false, error: "이미 다른 계정에서 사용 중인 사번입니다." },
      { status: 409 },
    );
  }
  const updated = await updateUserProfile(session.username, {
    name: parsed.value.name,
    company: parsed.value.company,
    phone: parsed.value.phone,
    carrier: parsed.value.carrier,
    department: parsed.value.department,
    jobTitle: parsed.value.job_title,
    employeeId: parsed.value.employee_id,
    guardianName: parsed.value.guardian_name,
    guardianPhone: parsed.value.guardian_phone,
    passwordHash,
  });
  if (!updated) {
    return NextResponse.json({ ok: false, error: "수정에 실패했습니다." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: "내 정보가 수정됐습니다." });
}
