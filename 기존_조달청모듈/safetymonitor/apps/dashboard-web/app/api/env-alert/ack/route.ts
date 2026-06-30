// 현장 환경 경보 확인/조치 기록 — 로그인 세션 토큰 필수. 매 확인/조치마다 감사 이력 1건(append-only).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { listEnvAlertAck, recordEnvAlertAck } from "../../../../lib/db";

function field(body: unknown, key: string, max: number): string {
  if (typeof body === "object" && body !== null && key in body) {
    return String((body as Record<string, unknown>)[key] ?? "").slice(0, max);
  }
  return "";
}

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

  const itemKey = field(body, "itemKey", 60);
  const itemLabel = field(body, "itemLabel", 60);
  const severity = field(body, "severity", 16);
  const status = field(body, "status", 16);
  const value = field(body, "value", 60) || null;
  const note = field(body, "note", 200) || null;
  const ackBy = field(body, "ackBy", 40) || "관제자";

  if (!itemKey || !severity || (status !== "확인" && status !== "조치완료")) {
    return NextResponse.json(
      { ok: false, error: "itemKey/severity/status('확인'|'조치완료') required" },
      { status: 400 },
    );
  }

  await recordEnvAlertAck({ itemKey, itemLabel, value, severity, status, note, ackBy });
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const acks = await listEnvAlertAck(100);
  return NextResponse.json({ ok: true, acks });
}
