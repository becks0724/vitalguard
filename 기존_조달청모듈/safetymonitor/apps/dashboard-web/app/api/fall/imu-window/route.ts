import { NextResponse } from "next/server";
import { z } from "zod";

import { insertImuWindow } from "../../../../lib/db";

// 워치 → raw 6축 IMU 윈도 수신. mock/vital 과 같은 공개 경로(워치 POST, 인증 없음).
// 한 요청에 단일 객체 또는 배열(배칭) 모두 허용 — 항목별 격리(한 건 실패해도 전체 400 아님).
const ImuWindowSchema = z.object({
  workerId: z.string().min(1),
  family: z.string().optional(),
  fs: z.number().int().positive().optional(),
  impactIndex: z.number().int().optional(),
  axes: z.array(z.array(z.number()).length(6)).min(1), // [[ax,ay,az,gx,gy,gz], …]
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items = Array.isArray(body) ? body : [body];

    let accepted = 0;
    let dropped = 0;
    const ids: number[] = [];
    for (const item of items) {
      const parsed = ImuWindowSchema.safeParse(item);
      if (!parsed.success) {
        dropped += 1;
        continue;
      }
      const { id } = await insertImuWindow(parsed.data);
      accepted += 1;
      ids.push(id);
    }

    return NextResponse.json({ ok: true, accepted, dropped, ids }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid imu-window payload",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
