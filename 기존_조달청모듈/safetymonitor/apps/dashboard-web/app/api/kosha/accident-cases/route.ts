// 국내재해사례 게시판(callApiId 1060) — KOSHA OpenAPI 프록시(인증키 서버 보관, 미설정 시 목업).
import { NextResponse } from "next/server";

import { getAccidentCases } from "../../../lib/kosha";

export async function GET() {
  const data = await getAccidentCases();
  return NextResponse.json({ ok: true, ...data });
}
