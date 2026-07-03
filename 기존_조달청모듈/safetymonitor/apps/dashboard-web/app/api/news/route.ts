// 산업 안전뉴스 프록시 — 네이버 뉴스검색 키 서버 보관. 산업현장·산업재해·산업안전 법규 실시간 기사.
import { NextResponse } from "next/server";

import { searchSafetyNews } from "../../lib/naver-news";

export async function GET() {
  const result = await searchSafetyNews();
  return NextResponse.json({ ok: true, ...result });
}
