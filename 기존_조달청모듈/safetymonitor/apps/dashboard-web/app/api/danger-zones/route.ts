// 위험구역(진입 금지 존) API — 조회 = 로그인 세션 / 등록·삭제 = 권한있음(owner·admin_access) 서버 강제.
import { NextResponse } from "next/server";

import { hasAdminMenuAccess, verifyBasicAuth } from "../../../lib/admin-auth";
import { createDangerZone, deleteDangerZone, listDangerZones } from "../../../lib/db";

// 한국 범위 게이트 — 지도·fieldCoords 와 동일 기준(엉뚱한 좌표 등록 차단).
function isKoreaCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 32.5 &&
    lat <= 39.5 &&
    lon >= 123.5 &&
    lon <= 132.5
  );
}

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { ok: true, zones: await listDangerZones() },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const name = String(obj.name ?? "").trim().slice(0, 40);
  const lat = Number(obj.lat);
  const lon = Number(obj.lon);
  const radiusM = Math.round(Number(obj.radiusM));
  if (!name) {
    return NextResponse.json({ ok: false, error: "name required" }, { status: 400 });
  }
  if (!isKoreaCoord(lat, lon)) {
    return NextResponse.json({ ok: false, error: "coord out of korea range" }, { status: 400 });
  }
  if (!Number.isFinite(radiusM) || radiusM < 5 || radiusM > 500) {
    return NextResponse.json({ ok: false, error: "radiusM must be 5..500" }, { status: 400 });
  }

  const zone = await createDangerZone({ name, lat, lon, radiusM });
  return NextResponse.json({ ok: true, zone });
}

export async function DELETE(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  const removed = await deleteDangerZone(id);
  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
