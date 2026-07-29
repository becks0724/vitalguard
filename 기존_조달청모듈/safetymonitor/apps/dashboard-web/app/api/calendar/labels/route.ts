// 일정 캘린더 라벨(이름·색상) 조회·전체교체 API — localStorage 승격(서버 단일 진실 소스)
import { NextResponse } from "next/server";

import { verifyBasicAuth, verifyOwner } from "../../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
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
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const labels = await listCalendarLabels();
  // 편집 가능 여부를 서버가 계산해 내려준다 — 화면이 role 을 다시 판정하면 언젠가 어긋난다.
  // 앱 로그인 JWT 로 조회하는 경우는 읽기 전용이므로 false 다.
  return NextResponse.json({ ok: true, labels, canEdit: verifyOwner(request) });
}

export async function PUT(request: Request) {
  // 라벨은 **전체 교체**다 — 지운 라벨을 쓰던 남의 일정이 조용히 첫 라벨로 밀린다.
  // 일정과 달리 소유자 개념이 없어 작성자 대조가 불가능하므로 총괄 관리자(owner) 전용으로 둔다.
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  if (!verifyOwner(request)) {
    return NextResponse.json(
      { ok: false, error: "라벨 편집은 총괄 관리자만 가능합니다" },
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
