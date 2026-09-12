// 알림 이력 조회 + 구획 이탈 기록 — 로그인 세션 토큰 필수(작업자명 포함).
import { NextResponse } from "next/server";
import { readOr503 } from "../../../lib/route-read";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import { listAlerts, recordAlert } from "../../../lib/db";

export async function GET(request: Request) {
  // 조회(GET) = 관제 세션 또는 앱 로그인 JWT 수용 — 현장 담당관이 태블릿에서 경보를 본다.
  // 기록(POST)은 관제 전용 유지: 구획 이탈 확정 전이는 관제웹이 판정 주체다.
  // (admin/site-info GET 과 같은 패턴. 앱 JWT 를 먼저 보고 불필요한 세션 조회를 피한다.)
  //
  // ⚠ 이 라우트는 현장 필터가 없다 — alerts 테이블에 site_id 가 없고 listAlerts 도 전체를 읽는다.
  //   앱은 받은 것을 "이 현장 경보" 라고 표시하면 안 된다(최근 100건 전체다).
  // ⚠ 신규 스키마로 전환하면 이 변경은 버린다 — alert.site_id 와 RLS 가 대신한다.
  //   이식하지 말 것.
  if (!verifyAppJwt(bearerToken(request)) && !verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return readOr503("alerts", () => listAlerts(100), (alerts) =>
    NextResponse.json({ ok: true, alerts }, { headers: { "cache-control": "no-store" } }),
  );
}

// 구획 이탈 기록 — 관제 웹이 확정 전이 시 호출(전이당 1건, ts 자연키 dedup).
// SOS/낙상/생체는 서버(addSample)가 기록하므로 클라이언트 기록은 이 1종만 허용(위조 삽입 차단).
export async function POST(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (obj.type !== "geofence") {
    return NextResponse.json(
      { ok: false, error: "type must be geofence" },
      { status: 400 },
    );
  }
  const workerId = String(obj.workerId ?? "").slice(0, 80);
  const ts = String(obj.ts ?? "");
  if (!workerId || Number.isNaN(Date.parse(ts))) {
    return NextResponse.json({ ok: false, error: "workerId and ts required" }, { status: 400 });
  }
  const workerName = obj.workerName ? String(obj.workerName).slice(0, 80) : null;

  await recordAlert({ workerId, workerName, type: obj.type, ts });
  return NextResponse.json({ ok: true });
}
