// CAM-03 프레임 주기 — 표를 검증·소비하고 DB 의 최신 JPEG 한 장을 단발로 준다. 젯슨 게이트 /cctv/stream3 의 서버판.
//
// 게이트는 MJPEG 를 흘렸지만 여기서는 단발 image/jpeg 다 — 장시간 연결이 남으면 요청 단위 과금이 깨진다(설계 §7-4).
// 앱 리더는 image/* 단발을 그대로 받는다(앱 수정 0). 관제웹은 CctvGateStream 이 폴링으로 바뀐다.
import { NextResponse } from "next/server";

import { cameraIdForSuffix, frameAgeSec, isStale } from "../../../../../lib/cctv-frame";
import { authorizeGate } from "../../../../../lib/cctv-gate-auth";
import { getCctvFrame } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("3")!;

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
