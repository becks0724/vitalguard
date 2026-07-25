// 기상특보 프록시 — 현장 GPS(lat/lon) → 시·도 발효 특보. 인증키 서버 보관, 미설정 시 목업.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { cronAuth } from "../../../lib/cron-auth";
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
  // 조회는 공개로 두되 알림 발사는 로그인 세션에서만 — 무인증 GET 으로 외부인이 텔레그램을
  // 임의 발사시킬 수 있었다(감사 BE-AUTHZ-02).
  // 로그인 세션 또는 Cloud Scheduler 크론 키(무인 24/7 경로는 세션이 없다).
  const trusted =
    verifyBasicAuth(request) ||
    cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET) === "ok";
  if (data.source === "live" && !trusted) {
    console.warn("[kma] 무인증 조회 — 특보 알림 발사를 건너뛴다");
  }
  if (data.source === "live" && trusted) {
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
