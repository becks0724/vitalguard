// 태풍정보 프록시 — 기상청 getTyphoonInfo 진로/중심기압/최대풍속(다중 태풍). 인증키 서버 보관, 미승인 시 샘플.
import { NextResponse } from "next/server";

import { getActiveTyphoons } from "../../lib/typhoon";

export async function GET() {
  const typhoons = await getActiveTyphoons();
  // 하위호환 봉투 — 구 클라이언트 필드(대표 태풍 스프레드) 보존 + 신 클라이언트용 typhoons 배열 동봉.
  // 대표 = 한국 최근접(조기경보 우선 — 최신 발표 우선이 아님, typhoon-parse 정렬 참조).
  const primary =
    typhoons[0] ??
    ({ source: "none", track: [], currentIndex: 0, note: "현재 발효 중인 태풍 없음" } as const);
  return NextResponse.json({ ok: true, ...primary, typhoons });
}
