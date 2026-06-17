// 국세청 사업자등록 상태조회 — ②사용축(세금계산서 발급처 검증). POST { bno: string | string[] }.
import { NextResponse } from "next/server";

import { checkBusinessStatus } from "../../lib/nts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { bno?: unknown };
    const raw = body.bno;
    const bnos = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
    const payload = await checkBusinessStatus(bnos);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/nts]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "사업자 상태조회 실패" } }, { status: 500 });
  }
}
