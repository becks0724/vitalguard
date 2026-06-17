// 건설현장 안전 신호등 — KOSHA OpenAPI 프록시(인증키 서버 보관, 미설정 시 목업).
import { NextResponse } from "next/server";

import { getSafetyLight } from "../../../lib/kosha";

export async function GET() {
  const data = await getSafetyLight();
  return NextResponse.json({ ok: true, ...data });
}
