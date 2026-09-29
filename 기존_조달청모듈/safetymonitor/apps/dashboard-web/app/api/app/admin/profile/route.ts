import { NextResponse } from "next/server";
import { requireAppAdmin } from "../../../../../lib/app-admin-auth";
import { appMemberProfile } from "../../../../../lib/app-member-profile";
import { findUserByUsername, getOwnerProfile } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

/** 본인 전용 읽기. 요청의 ID/username은 사용하지 않고 검증한 앱 토큰의 주체만 조회한다. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const gate = await requireAppAdmin(request, { readOnly: true });
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status, headers });
  const { username, role } = gate.principal;
  try {
    const user = await findUserByUsername(username, { readOnly: true });
    if (user) {
      if (user.status !== "approved" || (user.role !== "owner" && !user.admin_access))
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers });
      return NextResponse.json({ ok: true, profile: appMemberProfile(username, user.role, user) }, { headers });
    }
    if (role !== "owner") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403, headers });
    const profile = await getOwnerProfile(username, { readOnly: true });
    return NextResponse.json({ ok: true, profile: appMemberProfile(username, role, profile) }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "회원정보를 불러오지 못했습니다" }, { status: 503, headers });
  }
}
