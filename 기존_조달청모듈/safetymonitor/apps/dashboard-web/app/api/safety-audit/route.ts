// 안전관리비 실집행 감사 — ?id=공고번호 [&from&to(ISO)]. ①계상(조달)×③실집행(워치 출역) 교차.
import { NextResponse } from "next/server";

import { getNoticeDetail } from "../../lib/g2b";
import { auditWorkerDays } from "../../../lib/db";
import { buildExecutionAudit } from "../../lib/safety-execution";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: { code: "BAD_ID", message: "공고 id 가 필요합니다" } }, { status: 400 });
    }

    // 출역 집계 기간 — 기본 최근 90일.
    const now = new Date();
    const from = url.searchParams.get("from") ?? new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const to = url.searchParams.get("to") ?? now.toISOString();

    const detail = await getNoticeDetail(id);
    if (!detail.notice) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "공고를 찾을 수 없습니다" } }, { status: 404 });
    }

    const wd = auditWorkerDays({ from, to });
    const audit = buildExecutionAudit(detail.notice, wd);

    return NextResponse.json({ source: detail.source, notice: detail.notice, audit, period: { from, to } });
  } catch (err) {
    console.error("[api/safety-audit]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "안전관리비 실집행 감사 실패" } }, { status: 500 });
  }
}
