// 시공사 제출 입력 — 세금계산서·계좌·대장 수치(피검증자 제출). GET 조회 / POST 저장(병합 upsert).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { getReportInputs, upsertReportInputs } from "../../../../lib/db";

export const dynamic = "force-dynamic";

// 안전관리비 검증 수치(피검증자 제출분)는 4중 교차검증의 근거 — 무인증 읽기/덮어쓰기 시 검증 위조 가능.
// 로그인 세션 게이트로 공개 URL 익명 접근을 차단(로그인 대시보드는 Authorization 토큰 동봉).
export async function GET(req: Request) {
  if (!verifyBasicAuth(req, { allowContractor: true })) {
    return NextResponse.json({ error: { code: "UNAUTH", message: "인증이 필요합니다" } }, { status: 401 });
  }
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contractId") ?? "";
  if (!contractId) {
    return NextResponse.json({ error: { code: "BAD", message: "contractId가 필요합니다" } }, { status: 400 });
  }
  try {
    return NextResponse.json({ inputs: await getReportInputs(contractId) });
  } catch (err) {
    // DB 미설정/연결 실패 등 — 빈 입력으로 graceful 강등(폼은 빈 값으로 시작, 클라 파싱 에러 방지).
    console.error("[api/weekly-report/inputs GET]", err);
    return NextResponse.json({ inputs: null });
  }
}

export async function POST(req: Request) {
  if (!verifyBasicAuth(req, { allowContractor: true })) {
    return NextResponse.json({ error: { code: "UNAUTH", message: "인증이 필요합니다" } }, { status: 401 });
  }
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
    await upsertReportInputs(body.contractId, {
      supplier: body.supplier,
      supplierBno: body.supplierBno,
      claimedHeadcount: body.claimedHeadcount,
      invoiceTotal: body.invoiceTotal,
      paidTotal: body.paidTotal,
      ledgerHeadcount: body.ledgerHeadcount,
    });
    return NextResponse.json({ ok: true, inputs: await getReportInputs(body.contractId) });
  } catch (err) {
    console.error("[api/weekly-report/inputs]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "제출 실패" } }, { status: 500 });
  }
}
