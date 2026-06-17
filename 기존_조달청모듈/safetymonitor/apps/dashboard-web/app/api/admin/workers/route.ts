// 관리자 — DB 에 누적된 워커 목록 (드롭다운 채움용)
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { listAllWorkers, totalPersisted } from "../../../../lib/db";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    total: totalPersisted(),
    workers: listAllWorkers(),
  });
}
