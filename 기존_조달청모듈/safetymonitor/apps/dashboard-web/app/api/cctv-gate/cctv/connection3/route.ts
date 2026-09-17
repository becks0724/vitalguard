// CAM-03 연결 토글 — 젯슨 게이트 /cctv/connection3 의 자리. 서버 중계에서는 **할 수 없다**고 답한다.
//
// 관제웹 ConnToggle 이 control 표로 여기를 POST 한다. 게이트는 푸셔 /config 를 눌러 껐지만, 서버는 젯슨을
// 부를 길이 없다(그게 이 설계의 요점 — 젯슨은 아웃바운드만). 조용히 200 을 주면 「껐다」고 믿게 되니 501 로 말한다.
import { NextResponse } from "next/server";

import { cameraIdForSuffix } from "../../../../../lib/cctv-frame";
import { authorizeGate } from "../../../../../lib/cctv-gate-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("3")!;

export async function POST(request: Request) {
  // 표 검증은 그대로 한다 — 권한 없는 호출이 501 을 먼저 보면 「이 라우트가 있다」는 정보가 새는 셈이다.
  const auth = await authorizeGate(request, { cameraId: CAMERA_ID, scope: "control" });
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { ok: false, error: "server relay cannot control the edge — 젯슨의 /config 는 같은 랜이나 Tailscale 에서만" },
    { status: 501, headers: { "Cache-Control": "no-store" } },
  );
}
