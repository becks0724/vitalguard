// 관리자 — 현장 정보 일 1회 snapshot 저장/조회
import { NextResponse } from "next/server";

import { hasAdminMenuAccess } from "../../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
import {
  getLatestSiteInfo,
  persistSiteInfoDaily,
  type SiteInfoInput,
} from "../../../../lib/db";

function normalize(body: unknown): SiteInfoInput | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Partial<Record<keyof SiteInfoInput, unknown>>;
  return {
    companyName: typeof raw.companyName === "string" ? raw.companyName.trim() : "",
    siteName: typeof raw.siteName === "string" ? raw.siteName.trim() : "",
    constructionType:
      typeof raw.constructionType === "string" ? raw.constructionType.trim() : "",
    address: typeof raw.address === "string" ? raw.address.trim() : "",
    startDate: typeof raw.startDate === "string" ? raw.startDate.trim() : "",
    completionDate:
      typeof raw.completionDate === "string" ? raw.completionDate.trim() : "",
  };
}

export async function GET(request: Request) {
  // 조회(GET) = 대시보드 관리자 세션 또는 앱 로그인 JWT(owner/admin/worker) 수용 — 현장 앱이 현장정보 표시.
  // 저장(PUT)은 관리자 전용 유지. 앱 JWT 를 먼저 확인해 불필요한 DB 조회(hasAdminMenuAccess)를 피한다.
  const appAuthed = verifyAppJwt(bearerToken(request)) !== null;
  if (!appAuthed && !(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "인증 필요" },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true, siteInfo: await getLatestSiteInfo() });
}

export async function PUT(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const siteInfo = normalize(body);
  if (!siteInfo) {
    return NextResponse.json(
      { ok: false, error: "현장 정보 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const saved = await persistSiteInfoDaily(siteInfo);
  return NextResponse.json({ ok: true, siteInfo: saved });
}
