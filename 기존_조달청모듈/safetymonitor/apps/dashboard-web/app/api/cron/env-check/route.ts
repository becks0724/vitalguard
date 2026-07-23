// Cloud Scheduler 무인 트리거 — 저장된 현장 좌표로 날씨·기상특보를 서버가 주기 평가(브라우저 없이 알림 발송).
// 실제 판정·억제·발송은 /api/weather·/api/kma-warning 이 이미 수행 → 여기선 좌표 조회 후 자체 호출만.
import { NextResponse } from "next/server";

import { cronAuth } from "../../../../lib/cron-auth";
import { getLatestSiteCoord, getLatestWeatherDaily } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET);
  if (auth === "notConfigured") {
    return NextResponse.json({ ok: false, error: "CRON_SECRET 미설정" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // 저장된 현장 좌표(브라우저 세션이 하루 1회 캡처) → 폴백 weather_daily. 둘 다 없으면 평가 불가.
  let lat: number | undefined;
  let lon: number | undefined;
  const coord = await getLatestSiteCoord();
  if (coord) {
    lat = coord.lat;
    lon = coord.lon;
  } else {
    const daily = await getLatestWeatherDaily();
    if (daily) {
      lat = daily.lat;
      lon = daily.lon;
    }
  }
  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ ok: true, skipped: "저장된 현장 좌표 없음(브라우저 최초 접속 필요)" });
  }

  // 자체 라우트 호출 — 날씨(캐시미스 시 판정)·기상특보(live 특보)가 평가·억제·텔레그램 발송을 수행한다.
  // Cloud Run 은 컨테이너에 http 로 프록시해 request.url 이 http origin 이 될 수 있음 → Host 헤더로 https 강제.
  const host = request.headers.get("host");
  const origin = host ? `https://${host}` : new URL(request.url).origin;
  const query = `lat=${lat}&lon=${lon}`;
  const checked: Record<string, number | string> = {};
  try {
    const w = await fetch(`${origin}/api/weather?${query}`, { cache: "no-store" });
    checked.weather = w.status;
  } catch {
    checked.weather = "error";
  }
  try {
    const k = await fetch(`${origin}/api/kma-warning?${query}`, { cache: "no-store" });
    checked.kma = k.status;
  } catch {
    checked.kma = "error";
  }

  return NextResponse.json({ ok: true, lat, lon, checked });
}
