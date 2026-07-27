// 국세청 사업자등록 상태조회 — ②사용축(세금계산서 발급처 검증). POST { bno: string | string[] }.
//
// 빈도 제한만 두고 인가는 두지 않는다(감사 BE-AUTHZ-08) — 소비처 BusinessVerifyCard 가
// `app/safety-audit/page.tsx`(주석 그대로 "로그인 없이 데모")에도 실린다. 인가를 붙이면
// 그 공개 데모 화면의 발급처 검증이 401 로 죽는다(교훈 L-11).
// 지적의 실제 피해는 "공공데이터 키 쿼터 소진"이므로 빈도 제한이 그 피해를 직접 막는다.
// 공개 데모를 접거나 로그인 뒤로 옮기기로 결정되면 그때 인가로 승격한다(FE-PUBLIC-01 과 함께).
import { NextResponse } from "next/server";

import { clientIpFromRequest } from "../../../lib/client-ip";
import { consumeToken } from "../../../lib/rate-limit";
import { checkBusinessStatus } from "../../lib/nts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 사용자가 폼에 번호를 넣고 누르는 수동 조회다. 30/분이면 정상 사용을 자르지 않으면서
  // 자동화된 번호 대입(사업자번호 스캐닝)은 막힌다.
  if (!consumeToken(`nts:${clientIpFromRequest(req)}`, 30, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { bno?: unknown };
    const raw = body.bno;
    const bnos = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
    const payload = await checkBusinessStatus(bnos);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[api/nts]", err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "사업자 상태조회 실패" } }, { status: 500 });
  }
}
