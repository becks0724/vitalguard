// 일정 캘린더 일정 조회·업서트·삭제 API — localStorage 승격(서버 단일 진실 소스)
import { NextResponse } from "next/server";

import { getSession, verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, diagnoseAppAuth, mobileUnauthorizedAction, verifyAppJwt } from "../../../../lib/app-jwt";
import {
  calendarEventMatchesScope,
  type CalendarEventScope,
} from "../../../../lib/calendar-event-scope";
import {
  deleteCalendarEvent,
  listCalendarEvents,
  upsertCalendarEvent,
} from "../../../../lib/db";
import { HAZARD_TYPE_IDS } from "../../../lib/calendar-hazard";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// 수정·삭제 권한 범위 — 일정을 등록한 본인, 또는 owner(총괄 관리자).
//
// 일정은 관제 웹에서만 등록되므로 사진(lib/media-scope.ts)과 달리 사번 환산이 없다.
// 올리는 쪽과 지우는 쪽이 같은 신원 체계(세션 username)라 그대로 대조한다.
//
// 앱 로그인 JWT 는 조회 전용이다 — 일정을 등록하는 앱 화면이 없으므로 쓰기 범위를 주지 않는다.
// 판정 불가는 항상 거부 쪽이다. "신원 없음 → 범위 없음(전체 허용)"으로 떨어지면 인가 구멍이 된다.
function eventWriteScope(request: Request): CalendarEventScope | null {
  const session = getSession(request);
  if (!session) return null;
  if (session.role === "owner") return "moderator";
  return { createdBy: session.username };
}

// 쓰기가 0행일 때의 응답 — 사진(404 로 덮어 존재를 숨김)과 다르게 간다.
// 일정 목록은 로그인한 전원에게 보이므로 존재를 숨길 실익이 없고, 404 는 사용자가
// "일정이 사라졌나"로 오해한다. 총괄 관리자는 소유권 조건이 아예 없으므로 0행 = 정말 없는 것이다.
function eventWriteDenied(scope: CalendarEventScope, action: string): NextResponse {
  return scope === "moderator"
    ? NextResponse.json({ ok: false, error: "일정을 찾을 수 없습니다" }, { status: 404 })
    : NextResponse.json(
        { ok: false, error: `작성자 또는 총괄 관리자만 일정을 ${action}할 수 있습니다` },
        { status: 403 },
      );
}

export async function GET(request: Request) {
  // 조회 = 대시보드 세션 또는 앱 로그인 JWT — 캘린더 미디어 GET 과 동일 게이트(읽기 전용).
  if (!verifyBasicAuth(request) && verifyAppJwt(bearerToken(request)) === null) {
    // 401 은 네 가지 실패를 한 응답으로 뭉갠다. 사유는 서버 로그로만 남기고,
    // 응답에는 앱이 스스로 복구 가능한지(action)만 실어 재로그인을 유도한다.
    const d = diagnoseAppAuth(request);
    console.warn(`[calendar/events] ${d.logLine}`);
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
  // 항목별 수정·삭제 가능 여부를 서버가 계산해 내려준다 — 화면이 같은 규칙을 다시 구현하면
  // 언젠가 어긋나고, 그때 사용자는 "버튼은 있는데 눌러도 안 된다"를 겪는다(단일 소스).
  const scope = eventWriteScope(request);
  const rows = await listCalendarEvents(from, to);
  const events = rows.map((e) => ({
    ...e,
    canEdit: scope !== null && calendarEventMatchesScope(e.created_by, scope),
  }));
  return NextResponse.json({ ok: true, events });
}

export async function POST(request: Request) {
  // 등록·수정 = 유효 대시보드 세션(로그인 관제자). 수정은 등록 본인·총괄 관리자로 좁힌다.
  const scope = eventWriteScope(request);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "인증 필요", action: mobileUnauthorizedAction(bearerToken(request)) }, { status: 401 });
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
  // 종료 날짜(여러 날 일정). 없거나 시작과 같으면 하루짜리로 본다 — null 로 저장해
  // 기존 행과 같은 모양을 유지한다(화면이 "종료가 있으면 여러 날" 하나로만 판단하게).
  const endRaw = typeof body.endDateKey === "string" ? body.endDateKey.trim() : "";
  if (endRaw && !DATE_RE.test(endRaw)) {
    return NextResponse.json({ ok: false, error: "endDateKey(YYYY-MM-DD) 형식 오류" }, { status: 400 });
  }
  // ⚠ 거꾸로 된 기간은 거부한다 — 받아 두면 화면이 음수 길이 띠를 그리려다 사라진다.
  if (endRaw && endRaw < dateKey) {
    return NextResponse.json({ ok: false, error: "종료일이 시작일보다 빠릅니다" }, { status: 400 });
  }
  const endDateKey = endRaw && endRaw !== dateKey ? endRaw : null;
  // 메모 — 빈 문자열은 null 로. 상한을 둔다(무제한이면 한 행이 응답을 통째로 키운다).
  const noteRaw = typeof body.note === "string" ? body.note.trim() : "";
  if (noteRaw.length > 2000) {
    return NextResponse.json({ ok: false, error: "메모는 2000자 이하" }, { status: 400 });
  }
  const note = noteRaw || null;
  // 위험작업 유형 — 5종 목록 외 값은 거부(빈 문자열·미전송 = 없음).
  const hazardRaw =
    typeof body.hazardType === "string" && body.hazardType.trim()
      ? body.hazardType.trim()
      : null;
  if (hazardRaw !== null && !(HAZARD_TYPE_IDS as string[]).includes(hazardRaw)) {
    return NextResponse.json({ ok: false, error: "hazardType 불명" }, { status: 400 });
  }
  const id =
    typeof body.id === "string" && body.id.trim() && body.id.length <= 80
      ? body.id.trim()
      : crypto.randomUUID();
  const event = await upsertCalendarEvent(
    {
      id,
      dateKey,
      title,
      labelId,
      startTime: timeOf(body.startTime),
      endTime: timeOf(body.endTime),
      endDateKey,
      note,
      hazardType: hazardRaw,
      createdBy: getSession(request)?.username ?? null,
    },
    scope,
  );
  // 반환 행이 없다 = 이미 있는 id 인데 남의 일정이다(신규 INSERT 는 충돌이 없어 항상 반환된다).
  if (!event) return eventWriteDenied(scope, "수정");
  return NextResponse.json({ ok: true, event: { ...event, canEdit: true } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const scope = eventWriteScope(request);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  }
  const removed = await deleteCalendarEvent(id, scope);
  if (!removed) return eventWriteDenied(scope, "삭제");
  return NextResponse.json({ ok: true });
}
