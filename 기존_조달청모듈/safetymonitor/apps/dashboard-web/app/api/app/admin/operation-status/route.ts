// N-4 / O 전송 상태: 결과 불명 작업의 서버 등록 여부만 확인한다. 재전송은 하지 않는다.
import { NextResponse } from "next/server";

import { requireAppAdmin } from "../../../../../lib/app-admin-auth";
import { listOwnedAppMediaOperationIds } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

const MAX_OPERATION_IDS = 50;
const headers = { "Cache-Control": "no-store" };

// GET ?clientOperationId=<업로드 때 저장한 ID>&clientOperationId=<다음 ID>
// 중복 입력도 상한에 포함하고, 응답은 첫 등장 순서로 한 번씩 반환한다.
export async function GET(request: Request) {
  const gate = await requireAppAdmin(request, { readOnly: true });
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status, headers });

  const ids = new URL(request.url).searchParams.getAll("clientOperationId");
  // POST /api/app-media와 같은 ID 규칙. 변환·trim하면 원래 작업과 다른 키를 조회하게 된다.
  if (ids.length === 0 || ids.length > MAX_OPERATION_IDS ||
      ids.some((id) => !id.trim() || id !== id.trim() || id.length > 128)) {
    return NextResponse.json({
      ok: false,
      error: "clientOperationId는 앞뒤 공백 없는 1~128자 문자열로 1~50개 보내야 합니다",
    }, { status: 400, headers });
  }

  const operationIds = [...new Set(ids)];
  try {
    const registered = new Set(await listOwnedAppMediaOperationIds(operationIds, gate.principal));
    return NextResponse.json({
      ok: true,
      operations: operationIds.map((clientOperationId) => ({
        clientOperationId,
        // 미존재·타인 소유는 SQL에서 모두 빠져 동일한 응답이 된다.
        // 아직 POST가 미커밋인 경우도 not_registered다. 재전송 허가를 뜻하지 않는다.
        status: registered.has(clientOperationId) ? "registered" : "not_registered",
      })),
    }, { headers });
  } catch {
    console.warn("[app-admin/operation-status] 작업 상태 조회 실패");
    // DB 장애를 미등록으로 숨기지 않는다. 오류 원문·저장 키·경로도 응답하지 않는다.
    return NextResponse.json({ ok: false, error: "작업 상태 조회 실패" }, { status: 503, headers });
  }
}
