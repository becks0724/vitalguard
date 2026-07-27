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
  findUserByUsername,
  getWorkerAliasMap,
  type CalendarMediaCommentRow,
} from "../../../../lib/db";
import {
  mediaMatchesScope,
  workerIdGroup,
  type MediaScope,
} from "../../../../lib/media-scope";
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
  // 항목별 삭제 가능 여부를 서버가 계산해 내려준다 — 화면이 같은 규칙을 다시 구현하면
  // 언젠가 어긋나고, 그때 사용자는 "버튼은 있는데 눌러도 안 된다"를 겪는다(단일 소스).
  const scope = await mediaWriteScope(request);
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
      return {
        ...m,
        media_url: mediaUrl,
        comments: byMedia.get(m.id) ?? [],
        canDelete: scope !== null && mediaMatchesScope(m.worker_id, scope),
      };
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
  // 삭제와 같은 소유권 규칙 — 남의 사진 설명을 고치는 것도 같은 계열의 IDOR 이다.
  const scope = await mediaWriteScope(request);
  if (!scope) return mediaWriteDenied(request, "수정");
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
  // 남의 사진이면 rowCount 0 → 404(삭제와 동일하게 존재 여부를 흘리지 않는다).
  const ok = await updateCalendarMediaDescription(body.id, body.description, scope);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

// 수정·삭제 권한 범위 — 사진을 올린 작업자 본인, 또는 owner(최고관리자).
//
// 올리는 쪽과 지우는 쪽의 신원 체계가 달라 두 갈래를 각각 사번으로 환산한다.
//  · 앱 JWT    = 클레임의 사번(workerId)을 그대로 쓴다.
//  · 관제 세션 = owner 면 전체 허용. 그 외에는 로그인 ID 로 users 를 찾아 **사번(employee_id)**을 얻는다.
//    관제 로그인 ID(admin6861)와 사진에 박히는 사번(EMP-admin6861)이 다르기 때문이다.
//    이 환산을 빼면 **자기가 올린 사진도 못 지운다** — 실제로 그 증상으로 제보가 들어왔다.
//
// 얻은 사번은 병합(worker_alias) 그룹으로 넓힌다. 같은 사람이 폰·워치에서 다른 ID 로 들어오고
// 관제 웹의 "작업자 ID 병합"이 이를 하나로 합치므로, 어느 ID 로 올렸든 본인 것이어야 한다.
//
// 판정 불가는 항상 거부 쪽이다 — "신원 없음 → 범위 없음(전체 허용)"으로 떨어지면 인가 구멍이 된다.
// PATCH(설명 수정)와 DELETE 가 같은 함수를 쓴다. 규칙이 갈리면 한쪽만 고쳐지는 실수가 난다.
async function mediaWriteScope(request: Request): Promise<MediaScope | null> {
  // 앱 JWT 를 먼저 본다. 작업자 앱은 세션 쿠키가 아니라 Bearer JWT 로만 인증한다.
  const claims = verifyAppJwt(bearerToken(request));
  if (claims?.role === "owner") return "moderator";
  const jwtWorkerId = claims?.workerId?.trim();
  if (jwtWorkerId) {
    return { workerIds: workerIdGroup(jwtWorkerId, await getWorkerAliasMap()) };
  }

  // 관제 웹 세션.
  const session = getSession(request);
  if (!session) return null;
  if (session.role === "owner") return "moderator";

  // env owner 가 아닌 가입 관리자 — 로그인 ID → 사번 환산. 사번이 없으면 대조할 것이 없어 거부.
  const user = await findUserByUsername(session.username);
  const employeeId = user?.employee_id?.trim();
  if (!employeeId) return null;
  return { workerIds: workerIdGroup(employeeId, await getWorkerAliasMap()) };
}

// 권한 없음 응답 — 로그인 자체가 없으면 401, 로그인은 했지만 남의 사진이면 403 으로 나눈다.
// "로그인이 안 됐나"와 "권한이 없나"는 사용자가 할 일이 다르므로 구별해서 알려준다.
function mediaWriteDenied(request: Request, action: string): NextResponse {
  const authenticated =
    verifyBasicAuth(request) || verifyAppJwt(bearerToken(request)) !== null;
  return authenticated
    ? NextResponse.json(
        { ok: false, error: `본인이 올린 사진만 ${action}할 수 있습니다` },
        { status: 403 },
      )
    : NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
}

export async function DELETE(request: Request) {
  const scope = await mediaWriteScope(request);
  if (!scope) return mediaWriteDenied(request, "삭제");
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
