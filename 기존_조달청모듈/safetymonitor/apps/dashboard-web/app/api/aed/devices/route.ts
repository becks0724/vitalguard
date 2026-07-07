// AED(제세동기 알림) 실 연동 장비 등록 — 조회(GET)=로그인 세션, 등록/해제(PUT=register|remove)=관리자 권한(권한있음)만.
// 데모 프리셋(AED_DEVICES)과 별개: 여기 등록된 장비만 실 연동(RPi가 aed_id로 알림 레벨 폴링).
import { NextResponse } from "next/server";

import { getSession, hasAdminMenuAccess, verifyBasicAuth } from "../../../../lib/admin-auth";
import { findAedDevice } from "../../../../lib/aed-devices";
import { listRegisteredAedDevices, registerAedDevice, removeRegisteredAedDevice } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const devices = await listRegisteredAedDevices();
  return NextResponse.json({ ok: true, devices });
}

export async function PUT(request: Request) {
  // 등록/해제는 관리자 권한(owner 또는 admin_access=권한있음)만 — 권한없음 직접호출도 서버에서 차단.
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "AED 장비 등록/해제는 관리자 권한이 필요합니다" },
      { status: 403 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  const by = getSession(request)?.username ?? "";

  if (action === "remove") {
    const aedId = typeof body.aedId === "string" ? body.aedId.trim() : "";
    if (!aedId) return NextResponse.json({ ok: false, error: "aedId 필요" }, { status: 400 });
    const removed = await removeRegisteredAedDevice(aedId);
    return NextResponse.json({ ok: removed, aedId });
  }

  if (action === "register") {
    const dev = (body.device ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const numOf = (v: unknown) => (typeof v === "number" ? v : Number(v));
    const aedId = str(dev.aedId);
    const loc = str(dev.loc);
    const manager = str(dev.manager);
    if (!aedId || !loc || !manager) {
      return NextResponse.json(
        { ok: false, error: "장비 ID·설치위치·관리책임자는 필수입니다" },
        { status: 400 },
      );
    }
    // 데모 프리셋 ID와 충돌 방지 — 이중 표시·혼동 차단(실 장비는 프리셋과 다른 ID 사용, 예: AED-08).
    if (findAedDevice(aedId)) {
      return NextResponse.json(
        { ok: false, error: "데모 프리셋과 같은 장비 ID는 쓸 수 없습니다 (예: AED-08)" },
        { status: 409 },
      );
    }
    await registerAedDevice(
      {
        aedId,
        loc,
        manager,
        product: str(dev.product) || undefined,
        devBatt: numOf(dev.devBatt),
        battCycleMonths: numOf(dev.battCycleMonths),
        padCycleMonths: numOf(dev.padCycleMonths),
        lastSwapTs: str(dev.lastSwapTs) || null,
      },
      by,
    );
    return NextResponse.json({ ok: true, aedId });
  }

  return NextResponse.json({ ok: false, error: "action 은 register 또는 remove" }, { status: 400 });
}
