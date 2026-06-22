// 관리자 — 낙상 ML 후보 목록 + 수집 통계 (라벨링 UI 채움용)
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { fallCollectionStats, listFallCandidates } from "../../../../lib/db";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;

  return NextResponse.json({
    ok: true,
    stats: await fallCollectionStats(),
    candidates: await listFallCandidates(limit),
  });
}
