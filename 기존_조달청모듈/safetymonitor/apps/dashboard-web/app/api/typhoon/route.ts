// 태풍정보 프록시 — 기상청 getTyphoonInfo 진로/중심기압/최대풍속(다중 태풍). 인증키 서버 보관, 미승인 시 샘플.
// + 일본 기상청(JMA) 참고 진로 동봉 — **표시 전용이며 판정에는 쓰지 않는다**(판정 주체는 기상청).
import { NextResponse } from "next/server";

import { gibsTimeFor } from "../../lib/gibs-himawari";
import { getJmaTyphoons } from "../../lib/jma-typhoon";
import { getActiveTyphoons } from "../../lib/typhoon";

export async function GET() {
  // JMA 는 실패해도 빈 배열이라 기상청 조회를 막지 않는다 — 참고 진로만 빠지고 화면은 그대로 돈다.
  const [typhoons, jma] = await Promise.all([getActiveTyphoons(), getJmaTyphoons()]);
  // 구름 오버레이 타일 시각은 **서버 시각**으로 정한다 — 클라 시계가 몇 분만 어긋나도
  // 아직 없는 시각을 요청해 빈 타일(HTTP 200)이 조용히 깔린다(팀 PC 시계 사고와 같은 계열).
  const himawariTime = gibsTimeFor(Date.now());
  // 하위호환 봉투 — 구 클라이언트 필드(대표 태풍 스프레드) 보존 + 신 클라이언트용 typhoons 배열 동봉.
  // 대표 = 한국 최근접(조기경보 우선 — 최신 발표 우선이 아님, typhoon-parse 정렬 참조).
  const primary =
    typhoons[0] ??
    ({ source: "none", track: [], currentIndex: 0, note: "현재 발효 중인 태풍 없음" } as const);
  return NextResponse.json({ ok: true, ...primary, typhoons, jma, himawariTime });
}
