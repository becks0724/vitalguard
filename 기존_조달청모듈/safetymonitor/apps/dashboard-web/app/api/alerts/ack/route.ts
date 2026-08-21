// 알림 대응 확인(ack) — 미대응 알림에 대응자·시각 기록. 로그인 세션 토큰 필수.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import type { AlertType } from "../../../../lib/alert-type";
import { ackAlert, ackAlertByKey } from "../../../../lib/db";

const ALERT_TYPES: AlertType[] = ["sos", "fall", "vital", "geofence", "danger_zone"];

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const ackBy = String(obj.ackBy ?? "").slice(0, 40) || "관제자";

  // 자연키(작업자·종류) — 알림 팝업의 '확인' 버튼용(id 를 모름). id 방식보다 우선 검사.
  const workerId = "workerId" in obj ? String(obj.workerId ?? "").slice(0, 80) : "";
  const type = "type" in obj ? String(obj.type ?? "") : "";
  if (workerId && ALERT_TYPES.includes(type as AlertType)) {
    const changed = await ackAlertByKey(workerId, type as AlertType, ackBy);
    return NextResponse.json({ ok: true, acked: changed > 0 });
  }

  const id = "id" in obj ? Number(obj.id) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { ok: false, error: "id or (workerId + type) required" },
      { status: 400 },
    );
  }

  const changed = await ackAlert(id, ackBy);
  return NextResponse.json({ ok: true, acked: changed > 0 });
}
