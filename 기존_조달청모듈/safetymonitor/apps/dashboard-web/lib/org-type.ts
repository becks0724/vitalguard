// 가입 유형 단일 소스 — 누가 어느 검증 화면을 보는지가 이 파일 하나로 결정된다.
// ★ role 문자열을 늘리지 않고 이 축으로 나눈다 — 배포된 iOS 앱이 서버 role 을 owner/admin/worker
// 셋만 해석해서(modeForServerRole), 새 role 값을 내보내면 그 계정은 앱 로그인이 실패한다.
//
// 2026-08-28 재편(사용자 결정) — 종전 'member'(회원사 관리자) 하나가 조달청·공단 업무를 다 봤는데,
// 두 기관이 서로 남의 검증 화면까지 보는 상태였다. 담당 업무로 쪼갠다.
//   jodal  = 안전관리비 검증 담당(조달청)
//   kosha  = 공단 보조금 검증 담당(산업안전공단)
//   test   = 양쪽을 다 보는 시연·테스트 계정
// ⚠ 유형은 **소속 기관이 아니라 담당 업무**다. 행정안전부 소속이면서 안전관리비를 담당할 수 있어
//   유형(org_type)과 소속(company)은 1:1 이 아니다 — 회사 목록은 lib/companies.ts 가 따로 쥔다.
//
// contractor(현장 관리자) = 안전관리비 검증의 **피검증자** 계정(2026-08-27 사용자 결정).
// 근거 문서 제출은 하되 확정은 못 한다(자기 공사를 자기가 확정하면 검증이 성립하지 않는다).
// ⚠ 표기는 '현장 관리자'로 바뀌었지만 **내부 키는 'contractor' 로 유지**한다(2026-08-28) —
//   이 문자열이 세션 JWT 클레임·verifyBasicAuth·procureConfirmAccess·가드에 걸려 있어서,
//   값을 갈면 이미 발급된 세션이 전부 깨진다. 키는 두고 라벨만 바꾼다.

export const ORG_TYPES = ["vitalguard", "jodal", "kosha", "contractor", "test"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

// 가입 화면에 노출하는 유형 — test 는 뺀다.
// ⚠ test 는 양쪽 검증 화면을 다 보는 유형이라 가입 폼에 두면 아무나 전권 계정을 만든다.
//   admin_access·site_officer 와 같은 "자가취득 불가" 패턴 — owner 가 사용자 관리에서만 지정한다.
export const SIGNUP_ORG_TYPES = ["vitalguard", "jodal", "kosha", "contractor"] as const;
export type SignupOrgType = (typeof SIGNUP_ORG_TYPES)[number];

// ⚠ 타입이 SignupOrgType 이다(OrgType 이 아니라) — 가입 폼 상태의 기본값으로도 쓰이므로
//   'test' 가 들어갈 수 없는 좁은 타입이어야 한다. OrgType 자리에는 부분집합이라 그대로 들어간다.
export const DEFAULT_ORG_TYPE: SignupOrgType = "jodal";

export function isOrgType(value: unknown): value is OrgType {
  return typeof value === "string" && (ORG_TYPES as readonly string[]).includes(value);
}

// 가입 폼이 보내온 유형이 가입 가능한 것인지 — 서버 게이트(API 직접 호출로 test 를 못 만들게).
export function isSignupOrgType(value: unknown): value is SignupOrgType {
  return typeof value === "string" && (SIGNUP_ORG_TYPES as readonly string[]).includes(value);
}

// 화면 표기 — DB 에는 영문 키만 두고 라벨은 여기서만 만든다.
export function orgTypeLabel(value: string | null | undefined): string {
  if (value === "vitalguard") return "VitAlGuard 관리자";
  if (value === "jodal") return "조달청 관리자";
  if (value === "kosha") return "산업안전공단 관리자";
  if (value === "contractor") return "현장 관리자";
  if (value === "test") return "테스트 계정";
  // 구 'member' 잔여분 — 마이그레이션이 다 옮기지만 실패분이 남으면 여기로 떨어진다.
  return "회원사 관리자";
}

// ── 검증 화면 접근 ────────────────────────────────────────────────────────────
// 화면은 둘로 나뉜다. 라우트 목록은 lib/verification-area.ts 가 쥔다(경로↔영역 매핑).
export const VERIFICATION_AREAS = ["safetyCost", "subsidy"] as const;
export type VerificationArea = (typeof VERIFICATION_AREAS)[number];

// 유형별 열람 영역. contractor 는 여기 없다 — 제출 화면 하나만 쓰므로 별도 규칙(아래)이다.
// ⚠ 구 'member' 는 jodal 과 같이 취급한다(마이그레이션 잔여 대비). 최소권한으로 막으면
//   미처리 계정이 조용히 아무것도 못 보게 되어 원인 찾기가 어려워진다.
const AREA_BY_ORG_TYPE: Record<string, readonly VerificationArea[]> = {
  vitalguard: ["safetyCost", "subsidy"],
  test: ["safetyCost", "subsidy"],
  jodal: ["safetyCost"],
  member: ["safetyCost"],
  kosha: ["subsidy"],
  contractor: [],
};

export function areasForOrgType(orgType: string | null | undefined): readonly VerificationArea[] {
  return AREA_BY_ORG_TYPE[orgType ?? ""] ?? AREA_BY_ORG_TYPE.member!;
}

export function canViewArea(
  orgType: string | null | undefined,
  area: VerificationArea,
): boolean {
  return areasForOrgType(orgType).includes(area);
}

// 현장 관리자(구 시공사)인가 — 제출 화면(/contractor)으로만 들어간다.
export function isContractorOrgType(orgType: string | null | undefined): boolean {
  return orgType === "contractor";
}

// ── 권한 부여 게이트 ──────────────────────────────────────────────────────────

// 가입자 승인 권한 — VitAlGuard 소속 관리자이면서 owner 가 관리 권한을 부여한 계정만.
// (owner = env 부트스트랩 계정은 별도로 항상 허용 — admin-auth 에서 처리)
export function canApproveUsers(user: {
  role: string;
  org_type: string;
  status: string;
  admin_access: boolean;
}): boolean {
  return (
    user.role === "admin" &&
    user.org_type === "vitalguard" &&
    user.status === "approved" &&
    user.admin_access
  );
}

// 현장 담당관(안전관리비 확정 권한)을 **부여받을 수 있는** 유형인가(2026-08-28 사용자 결정).
// 안전관리비 확정은 조달청 업무라 공단 관리자에게는 부여 자체를 막는다.
// ⚠ contractor 는 피검증자라 영구 거부 — 자기 공사를 자기가 확정하면 검증이 성립하지 않는다.
export function canHoldSiteOfficer(orgType: string | null | undefined): boolean {
  return canViewArea(orgType, "safetyCost") && !isContractorOrgType(orgType);
}

// 담당관을 가질 수 있는 유형 목록 — SQL 게이트(setUserSiteOfficer)가 파라미터로 받는다.
// ⚠ SQL 에 유형 문자열을 하드코딩하지 않는다. 위 규칙에서 유도해야 이 파일이 단일 소스로 남는다.
// 구 'member' 잔여분도 후보에 넣는다(AREA_BY_ORG_TYPE 이 jodal 과 같이 취급하므로 자동 포함).
export const SITE_OFFICER_ORG_TYPES: string[] = [...ORG_TYPES, "member"].filter(canHoldSiteOfficer);
