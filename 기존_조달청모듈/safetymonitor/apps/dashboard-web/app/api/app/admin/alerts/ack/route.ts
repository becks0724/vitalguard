// 관리자 앱 경보 대응 확인 — 대응자는 요청 본문이 아니라 앱 게이트의 주체다.
import { NextResponse } from "next/server";

import { requireAppAdmin } from "../../../../../../lib/app-admin-auth";
import type { AlertType } from "../../../../../../lib/alert-type";
import { ackAlert, ackAlertByKey } from "../../../../../../lib/db";

// D-4 §②의 네 종류 — 기존 알림 대응 확인 라우트와 같은 범위다.
const ALERT_TYPES: AlertType[] = ["sos", "fall", "vital", "geofence"];

export async function POST(request: Request) {
  const gate = await requireAppAdmin(request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const obj = typeof body === "object" && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown> : {};
  const hasId = "id" in obj;
  const hasKey = "workerId" in obj || "type" in obj;

  // 두 식별 방식을 섞으면 대상을 임의로 고르지 않는다. ID도 형 변환하지 않는다.
  if (hasId && !hasKey && typeof obj.id === "number" && Number.isSafeInteger(obj.id) && obj.id > 0) {
    const changed = await ackAlert(obj.id, gate.principal.username);
    // 변경 0건은 실패가 아니라 이미 처리됨(L-05)이다.
    return NextResponse.json({ ok: true, acked: changed > 0 });
  }

  if (!hasId && typeof obj.workerId === "string" && obj.workerId.trim()
    && typeof obj.type === "string" && ALERT_TYPES.includes(obj.type as AlertType)) {
    const changed = await ackAlertByKey(obj.workerId, obj.type as AlertType, gate.principal.username);
    return NextResponse.json({ ok: true, acked: changed > 0 });
  }

  return NextResponse.json(
    { ok: false, error: "id or (workerId + type) required" },
    { status: 400 },
  );
}
