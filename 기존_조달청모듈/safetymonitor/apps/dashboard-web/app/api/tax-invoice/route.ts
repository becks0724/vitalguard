// 세금계산서 수신 엔드포인트 — 시공사 경리시스템(스마트경리 데모 /erp)이 매입 계산서를 쏘는 표준 계약.
// 실제 전자세금계산서 연동(홈택스수집 API·ASP)이 붙어도 같은 필드로 이 엔드포인트에 밀어넣으면 된다.
// 수집 정책 = gaspod/cctv 와 동일 soft 토큰 + DB 영속(tax_invoice) + 메모리 링버퍼 폴백(DATABASE_URL 없는 로컬 데모).
import { NextResponse } from "next/server";

import { clientIpFromRequest } from "../../../lib/client-ip";
import { consumeToken } from "../../../lib/rate-limit";
import { ingestAuthStatus } from "../../../lib/ingest-auth";
import { insertTaxInvoice, listTaxInvoices, type TaxInvoiceRow } from "../../../lib/db";

export const dynamic = "force-dynamic";

export type TaxInvoiceItem = { name: string; spec?: string; qty: number; unit: number; supply: number; tax: number };

const recent: TaxInvoiceRow[] = []; // DB 미설정/장애 폴백(최근 200건).
let warned = false;

export async function POST(request: Request) {
  // 빈도 제한 — 무토큰 수용(soft) 상태라 위조 주입 비용이 0 이다(감사 VER-013).
  if (!consumeToken(`taxinv:${clientIpFromRequest(request)}`, 60, 60_000)) {
    console.warn("[taxinv] 수집 빈도 제한 초과 — 요청 거부");
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  if (auth === "none" && !warned) {
    warned = true;
    console.warn("[tax-invoice] 무인증 수집 수용 중(soft)");
  }
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const items = Array.isArray(b.items) ? (b.items as TaxInvoiceItem[]) : [];
  if (!b.siteId || !b.approvalNo || !b.writeDate || !b.supplierName || items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "siteId/approvalNo/writeDate/supplierName/items[] 필수" },
      { status: 400 },
    );
  }
  const row: TaxInvoiceRow = {
    site_id: String(b.siteId).slice(0, 60),
    approval_no: String(b.approvalNo).slice(0, 40),
    write_date: String(b.writeDate).slice(0, 10),
    supplier_name: String(b.supplierName).slice(0, 80),
    supplier_bno: String(b.supplierBno ?? "").slice(0, 20),
    buyer_name: String(b.buyerName ?? "").slice(0, 80),
    buyer_bno: String(b.buyerBno ?? "").slice(0, 20),
    supply_amount: Number(b.supplyAmount) || items.reduce((s, i) => s + (Number(i.supply) || 0), 0),
    tax_amount: Number(b.taxAmount) || items.reduce((s, i) => s + (Number(i.tax) || 0), 0),
    items_json: JSON.stringify(items.slice(0, 99)), // 전자세금계산서 상세항목 상한(99행)
    received_at: new Date().toISOString(),
  };
  // 메모리 폴백 — 승인번호 멱등(재전송 시 교체).
  const dup = recent.findIndex((r) => r.approval_no === row.approval_no);
  if (dup >= 0) recent.splice(dup, 1);
  recent.unshift(row);
  if (recent.length > 200) recent.pop();
  try {
    await insertTaxInvoice(row);
  } catch (e) {
    console.error("[tax-invoice] DB 저장 실패(메모리 폴백 유지):", e);
  }
  return NextResponse.json({ ok: true, approvalNo: row.approval_no }, { status: 201 });
}

// 수신 계산서 조회 — ?siteId=현장ID (생략 시 전체 최근). ④증액 검증·ERP 전송상태 표시용.
export async function GET(request: Request) {
  const siteId = new URL(request.url).searchParams.get("siteId");
  try {
    const rows = await listTaxInvoices(siteId, 50);
    return NextResponse.json(
      { ok: true, rows, persisted: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    const rows = siteId ? recent.filter((r) => r.site_id === siteId) : recent;
    return NextResponse.json(
      { ok: true, rows: rows.slice(0, 50), persisted: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
