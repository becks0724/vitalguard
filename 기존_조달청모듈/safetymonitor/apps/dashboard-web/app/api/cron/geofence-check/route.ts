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

/** 기존 알림 조회 창 — 되짚기 창(60분)보다 길어야 한다(2026-08-31 · 08-30 79건 연발 수술).
    이탈이 60분을 넘기면 전이가 되짚기 창 밖으로 밀려 매 실행 창 시작 부근의 새 exitTs 가
    발급되는데, 조회 창이 되짚기 창과 같으면 직전 알림만 보여 그 표류 ts 가 매번 "새 사건" 으로
    통과했다. 24시간이면 연속 이탈 재알림은 하루 1회로 준다(recordAlert 의 일일 통지 상한
    3회가 그 위의 최종 안전망이다). */
const GEOFENCE_ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

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
  const lookbackIso = new Date(Date.now() - GEOFENCE_ALERT_LOOKBACK_MS).toISOString();
  const already = await lastGeofenceAlertTsByWorker(lookbackIso).catch(
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
    // ★ 같은 이탈 에피소드는 다시 알리지 않는다 — "이전 알림 이후의 구획 안 관측" 이 있어야
    //   새 사건이다(2026-08-31 개정). 종전의 `prev >= exitTs` 비교는 이탈이 되짚기 창(60분)을
    //   넘기는 순간 무력화됐다: 전이가 창 밖으로 밀려 매 실행 새 exitTs 가 발급되고, 그 ts 는
    //   항상 prev 보다 미래라 검사를 통과했다(08-30 실측: 같은 이탈 1건 → 79건 · 4~6분 간격).
    if (prev && !(v.lastInsideTs && v.lastInsideTs > prev)) {
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

  // ★ 한 줄 요약을 반드시 남긴다 — 안 남기면 **정상과 고장이 똑같이 200 으로 보인다**.
  //
  //   이 크론이 조용한 이유는 셋인데 응답 코드만으로는 안 갈린다.
  //     ⓐ 정상        아무도 구획을 안 벗어남
  //     ⓑ 입력 고장    좌표가 안 들어옴(전송 끊김·창 밖)
  //     ⓒ 출력 고장    이탈은 잡았는데 알림이 안 나감
  //   `workers`·`fixes`·`outside`·`alerted` 네 숫자가 이 셋을 즉시 가른다.
  //   실제로 첫 실행(2026-08-27 07:25Z)이 200 이었지만 창 안 좌표가 0건이라 판정 자체가
  //   돌지 않았다 — 그 사실을 알아내려고 DB 를 따로 뒤져야 했다. 그래서 넣는다.
  //
  // ⚠ 개인 식별자는 남기지 않는다 — 이탈자는 **수**만 찍고 명단은 응답 본문에만 둔다.
  // eslint-disable-next-line no-console -- 5분 주기 정상 요약이라 warn/error 로 올리면 진짜 경고가 묻힌다.
  console.log(
    `[구획이탈] 중심=${centerSource} · 좌표 ${fixes.length}건 · 작업자 ${verdicts.length}명 · ` +
      `이탈 ${outside.length}명 · 알림 ${alerted}건 · 건너뜀 ${skipped}건`,
  );

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
