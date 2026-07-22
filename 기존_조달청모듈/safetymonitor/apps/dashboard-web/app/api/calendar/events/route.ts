// 일정 캘린더 일정 조회·업서트·삭제 API — localStorage 승격(서버 단일 진실 소스)
import { NextResponse } from "next/server";

import { getSession, verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
import {
  deleteCalendarEvent,
  listCalendarEvents,
  upsertCalendarEvent,
} from "../../../../lib/db";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export async function GET(request: Request) {
  // 조회 = 대시보드 세션 또는 앱 로그인 JWT — 캘린더 미디어 GET 과 동일 게이트(읽기 전용).
  if (!verifyBasicAuth(request) && verifyAppJwt(bearerToken(request)) === null) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { ok: false, error: "from/to (YYYY-MM-DD) 필요" },
      { status: 400 },
    );
  }
  const events = await listCalendarEvents(from, to);
  return NextResponse.json({ ok: true, events });
}

export async function POST(request: Request) {
  // 등록·수정 = 유효 대시보드 세션(로그인 관제자) — 기존 localStorage 시절 UX 와 동일 범위.
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const dateKey = typeof body.dateKey === "string" ? body.dateKey : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const labelId = typeof body.labelId === "string" ? body.labelId.trim() : "";
  if (!DATE_RE.test(dateKey) || !title || title.length > 120 || !labelId || labelId.length > 60) {
    return NextResponse.json(
      { ok: false, error: "dateKey(YYYY-MM-DD)·title(≤120자)·labelId 필요" },
      { status: 400 },
    );
  }
  const timeOf = (v: unknown): string | null =>
    typeof v === "string" && TIME_RE.test(v) ? v : null;
  const id =
    typeof body.id === "string" && body.id.trim() && body.id.length <= 80
      ? body.id.trim()
      : crypto.randomUUID();
  const event = await upsertCalendarEvent({
    id,
    dateKey,
    title,
    labelId,
    startTime: timeOf(body.startTime),
    endTime: timeOf(body.endTime),
    createdBy: getSession(request)?.username ?? null,
  });
  return NextResponse.json({ ok: true, event }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  }
  const removed = await deleteCalendarEvent(id);
  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
