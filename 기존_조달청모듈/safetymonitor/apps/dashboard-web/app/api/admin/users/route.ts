// 사용자 관리 — owner(env 관리자) 또는 관리 권한을 받은 VitAlGuard 관리자. GET 목록 조회, POST 승인/거절.
import { NextResponse } from "next/server";

import { getSession, verifyUserAdmin } from "../../../../lib/admin-auth";
import { hashPassword } from "../../../../lib/password";
import {
  createWorkerAccount,
  deleteUser,
  listUsers,
  setUserStatus,
  setUserAdminAccess,
  setUserProfileFields,
  type UserRow,
} from "../../../../lib/db";

// password_hash·google_sub(민감/불필요) 만 제외하고 DB 스키마 그대로 반환.
function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    company: u.company,
    phone: u.phone,
    carrier: u.carrier,
    email: u.email,
    email_verified: u.email_verified,
    auth_provider: u.auth_provider,
    role: u.role,
    org_type: u.org_type,
    status: u.status,
    birth_date: u.birth_date,
    department: u.department,
    job_title: u.job_title,
    admin_access: u.admin_access,
    created_at: u.created_at,
    approved_at: u.approved_at,
    approved_by: u.approved_by,
  };
}

export async function GET(request: Request) {
  if (!(await verifyUserAdmin(request))) {
    return NextResponse.json({ ok: false, error: "관리 권한이 필요합니다." }, { status: 401 });
  }
  const users = (await listUsers()).map(publicUser);
  return NextResponse.json({ ok: true, users });
}

export async function POST(request: Request) {
  const session = getSession(request);
  if (!session || !(await verifyUserAdmin(request))) {
    return NextResponse.json({ ok: false, error: "관리 권한이 필요합니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { id, action } = (body ?? {}) as { id?: unknown; action?: unknown };

  // 근로자 로그인 계정 생성 — id 없이(신규) username·이름·사번·비번으로. 앱 로그인용(role=worker·즉시 승인).
  if (action === "create_worker") {
    const { username, name, employeeId, password } = (body ?? {}) as {
      username?: unknown;
      name?: unknown;
      employeeId?: unknown;
      password?: unknown;
    };
    if (
      typeof username !== "string" ||
      username.trim().length < 3 ||
      typeof password !== "string" ||
      password.length < 6
    ) {
      return NextResponse.json(
        { ok: false, error: "아이디(3자 이상)와 비밀번호(6자 이상)가 필요합니다." },
        { status: 400 },
      );
    }
    const norm = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    const created = await createWorkerAccount({
      username: username.trim(),
      name: norm(name),
      employeeId: norm(employeeId),
      passwordHash: await hashPassword(password),
      approvedBy: session.username,
    });
    if (!created) {
      return NextResponse.json(
        { ok: false, error: "이미 존재하는 아이디입니다." },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, user: publicUser(created) });
  }

  const ACTIONS = ["approve", "reject", "delete", "grant_admin", "revoke_admin", "set_profile"];
  if (typeof id !== "number" || typeof action !== "string" || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { ok: false, error: "id(number) 와 action(approve|reject|delete|grant_admin|revoke_admin|set_profile) 이 필요합니다." },
      { status: 400 },
    );
  }

  // 회사(상호)/부서/직책 직접 수정 — 관리 권한자가 사용자 관리에서 편집. 빈 문자열은 null 로 정규화.
  if (action === "set_profile") {
    const { company, department, jobTitle } = (body ?? {}) as {
      company?: unknown;
      department?: unknown;
      jobTitle?: unknown;
    };
    const norm = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    const updated = await setUserProfileFields(id, norm(company), norm(department), norm(jobTitle));
    if (!updated) {
      return NextResponse.json({ ok: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user: publicUser(updated) });
  }

  // 관리자 메뉴 접근 권한 부여/회수 — owner 전용(자가취득 불가).
  if (action === "grant_admin" || action === "revoke_admin") {
    const updated = await setUserAdminAccess(id, action === "grant_admin");
    if (!updated) {
      return NextResponse.json({ ok: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user: publicUser(updated) });
  }

  // 탈퇴(하드 삭제) — owner 전용. 행 제거 후 성공 반환.
  if (action === "delete") {
    const removed = await deleteUser(id);
    if (!removed) {
      return NextResponse.json({ ok: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: id });
  }

  const updated = await setUserStatus(
    id,
    action === "approve" ? "approved" : "rejected",
    session.username,
  );
  if (!updated) {
    return NextResponse.json({ ok: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, user: publicUser(updated) });
}
