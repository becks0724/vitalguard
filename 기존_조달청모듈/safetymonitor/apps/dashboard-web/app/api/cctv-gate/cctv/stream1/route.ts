// CAM-01 프레임 주기 — 표를 검증·소비하고 DB 의 최신 JPEG 한 장을 단발로 준다. stream3 의 CAM-01 판.
//
// ★ 왜 생겼나(2026-09-18): CAM-01 이 다른 공유기 뒤로 옮겨가 젯슨 게이트로는 닿지 않는다.
//   관제웹 CctvGateStream 이 `${gateApi}/cctv/stream1` 을 부르므로, 넣는 문(ingest1)만으로는 화면이 안 뜬다.
import { NextResponse } from "next/server";

import { cameraIdForSuffix, frameAgeSec, isStale } from "../../../../../lib/cctv-frame";
import { authorizeGate } from "../../../../../lib/cctv-gate-auth";
import { getCctvFrame } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("1")!;

export async function GET(request: Request) {
  const auth = await authorizeGate(request, { cameraId: CAMERA_ID, scope: "read" });
  if (!auth.ok) return auth.response;

  const frame = await getCctvFrame(CAMERA_ID);
  if (!frame) {
    return NextResponse.json({ error: "upstream unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const age = frameAgeSec(frame.captured_at);
  if (isStale(age)) {
    // 젯슨이 안 올리고 있다. 옛 그림을 주면 화면이 살아 있는 척한다 — 앱은 503 을 「현장 장비에 연결되지 않습니다」로 그린다.
    return NextResponse.json(
      { error: "stale", age_sec: Math.round(age) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response(new Uint8Array(frame.jpg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(frame.jpg.length),
      "Cache-Control": "no-store",
      "X-Captured-At": frame.captured_at,
    },
  });
}
