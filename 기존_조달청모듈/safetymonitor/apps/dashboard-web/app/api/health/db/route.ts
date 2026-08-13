// DB 헬스 체크(공개·최소) — SELECT 1 왕복만 확인한다. 배포 사후 관찰·업타임 감시 대상 URL.
//
// 공개로 두는 이유 — 배포 스크립트·외부 업타임 체크가 자격 없이 호출해야 한다. 노출 정보는
// "DB 왕복 성공 여부 + 소요 ms" 뿐이고 데이터·스키마·에러 상세는 싣지 않는다(실패 사유는 서버 로그로).
// 남용 방지 = IP 당 분당 30회 레이트리밋(다른 공개 라우트와 같은 장치).
import { NextResponse } from "next/server";

import { dbPing } from "../../../../lib/db";
import { clientIpFromRequest } from "../../../../lib/client-ip";
import { consumeToken } from "../../../../lib/rate-limit";

export async function GET(request: Request) {
  if (!consumeToken(`health-db:${clientIpFromRequest(request)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "too_many" }, { status: 429 });
  }
  const t0 = Date.now();
  try {
    await dbPing();
    return NextResponse.json({ ok: true, ms: Date.now() - t0 });
  } catch (e) {
    console.error("[health-db] DB 왕복 실패", e);
    return NextResponse.json({ ok: false, ms: Date.now() - t0 }, { status: 503 });
  }
}
