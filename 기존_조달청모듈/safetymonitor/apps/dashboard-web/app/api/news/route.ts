// 산업 안전뉴스 프록시 — 네이버 뉴스검색 키 서버 보관. 산업현장·산업재해·산업안전 법규 실시간 기사.
// 인가·빈도 제한(감사 BE-AUTHZ-08) — 무인증이면 외부인이 이 경로로 네이버 검색 쿼터를 대신 쓴다.
// 소비처가 fetch(NewsPanel)라 Authorization 헤더를 실을 수 있어 인가를 붙일 수 있다
// (헤더를 못 싣는 vworld-tile 과 갈리는 지점).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { clientIpFromRequest } from "../../../lib/client-ip";
import { consumeToken } from "../../../lib/rate-limit";
import { searchSafetyNews } from "../../lib/naver-news";

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  // 패널이 10분 주기로 1회 호출하고 서버 15분 캐시가 앞에 있다. 30/분이면 정상 사용과
  // 새로고침 연타를 모두 흡수하고 남는다.
  if (!consumeToken(`news:${clientIpFromRequest(request)}`, 30, 60_000)) {
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  const result = await searchSafetyNews();
  return NextResponse.json({ ok: true, ...result });
}
