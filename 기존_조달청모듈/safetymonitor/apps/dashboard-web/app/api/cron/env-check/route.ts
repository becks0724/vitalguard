// Cloud Scheduler 무인 트리거 — 저장된 현장 좌표로 날씨·기상특보·재난문자를 서버가 주기 평가(브라우저 없이 알림 발송).
// 실제 판정·억제·발송은 /api/weather·/api/kma-warning·/api/disaster-msg 가 이미 수행 → 여기선 좌표 조회 후 자체 호출만.
import { NextResponse } from "next/server";

import { geocodeAddress, vworldConfigured } from "../../../lib/vworld";
import { cronAuth } from "../../../../lib/cron-auth";
import {
  getLatestSiteCoord,
  getLatestSiteInfo,
  getLatestWeatherDaily,
} from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET);
  if (auth === "notConfigured") {
    return NextResponse.json({ ok: false, error: "CRON_SECRET 미설정" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ★ 중심 좌표는 **관제 화면과 같은 출처 순서**로 고른다(2026-08-27 실측 정정).
  //
  //   화면(`DemoDashboard`)은 `siteAnchor(등록 주소 지오코딩) ?? cachedCoord ?? 기상 좌표` 순인데,
  //   여기는 `site_coord_daily`(작업자 좌표 일별 캐시)부터 집고 있었다. 두 좌표가 **1,009m** 떨어져
  //   있다 — 주소 `35.150500,126.916166` vs 캐시 `35.156,126.925`. 같은 현장을 두고 서버와 화면이
  //   다른 지점의 날씨·특보를 평가하던 셈이다.
  //   ⚠ 광주 안에서는 시·도 특보가 같아 증상이 안 보였다. **틀린 채로 맞는 답이 나오던 것**이라
  //     현장이 시·도 경계 근처로 바뀌는 순간 갈린다.
  //   같은 날 구획 이탈 판정에서 같은 폴백을 정본으로 착각해 이탈률을 15.6% → 100% 로 잘못 쟀다.
  //   그래서 두 곳 다 **주소 1순위**로 맞춘다.
  let lat: number | undefined;
  let lon: number | undefined;
  let coordSource = "none";
  const info = await getLatestSiteInfo().catch(() => null);
  const address = info?.address?.trim() ?? "";
  if (address && vworldConfigured()) {
    const g = await geocodeAddress(address).catch(() => ({ ok: false }) as const);
    if (g.ok) {
      lat = g.lat;
      lon = g.lon;
      coordSource = "address";
    }
  }
  if (lat === undefined) {
    const coord = await getLatestSiteCoord();
    if (coord) {
      lat = coord.lat;
      lon = coord.lon;
      coordSource = "cache";
    }
  }
  if (lat === undefined) {
    const daily = await getLatestWeatherDaily();
    if (daily) {
      lat = daily.lat;
      lon = daily.lon;
      coordSource = "weatherDaily";
    }
  }
  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ ok: true, skipped: "저장된 현장 좌표 없음(브라우저 최초 접속 필요)" });
  }

  // 자체 라우트 호출 — 날씨(캐시미스 시 판정)·기상특보(live 특보)·재난문자가 평가·억제·텔레그램 발송을 수행한다.
  // Cloud Run 은 컨테이너에 http 로 프록시해 request.url 이 http origin 이 될 수 있음 → Host 헤더로 https 강제.
  const host = request.headers.get("host");
  const origin = host ? `https://${host}` : new URL(request.url).origin;
  const query = `lat=${lat}&lon=${lon}`;
  // 크론 키를 자기호출에 전달한다. weather/kma 는 부작용(이력 저장·텔레그램 발송)을 인증된
  // 호출에만 수행하므로(BE-AUTHZ-02), 키가 없으면 무인 24/7 알림이 조용히 멈춘다.
  const cronHeaders = { "x-cron-key": process.env.CRON_SECRET ?? "" };
  const checked: Record<string, number | string> = {};
  try {
    const w = await fetch(`${origin}/api/weather?${query}`, {
      cache: "no-store",
      headers: cronHeaders,
    });
    checked.weather = w.status;
  } catch {
    checked.weather = "error";
  }
  try {
    const k = await fetch(`${origin}/api/kma-warning?${query}`, {
      cache: "no-store",
      headers: cronHeaders,
    });
    checked.kma = k.status;
  } catch {
    checked.kma = "error";
  }
  try {
    const d = await fetch(`${origin}/api/disaster-msg?${query}`, {
      cache: "no-store",
      headers: cronHeaders,
    });
    checked.disasterMsg = d.status;
  } catch {
    checked.disasterMsg = "error";
  }

  // 좌표 출처를 응답에 싣는다 — 화면과 어긋났을 때 사후에 "어느 단계 값을 집었나" 를 알 유일한 단서다.
  return NextResponse.json({ ok: true, coordSource, lat, lon, checked });
}
