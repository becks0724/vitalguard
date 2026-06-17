// 조달청 공사 입찰공고 표준 목록 — G2B OpenAPI 프록시(인증키 서버 보관, 미설정 시 목업).
import { NextResponse } from "next/server";

import { getNotices } from "../../../lib/g2b";

export const dynamic = "force-dynamic"; // 캐시는 lib 내부 30분 TTL 로 관리(라우트 stale 방지).

const KINDS = new Set(["공사", "용역", "물품"]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const kindRaw = searchParams.get("kind") ?? "공사";
    const kind = KINDS.has(kindRaw) ? kindRaw : "공사";
    const regionRaw = searchParams.get("region") ?? undefined;
    const region = regionRaw && regionRaw.length <= 20 ? regionRaw : undefined; // 길이 제한(남용 방지)
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const rows = Math.min(100, Math.max(1, Number(searchParams.get("rows") ?? "20") || 20));

    const data = await getNotices({ kind, region, page, rows });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/g2b/notices]", err);
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "공고 목록 조회 실패" } },
      { status: 500 },
    );
  }
}
