// 사용자 관리 — owner(env 관리자) 또는 관리 권한을 받은 VitAlGuard 관리자. GET 목록 조회, POST 승인/거절.
import { NextResponse } from "next/server";

import { getSession, verifyUserAdmin } from "../../../../lib/admin-auth";
import {
  deleteUser,
  listUsers,
  setUserStatus,
  setUserAdminAccess,
  setUserProfileFields,
  setUserSiteOfficer,
  setUserOrgType,
  type UserRow,
} from "../../../../lib/db";
import { isOrgType } from "../../../../lib/org-type";

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
    site_officer: u.site_officer,
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

  const ACTIONS = ["approve", "reject", "delete", "grant_admin", "revoke_admin", "grant_officer", "revoke_officer", "set_profile", "set_org_type"];
  if (typeof id !== "number" || typeof action !== "string" || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { ok: false, error: "id(number) 와 action(approve|reject|delete|grant_admin|revoke_admin|grant_officer|revoke_officer|set_profile|set_org_type) 이 필요합니다." },
      { status: 400 },
    );
  }

  // 가입 유형 변경 — 'test'(양쪽 검증 화면 열람)를 부여하는 유일한 경로다(가입 폼에는 없다).
  // ⚠ 여기서는 isOrgType 이 맞다 — 가입 경로가 아니라 관리 경로이고, test 를 주는 것이 이 액션의 목적이다.
  //   대신 verifyUserAdmin 이 이미 위에서 관리 권한자만 통과시킨다(자가취득 불가).
  // ⚠ 유형을 내리면 담당관 자격을 잃을 수 있다 — setUserOrgType 이 같은 UPDATE 에서 정리한다.
  if (action === "set_org_type") {
    const { orgType } = (body ?? {}) as { orgType?: unknown };
    if (!isOrgType(orgType)) {
      return NextResponse.json({ ok: false, error: "orgType 이 올바르지 않습니다." }, { status: 400 });
    }
    const updated = await setUserOrgType(id, orgType);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user: publicUser(updated) });
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

  // 현장 담당관(안전관리비 확정 권한) 부여/회수 — admin_access 와 같은 관리 경로(자가취득 불가).
  // ⚠ 안전관리비 영역 밖 유형에는 부여 불가 — 현장 관리자(피검증자가 확정하면 검증이 성립하지 않는다)와
  //   산업안전공단 관리자(안전관리비는 조달청 업무 · 2026-08-28)가 여기 걸린다.
  //   DB 함수(setUserSiteOfficer)도 같은 조건을 걸어, 자격 없는 유형이면 0행이 돌아와 404 로 떨어진다.
  if (action === "grant_officer" || action === "revoke_officer") {
    const updated = await setUserSiteOfficer(id, action === "grant_officer");
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "사용자를 찾을 수 없거나 이 가입 유형에는 부여할 수 없습니다." },
        { status: 404 },
      );
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
