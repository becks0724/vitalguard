// 사진대지 업로드 — POST(multipart: contractId + photos[]) 파일 저장 + 매수 반환 / GET 매수 조회.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { savePhotos, countPhotos } from "../../../lib/photo-store";

export const dynamic = "force-dynamic";

// 업로드 방어 — 무인증·무제한 파일 쓰기(각 arrayBuffer 전량 버퍼)는 디스크·메모리 DoS. 세션 게이트 +
// 이미지 content-type 허용 + 파일당 크기·개수 상한(버퍼링 전에 File.size/type 으로 선차단).
const MAX_PHOTOS = 20;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 파일당 10MB

export async function POST(req: Request) {
  if (!verifyBasicAuth(req)) {
    return NextResponse.json({ error: { code: "UNAUTH", message: "인증이 필요합니다" } }, { status: 401 });
  }
  try {
    const form = await req.formData();
    const contractId = String(form.get("contractId") ?? "");
    if (!contractId) {
      return NextResponse.json({ error: { code: "BAD", message: "contractId가 필요합니다" } }, { status: 400 });
    }
    const files = form.getAll("photos").filter((f): f is File => f instanceof File);
    if (files.length > MAX_PHOTOS) {
      return NextResponse.json({ error: { code: "TOO_MANY", message: `한 번에 최대 ${MAX_PHOTOS}장` } }, { status: 400 });
    }
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        return NextResponse.json({ error: { code: "BAD_TYPE", message: "이미지 파일만 업로드할 수 있습니다" } }, { status: 400 });
      }
      if (f.size > MAX_PHOTO_BYTES) {
        return NextResponse.json({ error: { code: "TOO_LARGE", message: "파일당 10MB 이하만 가능합니다" } }, { status: 413 });
      }
    }
    const count = await savePhotos(contractId, files);
    return NextResponse.json({ ok: true, uploaded: files.length, count });
  } catch (err) {
    console.error("[api/weekly-report/photos]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "업로드 실패" } }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!verifyBasicAuth(req)) {
    return NextResponse.json({ error: { code: "UNAUTH", message: "인증이 필요합니다" } }, { status: 401 });
  }
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contractId") ?? "";
  return NextResponse.json({ count: contractId ? countPhotos(contractId) : 0 });
}
