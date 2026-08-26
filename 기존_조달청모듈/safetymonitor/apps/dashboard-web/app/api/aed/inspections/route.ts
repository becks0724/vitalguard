// AED 점검 기록 목록 — 대시보드가 폴링해 장비별 최근 교환/이력을 갱신. 점검자 이름·위치 포함이라 세션 게이트.
import { NextResponse } from "next/server";
import { readOr503 } from "../../../../lib/route-read";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { listAedInspections } from "../../../../lib/db";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return readOr503("aed/inspections", () => listAedInspections(500), (inspections) =>
    NextResponse.json({ ok: true, inspections }, { headers: { "cache-control": "no-store" } }),
  );
}
