// 클라우드 브릿지 — 캘린더 미디어(앱 OCR 이미지/영상) 조회·등록·설명수정·삭제 API (관리자 인증)
import { NextResponse } from "next/server";

import { getSession, verifyAppUploadToken, verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
import {
  listCalendarMedia,
  listCommentsForMedia,
  insertCalendarMedia,
  updateCalendarMediaDescription,
  deleteCalendarMedia,
  type CalendarMediaCommentRow,
  type MediaScope,
} from "../../../../lib/db";
import { isStorageConfigured, presignDownload } from "../../../../lib/storage";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function GET(request: Request) {
  // 조회 = 대시보드 세션 또는 앱 로그인 JWT(owner/admin/worker) 수용 — 현장 앱이 캘린더 미디어를 표시.
  // 등록(POST)/수정(PATCH)/삭제(DELETE)는 기존 인증 유지(POST 는 앱 업로드 토큰 병행).
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
  const media = await listCalendarMedia(from, to);
  const comments = await listCommentsForMedia(media.map((m) => m.id));
  const byMedia = new Map<string, CalendarMediaCommentRow[]>();
  for (const c of comments) {
    const list = byMedia.get(c.media_id) ?? [];
    list.push(c);
    byMedia.set(c.media_id, list);
  }
  // 비공개 Object Storage 저장분(storage_provider=naver + storage_key)은 표시 시점에 만료형 GET URL 발급.
  // 발급 실패 시 기존 media_url 유지(렌더 깨짐 방지). 리터럴 media_url(더미/시드)은 그대로.
  const storageOn = isStorageConfigured();
  const withComments = await Promise.all(
    media.map(async (m) => {
      let mediaUrl = m.media_url;
      if (storageOn && m.storage_provider === "naver" && m.storage_key) {
        try {
          mediaUrl = await presignDownload(m.storage_key);
        } catch {
          /* 발급 실패 — 기존 media_url 유지 */
        }
      }
      return { ...m, media_url: mediaUrl, comments: byMedia.get(m.id) ?? [] };
    }),
  );
  return NextResponse.json({ ok: true, media: withComments });
}

export async function POST(request: Request) {
  // 관리자 세션(대시보드) 또는 앱 업로드 토큰(현장 단말 등록) 중 하나면 허용.
  if (!verifyBasicAuth(request) && !verifyAppUploadToken(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
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
    workerId: str(body.workerId),
    latitude: num(body.latitude),
    longitude: num(body.longitude),
    roadAddress: str(body.roadAddress),
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

// 삭제 권한 범위 — 사진을 올린 작업자 본인, 또는 owner(최고관리자).
// 올리는 쪽과 지우는 쪽의 신원 체계가 다르므로 두 갈래를 각각 판정한다.
//  · 앱 JWT      = 현장 작업자. 사번(workerId)이 업로드 시 저장된 worker_id 와 같을 때만.
//  · 관제 세션   = owner 만 전체 허용(잘못 올라온 사진 정리). 일반 admin 은 자기 것이 아니므로 불가.
// 판정 불가는 항상 거부 쪽이다 — "신원 없음 → 범위 없음(전체 허용)"으로 떨어지면 인가 구멍이 된다.
function mediaDeleteScope(request: Request): MediaScope | null {
  // 앱 JWT 를 먼저 본다. 작업자 앱은 세션 쿠키가 아니라 Bearer JWT 로만 인증한다.
  const claims = verifyAppJwt(bearerToken(request));
  const workerId = claims?.workerId?.trim();
  if (workerId) return { workerId };

  // 관제 웹 세션.
  const session = getSession(request);
  if (session?.role === "owner") return "moderator";

  return null;
}

export async function DELETE(request: Request) {
  const scope = mediaDeleteScope(request);
  if (!scope) {
    // 로그인 자체가 없으면 401, 로그인은 했지만 권한이 없으면 403 으로 나눈다.
    // 일반 관리자가 남의 사진을 지우려 한 경우가 후자다 — 안내 문구가 달라야 한다.
    const authenticated = verifyBasicAuth(request) || verifyAppJwt(bearerToken(request)) !== null;
    return authenticated
      ? NextResponse.json(
          { ok: false, error: "본인이 올린 사진만 삭제할 수 있습니다" },
          { status: 403 },
        )
      : NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  }
  // 남의 사진이면 rowCount 0 → 404. "없음"과 "권한 없음"을 같은 응답으로 묶어
  // 사진 id 존재 여부가 새어나가지 않게 한다.
  const ok = await deleteCalendarMedia(id, scope);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
