// 관리자 앱 S 현장 화면 — 네 신호등 행과 경보를 각각 실패 격리한다(S-09).
import { NextResponse } from "next/server";

import { requireAppAdmin } from "../../../../../lib/app-admin-auth";
import {
  readAedStatus, readAlertsStatus, readGasStatus, readWeatherStatus, readWorkersStatus,
} from "../../../../../lib/app-site-status";

export const dynamic = "force-dynamic";

function row<T>(result: PromiseSettledResult<T>, label: string) {
  if (result.status === "fulfilled") return result.value;
  // DB/외부 오류 원문은 응답에 노출하지 않는다.
  console.warn(`[app-admin/site-status] ${label} 조회 실패`);
  return { ok: false as const, error: `${label} 조회 실패` };
}

export async function GET(request: Request) {
  const gate = await requireAppAdmin(request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const [weather, workers, gas, aed, alerts] = await Promise.allSettled([
    readWeatherStatus(), readWorkersStatus(request), readGasStatus(), readAedStatus(), readAlertsStatus(),
  ]);
  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    weather: row(weather, "기상"), workers: row(workers, "작업자"),
    gas: row(gas, "가스"), aed: row(aed, "AED"), alerts: row(alerts, "경보"),
  }, { headers: { "Cache-Control": "no-store" } });
}
