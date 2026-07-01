// 클라우드 브릿지 — 캘린더 미디어 다운로드 URL 발급(관리자 인증). attachment 프리사인으로 브라우저 저장 강제.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../../lib/admin-auth";
import { getCalendarMediaById } from "../../../../../lib/db";
import { isStorageConfigured, presignDownloadAttachment } from "../../../../../lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  }
  const row = await getCalendarMediaById(id);
  if (!row) {
    return NextResponse.json({ ok: false, error: "미디어 없음" }, { status: 404 });
  }

  // 저장 파일명 — 제목(있으면) + 확장자(키/URL에서 추출). 확장자 판별 실패 시 미디어타입 기본값.
  const src = row.storage_key ?? row.media_url ?? "";
  const rawExt = src.split(".").pop()?.toLowerCase() ?? "";
  const ext = /^[a-z0-9]{2,5}$/.test(rawExt) ? rawExt : row.media_type === "video" ? "mp4" : "jpg";
  const base = row.title && row.title.trim() ? row.title.trim() : `현장미디어-${row.date_key ?? ""}`;
  const filename = `${base}.${ext}`;

  // Naver 저장분은 attachment 프리사인, 리터럴 media_url(더미/시드)은 그대로 반환.
  if (row.storage_provider === "naver" && row.storage_key) {
    if (!isStorageConfigured()) {
      return NextResponse.json({ ok: false, error: "스토리지 미설정" }, { status: 503 });
    }
    try {
      const url = await presignDownloadAttachment(row.storage_key, filename);
      return NextResponse.json({ ok: true, url, filename });
    } catch {
      return NextResponse.json({ ok: false, error: "다운로드 URL 발급 실패" }, { status: 500 });
    }
  }
  if (row.media_url) {
    return NextResponse.json({ ok: true, url: row.media_url, filename });
  }
  return NextResponse.json({ ok: false, error: "다운로드할 파일 없음" }, { status: 404 });
}
