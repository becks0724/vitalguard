// SOS/낙상 알림 이력 조회 — 로그인 세션 토큰 필수(작업자명 포함).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { listAlerts } from "../../../lib/db";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { ok: true, alerts: await listAlerts(100) },
    { headers: { "cache-control": "no-store" } },
  );
}
