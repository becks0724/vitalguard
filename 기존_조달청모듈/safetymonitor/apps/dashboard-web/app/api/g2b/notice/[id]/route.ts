// 공고 상세 + 사전 안전 리스크 프로파일. (조달 상세 → 안전관리비 예비검증 + 위험작업 태그 + 위험도 종합)
import { NextResponse } from "next/server";

import { latestProcureCostConfirm } from "../../../../../lib/db";
import { getNoticeDetail } from "../../../../lib/g2b";
// ⚠ risk-tagging(공용 — 배치 어시스턴트도 사용)이 아니라 안전조달 **전용** 사전을 쓴다(2026-08-27).
import { extractProcureRiskTags } from "../../../../lib/procure-risk-tags";
import { buildRiskProfile } from "../../../../lib/procure-risk";
import type { ConstructionType } from "../../../../lib/safeprocure-types";

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

    // ★ 담당관 확정값이 있으면 그것으로 판정한다(2026-08-27 사용자 설계 결정).
    //   조달 API 는 안전관리비를 안 주고, 첨부 내역서 파싱은 초안일 뿐이다. 확정 전에는
    //   `targetAmount`·`declaredSafetyCost` 가 null 이라 판정이 '검토필요'로 남는다 — 그게 맞다.
    // ⚠ 초안을 여기서 자동 주입하지 않는다. 사람이 안 본 값으로 '과소계상 의심'을 찍으면
    //   그 단정의 책임자가 없어진다.
    const confirmed = await latestProcureCostConfirm(id).catch(() => null);
    const notice = confirmed
      ? {
          ...detail.notice,
          targetAmount: confirmed.target_amount ?? detail.notice.targetAmount ?? null,
          declaredSafetyCost: confirmed.declared_cost ?? detail.notice.declaredSafetyCost ?? null,
        }
      : detail.notice;

    const tags = await extractProcureRiskTags(notice.taskText);
    const profile = buildRiskProfile(notice, tags, confirmed?.construction_type as ConstructionType | null);

    return NextResponse.json({
      source: detail.source,
      notice,
      // 판정의 근거가 사람인지 기계인지 소비처가 알아야 한다 — 화면이 "확정" 배지를 여기서 만든다.
      costConfirm: confirmed,
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
