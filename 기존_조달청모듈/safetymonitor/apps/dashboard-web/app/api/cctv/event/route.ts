import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CctvFallEventSchema } from "@safetymonitor/schemas";

import { ingestCctvEvent, recentZoneHazards } from "../ingest";
import { recentCctvEvents } from "../../../../lib/db";

// 영상(CCTV) 낙상 이벤트 수신 — 폴링 어댑터/푸시가 POST. 워치(/api/mock/vital)와 별개 경로.
// 기존 vital route 패턴 답습(배열/단일, Zod, 항목 격리). 단 CCTV 는 reserved worker 가 없어
// 202 분기를 두지 않는다(설계 §9) — 201/400 만 사용.
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // 배열 전송(폴링 어댑터가 여러 카메라/프레임을 묶어 보낼 수 있음) — 항목별 격리.
    if (Array.isArray(body)) {
      let accepted = 0;
      let dropped = 0;
      const decisions = [];
      for (const item of body) {
        try {
          const event = CctvFallEventSchema.parse(item);
          decisions.push(await ingestCctvEvent(event));
          accepted += 1;
        } catch (itemError: unknown) {
          if (itemError instanceof ZodError) {
            dropped += 1;
            continue;
          }
          throw itemError;
        }
      }
      return NextResponse.json({ ok: true, accepted, dropped, decisions }, { status: 201 });
    }

    const event = CctvFallEventSchema.parse(body);
    const decision = await ingestCctvEvent(event);
    return NextResponse.json({ ok: true, decision }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: "invalid cctv event payload",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

// 최근 영상 이벤트(감사) + 대상 미특정 zone 위험(관제 표시용).
export async function GET() {
  return NextResponse.json({
    cctvEvents: await recentCctvEvents(100),
    zoneHazards: recentZoneHazards(50),
  });
}
