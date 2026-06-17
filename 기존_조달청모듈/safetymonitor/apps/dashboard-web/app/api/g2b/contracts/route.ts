// 조달청 공사 계약 목록(체결=진행 중 현장) — VitAlGuard 실집행 검증의 현장 소스.
import { NextResponse } from "next/server";

import { getContracts } from "../../../lib/g2b";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const region = url.searchParams.get("region") ?? undefined;
    const payload = await getContracts({ region });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/g2b/contracts]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "계약 조회 실패" } }, { status: 500 });
  }
}
