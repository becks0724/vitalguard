// CAM-01 통계 주기 — stats3 의 CAM-01 판. 관제웹 PPE 줄(useAiStats)이 `${gateApi}/cctv/stats1` 을 부른다.
//
// ⚠ 없으면 영상은 떠도 PPE 줄이 「수신 대기」로 죽는다. 응답 형태는 게이트 화이트리스트와 같다(publicStats).
import { NextResponse } from "next/server";

import { cameraIdForSuffix, frameAgeSec, isStale, publicStats } from "../../../../../lib/cctv-frame";
import { authorizeGate } from "../../../../../lib/cctv-gate-auth";
import { getCctvFrame } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("1")!;

export async function GET(request: Request) {
  const auth = await authorizeGate(request, { cameraId: CAMERA_ID, scope: "read" });
  if (!auth.ok) return auth.response;

  const frame = await getCctvFrame(CAMERA_ID);
  const headers = { "Cache-Control": "no-store" };
  if (!frame) return NextResponse.json({ error: "upstream unreachable" }, { status: 503, headers });
  const age = frameAgeSec(frame.captured_at);
  if (isStale(age)) return NextResponse.json({ error: "stale", age_sec: Math.round(age) }, { status: 503, headers });
  return NextResponse.json(publicStats(frame.stats), { headers });
}
