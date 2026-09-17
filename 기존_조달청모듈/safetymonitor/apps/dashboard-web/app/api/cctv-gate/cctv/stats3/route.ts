// CAM-03 통계 주기 — 젯슨 게이트 /cctv/stats3 의 서버판. 관제웹 PPE 줄(useAiStats)이 `${gateApi}/cctv/stats3` 를 부른다.
//
// ⚠ 설계 문서(§5-2)에는 이 라우트가 없다. 그러나 gateApi 를 서버로 돌리는 순간 관제웹이 여기를 부르므로
//   없으면 PPE 줄이 「수신 대기」로 죽는다. 응답 형태는 게이트 화이트리스트와 같다(publicStats).
import { NextResponse } from "next/server";

import { cameraIdForSuffix, frameAgeSec, isStale, publicStats } from "../../../../../lib/cctv-frame";
import { authorizeGate } from "../../../../../lib/cctv-gate-auth";
import { getCctvFrame } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("3")!;

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
