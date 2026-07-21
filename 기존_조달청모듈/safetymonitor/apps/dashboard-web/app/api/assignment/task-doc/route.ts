// 현장 과업지시서(배치 어시스턴트 태깅 소스) — 조회(GET)=로그인 세션, 저장(POST=PDF 업로드)=관리자 권한만.
// 텍스트 직접 입력은 위변조 우려로 미수용: PDF 원본 업로드 → 서버 텍스트 추출 → 태깅 → 저장.
// 업로드 원본의 파일명·SHA-256 을 함께 기록해 감사 시 원본 문서와 대조할 수 있다.
import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getSession, hasAdminMenuAccess, verifyBasicAuth } from "../../../../lib/admin-auth";
import { getLatestSiteTaskDoc, setSiteTaskDoc } from "../../../../lib/db";
import { extractPdfText } from "../../../../lib/pdf-text";
import { extractRiskTags } from "../../../lib/risk-tagging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_LEN = 20_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const doc = await getLatestSiteTaskDoc();
  if (!doc) return NextResponse.json({ ok: true, doc: null });
  let tags: unknown = [];
  try {
    tags = JSON.parse(doc.tags_json);
  } catch {
    /* 손상된 행 — 빈 태그로 응답 */
  }
  return NextResponse.json({
    ok: true,
    doc: {
      tags,
      updatedBy: doc.updated_by,
      updatedAt: doc.updated_at,
      srcName: doc.src_name,
      srcSha256: doc.src_sha256,
    },
  });
}

// POST(multipart) — 과업지시서 PDF 업로드 → 서버 텍스트 추출 → 태깅 → 저장.
// hwp/hwpx 는 파싱이 불안정하므로 미지원: 감독관이 PDF 로 변환 후 업로드한다.
export async function POST(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "과업지시서 저장은 관리자 권한이 필요합니다" },
      { status: 403 },
    );
  }
  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid form data" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ ok: false, error: "PDF 파일이 필요합니다" }, { status: 400 });
  }
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    return NextResponse.json(
      { ok: false, error: "PDF 파일만 업로드할 수 있습니다. 한글(hwp·hwpx) 문서는 PDF로 변환 후 업로드해 주세요." },
      { status: 400 },
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ ok: false, error: "PDF 크기는 10MB 이하만 가능합니다" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let taskText = "";
  try {
    taskText = await extractPdfText(bytes, MAX_TEXT_LEN);
  } catch (err) {
    console.error("[task-doc] PDF 추출 실패:", err);
    return NextResponse.json({ ok: false, error: "PDF 텍스트 추출에 실패했습니다" }, { status: 422 });
  }
  if (!taskText) {
    return NextResponse.json(
      { ok: false, error: "PDF에서 텍스트를 찾지 못했습니다(스캔 이미지 PDF는 지원하지 않습니다)" },
      { status: 422 },
    );
  }

  const tags = await extractRiskTags(taskText);
  await setSiteTaskDoc({
    taskText,
    tagsJson: JSON.stringify(tags),
    updatedBy: getSession(request)?.username ?? "",
    srcName: file.name,
    srcSha256: createHash("sha256").update(bytes).digest("hex"),
  });
  return NextResponse.json({ ok: true, tags, chars: taskText.length });
}
