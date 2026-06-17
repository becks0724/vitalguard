// 기상특보 프록시 — 현장 GPS(lat/lon) → 시·도 발효 특보. 인증키 서버 보관, 미설정 시 목업.
import { NextResponse } from "next/server";

import { warningsForLocation } from "../../lib/kma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: "lat/lon 필요" }, { status: 400 });
  }
  const data = await warningsForLocation(lat, lon);
  return NextResponse.json({ ok: true, ...data });
}
