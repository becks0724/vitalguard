// CAM-03 프레임 받기 — 젯슨 푸셔가 5초마다 POST 하는 JPEG 를 DB 한 행에 덮어쓴다. 추론 없음 · 메모리 보관 없음.
//
// 젯슨 gopro_ppe_edge.py `_push_worker` 가 `{CCTV_BASE}/cctv/ingest3?drawn=1&persons=…` 로 보내는 그 요청이다.
// CCTV_BASE 를 이 서버로 두면 7월 cctv-ai 경로와 같은 모양으로 오되, 목적지가 프로세스 메모리가 아니라 DB 다.
// 인증은 젯슨 전용 업로드 토큰 — 가스포드의 soft 모드(무토큰 수용)는 따르지 않는다(lib/cctv-frame.ts 주석).
import { NextResponse } from "next/server";

import {
  MAX_JPEG_BYTES, bearerFromHeader, cameraIdForSuffix, ingestTokenMatches, parseIngestStats,
} from "../../../../../lib/cctv-frame";
import { upsertCctvFrame } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("3")!; // 이 경로는 CAM-03 전용이다 — 게이트가 CAMERA=CAM-03 하나만 알듯

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const expected = process.env.CCTV_INGEST_TOKEN;
  if (!expected) {
    // 토큰이 없으면 받지 않는다. 조용히 200 을 주면 젯슨은 「올라갔다」고 믿고 화면은 옛 프레임을 본다.
    return json({ ok: false, error: "ingest token not configured" }, 503);
  }
  if (!ingestTokenMatches(bearerFromHeader(request.headers.get("authorization")), expected)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.startsWith("image/jpeg")) return json({ ok: false, error: "image/jpeg required" }, 415);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_JPEG_BYTES) return json({ ok: false, error: "too large" }, 413);

  const jpg = Buffer.from(await request.arrayBuffer());
  if (jpg.length === 0) return json({ ok: false, error: "empty body" }, 400);
  if (jpg.length > MAX_JPEG_BYTES) return json({ ok: false, error: "too large" }, 413);

  const stats = parseIngestStats(new URL(request.url).searchParams);
  try {
    await upsertCctvFrame({
      cameraId: CAMERA_ID,
      jpg,
      capturedAt: new Date().toISOString(), // 푸셔는 시각을 안 보낸다 — 도착 시각이 곧 프레임 시각
      stats,
    });
  } catch (e) {
    console.error("[cctv-gate/ingest3] 저장 실패:", e);
    return json({ ok: false, error: "store failed" }, 500);
  }
  return json({ ok: true }, 201);
}
