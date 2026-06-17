// 태풍정보 프록시 — 기상청 getTyphoonInfo 진로/중심기압/최대풍속. 인증키 서버 보관, 미승인 시 샘플.
import { NextResponse } from "next/server";

import { getActiveTyphoon } from "../../lib/typhoon";

export async function GET() {
  const data = await getActiveTyphoon();
  return NextResponse.json({ ok: true, ...data });
}
