// 공고 상세 + 사전 안전 리스크 프로파일. (조달 상세 → 안전관리비 예비검증 + 위험작업 태그 + 위험도 종합)
import { NextResponse } from "next/server";

import { getNoticeDetail } from "../../../../lib/g2b";
import { extractRiskTags } from "../../../../lib/risk-tagging";
import { buildRiskProfile } from "../../../../lib/procure-risk";

export const dynamic = "force-dynamic";

// Next15: route handler 의 params 는 Promise — 반드시 await.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: { code: "BAD_ID", message: "잘못된 공고 id" } }, { status: 400 });
    }

    const detail = await getNoticeDetail(id);
    if (!detail.notice) {
      return NextResponse.json(
        { error: { code: "NOTICE_NOT_FOUND", message: "해당 공고를 찾을 수 없습니다" } },
        { status: 404 },
      );
    }

    const tags = await extractRiskTags(detail.notice.taskText);
    const profile = buildRiskProfile(detail.notice, tags);

    return NextResponse.json({
      source: detail.source,
      notice: detail.notice,
      safetyCost: profile.safetyCost,
      tags: profile.tags,
      risk: {
        score: profile.score,
        breakdown: profile.breakdown,
        topFactors: profile.topFactors,
        recommendations: profile.recommendations,
      },
      note: detail.note,
    });
  } catch (err) {
    console.error("[api/g2b/notice/:id]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "공고 분석 실패" } }, { status: 500 });
  }
}
