// 인근 병원 프록시 — 네이버 검색 키 서버 보관. 현장 지역(region)+GPS(lat/lon)로 진료과별 병원 검색.
import { NextResponse } from "next/server";

import { inKorea } from "../../lib/hospital";
import {
  searchNearbyHospitals,
  type HospitalScope,
} from "../../lib/naver-local";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const region = url.searchParams.get("region")?.trim() ?? "";
  const scope: HospitalScope =
    url.searchParams.get("scope") === "emergency" ? "emergency" : "full";

  const latRaw = Number(url.searchParams.get("lat"));
  const lonRaw = Number(url.searchParams.get("lon"));
  // 좌표는 거리 계산용 — 한국 범위일 때만 사용(아니면 좌표 없이 검색·거리 미표시).
  const hasCoord = inKorea(latRaw, lonRaw);

  const result = await searchNearbyHospitals({
    region,
    lat: hasCoord ? latRaw : NaN,
    lon: hasCoord ? lonRaw : NaN,
    scope,
  });

  return NextResponse.json({ ok: true, ...result });
}
