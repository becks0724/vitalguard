// VWorld 타일 프록시 — 지도 모드 지적도 베이스(base=WMTS Base)·연속지적도 오버레이(cadastral=WMS).
// <img> 태그 소비라 무인증(공개 지도 타일·비민감, 레이더 프록시와 동일 정책). 키·Referer 는 서버에서만 부착.
//
// 인가 대신 빈도 제한만 두는 이유(감사 BE-AUTHZ-08) — 소비처가 WorkerGpsMap 의 <img src> 다.
// 브라우저 이미지 요청에는 Authorization 헤더를 실을 수 없고, 이 앱의 세션은 헤더 전용이라
// (쿠키 인증 경로 없음) 인가를 붙이면 지도가 통째로 깨진다. 실제 피해가 "유료 키 쿼터 소진"이므로
// 빈도 제한이 그 피해를 직접 막는다. 쿠키 세션을 도입하면 그때 인가로 승격한다.
import { NextResponse } from "next/server";

import { clientIpFromRequest } from "../../../lib/client-ip";
import { consumeToken } from "../../../lib/rate-limit";
import {
  baseTileUrl,
  cadastralTileUrl,
  fetchTile,
  hybridTileUrl,
  satelliteTileUrl,
  vworldConfigured,
} from "../../lib/vworld";

export const dynamic = "force-dynamic";

const MIN_Z = 5;
// 항공사진(satellite/hybrid)은 z19 까지 서빙 — base/cadastral 은 컴포넌트에서 z18 이하로만 요청.
const MAX_Z = 19;
const TILE_URL = {
  base: baseTileUrl,
  cadastral: cadastralTileUrl,
  satellite: satelliteTileUrl,
  hybrid: hybridTileUrl,
} as const;

export async function GET(request: Request) {
  // 한도 산정 — 감이 아니라 실제 타일 수로 잡는다(교훈 L-08 의 취지).
  //  · 타일 256px, 뷰포트 900×600 이면 5열×4행 ≈ 20장. 레이어 2장(위성+하이브리드 등) → 1화면 ≈ 40 요청.
  //  · 확대·이동마다 새 타일을 받는다(겹치는 타일은 브라우저 캐시). 적극적으로 조작하면 분당 300~500.
  //  · **키가 IP 당이라 사무실 공용 IP 뒤 관리자 여럿이 같은 버킷을 쓴다.** 3명이면 900~1500.
  // 그래서 600 은 정상 사용 중에도 걸린다(걸리면 <img> 가 깨져 지도에 빈칸이 뜬다).
  // 3000/분(50/초)이면 사람이 조작하는 범위는 확실히 덮으면서, 무제한 스크래핑은 여전히 막힌다.
  if (!consumeToken(`vworld:${clientIpFromRequest(request)}`, 3000, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  if (!vworldConfigured()) {
    return NextResponse.json({ ok: false, error: "VWORLD_KEY 미설정" }, { status: 503 });
  }
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("kind") ?? "";
  const z = Number(sp.get("z"));
  const x = Number(sp.get("x"));
  const y = Number(sp.get("y"));
  const n = 2 ** z;
  if (
    !(kind in TILE_URL) ||
    !Number.isInteger(z) || z < MIN_Z || z > MAX_Z ||
    !Number.isInteger(x) || x < 0 || x >= n ||
    !Number.isInteger(y) || y < 0 || y >= n
  ) {
    return NextResponse.json({ ok: false, error: "invalid tile params" }, { status: 400 });
  }
  const tile = await fetchTile(TILE_URL[kind as keyof typeof TILE_URL](z, y, x));
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
