// 주간 검증 보고서 — 서버 종합. GET ?contractId= (없으면 진행 중 현장 첫 건).
import { NextResponse } from "next/server";

import { getSession, verifyAreaAccess } from "../../../lib/admin-auth";
import { getContracts } from "../../lib/g2b";
import { buildWeeklyReport } from "../../lib/weekly-report";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 안전관리비 영역 — 공단 관리자는 거부(2026-08-28 소속별 화면 분리).
  // ⚠ 현장 관리자(contractor)는 이 보고서를 본다 — 제출 화면(/contractor)에 주간 보고서 링크가
  //   이미 있어서 막으면 그 동선이 끊긴다. canViewArea 가 contractor 를 안전관리비 영역 밖에 두므로
  //   allowContractor 대신 여기서 명시적으로 통과시킨다.
  const contractorOk = getSession(req)?.orgType === "contractor";
  if (!contractorOk && !(await verifyAreaAccess(req, "safetyCost"))) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "안전관리비 검증 열람 권한이 없습니다" } },
      { status: 403 },
    );
  }
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
