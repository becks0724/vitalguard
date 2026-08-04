// 긴급재난문자 프록시 — 작업자 GPS 평균(lat/lon) → 현장 시·도 발령. 인증키 서버 보관, 미설정 시 목업.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { cronAuth } from "../../../lib/cron-auth";
import { notifyEnvAlerts } from "../../../lib/env-alert-notify";
import { disasterMsgsForLocation } from "../../lib/disaster-msg-api";

// 좌표 파싱 — Number(null) 도 Number("") 도 0 이라 그대로 쓰면 파라미터 누락이
// "적도 앞바다 현장"으로 통과한다(Number.isFinite(0) === true). 빈 값은 NaN 으로 돌린다.
function coord(v: string | null): number {
  return v === null || v.trim() === "" ? Number.NaN : Number(v);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = coord(url.searchParams.get("lat"));
  const lon = coord(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ ok: false, error: "lat/lon 필요" }, { status: 400 });
  }
  // 실 API 실패 + 직전 캐시 없음 → 503. 화면은 "연결 끊김" 을 표시한다(D-32).
  // 종전에는 목업으로 폴백해 관제 화면에 가짜 긴급재난이 떴다 — 실제 재난과 구분되지 않는다.
  let result: Awaited<ReturnType<typeof disasterMsgsForLocation>>;
  try {
    result = await disasterMsgsForLocation(lat, lon);
  } catch (e) {
    console.error(`[disaster-msg] 조회 실패 — 503 으로 알린다. ${(e as Error).message}`);
    return NextResponse.json({ ok: false, error: "재난문자 조회 실패" }, { status: 503 });
  }
  const { alertItems, ...data } = result;

  // 발령 재난문자 자동 텔레그램 알림(긴급재난=위험·안전안내=주의 전이) — 실측(live)만(목업 오발송 방지).
  // 조회는 공개로 두되 알림 발사는 로그인 세션 또는 크론 키에서만 — 무인증 GET 으로 외부인이
  // 텔레그램을 임의 발사시킬 수 있었던 감사 지적(BE-AUTHZ-02)을 kma-warning 과 동일하게 적용한다.
  const trusted =
    verifyBasicAuth(request) ||
    cronAuth(request.headers.get("x-cron-key"), process.env.CRON_SECRET) === "ok";
  if (data.source === "live" && !trusted) {
    console.warn("[disaster-msg] 무인증 조회 — 재난문자 알림 발사를 건너뛴다");
  }
  if (data.source === "live" && trusted) {
    try {
      // ⚠️ alertItems 는 발령 없는 유형까지 normal 로 포함한다 — 그게 해제 역할이다(D-07).
      //    site 발령분만 골라 넘기면 유형당 알림이 딱 한 번만 가고 영영 안 간다.
      await notifyEnvAlerts(alertItems);
    } catch (notifyError) {
      console.error("[disaster-msg] env alert notify failed:", notifyError);
    }
  }

  return NextResponse.json({ ok: true, ...data });
}
