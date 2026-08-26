// 가스 누출 감지기 표시 오버라이드 — 조회(GET)=로그인 세션, 수정(PUT=설치위치·가스종류)=관리자 권한(권한있음)만.
import { NextResponse } from "next/server";
import { readOr503 } from "../../../../lib/route-read";

import { getSession, hasAdminMenuAccess, verifyBasicAuth } from "../../../../lib/admin-auth";
import { getGaspodConfigs, setGaspodConfig } from "../../../../lib/db";

export const dynamic = "force-dynamic";

// 허용 row_key — 데모 행(demo:0~) · 실기기 가스 행(<device>:o2|co|h2s). 무제한 키 적재 방지.
const ROW_KEY = /^(demo:\d{1,2}|[A-Za-z0-9_-]{1,40}:(o2|co|h2s))$/;

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }
  return readOr503("gaspod/config", getGaspodConfigs, (configs) =>
    NextResponse.json({ ok: true, configs }),
  );
}

export async function PUT(request: Request) {
  // 설치위치·가스종류 수정은 관리자 권한(owner 또는 admin_access=권한있음)만 — 권한없음 직접호출도 서버 차단.
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "가스 감지기 설정 수정은 관리자 권한이 필요합니다" },
      { status: 403 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const rowKey = typeof body.rowKey === "string" ? body.rowKey.trim() : "";
  if (!ROW_KEY.test(rowKey)) {
    return NextResponse.json({ ok: false, error: "알 수 없는 가스 행" }, { status: 404 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const updatedBy = getSession(request)?.username ?? "";
  await setGaspodConfig(rowKey, { loc: str(body.loc), gas: str(body.gas) }, updatedBy);
  return NextResponse.json({ ok: true, rowKey });
}
