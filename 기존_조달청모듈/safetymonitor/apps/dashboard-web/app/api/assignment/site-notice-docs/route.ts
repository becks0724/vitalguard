// 현장 공고 첨부문서 조회 — 현장에 연결된 나라장터 공고번호(noticeId)로 공고 상세의
// 첨부(시방서·과업내용서·공고규격서) 파일명+다운로드 URL 을 반환한다.
// 감독관은 나라장터에 접속하지 않고 여기서 내려받아 PDF 변환 후 과업지시서로 업로드한다(표시 전용·서버 다운로드 없음).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { getNoticeAttachments, getNoticeDetail } from "../../../lib/g2b";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  const noticeId = new URL(request.url).searchParams.get("noticeId")?.trim() ?? "";
  if (!noticeId || noticeId.length > 60) {
    return NextResponse.json({ ok: false, error: "noticeId required" }, { status: 400 });
  }

  const { source, notice, note } = await getNoticeDetail(noticeId);
  let title = notice?.title ?? null;
  let docs = notice?.specDocs ?? [];

  // 첨부가 비면 입찰공고번호 직접 조회 폴백 —
  // ① 계약 매칭 현장(계약 응답엔 첨부 필드 없음)은 계약 상세의 ntceNo 로,
  // ② 목록 캐시에 없는 공고(감독관 수동 입력)는 입력값 자체를 공고번호로 시도.
  if (docs.length === 0) {
    const bidNo = notice?.ntceNo ?? noticeId;
    const direct = await getNoticeAttachments(bidNo);
    if (direct) {
      docs = direct.docs;
      title = title ?? direct.title;
    }
  }

  return NextResponse.json({ ok: true, source, noticeId, title, docs, note });
}
