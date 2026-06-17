// 사고사망 게시판 속보 — KOSHA OpenAPI 프록시(인증키 서버 보관, 미설정 시 목업).
import { NextResponse } from "next/server";

import { getFatalAccidents } from "../../../lib/kosha";

export async function GET() {
  const data = await getFatalAccidents();
  return NextResponse.json({ ok: true, ...data });
}
