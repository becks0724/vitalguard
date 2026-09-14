// 관리자 앱 CCTV 조회 티켓 — 모바일 관리자 게이트를 통과한 사용자에게 read만 발급한다.
// 관제웹의 /api/cctv/ticket은 변경하지 않고 서명·현장 권한·감사 경로를 그대로 사용한다.
import { NextResponse } from "next/server";

import { requireAppAdmin } from "../../../../../lib/app-admin-auth";
import { signTicket, ticketSigningReady } from "../../../../../lib/cctv-ticket";
import { cctvPermissionFor, recordCctvTicketAudit } from "../../../../../lib/db";

// 기존 라우트의 비공개 rateOk를 그대로 유지한다. 카운터는 앱 경로·인스턴스별이다.
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
  const gate = await requireAppAdmin(request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  const { username, role } = gate.principal;

  if (!ticketSigningReady()) {
    return NextResponse.json({ ok: false, error: "ticket signing not configured" }, { status: 503 });
  }
  if (!rateOk(username)) {
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
  if (!cameraId) {
    return NextResponse.json({ ok: false, error: "cameraId required" }, { status: 400 });
  }
  // 앱은 조회만 한다. 요청 본문의 scope는 읽지 않는다.
  const scope = "read";

  // ★ 현장은 요청 본문이 아니라 카메라 대장에서 되찾는다. 클라이언트가 보낸 현장을 믿으면
  //   다른 현장 이름을 적어 보내는 것으로 권한 검사를 통과할 수 있다.
  // 앱 게이트 통과자 중 owner만 전역 특례를 쓰고, 나머지는 기존 현장 권한 경로로 보낸다.
  const perm = await cctvPermissionFor(username, role === "owner" ? "owner" : "admin", cameraId);
  if (!perm) {
    await recordCctvTicketAudit({
      username, cameraId, scope, granted: false, reason: "unknown camera",
    });
    return NextResponse.json({ ok: false, error: "unknown camera" }, { status: 404 });
  }
  if (!perm.canView) {
    await recordCctvTicketAudit({
      username, cameraId, scope, granted: false, reason: `no ${scope} on ${perm.siteId}`,
    });
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const signed = signTicket({
    cameraId,
    siteId: perm.siteId,
    scope,
    subject: username,
  });
  if (!signed) {
    return NextResponse.json({ ok: false, error: "sign failed" }, { status: 503 });
  }
  await recordCctvTicketAudit({ username, cameraId, scope, granted: true });

  // 앱은 빌드타임 NEXT_PUBLIC_*을 볼 수 없으므로 런타임 게이트 주소를 우선 전달한다.
  const gateApi = (process.env.CAM03_GATE_API ?? process.env.NEXT_PUBLIC_CAM03_GATE_API ?? "").trim();
  return NextResponse.json(
    { ok: true, ticket: signed.ticket, expiresAt: signed.expiresAt, ttlSec: signed.ttlSec, gateApi },
    { headers: { "Cache-Control": "no-store" } },
  );
}
