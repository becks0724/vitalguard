// 클라우드 브릿지 — 캘린더 미디어(앱 OCR 이미지/영상) 조회·등록·설명수정·삭제 API (관리자 인증)
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import {
  listCalendarMedia,
  listCommentsForMedia,
  insertCalendarMedia,
  updateCalendarMediaDescription,
  deleteCalendarMedia,
  type CalendarMediaCommentRow,
} from "../../../../lib/db";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
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
  const media = await listCalendarMedia(from, to);
  const comments = await listCommentsForMedia(media.map((m) => m.id));
  const byMedia = new Map<string, CalendarMediaCommentRow[]>();
  for (const c of comments) {
    const list = byMedia.get(c.media_id) ?? [];
    list.push(c);
    byMedia.set(c.media_id, list);
  }
  const withComments = media.map((m) => ({
    ...m,
    comments: byMedia.get(m.id) ?? [],
  }));
  return NextResponse.json({ ok: true, media: withComments });
}

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const dateKey = typeof body.dateKey === "string" ? body.dateKey : "";
  if (!DATE_RE.test(dateKey)) {
    return NextResponse.json(
      { ok: false, error: "dateKey (YYYY-MM-DD) 필요" },
      { status: 400 },
    );
  }
  const row = await insertCalendarMedia({
    id: crypto.randomUUID(),
    dateKey,
    capturedAt: str(body.capturedAt),
    mediaType: str(body.mediaType) ?? "image",
    title: str(body.title),
    storageProvider: str(body.storageProvider),
    storageKey: str(body.storageKey),
    mediaUrl: str(body.mediaUrl),
    thumbnailUrl: str(body.thumbnailUrl),
    ocrText: str(body.ocrText),
    description: str(body.description),
    siteId: str(body.siteId),
    uploader: str(body.uploader),
  });
  return NextResponse.json({ ok: true, media: row });
}

export async function PATCH(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  let body: { id?: unknown; description?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; description?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || typeof body.description !== "string") {
    return NextResponse.json(
      { ok: false, error: "id, description 필요" },
      { status: 400 },
    );
  }
  const ok = await updateCalendarMediaDescription(body.id, body.description);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  }
  const ok = await deleteCalendarMedia(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
