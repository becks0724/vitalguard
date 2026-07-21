// GET /api/assignment?workerId=EMP-xxxx — 작업자 배치 권고(결정적, LLM 미사용).
// 세션 인증(관제 로그인) 필수 — 등급·사유는 준식별 정보라 무인증 노출 금지.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { assessWorker } from "../../../lib/assignment-service";
import { CONDITION_DISCLAIMER } from "../../../lib/worker-condition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const workerId = new URL(request.url).searchParams.get("workerId")?.trim() ?? "";
  if (!workerId) {
    return NextResponse.json({ ok: false, error: "workerId required" }, { status: 400 });
  }
  try {
    const assignment = await assessWorker(workerId);
    return NextResponse.json({ ok: true, assignment, disclaimer: CONDITION_DISCLAIMER });
  } catch (err) {
    console.error("[assignment] assess failed:", err);
    return NextResponse.json({ ok: false, error: "assessment_failed" }, { status: 500 });
  }
}
