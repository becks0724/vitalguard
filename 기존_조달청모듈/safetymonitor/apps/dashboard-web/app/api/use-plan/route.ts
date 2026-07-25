// 산업안전보건관리비 사용계획서 수신 — 시공사 경리시스템(스마트경리 데모 /erp)이 제출.
// ④증액 검증이 '계획액 대비 증액 청구' 판정 기준으로 사용. 현장당 1건 upsert(재제출 = 갱신).
// 수집 정책 = tax-invoice 와 동일(soft 토큰 + DB 영속 + 메모리 폴백).
import { NextResponse } from "next/server";

import { clientIpFromRequest } from "../../../lib/client-ip";
import { consumeToken } from "../../../lib/rate-limit";
import { ingestAuthStatus } from "../../../lib/ingest-auth";
import { getUsePlan, upsertUsePlan, type UsePlanRow } from "../../../lib/db";

export const dynamic = "force-dynamic";

const recent = new Map<string, UsePlanRow>(); // DB 미설정/장애 폴백.
let warned = false;

export async function POST(request: Request) {
  // 빈도 제한 — 무토큰 수용(soft) 상태라 위조 주입 비용이 0 이다(감사 VER-013).
  if (!consumeToken(`useplan:${clientIpFromRequest(request)}`, 60, 60_000)) {
    console.warn("[useplan] 수집 빈도 제한 초과 — 요청 거부");
    return NextResponse.json(
      { ok: false, error: "요청이 너무 잦습니다" },
      { status: 429 },
    );
  }
  const auth = ingestAuthStatus(request);
  if (auth === "invalid") return NextResponse.json({ ok: false, error: "유효하지 않은 토큰" }, { status: 401 });
  if (auth === "none" && !warned) {
    warned = true;
    console.warn("[use-plan] 무인증 수집 수용 중(soft)");
  }
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const items = Array.isArray(b.items) ? (b.items as { name: string; amount: number }[]) : [];
  if (!b.siteId || !Number(b.appropriated) || items.length === 0) {
    return NextResponse.json({ ok: false, error: "siteId/appropriated/items[] 필수" }, { status: 400 });
  }
  const row: UsePlanRow = {
    site_id: String(b.siteId).slice(0, 60),
    target_amount: Math.round(Number(b.targetAmount) || 0),
    appropriated: Math.round(Number(b.appropriated)),
    items_json: JSON.stringify(items.slice(0, 20)),
    received_at: new Date().toISOString(),
  };
  recent.set(row.site_id, row);
  try {
    await upsertUsePlan(row);
  } catch (e) {
    console.error("[use-plan] DB 저장 실패(메모리 폴백 유지):", e);
  }
  return NextResponse.json({ ok: true, siteId: row.site_id }, { status: 201 });
}

// 현장별 사용계획서 조회 — ?siteId= 필수.
export async function GET(request: Request) {
  const siteId = new URL(request.url).searchParams.get("siteId");
  if (!siteId) return NextResponse.json({ ok: false, error: "siteId 필수" }, { status: 400 });
  try {
    const row = await getUsePlan(siteId);
    return NextResponse.json({ ok: true, plan: row ?? recent.get(siteId) ?? null }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: true, plan: recent.get(siteId) ?? null }, { headers: { "cache-control": "no-store" } });
  }
}
