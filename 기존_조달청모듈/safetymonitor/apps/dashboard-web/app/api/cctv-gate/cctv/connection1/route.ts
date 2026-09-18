// CAM-01 연결 토글 — connection3 과 같이 서버 중계에서는 **할 수 없다**고 501 로 답한다.
//
// 조용히 200 을 주면 화면이 「껐다」고 믿는다. 젯슨을 부를 길이 없다는 사실을 말한다.
import { NextResponse } from "next/server";

import { cameraIdForSuffix } from "../../../../../lib/cctv-frame";
import { authorizeGate } from "../../../../../lib/cctv-gate-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("1")!;

export async function POST(request: Request) {
  // 표 검증은 그대로 한다 — 권한 없는 호출이 501 을 먼저 보면 「이 라우트가 있다」는 정보가 새는 셈이다.
  const auth = await authorizeGate(request, { cameraId: CAMERA_ID, scope: "control" });
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { ok: false, error: "server relay cannot control the edge — 젯슨의 /config 는 같은 랜이나 Tailscale 에서만" },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}
