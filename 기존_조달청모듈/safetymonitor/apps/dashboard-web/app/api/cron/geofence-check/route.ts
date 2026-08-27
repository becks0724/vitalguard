// Cloud Scheduler 무인 트리거 — 구획을 벗어난 작업자를 서버가 주기로 찾아 알린다.
//
// ★ 왜 크론인가. 구획 판정은 지금까지 **관제 화면(브라우저)에서만** 돌았다. 아무도 화면을
//   열어 두지 않으면 이탈 알림은 누구에게도 안 간다. `cron/absence-check` 가 같은 이유로
//   이미 서버로 옮겨진 전례다.
//
// ★ 중심 좌표는 **화면과 같은 출처**를 써야 한다(2026-08-27 실사고 계열).
//   화면은 `siteAnchor(등록 주소 지오코딩) ?? cachedCoord ?? 기상 좌표` 순이다. 서버가
//   `site_coord_daily`(작업자 좌표 일별 캐시)를 중심으로 쓰면 **두 판정이 1,009m 어긋난다** —
//   실측으로 확인했다(주소 35.150500,126.916166 vs 캐시 35.156,126.925). 그래서 여기서도
//   주소 지오코딩을 1순위로 두고, 실패할 때만 캐시로 떨어진다.
//
// ⚠ 중복 통지 방지는 두 겹이다. ① `replayGeofence` 가 **전이가 일어난 표본의 ts** 를 내므로
//   같은 이탈 구간이면 크론이 몇 번 돌아도 같은 자연키다(`recordAlert` 의 ON CONFLICT).
//   ② 화면이 같은 구간을 다른 ts 로 이미 기록했을 수 있어, 이탈 시각 이후에 알림이 있으면 건너뛴다.
import { NextResponse } from "next/server";

import { geocodeAddress, vworldConfigured } from "../../../lib/vworld";
import { cronAuth } from "../../../../lib/cron-auth";
import {
  getLatestSiteCoord,
  getLatestSiteInfo,
  lastGeofenceAlertTsByWorker,
  recentGpsFixes,
  recordAlert,
  rosterWorkerNames,
} from "../../../../lib/db";
import { replayGeofence } from "../../../../lib/geofence-watch";
import { SITE_RADIUS_MAX_M } from "../../../../lib/site-radius";

export const dynamic = "force-dynamic";

/** 되짚는 창 — 화면의 상태 보존(20분)보다 넉넉히 잡아 느린 기기의 연속 3회를 담는다. */
const REPLAY_WINDOW_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const auth = cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET);
  if (auth === "notConfigured") {
    return NextResponse.json({ ok: false, error: "CRON_SECRET 미설정" }, { status: 503 });
  }
  if (auth === "unauthorized") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ── ① 중심 좌표 — 주소 지오코딩 우선, 실패 시 일별 캐시.
  let center: { lat: number; lon: number } | null = null;
  let centerSource = "none";
  const info = await getLatestSiteInfo().catch(() => null);
  const address = info?.address?.trim() ?? "";
  if (address && vworldConfigured()) {
    const g = await geocodeAddress(address).catch(() => ({ ok: false }) as const);
    if (g.ok) {
      center = { lat: g.lat, lon: g.lon };
      centerSource = "address";
    }
  }
  if (!center) {
    const cached = await getLatestSiteCoord().catch(() => null);
    if (cached && Number.isFinite(Number(cached.lat)) && Number.isFinite(Number(cached.lon))) {
      center = { lat: Number(cached.lat), lon: Number(cached.lon) };
      centerSource = "cache";
    }
  }
  if (!center) {
    // 중심을 모르면 판정하지 않는다 — 임의 중심으로 재면 전원이 이탈로 보인다.
    return NextResponse.json({ ok: false, error: "현장 중심 좌표 없음", centerSource });
  }

  // ── ② 최근 창의 좌표를 되짚어 현재 이탈자를 재구성.
  const sinceIso = new Date(Date.now() - REPLAY_WINDOW_MS).toISOString();
  const fixes = await recentGpsFixes(sinceIso);
  const verdicts = replayGeofence(fixes, center, SITE_RADIUS_MAX_M);

  // ── ③ 이미 알린 구간은 건너뛴다(화면이 먼저 기록했을 수 있다).
  const already = await lastGeofenceAlertTsByWorker(sinceIso).catch(
    () => ({}) as Record<string, string>,
  );
  const names = await rosterWorkerNames().catch(() => ({}) as Record<string, string>);

  let alerted = 0;
  let skipped = 0;
  const outside: string[] = [];
  for (const v of verdicts) {
    if (!v.outside || !v.exitTs) continue;
    outside.push(v.workerId);
    const prev = already[v.workerId];
    // 이탈 시각 이후에 이미 알림이 있으면 같은 구간으로 본다.
    if (prev && prev >= v.exitTs) {
      skipped += 1;
      continue;
    }
    await recordAlert({
      workerId: v.workerId,
      workerName: names[v.workerId] ?? v.workerName,
      type: "geofence",
      ts: v.exitTs,
    });
    alerted += 1;
  }

  return NextResponse.json({
    ok: true,
    centerSource,
    center,
    radiusM: SITE_RADIUS_MAX_M,
    fixes: fixes.length,
    workers: verdicts.length,
    outside,
    alerted,
    skipped,
  });
}
