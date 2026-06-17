// 주간 검증 보고서 — 서버 종합. GET ?contractId= (없으면 진행 중 현장 첫 건).
import { NextResponse } from "next/server";

import { getContracts } from "../../lib/g2b";
import { buildWeeklyReport } from "../../lib/weekly-report";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    let contractId = url.searchParams.get("contractId") ?? undefined;
    if (!contractId) {
      const list = await getContracts({ rows: 1 });
      contractId = list.items[0]?.id;
    }
    if (!contractId) {
      return NextResponse.json({ error: { code: "NO_CONTRACT", message: "진행 중 현장이 없습니다" } }, { status: 404 });
    }
    const report = await buildWeeklyReport(contractId);
    if (!report) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "현장을 찾을 수 없습니다" } }, { status: 404 });
    }
    return NextResponse.json(report);
  } catch (err) {
    console.error("[api/weekly-report]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "보고서 생성 실패" } }, { status: 500 });
  }
}
