// 안전관리비 실집행 감사 — ?id=공고번호 [&from&to(ISO)]. ①계상(조달)×③실집행(워치 출역) 교차.
import { NextResponse } from "next/server";

import { getNoticeDetail } from "../../lib/g2b";
import { auditWorkerDays } from "../../../lib/db";
import { buildExecutionAudit } from "../../lib/safety-execution";
import { MAIN_SITE_ID, mockWorkerDayAudit } from "../../lib/site-workerdays-mock";

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

    // 현장별 격리 — 메인 관제 현장만 실 워치 출역(vital_samples), 그 외는 현장별 가상 출역.
    const isMainSite = id === MAIN_SITE_ID;
    const wd = isMainSite ? auditWorkerDays({ from, to }) : mockWorkerDayAudit(id);
    const audit = buildExecutionAudit(detail.notice, wd);
    if (!isMainSite && wd.totalWorkerDays > 0) {
      audit.note = `[가상 출역 데모] ${audit.note}`;
    }
    const execution: "live" | "simulated" | "none" =
      wd.totalWorkerDays === 0 ? "none" : isMainSite ? "live" : "simulated";

    return NextResponse.json({ source: detail.source, execution, notice: detail.notice, audit, period: { from, to } });
  } catch (err) {
    console.error("[api/safety-audit]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "안전관리비 실집행 감사 실패" } }, { status: 500 });
  }
}
