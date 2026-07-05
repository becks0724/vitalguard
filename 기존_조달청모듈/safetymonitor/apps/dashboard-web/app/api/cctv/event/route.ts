import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CctvFallEventSchema } from "@safetymonitor/schemas";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { ingestAuthStatus } from "../../../../lib/ingest-auth";
import { ingestCctvEvent, recentZoneHazards } from "../ingest";
import { recentCctvEvents } from "../../../../lib/db";

// 무인증 수집 전송 경고(soft 모드) — 프로세스당 1회.
let warnedUnauthedCctv = false;

// 영상(CCTV) 낙상 이벤트 수신 — 폴링 어댑터/푸시가 POST. 워치(/api/mock/vital)와 별개 경로.
// 기존 vital route 패턴 답습(배열/단일, Zod, 항목 격리). 단 CCTV 는 reserved worker 가 없어
// 202 분기를 두지 않는다(설계 §9) — 201/400 만 사용.
export async function POST(request: Request) {
  // 토큰 병행(soft) — 유효 토큰 있으면 인증, 무토큰 한시 허용(경고), 무효 토큰 거부.
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") {
    return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  }
  if (auth === "none" && !warnedUnauthedCctv) {
    warnedUnauthedCctv = true;
    console.warn("[cctv/event] 무인증 수집 전송 수용 중(soft) — 발표 후 토큰 필수화 예정");
  }
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
    // ZodError(클라 검증 실패)=400, 그 외 서버/DB 오류=500. 내부 상세는 응답 미노출(서버 로그만).
    if (error instanceof ZodError) {
      return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
    }
    console.error("[cctv/event]", error);
    return NextResponse.json({ ok: false, error: "이벤트 처리 실패" }, { status: 500 });
  }
}

// 최근 영상 이벤트(감사) + 대상 미특정 zone 위험(관제 표시용) — 세션 게이트(무인증 열람 차단).
export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    cctvEvents: await recentCctvEvents(100),
    zoneHazards: recentZoneHazards(50),
  });
}
