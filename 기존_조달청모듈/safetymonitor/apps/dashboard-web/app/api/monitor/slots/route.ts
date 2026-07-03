// 작업자 모니터링 슬롯 조회/저장 API. 조회(GET)=로그인 세션, 저장(PUT=등록/해제)=관리자 권한(권한있음)만.
import { NextResponse } from "next/server";

import { verifyBasicAuth, hasAdminMenuAccess } from "../../../../lib/admin-auth";
import { getMonitorSlots, saveMonitorSlots } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const SLOT_COUNT = 100; // DemoDashboard 와 동일 — 초과분은 잘라 저장.

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const slots = await getMonitorSlots();
  return NextResponse.json({ ok: true, slots });
}

export async function PUT(request: Request) {
  // 등록/해제는 관리자 권한(owner 또는 admin_access=권한있음)만 — 권한없음 계정의 직접 호출도 서버에서 차단.
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "작업자 등록/해제는 관리자 권한이 필요합니다" },
      { status: 403 },
    );
  }
  let body: { slots?: unknown };
  try {
    body = (await request.json()) as { slots?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.slots)) {
    return NextResponse.json({ ok: false, error: "slots 배열 필요" }, { status: 400 });
  }
  // 정규화 — 문자열(workerId) 또는 null 만, 최대 SLOT_COUNT.
  const slots = (body.slots as unknown[])
    .slice(0, SLOT_COUNT)
    .map((v) => (typeof v === "string" ? v : null));
  await saveMonitorSlots(slots);
  return NextResponse.json({ ok: true });
}
