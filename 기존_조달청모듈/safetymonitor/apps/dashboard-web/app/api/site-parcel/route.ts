// 현장 필지 경계 폴리곤 조회 — 로그인 세션 필수, VWorld 연속지적도 GetFeature(서버 키·6h 캐시).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { fetchParcelPolygon, vworldConfigured } from "../../lib/vworld";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!vworldConfigured()) {
    return NextResponse.json({ ok: true, configured: false, found: false });
  }

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  // 한국 범위 게이트 — 지도·fieldCoords 와 동일 기준.
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < 32.5 ||
    lat > 39.5 ||
    lon < 123.5 ||
    lon > 132.5
  ) {
    return NextResponse.json({ ok: false, error: "invalid coord" }, { status: 400 });
  }

  const parcel = await fetchParcelPolygon(lat, lon);
  if (!parcel.ok) {
    return NextResponse.json({ ok: true, configured: true, found: false });
  }
  return NextResponse.json(
    { ok: true, configured: true, found: true, ring: parcel.ring, addr: parcel.addr },
    { headers: { "cache-control": "no-store" } },
  );
}
