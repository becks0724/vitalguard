// 클라우드 브릿지 — R2 프리사인 업로드 URL 발급(관리자 인증). 클라가 받은 URL로 직접 PUT 후 등록 API(/api/calendar/media POST) 호출.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../../lib/admin-auth";
import { isR2Configured, presignUpload } from "../../../../../lib/storage";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 허용 콘텐츠타입 → 확장자(이미지/영상만). 임의 타입 업로드 차단.
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  if (!isR2Configured()) {
    return NextResponse.json({ ok: false, error: "스토리지(R2) 미설정" }, { status: 503 });
  }
  let body: { contentType?: unknown; dateKey?: unknown };
  try {
    body = (await request.json()) as { contentType?: unknown; dateKey?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    return NextResponse.json(
      { ok: false, error: "지원하지 않는 contentType (이미지/영상만)" },
      { status: 400 },
    );
  }
  // 날짜 프리픽스(있으면) + UUID 키 — 날짜 폴더로 정리, 충돌 없음. 등록 API 에 이 key 를 storageKey 로 전달.
  const dateKey =
    typeof body.dateKey === "string" && DATE_RE.test(body.dateKey) ? body.dateKey : "undated";
  const key = `calendar-media/${dateKey}/${crypto.randomUUID()}.${ext}`;
  try {
    const uploadUrl = await presignUpload(key, contentType);
    return NextResponse.json({ ok: true, provider: "r2", key, uploadUrl });
  } catch {
    return NextResponse.json({ ok: false, error: "프리사인 발급 실패" }, { status: 500 });
  }
}
