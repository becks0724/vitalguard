// 안전관리비 요율 고시 상태 — 적용 중 버전 + 법제처 최신 발령 비교(개정 드리프트 감지).
import { NextResponse } from "next/server";

import { getRateNoticeStatus } from "../../../lib/moleg";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getRateNoticeStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error("[api/safety-rate/notice]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "고시 상태 조회 실패" } }, { status: 500 });
  }
}
