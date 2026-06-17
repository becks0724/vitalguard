// AED 점검 기록 목록 — 대시보드가 폴링해 장비별 최근 교환/이력을 갱신. PII 아님(무인증).
import { NextResponse } from "next/server";

import { listAedInspections } from "../../../../lib/db";

export async function GET() {
  return NextResponse.json(
    { ok: true, inspections: listAedInspections(500) },
    { headers: { "cache-control": "no-store" } },
  );
}
