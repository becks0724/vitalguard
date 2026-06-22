// 사용자 관리 — owner(env 관리자) 전용. GET 목록 조회, POST 승인/거절(가입 신청 처리).
import { NextResponse } from "next/server";

import { getSession, verifyOwner } from "../../../../lib/admin-auth";
import { listUsers, setUserStatus, type UserRow } from "../../../../lib/db";

// password_hash 는 응답에서 제외.
function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    company: u.company,
    phone: u.phone,
    email: u.email,
    role: u.role,
    status: u.status,
    created_at: u.created_at,
    approved_at: u.approved_at,
    approved_by: u.approved_by,
  };
}

export async function GET(request: Request) {
  if (!verifyOwner(request)) {
    return NextResponse.json({ ok: false, error: "owner 권한이 필요합니다." }, { status: 401 });
  }
  const users = (await listUsers()).map(publicUser);
  return NextResponse.json({ ok: true, users });
}

export async function POST(request: Request) {
  const session = getSession(request);
  if (session?.role !== "owner") {
    return NextResponse.json({ ok: false, error: "owner 권한이 필요합니다." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { id, action } = (body ?? {}) as { id?: unknown; action?: unknown };
  if (typeof id !== "number" || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { ok: false, error: "id(number) 와 action(approve|reject) 이 필요합니다." },
      { status: 400 },
    );
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
