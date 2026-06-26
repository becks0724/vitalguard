// 레포 경로: apps/dashboard-web/app/api/admin/imu-export/route.ts
// 관리자 → imu_window 전체를 NDJSON 으로 다운로드. 미니앱 payload 형식 그대로라
// 받은 파일을 그대로 python run_all.py --real <파일> / train_solo.py 에 투입 가능.
// fall-export 와 동일하게 verifyBasicAuth 사용.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { exportImuWindows } from "../../../../lib/db";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  const rows = await exportImuWindows();
  const ndjson =
    rows
      .map((r) =>
        JSON.stringify({
          workerId: r.worker_id,
          family: r.family,
          fs: r.fs,
          impactIndex: r.impact_index,
          axes: r.axes,
        }),
      )
      .join("\n") + (rows.length ? "\n" : "");

  return new NextResponse(ndjson, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="imu_window.ndjson"`,
      "x-row-count": String(rows.length),
    },
  });
}
