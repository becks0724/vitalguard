// 작업자 모니터링 슬롯 등록(공유 관제 1벌) 조회/저장 API — 관리자 인증. 브라우저 localStorage 를 서버로 승격.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
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
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
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
