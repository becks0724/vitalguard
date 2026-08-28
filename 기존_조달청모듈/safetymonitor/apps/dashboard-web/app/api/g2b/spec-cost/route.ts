// 공고 첨부 내역서 → 원가 **초안**. 담당관 확정 화면이 이 값을 미리 채우는 데 쓴다.
//   조달 API 는 안전관리비를 주지 않으므로(2026-08-27 실측), 첨부 내역서가 유일한 자동 경로다.
//
// ⚠ 이 라우트는 **확정값을 만들지 않는다.** 반환은 전부 draft 이고 근거(파일명·시트·행)를 함께 싣는다.
//   확정은 근거 문서를 본 담당관이 한다 — 피검증자 자기신고를 판정에 쓰지 않기 위한 경계다.
import { NextResponse } from "next/server";

import { getNoticeDetail } from "../../../lib/g2b";
import { draftFromXlsx, type SpecCostDraft } from "../../../lib/spec-cost-parse";

export const dynamic = "force-dynamic";

// 내역서로 볼 파일명 — 실측 표본에서 쓰인 이름들(설계내역서·공내역서·물량내역서·도급예산내역서).
const SPEC_NAME = /내역서|내역/;
// xlsx 만 연다. 구형 .xls(CFB)·PDF 는 이 파서로 못 읽어 담당관 확인 대상으로 남긴다.
const XLSX_NAME = /\.xlsx$/i;
const MAX_BYTES = 12 * 1024 * 1024; // 첨부가 수십 MB 인 건이 있어 상한을 둔다(실측 최대 3.3MB).

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: { code: "BAD_REQUEST", message: "공고번호(id)가 필요합니다" } }, { status: 400 });

  try {
    const detail = await getNoticeDetail(id);
    const docs = detail.notice?.specDocs ?? [];
    const candidates = docs.filter((d) => SPEC_NAME.test(d.name));
    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        noticeId: id,
        source: null,
        draft: null,
        note: "공고 첨부에 내역서가 없습니다 — 담당관이 계약 내역서로 확인해야 합니다.",
        skipped: docs.map((d) => d.name),
      });
    }

    // xlsx 를 우선 시도하고, 열린 첫 건을 초안으로 쓴다. 나머지는 건너뛴 사유와 함께 남긴다.
    const openable = candidates.filter((d) => XLSX_NAME.test(d.name));
    const skipped = candidates.filter((d) => !XLSX_NAME.test(d.name)).map((d) => d.name);
    let picked: { name: string; draft: SpecCostDraft } | null = null;
    for (const doc of openable) {
      try {
        const res = await fetch(doc.url, { signal: AbortSignal.timeout(30000) });
        if (!res.ok) {
          skipped.push(`${doc.name} (다운로드 실패 ${res.status})`);
          continue;
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > MAX_BYTES) {
          skipped.push(`${doc.name} (용량 초과)`);
          continue;
        }
        const draft = draftFromXlsx(buf);
        // 계상액이든 대상액이든 하나라도 건진 파일을 우선 채택한다.
        if (draft.safetyCost || draft.targetAmount !== null) {
          picked = { name: doc.name, draft };
          break;
        }
        if (!picked) picked = { name: doc.name, draft };
      } catch {
        skipped.push(`${doc.name} (열기 실패)`);
      }
    }

    if (!picked) {
      return NextResponse.json({
        ok: true,
        noticeId: id,
        source: null,
        draft: null,
        note: "내역서를 열지 못했습니다(구형 .xls·PDF 등) — 담당관 확인 대상입니다.",
        skipped,
      });
    }

    return NextResponse.json({
      ok: true,
      noticeId: id,
      source: { file: picked.name },
      draft: picked.draft,
      skipped,
      // ★ 소비처가 이 값을 확정처럼 쓰지 않도록 성격을 응답에 박아 둔다.
      confirmed: false,
      note: "초안입니다 — 담당관이 근거 문서와 대조해 확정해야 판정에 쓰입니다.",
    });
  } catch (err) {
    console.error("[api/g2b/spec-cost]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "내역서 조회 실패" } }, { status: 500 });
  }
}
