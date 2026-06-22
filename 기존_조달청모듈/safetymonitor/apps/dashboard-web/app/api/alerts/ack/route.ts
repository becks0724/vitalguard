// 알림 대응 확인(ack) — 미대응 알림에 대응자·시각 기록. 로그인 세션 토큰 필수.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { ackAlert } from "../../../../lib/db";

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

  const id =
    typeof body === "object" && body !== null && "id" in body
      ? Number((body as { id: unknown }).id)
      : NaN;
  const ackBy =
    typeof body === "object" && body !== null && "ackBy" in body
      ? String((body as { ackBy: unknown }).ackBy ?? "").slice(0, 40)
      : "";

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const changed = await ackAlert(id, ackBy || "관제자");
  return NextResponse.json({ ok: true, acked: changed > 0 });
}
