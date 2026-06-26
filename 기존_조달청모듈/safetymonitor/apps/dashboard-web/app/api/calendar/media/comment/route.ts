// 클라우드 브릿지 — 미디어 댓글 추가/수정/삭제. 작성자는 인증 세션(이름·사번 대용 username)에서 도출.
import { NextResponse } from "next/server";

import { verifyBasicAuth, getSession } from "../../../../../lib/admin-auth";
import {
  insertCalendarMediaComment,
  updateCalendarMediaComment,
  deleteCalendarMediaComment,
  findUserByUsername,
} from "../../../../../lib/db";

export const dynamic = "force-dynamic";

// 세션 → 작성자 표시정보(이름·식별자·역할). 가입 사용자는 users.name, env 관리자는 "관리자".
async function resolveAuthor(request: Request) {
  const session = getSession(request);
  const username = session?.username ?? "admin";
  const role = session?.role ?? "owner";
  let name: string | null = null;
  try {
    const user = await findUserByUsername(username);
    name = user?.name ?? null;
  } catch {
    name = null;
  }
  return {
    authorName: name ?? (role === "owner" ? "관리자" : username),
    authorId: username,
    authorRole: role,
  };
}

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  let body: { mediaId?: unknown; body?: unknown };
  try {
    body = (await request.json()) as { mediaId?: unknown; body?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!mediaId || !text) {
    return NextResponse.json({ ok: false, error: "mediaId, body 필요" }, { status: 400 });
  }
  const author = await resolveAuthor(request);
  const comment = await insertCalendarMediaComment({
    id: crypto.randomUUID(),
    mediaId,
    body: text,
    ...author,
  });
  return NextResponse.json({ ok: true, comment });
}

export async function PATCH(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  let body: { id?: unknown; body?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; body?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!id || !text) {
    return NextResponse.json({ ok: false, error: "id, body 필요" }, { status: 400 });
  }
  const ok = await updateCalendarMediaComment(id, text);
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
  const ok = await deleteCalendarMediaComment(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
