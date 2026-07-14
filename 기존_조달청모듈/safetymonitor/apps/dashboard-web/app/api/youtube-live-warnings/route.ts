// 실시간 특보 생방송 프록시 — 주요 방송사의 현재 진행 중인 뉴스 라이브 목록. 인증키 서버 보관.
// LIVE 토글 ON 일 때만 클라이언트가 호출 → 상시 조회 과금 방지. 30분 서버 캐시.
import { NextResponse } from "next/server";

import { searchLiveWarningBroadcasts } from "../../lib/youtube";

export async function GET() {
  const data = await searchLiveWarningBroadcasts();
  return NextResponse.json(data);
}
