// 현장 좌표 일별 캐시 — 작업자 GPS 평균(현장 좌표)을 하루 1행 저장/조회. 연결 끊겨도 이 좌표로 기상 유지.
import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/admin-auth";
import { captureSiteCoordDaily, getLatestSiteCoord } from "../../../../lib/db";

export async function GET(request: Request) {
  if (!getSession(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const coord = await getLatestSiteCoord();
  return NextResponse.json({ ok: true, coord });
}

export async function POST(request: Request) {
  if (!getSession(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const raw = body as {
    lat?: unknown;
    lon?: unknown;
    workerCount?: unknown;
    manual?: unknown;
  };
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  // 한국 범위 게이트 — fieldCoords 와 동일(비-한국·NaN 좌표 캐시 오염 차단).
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < 32.5 ||
    lat > 39.5 ||
    lon < 123.5 ||
    lon > 132.5
  ) {
    return NextResponse.json(
      { ok: false, error: "유효한 한국 범위 좌표 필요" },
      { status: 400 },
    );
  }
  const workerCountNum = Number(raw.workerCount);
  const coord = await captureSiteCoordDaily({
    lat,
    lon,
    workerCount: Number.isFinite(workerCountNum) ? workerCountNum : undefined,
    force: raw.manual === true, // 수동 새로고침이면 그날 좌표 재캡처, 자동이면 하루 최초만
  });
  return NextResponse.json({ ok: true, coord });
}
