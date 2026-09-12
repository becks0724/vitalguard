// 알림 대응 확인(ack) — 미대응 알림에 대응자·시각 기록. 로그인 세션 토큰 필수.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import type { AlertType } from "../../../../lib/alert-type";
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
import { ackAlert, ackAlertByKey } from "../../../../lib/db";

const ALERT_TYPES: AlertType[] = ["sos", "fall", "vital", "geofence"];

export async function POST(request: Request) {
  // 대응확인 = 관제 세션 또는 앱 로그인 JWT 수용 — 현장 담당관이 현장에서 직접 확인한다.
  // ⚠ 신규 스키마로 전환하면 이 변경은 버린다 — alert_ack.ack_by 가 app_user FK 라
  //   아래 귀속 강제가 구조적으로 불필요해진다. 이식하지 말 것.
  const appClaims = verifyAppJwt(bearerToken(request));
  if (!appClaims && !verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  // 귀속 위조 방지 — app-media/route.ts 와 같은 규칙.
  // 앱 JWT 로 인증했으면 JWT 신원을 강제하고 body 의 ackBy 는 무시한다.
  // (body 가 우선하면 인증된 현장 단말이 대응 사실을 타인에게 귀속시킬 수 있음.)
  // ★ ack_by 는 관리자 CSV 에 "대응자" 로 실린다(산업재해 자료 제출용).
  //   name 이 없으면 로그인 ID(sub) 로 떨어뜨린다 — "관제자" 로 두면
  //   현장에서 누른 것이 관제자 기록이 되어 사실과 달라진다.
  const ackBy = appClaims
    ? (appClaims.name ?? appClaims.sub).slice(0, 40)
    : String(obj.ackBy ?? "").slice(0, 40) || "관제자";

  // 자연키(작업자·종류) — 알림 팝업의 '확인' 버튼용(id 를 모름). id 방식보다 우선 검사.
  const workerId = "workerId" in obj ? String(obj.workerId ?? "").slice(0, 80) : "";
  const type = "type" in obj ? String(obj.type ?? "") : "";
  if (workerId && ALERT_TYPES.includes(type as AlertType)) {
    const changed = await ackAlertByKey(workerId, type as AlertType, ackBy);
    return NextResponse.json({ ok: true, acked: changed > 0 });
  }

  const id = "id" in obj ? Number(obj.id) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { ok: false, error: "id or (workerId + type) required" },
      { status: 400 },
    );
  }

  const changed = await ackAlert(id, ackBy);
  return NextResponse.json({ ok: true, acked: changed > 0 });
}
