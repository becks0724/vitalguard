// 현장별 일일 snapshot·사용자 선택 조회. POST는 현장 선택도 수용하고 PUT은 기존 관리자 편집용이다.
import { NextResponse } from "next/server";

import { getSession, hasAdminMenuAccess, verifyBasicAuth } from "../../../../lib/admin-auth";
import { bearerToken, verifyAppJwt } from "../../../../lib/app-jwt";
import {
  getCurrentSite,
  getLatestSiteInfo,
  getSite,
  getUserOrgType,
  listAssignedSites,
  persistSiteInfoDaily,
  setCurrentSite,
  type SiteInfoInput,
} from "../../../../lib/db";

export const dynamic = "force-dynamic";

function normalize(body: unknown): SiteInfoInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const raw = body as Partial<Record<keyof SiteInfoInput, unknown>>;
  return {
    siteId: typeof raw.siteId === "string" ? raw.siteId.trim() : "",
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
  // contractor는 DB 배정 현장을 조회한다. 직원 웹 세션의 관리자 메뉴 권한 검사는 유지한다.
  // 앱 JWT에는 orgType이 없으므로 조직 유형은 DB에서 확인한다.
  const appClaims = verifyAppJwt(bearerToken(request));
  const username = appClaims?.sub ?? getSession(request)?.username;
  if (!username) {
    return NextResponse.json(
      { ok: false, error: "인증 필요" },
      { status: 401 },
    );
  }

  const isContractor = (await getUserOrgType(username)) === "contractor";
  if (!appClaims && !isContractor && !(await hasAdminMenuAccess(request))) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  let current = await getCurrentSite(username);
  const assignedSites = isContractor ? await listAssignedSites(username) : [];
  if (isContractor) {
    const first = assignedSites[0];
    if (!first) {
      return NextResponse.json({ ok: true, siteInfo: null, assignedSiteCount: 0 });
    }
    // 배정 해제·비활성화 뒤 남은 선택도 현재 배정 목록으로 다시 맞춘다.
    const currentSiteId = current?.site_id;
    if (!assignedSites.some((site) => site.site_id === currentSiteId)) {
      current = await setCurrentSite(username, first.site_id);
    }
  }
  const siteInfo = current
    ? (await getLatestSiteInfo(current.site_id)) ?? (await getSite(current.site_id))
    : await getLatestSiteInfo();
  return NextResponse.json({ ok: true, siteInfo, assignedSiteCount: assignedSites.length });
}

async function saveSiteInfo(request: Request, allowLegacySiteId: boolean) {
  const session = getSession(request);
  if (!session || !verifyBasicAuth(request, { allowContractor: true })) {
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

  // 로그인은 기존 현장 선택만 허용한다. 공용 현장정보를 편집하는 요청은 관리자 권한을 확인한다.
  const selectOnly = !allowLegacySiteId && (body as { selectOnly?: unknown }).selectOnly === true;
  if (!selectOnly && (!verifyBasicAuth(request) || !(await hasAdminMenuAccess(request)))) {
    return NextResponse.json({ ok: false, error: "관리자 인증 필요" }, { status: 401 });
  }

  // 이전 관리자 화면의 PUT에는 siteId가 없을 수 있다. 해당 사용자의 선택을 먼저 따른다.
  if (!siteInfo.siteId && allowLegacySiteId) {
    const current = await getCurrentSite(session.username);
    siteInfo.siteId = current?.site_id ?? (await getLatestSiteInfo())?.site_id ?? "SITE-SMARTHRD-2026";
  }
  if (!siteInfo.siteId) {
    return NextResponse.json({ ok: false, error: "siteId가 필요합니다." }, { status: 400 });
  }
  if (selectOnly && (await getUserOrgType(session.username)) === "contractor") {
    const assignedSites = await listAssignedSites(session.username);
    if (!assignedSites.some((site) => site.site_id === siteInfo.siteId)) {
      return NextResponse.json({ ok: false, error: "배정되지 않은 현장입니다" }, { status: 403 });
    }
  }
  const site = await getSite(siteInfo.siteId);
  if (!site?.active) {
    return NextResponse.json({ ok: false, error: "선택할 수 없는 현장입니다." }, { status: 400 });
  }

  if (selectOnly) {
    // 재로그인·다른 기기에서의 선택도 사람이 고친 주소 등을 프리셋으로 되돌리면 안 된다.
    const existing = (await getLatestSiteInfo(siteInfo.siteId)) ?? site;
    siteInfo.companyName = existing.company_name ?? "";
    siteInfo.siteName = existing.site_name ?? "";
    siteInfo.constructionType = existing.construction_type ?? "";
    siteInfo.address = existing.address ?? "";
    siteInfo.startDate = existing.start_date ?? "";
    siteInfo.completionDate = existing.completion_date ?? "";
  }
  const saved = await persistSiteInfoDaily(siteInfo);
  await setCurrentSite(session.username, siteInfo.siteId);
  return NextResponse.json({ ok: true, siteInfo: saved });
}

export async function POST(request: Request) {
  return saveSiteInfo(request, false);
}

export async function PUT(request: Request) {
  return saveSiteInfo(request, true);
}
