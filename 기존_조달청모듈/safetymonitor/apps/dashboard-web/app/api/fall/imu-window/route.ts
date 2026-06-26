// 레포 경로: apps/dashboard-web/app/api/fall/imu-window/route.ts
// 워치(미니앱) → raw 6축 윈도 1건 수신 → imu_window 임시 버퍼 INSERT. A3 임시 수집용.
// 인증 없음(임시 수집 버퍼, 본 파이프라인과 미연결). 필요 시 토큰 헤더 추가.
import { NextResponse } from "next/server";

import { insertImuWindow } from "../../../../lib/db";

export async function POST(request: Request) {
  try {
    const b = await request.json();
    // 미니앱 payload: { workerId, fs, impactIndex, axes:[[6]...], family }
    if (!Array.isArray(b?.axes) || b.axes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "axes(6축 배열) 필수" },
        { status: 400 },
      );
    }
    // 각 윈도 행이 정확히 6축인지 검증(DDL CHECK 로는 서브쿼리 불가라 여기서 막음).
    if (!b.axes.every((r: unknown) => Array.isArray(r) && r.length === 6)) {
      return NextResponse.json(
        { ok: false, error: "각 윈도는 6축([ax,ay,az,gx,gy,gz]) 이어야 함" },
        { status: 400 },
      );
    }
    await insertImuWindow({
      worker_id: String(b.workerId ?? "UNSET"),
      family: typeof b.family === "string" ? b.family : null,
      fs: typeof b.fs === "number" ? b.fs : null,
      impact_index: typeof b.impactIndex === "number" ? b.impactIndex : null,
      axes: b.axes,
    });
    return NextResponse.json(
      { ok: true, samples: b.axes.length },
      { status: 201 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
