// 시공사 제출 입력 — 세금계산서·계좌·대장 수치(피검증자 제출). GET 조회 / POST 저장(병합 upsert).
import { NextResponse } from "next/server";

import { getReportInputs, upsertReportInputs } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contractId") ?? "";
  if (!contractId) {
    return NextResponse.json({ error: { code: "BAD", message: "contractId가 필요합니다" } }, { status: 400 });
  }
  return NextResponse.json({ inputs: getReportInputs(contractId) });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      contractId?: string;
      supplier?: string;
      supplierBno?: string;
      claimedHeadcount?: number;
      invoiceTotal?: number;
      paidTotal?: number;
      ledgerHeadcount?: number;
    };
    if (!body.contractId) {
      return NextResponse.json({ error: { code: "BAD", message: "contractId가 필요합니다" } }, { status: 400 });
    }
    upsertReportInputs(body.contractId, {
      supplier: body.supplier,
      supplierBno: body.supplierBno,
      claimedHeadcount: body.claimedHeadcount,
      invoiceTotal: body.invoiceTotal,
      paidTotal: body.paidTotal,
      ledgerHeadcount: body.ledgerHeadcount,
    });
    return NextResponse.json({ ok: true, inputs: getReportInputs(body.contractId) });
  } catch (err) {
    console.error("[api/weekly-report/inputs]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "제출 실패" } }, { status: 500 });
  }
}
