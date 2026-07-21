// VWorld 타일 프록시 — 지도 모드 지적도 베이스(base=WMTS Base)·연속지적도 오버레이(cadastral=WMS).
// <img> 태그 소비라 무인증(공개 지도 타일·비민감, 레이더 프록시와 동일 정책). 키·Referer 는 서버에서만 부착.
import { NextResponse } from "next/server";

import { baseTileUrl, cadastralTileUrl, fetchTile, vworldConfigured } from "../../lib/vworld";

export const dynamic = "force-dynamic";

const MIN_Z = 5;
const MAX_Z = 18;

export async function GET(request: Request) {
  if (!vworldConfigured()) {
    return NextResponse.json({ ok: false, error: "VWORLD_KEY 미설정" }, { status: 503 });
  }
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind");
  const z = Number(sp.get("z"));
  const x = Number(sp.get("x"));
  const y = Number(sp.get("y"));
  const n = 2 ** z;
  if (
    (kind !== "base" && kind !== "cadastral") ||
    !Number.isInteger(z) || z < MIN_Z || z > MAX_Z ||
    !Number.isInteger(x) || x < 0 || x >= n ||
    !Number.isInteger(y) || y < 0 || y >= n
  ) {
    return NextResponse.json({ ok: false, error: "invalid tile params" }, { status: 400 });
  }
  const tile = await fetchTile(kind === "base" ? baseTileUrl(z, y, x) : cadastralTileUrl(z, y, x));
  if (!tile) {
    return NextResponse.json({ ok: false, error: "upstream tile fail" }, { status: 502 });
  }
  return new NextResponse(tile.body, {
    headers: {
      "content-type": tile.contentType,
      // 지도 타일은 불변에 가까움 — 브라우저·CDN 1일 캐시로 VWorld 쿼터·프록시 부하 절감.
      "cache-control": "public, max-age=86400",
    },
  });
}
