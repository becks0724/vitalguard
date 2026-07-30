// 일정 캘린더 라벨(이름·색상) 조회·전체교체 API — localStorage 승격(서버 단일 진실 소스)
import { NextResponse } from "next/server";

import { hasAdminMenuAccess, verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, diagnoseAppAuth, mobileUnauthorizedAction, verifyAppJwt } from "../../../../lib/app-jwt";
import { listCalendarLabels, replaceCalendarLabels } from "../../../../lib/db";

export const dynamic = "force-dynamic";

// 클라 8색 팔레트(LABEL_COLOR_ORDER)와 동일 — 라우트는 lib 단일 소스 대신 값 검증만 미러.
const LABEL_COLORS = new Set([
  "red",
  "amber",
  "emerald",
  "blue",
  "violet",
  "pink",
  "cyan",
  "slate",
]);
const MAX_LABELS = 12;

export async function GET(request: Request) {
  if (!verifyBasicAuth(request) && verifyAppJwt(bearerToken(request)) === null) {
    // 401 은 네 가지 실패를 한 응답으로 뭉갠다. 사유는 서버 로그로만 남기고,
    // 응답에는 앱이 스스로 복구 가능한지(action)만 실어 재로그인을 유도한다.
    const d = diagnoseAppAuth(request);
    console.warn(`[calendar/labels] ${d.logLine}`);
    return NextResponse.json({ ok: false, error: "인증 필요", action: d.action }, { status: 401 });
  }
  const labels = await listCalendarLabels();
  // 편집 가능 여부를 서버가 계산해 내려준다 — 화면이 역할을 다시 판정하면 언젠가 어긋난다.
  // 앱 로그인 JWT 로 조회하는 경우는 세션이 없어 false 다(읽기 전용).
  return NextResponse.json({ ok: true, labels, canEdit: await hasAdminMenuAccess(request) });
}

export async function PUT(request: Request) {
  // 라벨은 **전체 교체**다 — 지운 라벨을 쓰던 남의 일정이 조용히 첫 라벨로 밀린다.
  // 일정과 달리 소유자 개념이 없어 작성자 대조가 불가능하므로 부여받은 권한으로 좁힌다.
  //
  // 게이트는 관리자 메뉴와 같은 축(hasAdminMenuAccess) = owner 이거나 owner 가 admin_access 를
  // 부여한 계정. 자가취득이 불가한 기존 플래그라 새 권한 축을 만들지 않는다.
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요", action: mobileUnauthorizedAction(bearerToken(request)) }, { status: 401 });
  }
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "라벨 편집 권한이 없습니다(총괄 관리자에게 요청하세요)" },
      { status: 403 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const raw = body.labels;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_LABELS) {
    return NextResponse.json(
      { ok: false, error: `labels 배열(1~${MAX_LABELS}개) 필요` },
      { status: 400 },
    );
  }
  const labels: { id: string; name: string; color: string }[] = [];
  const seen = new Set<string>();
  for (const l of raw) {
    const id = typeof l?.id === "string" ? l.id.trim() : "";
    const name = typeof l?.name === "string" ? l.name.trim() : "";
    const color = typeof l?.color === "string" ? l.color : "";
    if (!id || id.length > 60 || seen.has(id) || !name || name.length > 40 || !LABEL_COLORS.has(color)) {
      return NextResponse.json(
        { ok: false, error: "라벨 형식 오류(id·name≤40자·8색 팔레트)" },
        { status: 400 },
      );
    }
    seen.add(id);
    labels.push({ id, name, color });
  }
  await replaceCalendarLabels(labels);
  return NextResponse.json({ ok: true, labels });
}
