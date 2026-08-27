// 조달 공고 안전관리비 **담당관 확정** — 검증 판정이 쓰는 확정값의 유일한 입력구.
//
// ★ 설계 결정(2026-08-27 사용자) — "시공사가 입력하지 않는다. 근거 문서만 제출하고,
//   그 문서를 확인한 담당관이 입력한다." 피검증자가 판정 기준을 적으면 검증이 성립하지 않는다.
//   초안(`/api/g2b/spec-cost`)은 담당관의 입력을 **덜어 줄 뿐** 확정하지 않는다.
//
// ⚠ append-only — PUT·DELETE 를 만들지 않는다. 정정도 POST 이고 최신 한 건이 현행이다.
import { NextResponse } from "next/server";

import { getSession, procureConfirmAccess } from "../../../../lib/admin-auth";
import { insertProcureCostConfirm, latestProcureCostConfirm, listProcureCostConfirms } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const ID_OK = /^[A-Za-z0-9_-]+$/;
// ★ 공사종류는 필수다(2026-08-27 사용자 결정) — 요율을 가르는 축이라 자동 추정에 맡기면
//   틀린 기준액으로 판정된다(실측: 공원 리모델링을 건축 3.11% 로 추정, 문서 요율은 2.07% 특수).
const CTYPES = new Set(["건축공사", "토목공사", "중건설공사", "특수건설공사"]);

/** 금액 입력 — 빈 값은 null(모름)이고, 음수·비수치는 거부한다(0 은 "0원 계상"이라 유효하다). */
function money(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s원]/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined; // undefined = 입력 오류
  return Math.round(n);
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id || !ID_OK.test(id)) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "공고번호(id)가 필요합니다" } }, { status: 400 });
  }
  try {
    const [confirmed, history] = await Promise.all([latestProcureCostConfirm(id), listProcureCostConfirms(id)]);
    return NextResponse.json({ ok: true, noticeId: id, confirmed, history });
  } catch (err) {
    console.error("[api/g2b/cost-confirm GET]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "확정 이력 조회 실패" } }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // ⚠ 확정자는 세션에서만 온다 — 본문의 이름을 믿으면 누구나 남의 이름으로 확정할 수 있다.
  // ★ 역할 분리(2026-08-27 사용자 결정) — 확정은 owner 또는 현장 담당관(site_officer)만.
  //   시공사(contractor)는 근거 문서 제출까지고, 확정 권한은 부여 여부와 무관하게 없다.
  const access = await procureConfirmAccess(req);
  if (access === "no_session") {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다" } }, { status: 401 });
  }
  if (access === "contractor") {
    return NextResponse.json(
      { error: { code: "CONTRACTOR", message: "시공사 계정은 확정할 수 없습니다 — 근거 문서 제출까지입니다" } },
      { status: 403 },
    );
  }
  if (access === "not_officer") {
    return NextResponse.json(
      { error: { code: "NOT_OFFICER", message: "현장 담당관 권한이 필요합니다 — 사용자 관리에서 부여받으세요" } },
      { status: 403 },
    );
  }
  const session = getSession(req)!; // access === "ok" 는 세션 존재를 전제한다

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "본문을 읽을 수 없습니다" } }, { status: 400 });
  }

  const noticeId = String(body.noticeId ?? "").trim();
  if (!noticeId || !ID_OK.test(noticeId)) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "공고번호(noticeId)가 필요합니다" } }, { status: 400 });
  }

  const targetAmount = money(body.targetAmount);
  const declaredCost = money(body.declaredCost);
  if (targetAmount === undefined || declaredCost === undefined) {
    return NextResponse.json({ error: { code: "BAD_AMOUNT", message: "금액은 0 이상의 숫자여야 합니다" } }, { status: 400 });
  }
  // 둘 다 비면 남길 것이 없다 — 빈 확정은 "확인했다"는 거짓 신호가 된다.
  if (targetAmount === null && declaredCost === null) {
    return NextResponse.json(
      { error: { code: "EMPTY", message: "대상액·계상액 중 하나는 입력해야 합니다" } },
      { status: 400 },
    );
  }

  const constructionType = typeof body.constructionType === "string" ? body.constructionType : "";
  if (!CTYPES.has(constructionType)) {
    return NextResponse.json(
      { error: { code: "NO_CTYPE", message: "공사종류를 선택해야 확정할 수 있습니다" } },
      { status: 400 },
    );
  }

  // 근거가 없는 확정은 만들지 않는다 — 이 화면의 존재 이유가 "무엇을 보고 정했나"이기 때문이다.
  const evidenceFile = typeof body.evidenceFile === "string" ? body.evidenceFile.trim() : "";
  if (!evidenceFile) {
    return NextResponse.json(
      { error: { code: "NO_EVIDENCE", message: "근거 문서를 지정해야 확정할 수 있습니다" } },
      { status: 400 },
    );
  }

  try {
    const row = await insertProcureCostConfirm({
      notice_id: noticeId,
      target_amount: targetAmount,
      declared_cost: declaredCost,
      construction_type: constructionType,
      evidence_file: evidenceFile,
      evidence_url: typeof body.evidenceUrl === "string" ? body.evidenceUrl : null,
      evidence_locus: typeof body.evidenceLocus === "string" ? body.evidenceLocus : null,
      // 확정 당시의 초안을 그대로 얼려 둔다 — 파서를 고치면 오늘의 초안은 달라진다.
      draft_json: body.draft === undefined ? null : JSON.stringify(body.draft),
      note: typeof body.note === "string" ? body.note : null,
      confirmed_by: session.username,
    });
    return NextResponse.json({ ok: true, confirmed: row });
  } catch (err) {
    console.error("[api/g2b/cost-confirm POST]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "확정 저장 실패" } }, { status: 500 });
  }
}
