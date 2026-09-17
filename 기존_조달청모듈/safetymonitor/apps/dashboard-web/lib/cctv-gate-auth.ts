// CAM-03 서버 중계 라우트 공용 인가 — 표 검증 → 현장 대조 → jti 소비. 세 라우트(stream3·stats3·connection3)가 같은 문을 쓴다.
//
// 젯슨 게이트 cctv_gate.py `_verify(scope, consume=True)` 를 서버로 옮긴 것이다. 라우트마다 따로 쓰면
// 한 곳만 sid 검사를 빼먹는 식으로 갈린다 — 문은 하나여야 한다.
import { NextResponse } from "next/server";

import { bearerFromHeader } from "./cctv-frame";
import { verifyTicket, type TicketPayload, type TicketScope } from "./cctv-ticket";
import { cctvCameraSite, consumeCctvTicketJti } from "./db";

export type GateAuth =
  | { ok: true; payload: TicketPayload }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string): GateAuth {
  return { ok: false, response: NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } }) };
}

/**
 * 요청의 Bearer 표를 검증하고 소비한다. 실패하면 게이트와 같은 상태·문구의 응답을 돌려준다.
 * ⚠ 소비는 검증이 전부 끝난 뒤에만 — 틀린 표를 소비하면 정당한 표의 jti 를 남이 먼저 태울 수 있다.
 */
export async function authorizeGate(
  request: Request,
  want: { cameraId: string; scope: TicketScope },
): Promise<GateAuth> {
  const ticket = bearerFromHeader(request.headers.get("authorization"));
  if (!ticket) return deny(401, "ticket required");
  const v = verifyTicket(ticket, want);
  if (!v.ok) return deny(v.status, v.error);

  // 현장은 표가 아니라 카메라 대장에서 되찾아 대조한다 — 표의 sid 는 발급 때 대장에서 채운 값이지만,
  // 카메라가 다른 현장으로 옮겨진 뒤 남은 옛 표는 여기서 걸린다.
  const siteId = await cctvCameraSite(want.cameraId);
  if (!siteId) return deny(404, "unknown camera");
  if (v.payload.sid !== siteId) return deny(403, "wrong site");

  const fresh = await consumeCctvTicketJti(v.payload.jti, v.payload.exp);
  if (!fresh) return deny(401, "already used");
  return { ok: true, payload: v.payload };
}
