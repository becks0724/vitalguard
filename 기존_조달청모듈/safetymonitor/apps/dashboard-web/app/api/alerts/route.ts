// 알림 이력 조회 + 구획 이탈 기록 — 로그인 세션 토큰 필수(작업자명 포함).
import { NextResponse } from "next/server";
import { readOr503 } from "../../../lib/route-read";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { listAlerts, recordAlert } from "../../../lib/db";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return readOr503("alerts", () => listAlerts(100), (alerts) =>
    NextResponse.json({ ok: true, alerts }, { headers: { "cache-control": "no-store" } }),
  );
}

// 구획 이탈 기록 — 관제 웹이 확정 전이 시 호출(전이당 1건, ts 자연키 dedup).
// SOS/낙상/생체는 서버(addSample)가 기록하므로 클라이언트 기록은 이 1종만 허용(위조 삽입 차단).
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
  if (obj.type !== "geofence") {
    return NextResponse.json(
      { ok: false, error: "type must be geofence" },
      { status: 400 },
    );
  }
  const workerId = String(obj.workerId ?? "").slice(0, 80);
  const ts = String(obj.ts ?? "");
  if (!workerId || Number.isNaN(Date.parse(ts))) {
    return NextResponse.json({ ok: false, error: "workerId and ts required" }, { status: 400 });
  }
  const workerName = obj.workerName ? String(obj.workerName).slice(0, 80) : null;

  await recordAlert({ workerId, workerName, type: obj.type, ts });
  return NextResponse.json({ ok: true });
}
