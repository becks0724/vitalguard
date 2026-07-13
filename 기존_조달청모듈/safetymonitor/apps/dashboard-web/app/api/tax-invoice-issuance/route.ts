// 전자세금계산서 발급사실 확인 — ②사용축(홈택스 제3자 조회 5요소). POST { supplierBno, buyerBno, approvalNo, writeDate, supplyAmount }.
import { NextResponse } from "next/server";

import { checkTaxInvoiceIssuance, type TwoWayInfo } from "../../lib/tax-invoice-issuance";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const digits = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "");
    const q = {
      supplierBno: digits(body.supplierBno),
      buyerBno: digits(body.buyerBno),
      approvalNo: digits(body.approvalNo),
      writeDate: digits(body.writeDate),
      supplyAmount: digits(body.supplyAmount),
    };
    if (q.supplierBno.length !== 10 || q.buyerBno.length !== 10)
      return NextResponse.json({ error: { code: "BAD_BNO", message: "사업자번호는 10자리입니다" } }, { status: 400 });
    if (q.approvalNo.length !== 24)
      return NextResponse.json({ error: { code: "BAD_APPROVAL", message: "승인번호는 24자리입니다" } }, { status: 400 });
    if (q.writeDate.length !== 8)
      return NextResponse.json({ error: { code: "BAD_DATE", message: "작성일자는 YYYYMMDD 8자리입니다" } }, { status: 400 });
    if (q.supplyAmount.length === 0)
      return NextResponse.json({ error: { code: "BAD_AMOUNT", message: "공급가액을 입력하세요" } }, { status: 400 });

    // 간편인증 승인 후 재요청(is2Way) — 1차 응답의 pendingAuth 를 그대로 되돌려 받는다.
    const t = body.twoWay as Record<string, unknown> | undefined;
    const twoWay: TwoWayInfo | undefined =
      t && typeof t.jti === "string"
        ? {
            jobIndex: Number(t.jobIndex ?? 0),
            threadIndex: Number(t.threadIndex ?? 0),
            jti: t.jti,
            twoWayTimestamp: Number(t.twoWayTimestamp ?? 0),
          }
        : undefined;
    const payload = await checkTaxInvoiceIssuance(q, twoWay);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/tax-invoice-issuance]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "발급사실 조회 실패" } }, { status: 500 });
  }
}
