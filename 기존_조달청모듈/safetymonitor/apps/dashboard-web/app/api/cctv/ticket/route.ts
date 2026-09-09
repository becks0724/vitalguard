// CCTV 게이트 티켓 발급 — 관제웹 로그인 세션을 확인하고 현장 권한을 판정해 짧은 수명 티켓을 준다.
// 「로그인한, 그 현장의 인가받은 관리자만 영상을 본다」가 성립하는 유일한 지점이다.
// 검증은 젯슨 게이트(cctv-ai/edge/cctv_gate.py)가 공개키로 한다 — 개인키는 여기에만 있다.
import { NextResponse } from "next/server";

import { getSession } from "../../../../lib/admin-auth";
import { signTicket, ticketSigningReady, type TicketScope } from "../../../../lib/cctv-ticket";
import { cctvPermissionFor, recordCctvTicketAudit } from "../../../../lib/db";

// 사용자별 분당 발급 상한 — 재연결 폭주·티켓 수집을 막는다.
// ⚠ 인스턴스 메모리라 Cloud Run 이 여러 대면 대당 상한이다. 최종 방어선은 게이트의 요청률 상한이고
//    이건 정상 클라이언트의 폭주를 일찍 끊는 용도다.
const RATE_PER_MIN = 60;
const rate = new Map<string, { minute: number; count: number }>();

function rateOk(username: string): boolean {
  const minute = Math.floor(Date.now() / 60000);
  const slot = rate.get(username);
  if (!slot || slot.minute !== minute) {
    rate.set(username, { minute, count: 1 });
    if (rate.size > 500) {
      for (const [k, v] of rate) if (v.minute < minute - 5) rate.delete(k);
    }
    return true;
  }
  slot.count += 1;
  return slot.count <= RATE_PER_MIN;
}

export async function POST(request: Request) {
  const session = getSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!ticketSigningReady()) {
    // 서명키가 없으면 티켓을 만들지 않는다 — 서명 없는 값을 흘리면 게이트가 통과시킬 이유가 없고,
    // 조용히 200 을 주면 화면만 도는 것처럼 보인다.
    return NextResponse.json({ ok: false, error: "ticket signing not configured" }, { status: 503 });
  }
  if (!rateOk(session.username)) {
    return NextResponse.json({ ok: false, error: "too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const obj = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const cameraId = String(obj.cameraId ?? "").trim();
  const scopeRaw = String(obj.scope ?? "read");
  if (!cameraId) {
    return NextResponse.json({ ok: false, error: "cameraId required" }, { status: 400 });
  }
  if (scopeRaw !== "read" && scopeRaw !== "control") {
    return NextResponse.json({ ok: false, error: "scope must be read or control" }, { status: 400 });
  }
  const scope: TicketScope = scopeRaw;

  // ★ 현장은 요청 본문이 아니라 카메라 대장에서 되찾는다. 클라이언트가 보낸 현장을 믿으면
  //   다른 현장 이름을 적어 보내는 것으로 권한 검사를 통과할 수 있다.
  const perm = await cctvPermissionFor(session.username, session.role, cameraId);
  if (!perm) {
    await recordCctvTicketAudit({
      username: session.username, cameraId, scope, granted: false, reason: "unknown camera",
    });
    return NextResponse.json({ ok: false, error: "unknown camera" }, { status: 404 });
  }
  const allowed = scope === "control" ? perm.canControl : perm.canView;
  if (!allowed) {
    await recordCctvTicketAudit({
      username: session.username, cameraId, scope, granted: false, reason: `no ${scope} on ${perm.siteId}`,
    });
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const signed = signTicket({
    cameraId,
    siteId: perm.siteId,
    scope,
    subject: session.username,
  });
  if (!signed) {
    return NextResponse.json({ ok: false, error: "sign failed" }, { status: 503 });
  }
  await recordCctvTicketAudit({ username: session.username, cameraId, scope, granted: true });

  return NextResponse.json(
    { ok: true, ticket: signed.ticket, expiresAt: signed.expiresAt, ttlSec: signed.ttlSec },
    { headers: { "Cache-Control": "no-store" } },
  );
}
