// 사고(산업재해) 등록·목록 API — 조사 뷰 앵커 + 사고 구간 3년 보존 마킹의 원장(관리자 전용)
import { NextResponse } from "next/server";
import { canonicalIsoMs } from "@safetymonitor/schemas";

import { hasAdminMenuAccess } from "../../../../lib/admin-auth";
import { insertIncident, listIncidents } from "../../../../lib/db";

// vital 스키마의 workerId 규칙과 동일 — 로그·CSV 에 그대로 들어가는 값이라 문자셋을 제한한다.
const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const NOTE_MAX = 500;

export async function GET(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, incidents: await listIncidents() });
  } catch (e) {
    console.error("[incidents] 목록 조회 실패", e);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON 본문이 필요합니다." }, { status: 400 });
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const workerId = typeof b.workerId === "string" ? b.workerId.trim() : "";
  const occurredAtRaw = typeof b.occurredAt === "string" ? b.occurredAt : "";
  const note = typeof b.note === "string" ? b.note.trim() : "";

  if (!WORKER_ID_RE.test(workerId)) {
    return NextResponse.json({ ok: false, error: "workerId 형식 오류" }, { status: 400 });
  }
  const occurredMs = Date.parse(occurredAtRaw);
  if (Number.isNaN(occurredMs)) {
    return NextResponse.json({ ok: false, error: "occurredAt(ISO 시각) 필수" }, { status: 400 });
  }
  // 미래 시각 방지(시계 오차 5분 허용) — 사고는 과거 사건이다.
  if (occurredMs > Date.now() + 5 * 60_000) {
    return NextResponse.json({ ok: false, error: "미래 시각은 등록할 수 없습니다." }, { status: 400 });
  }
  if (note.length > NOTE_MAX) {
    return NextResponse.json({ ok: false, error: `메모는 ${NOTE_MAX}자 이하` }, { status: 400 });
  }

  try {
    const incident = await insertIncident({
      workerId,
      occurredAt: canonicalIsoMs(occurredAtRaw),
      note: note || null,
    });
    return NextResponse.json({ ok: true, incident }, { status: 201 });
  } catch (e) {
    console.error("[incidents] 등록 실패", e);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 503 });
  }
}
