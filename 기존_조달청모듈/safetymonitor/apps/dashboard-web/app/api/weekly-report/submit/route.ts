// 주간보고서 감독관 제출 — POST { contractId, period, verdict, suspectCount } → 제출 이력 DB 기록.
//   (데모: 실제 메일 발송 대신 제출 이력을 영속. 실서비스: 주1회 자동 메일 스케줄러)
import { NextResponse } from "next/server";

import { recordReportSubmission, listReportSubmissions } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      contractId?: string;
      period?: string;
      verdict?: string;
      suspectCount?: number;
    };
    if (!body.contractId) {
      return NextResponse.json({ error: { code: "BAD", message: "contractId가 필요합니다" } }, { status: 400 });
    }
    const submission = await recordReportSubmission({
      contractId: body.contractId,
      period: body.period,
      verdict: body.verdict,
      suspectCount: typeof body.suspectCount === "number" ? body.suspectCount : undefined,
    });
    return NextResponse.json({ ok: true, submission, history: await listReportSubmissions(body.contractId, 10) });
  } catch (err) {
    console.error("[api/weekly-report/submit]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "제출 실패" } }, { status: 500 });
  }
}
