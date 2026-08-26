// AED(제세동기 알림) 장비 설정 오버라이드 — 조회(GET)=로그인 세션, 수정(PUT=설치위치·관리책임자·비고)=관리자 권한(권한있음)만.
import { NextResponse } from "next/server";
import { readOr503 } from "../../../../lib/route-read";

import { getSession, hasAdminMenuAccess, verifyBasicAuth } from "../../../../lib/admin-auth";
import { findAedDevice } from "../../../../lib/aed-devices";
import { getAedConfigs, setAedConfig } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  return readOr503("aed/config", getAedConfigs, (configs) =>
    NextResponse.json({ ok: true, configs }),
  );
}

export async function PUT(request: Request) {
  // 설치위치·관리책임자·비고 수정은 관리자 권한(owner 또는 admin_access=권한있음)만 — 권한없음 직접호출도 서버 차단.
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "AED 설정 수정은 관리자 권한이 필요합니다" },
      { status: 403 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const aedId = typeof body.aedId === "string" ? body.aedId.trim() : "";
  if (!findAedDevice(aedId)) {
    return NextResponse.json({ ok: false, error: "알 수 없는 AED 장비" }, { status: 404 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const updatedBy = getSession(request)?.username ?? "";
  await setAedConfig(
    aedId,
    { loc: str(body.loc), manager: str(body.manager), product: str(body.product), note: str(body.note) },
    updatedBy,
  );
  return NextResponse.json({ ok: true, aedId });
}
