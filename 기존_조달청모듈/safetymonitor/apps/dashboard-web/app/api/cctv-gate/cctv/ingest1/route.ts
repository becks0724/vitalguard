// CAM-01 프레임 받기 — 2호기 젯슨 푸셔가 보내는 JPEG 를 DB 한 행에 덮어쓴다. 추론 없음 · 메모리 보관 없음.
//
// ingest3(CAM-03)와 같은 꼴이고 카메라만 다르다. 굳이 한 파일로 합치지 않는다 —
// 경로마다 카메라가 하나로 고정돼 있어야 잘못된 접미사로 남의 카메라를 덮어쓸 여지가 없다.
//
// ★ 왜 생겼나(2026-09-18): CAM-01 이 다른 장소로 옮겨가 **다른 공유기** 뒤에 있다.
//   기존 젯슨의 게이트(:8443 → :8445)로는 닿지 않는다. 2호기가 인터넷으로 직접 밀어야 한다.
import { NextResponse } from "next/server";

import {
  MAX_JPEG_BYTES, bearerFromHeader, cameraIdForSuffix, ingestTokenMatches, parseIngestStats,
} from "../../../../../lib/cctv-frame";
import { upsertCctvFrame } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAMERA_ID = cameraIdForSuffix("1")!; // 이 경로는 CAM-01 전용이다

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
    console.error("[cctv-gate/ingest1] 저장 실패:", e);
    return json({ ok: false, error: "store failed" }, 500);
  }
  return json({ ok: true }, 201);
}
