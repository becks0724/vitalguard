// 가입 유형(VitAlGuard 관리자 / 회원사 관리자) 단일 소스.
// ★ role 문자열을 늘리지 않고 이 축으로 나눈다 — 배포된 iOS 앱이 서버 role 을 owner/admin/worker
// 셋만 해석해서(modeForServerRole), 새 role 값을 내보내면 그 계정은 앱 로그인이 실패한다.

export const ORG_TYPES = ["vitalguard", "member"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const DEFAULT_ORG_TYPE: OrgType = "member";

export function isOrgType(value: unknown): value is OrgType {
  return typeof value === "string" && (ORG_TYPES as readonly string[]).includes(value);
}

// 화면 표기 — DB 에는 영문 키만 두고 라벨은 여기서만 만든다.
export function orgTypeLabel(value: string | null | undefined): string {
  return value === "vitalguard" ? "VitAlGuard 관리자" : "회원사 관리자";
}

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
