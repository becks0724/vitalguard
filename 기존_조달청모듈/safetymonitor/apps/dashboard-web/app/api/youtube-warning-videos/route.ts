// 특보 관련 유튜브 영상 프록시 — API 키 서버 보관. type/kind → 안전 검색어 → 공식 채널 한정 검색.
import { NextResponse } from "next/server";

import { buildQuery, searchWarningVideos } from "../../lib/youtube";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type")?.trim();
  const kind = url.searchParams.get("kind") === "preliminary" ? "preliminary" : "warning";

  if (!type) {
    return NextResponse.json({ ok: false, error: "type 필요" }, { status: 400 });
  }

  const q = buildQuery(type, kind);
  const result = await searchWarningVideos(q);
  return NextResponse.json({ ok: true, ...result });
}
