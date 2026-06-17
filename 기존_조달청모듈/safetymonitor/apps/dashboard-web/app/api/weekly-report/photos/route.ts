// 사진대지 업로드 — POST(multipart: contractId + photos[]) 파일 저장 + 매수 반환 / GET 매수 조회.
import { NextResponse } from "next/server";

import { savePhotos, countPhotos } from "../../../lib/photo-store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const contractId = String(form.get("contractId") ?? "");
    if (!contractId) {
      return NextResponse.json({ error: { code: "BAD", message: "contractId가 필요합니다" } }, { status: 400 });
    }
    const files = form.getAll("photos").filter((f): f is File => f instanceof File);
    const count = await savePhotos(contractId, files);
    return NextResponse.json({ ok: true, uploaded: files.length, count });
  } catch (err) {
    console.error("[api/weekly-report/photos]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "업로드 실패" } }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contractId") ?? "";
  return NextResponse.json({ count: contractId ? countPhotos(contractId) : 0 });
}
