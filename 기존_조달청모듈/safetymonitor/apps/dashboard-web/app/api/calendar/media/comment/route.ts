// 클라우드 브릿지 — 미디어 댓글 추가/수정/삭제. 작성자는 인증 주체(이름·사번 대용 username)에서 도출.
//
// ★ 관제 세션과 **작업자 앱 JWT** 를 둘 다 받는다(2026-08-20). 앱 OCR 탭에서 남긴 설명이
//   관제웹의 같은 사진 댓글 스레드에 그대로 뜨고, 관리자가 거기서 답글을 단다.
// ★ 두 경로가 **같은 식별자**를 쓴다 — 앱 JWT 의 `sub` 가 곧 관제 로그인 ID(username)다
//   (`lib/app-login.ts` AppPrincipal). 그래서 기존 댓글(author_id=username)과 섞여도
//   본인 판정이 갈리지 않고, 앱에서 쓴 댓글을 관제웹에서 고칠 수 있다.
// ⚠ 사번(workerId)을 author_id 로 쓰면 안 된다 — 관제는 `admin6861`, 앱 사번은 `EMP-6861`
//   이라 같은 사람이 두 사람으로 갈리고, 자기 댓글을 자기가 못 고치게 된다(미디어 삭제에서
//   실제로 그 증상이 제보된 적 있다 · `calendar/media/route.ts` mediaWriteScope 주석).
import { NextResponse } from "next/server";

import { verifyBasicAuth, getSession } from "../../../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../../../lib/app-jwt";
import {
  insertCalendarMediaComment,
  updateCalendarMediaComment,
  deleteCalendarMediaComment,
  findUserByUsername,
  getOwnerProfile,
  type CommentScope,
} from "../../../../../lib/db";

export const dynamic = "force-dynamic";

// 세션 → 작성자 표시정보(이름·직책·식별자·역할). 가입 사용자는 users.name/job_title,
// env 관리자(owner)는 users 행이 없어 '내 정보'(owner_profile)에 등록한 값을 쓴다.
// author_id 는 사번 대용 username.
// 인증 주체 — 앱 JWT 우선, 없으면 관제 세션, 그것도 없으면 env Basic 자격(종전 동작).
// 판정 불가는 null 이고 호출부가 401 을 낸다.
function principal(request: Request): { username: string; role: string } | null {
  const claims = verifyAppJwt(bearerToken(request));
  if (claims?.sub) return { username: claims.sub, role: claims.role };
  const session = getSession(request);
  if (session) return { username: session.username, role: session.role };
  // 세션 없이 Basic 자격만으로 오는 관리자 호출 — 종전 기본값을 그대로 둔다.
  if (verifyBasicAuth(request)) return { username: "admin", role: "owner" };
  return null;
}

/** 인증 게이트 — 세션·Basic·앱 JWT 중 하나. */
function authed(request: Request): boolean {
  return principal(request) !== null;
}

async function resolveAuthor(request: Request) {
  const who = principal(request);
  const username = who?.username ?? "admin";
  const role = who?.role ?? "owner";
  if (role === "owner") {
    // 미등록이면 종전 기본값 — 등록해 둔 이름·직책이 있는데 "시스템 관리자"로 찍으면 그게 틀린 표기다.
    const p = await getOwnerProfile(username).catch(() => null);
    return {
      authorName: p?.name ?? "관리자",
      authorId: username,
      authorRole: role,
      authorTitle: p?.job_title ?? "시스템 관리자",
    };
  }
  let user = null;
  try {
    user = await findUserByUsername(username);
  } catch {
    user = null;
  }
  // 여기는 owner 가 아닌 경로만 온다(위에서 반환) — 이름 미등록이면 아이디로 표시.
  return {
    authorName: user?.name ?? username,
    authorId: username,
    authorRole: role,
    authorTitle: user?.job_title ?? null,
  };
}

export async function POST(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
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

// 수정·삭제 권한 범위 — 작성자 본인만. owner(env 관리자)는 모더레이션 목적으로 전체 허용.
// 세션이 없으면 null 을 돌려 호출부가 401 을 내게 한다. "세션 없음 → 범위 없음(전체 허용)"으로
// 떨어지면 인가 구멍이 되므로, 판정 불가는 항상 거부 쪽이다(안전한 실패 방향).
function commentScope(request: Request): CommentScope | null {
  const who = principal(request);
  if (!who) return null;
  if (who.role === "owner") return "moderator";
  const authorId = who.username.trim();
  if (!authorId) return null;
  return { authorId };
}

export async function PATCH(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const scope = commentScope(request);
  if (!scope) {
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
  // 남의 댓글이면 rowCount 0 → 404. "없음"과 "권한 없음"을 같은 응답으로 묶어
  // 댓글 id 존재 여부가 새어나가지 않게 한다.
  const ok = await updateCalendarMediaComment(id, text, scope);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: Request) {
  if (!authed(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const scope = commentScope(request);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  }
  const ok = await deleteCalendarMediaComment(id, scope);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
