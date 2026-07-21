// 현장 주소 지오코딩 API — 로그인 세션 전용(쿼터 남용 방지), VWorld 지오코더 프록시(키 서버 보관).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { geocodeAddress, vworldConfigured } from "../../lib/vworld";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "로그인 세션 필요" }, { status: 401 });
  }
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!vworldConfigured()) {
    return NextResponse.json({ ok: false, configured: false });
  }
  const result = await geocodeAddress(address);
  return NextResponse.json(
    result.ok
      ? { ok: true, configured: true, lat: result.lat, lon: result.lon, refined: result.refined }
      : { ok: false, configured: true },
  );
}
