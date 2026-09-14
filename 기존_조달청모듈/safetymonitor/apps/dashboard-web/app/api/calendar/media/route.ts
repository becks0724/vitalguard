// 클라우드 브릿지 — 캘린더 미디어(앱 OCR 이미지/영상) 조회·설명수정·삭제 API (관리자 인증)
//
// ★ 등록(POST)·프리사인 업로드 다리는 2026-08-21 철거됐다(docs/seam-contracts/findings.md H).
//   레포 안 호출자 0 + 프로덕션 30일 성공 호출 0 실측 — 게다가 등록이 임의 storageKey 를
//   무검증 수용해 깨진 참조·남의 key 재등록 통로였다. 업로드는 앱 경로(/api/app-media)가
//   서버 안에서 putObject+insert 를 한 호출로 처리한다 — 그쪽이 유일한 등록 경로다.
import { NextResponse } from "next/server";

import { getSession, verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, diagnoseAppAuth, verifyAppJwt } from "../../../../lib/app-jwt";
import {
  listCalendarMedia,
  listCommentsForMedia,
  updateCalendarMediaDescription,
  deleteCalendarMedia,
  MEDIA_DELETE_WINDOW_MIN,
  findUserByUsername,
  getWorkerAliasMap,
  type CalendarMediaCommentRow,
} from "../../../../lib/db";
import {
  mediaMatchesScope,
  workerIdGroup,
  type MediaScope,
} from "../../../../lib/media-scope";
import { deleteObject, isStorageConfigured, presignDownload } from "../../../../lib/storage";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  // 조회 = 대시보드 세션 또는 앱 로그인 JWT(owner/admin/worker) 수용 — 현장 앱이 캘린더 미디어를 표시.
  // 수정(PATCH)/삭제(DELETE)는 소유권 규칙(mediaWriteScope). 등록은 이 라우트에 없다(헤더 주석).
  if (!verifyBasicAuth(request) && verifyAppJwt(bearerToken(request)) === null) {
    // 401 은 네 가지 실패를 한 응답으로 뭉갠다. 사유는 서버 로그로만 남기고,
    // 응답에는 앱이 스스로 복구 가능한지(action)만 실어 재로그인을 유도한다.
    const d = diagnoseAppAuth(request);
    console.warn(`[calendar/media] ${d.logLine}`);
    return NextResponse.json({ ok: false, error: "인증 필요", action: d.action }, { status: 401 });
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
  // 음성도 비공개 객체이므로 조회할 때 URL을 발급한다. 글 댓글·시간순 목록은 그대로다.
  await Promise.all(comments.map(async (c) => {
    if (!storageOn || !c.audio_storage_key) return;
    try {
      c.audio_url = await presignDownload(c.audio_storage_key);
    } catch {
      /* 발급 실패 — 기존 audio_url 유지 */
    }
  }));
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
        canDelete: !m.deleteWindowExpired && scope !== null && mediaMatchesScope(m.worker_id, scope),
      };
    }),
  );
  return NextResponse.json({ ok: true, media: withComments });
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
  // 남의 사진이면 not_found → 404. "없음"과 "권한 없음"을 같은 응답으로 묶어
  // 사진 id 존재 여부가 새어나가지 않게 한다.
  const result = await deleteCalendarMedia(id, scope);
  if (result.status === "not_found") return NextResponse.json({ ok: false }, { status: 404 });
  if (result.status === "delete_window_expired") {
    return NextResponse.json(
      { ok: false, code: "MEDIA_DELETE_WINDOW_EXPIRED", error: `삭제 유예 시간(${MEDIA_DELETE_WINDOW_MIN}분)이 지났습니다` },
      { status: 403 },
    );
  }

  // ★ 행을 지운 **뒤에** 파일을 지운다. 순서를 뒤집으면 권한이 없어 행이 안 지워진 경우에도
  //   파일만 사라진다 — 남의 증빙을 파괴한다.
  // ⚠ 파일 삭제 실패는 삭제 자체의 실패가 아니다. 여기서 500 을 내면 사용자는 "안 지워졌다" 로
  //   읽고 다시 누르는데 행은 이미 없어 404 를 받는다. 남는 파일은 고아이므로 로그로 남긴다.
  //   (실측 2026-08-20 — 이 삭제가 파일을 안 지워 고아 4개·21.2MB 가 이미 쌓여 있었다.)
  const storageOn = isStorageConfigured();
  for (const deleted of result.files) {
    if (deleted.storageProvider !== "naver" || !deleted.storageKey || !storageOn) continue;
    try {
      await deleteObject(deleted.storageKey);
    } catch (e) {
      console.warn(
        `[calendar/media] 버킷 객체 삭제 실패 — 고아로 남는다 key=${deleted.storageKey} ${String(e)}`,
      );
    }
  }
  return NextResponse.json({ ok: true });
}
