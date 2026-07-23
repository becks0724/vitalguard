// 기상특보 프록시 — 현장 GPS(lat/lon) → 시·도 발효 특보. 인증키 서버 보관, 미설정 시 목업.
import { NextResponse } from "next/server";

import { notifyEnvAlerts } from "../../../lib/env-alert-notify";
import { warningsForLocation } from "../../lib/kma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: "lat/lon 필요" }, { status: 400 });
  }
  const data = await warningsForLocation(lat, lon);

  // 발효 특보 자동 텔레그램 알림(경보=위험·주의보=주의 전이) — 실측(live) 특보만(목업 오발송 방지).
  if (data.source === "live") {
    try {
      await notifyEnvAlerts(
        data.warnings.map((w) => ({
          itemKey: `kma:${w.type}`,
          itemLabel: "기상특보",
          currentValue: w.type,
          severity: w.level === "경보" ? "danger" : "caution",
          detail: w.regions.length > 0 ? `발효 지역 ${w.regions.join(", ")}` : undefined,
        })),
      );
    } catch (notifyError) {
      console.error("[kma] env alert notify failed:", notifyError);
    }
  }

  return NextResponse.json({ ok: true, ...data });
}
