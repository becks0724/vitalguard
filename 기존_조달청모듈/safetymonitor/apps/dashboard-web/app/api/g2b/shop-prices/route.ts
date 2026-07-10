// 종합쇼핑몰 실단가 프록시 — ?names=안전모,안전화,… (쉼표 구분, 최대 15개).
// ERP(스마트경리)의 '3. 개인보호구' 상세 내역이 품목별 실단가·실품목명을 이 라우트로 받는다.
import { NextResponse } from "next/server";

import { getShopPrices } from "../../../lib/g2b-shop";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const names = (new URL(request.url).searchParams.get("names") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) {
    return NextResponse.json({ ok: false, error: "names 필수(쉼표 구분)" }, { status: 400 });
  }
  const payload = await getShopPrices(names);
  return NextResponse.json({ ok: true, ...payload }, { headers: { "cache-control": "no-store" } });
}
