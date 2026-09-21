// 캘린더 표시본(잉크 주석) JSON — 같은 오리진으로 내려준다(관리자 인증).
// 왜 프리사인이 아니라 서버 경유인가(2026-09-21 실측):
//   스토리지 프리사인 GET 은 서버에서 부르면 200·본문 정상인데 응답에
//   Access-Control-Allow-Origin 이 없다 → 브라우저의 cross-origin fetch 는 Failed to fetch,
//   XHR 은 status 0 으로 끊긴다. 사진은 <img> 로 그려서 CORS 가 필요 없었고, 표시본만
//   fetch 로 JSON 을 읽어야 해서 이 경로에서만 터졌다.
// 다운로드(⬇)는 브라우저 네비게이션이라 CORS 가 필요 없다 — download-url 경로는 그대로 둔다.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../../lib/admin-auth";
import { getCalendarMediaById } from "../../../../../lib/db";
import { getObjectText, isStorageConfigured } from "../../../../../lib/storage";

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
  if (row.storage_provider !== "naver" || !row.storage_key) {
    return NextResponse.json({ ok: false, error: "표시 파일 없음" }, { status: 404 });
  }
  if (!isStorageConfigured()) {
    return NextResponse.json({ ok: false, error: "스토리지 미설정" }, { status: 503 });
  }

  let text: string;
  try {
    text = await getObjectText(row.storage_key);
  } catch {
    return NextResponse.json({ ok: false, error: "표시 파일 조회 실패" }, { status: 502 });
  }
  try {
    JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "표시 파일 형식 오류" }, { status: 502 });
  }

  // 스토리지 원본 JSON 을 그대로 전달한다 — InkOverlay 가 파일 형식을 그대로 읽는다.
  return new NextResponse(text, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
