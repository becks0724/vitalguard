// 작업자 이동 경로(트랙) 조회 — 로그인 세션 필수(GPS=PII), 별칭(worker_alias) 폴딩 포함.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { getWorkerAliasMap, listWorkerTrack } from "../../../../lib/db";
import { downsampleTrack, sanitizeTrack, TRACK_WINDOW_MIN } from "../../../lib/track";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workerId = (url.searchParams.get("workerId") ?? "").slice(0, 80);
  if (!workerId) {
    return NextResponse.json({ ok: false, error: "workerId required" }, { status: 400 });
  }
  const minsRaw = Number(url.searchParams.get("mins") ?? TRACK_WINDOW_MIN);
  const mins = Number.isFinite(minsRaw) ? Math.min(180, Math.max(5, Math.round(minsRaw))) : TRACK_WINDOW_MIN;

  // 표시 계층은 별칭을 primary 로 폴딩하므로, primary 로 들어온 조회에 secondary 발신분도 합친다.
  const aliasMap = await getWorkerAliasMap();
  const ids = [
    workerId,
    ...Object.entries(aliasMap)
      .filter(([, primary]) => primary === workerId)
      .map(([secondary]) => secondary),
  ];

  const since = new Date(Date.now() - mins * 60_000).toISOString();
  const rows = await listWorkerTrack(ids, since);
  const points = downsampleTrack(sanitizeTrack(rows));

  return NextResponse.json(
    { ok: true, workerId, mins, points },
    { headers: { "cache-control": "no-store" } },
  );
}
