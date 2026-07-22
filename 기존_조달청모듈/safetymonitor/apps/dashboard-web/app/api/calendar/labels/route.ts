// 일정 캘린더 라벨(이름·색상) 조회·전체교체 API — localStorage 승격(서버 단일 진실 소스)
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
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
  return NextResponse.json({ ok: true, labels });
}

export async function PUT(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
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
