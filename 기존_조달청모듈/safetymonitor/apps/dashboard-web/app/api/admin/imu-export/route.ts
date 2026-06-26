import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { exportImuWindows } from "../../../../lib/db";

// 관리자 — raw IMU 윈도 NDJSON 내보내기. fall-export 와 동일한 인증·기간 패턴.
// 줄당 1윈도 JSON(스트리밍/대용량 친화) → 학습 파이프라인에서 라인 단위로 읽기.
export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }

  const url = new URL(request.url);
  const now = new Date();
  const to = url.searchParams.get("to") || now.toISOString();
  const from =
    url.searchParams.get("from") ||
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json(
      { ok: false, error: "from / to 는 ISO 8601 형식이어야 합니다." },
      { status: 400 },
    );
  }

  const rows = await exportImuWindows({ from, to });
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  const fileFrom = from.slice(0, 10);
  const fileTo = to.slice(0, 10);

  return new NextResponse(ndjson, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="imu-windows-${fileFrom}_${fileTo}.ndjson"`,
      "x-row-count": String(rows.length),
    },
  });
}
