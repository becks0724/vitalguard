// 2단계 인증 정책 — **누가 대상인가** 하나만 정한다(코드 계산은 lib/totp.ts).
// 화면·로그인·사용자 관리가 이 함수 하나를 본다. 세 곳이 각자 판정하면 서로 어긋난다.
//
// ★ 대상을 고권한 계정으로 한정한 근거(2026-08-28 사용자 결정):
//   이 대시보드는 근로자 위치·영상·생체를 다뤄 계정 하나가 털리면 피해가 크다. 그런데 구글
//   로그인 계정은 구글이 2단계를 맡는 반면 **비밀번호 계정만 단일 요소로 남는** 비대칭이 있다.
//   그 비대칭을 메우는 것이 목적이므로 대상은 실제로 그 데이터와 확정 권한을 쥔 계정이다.
//
// ⚠ 전 계정에 걸지 않는다 — 현장 근로자는 휴대폰 앱으로 로그인하는데, 배포된 앱에는 6자리
//   입력 화면이 없다. 앱은 서버 role 을 owner/admin/worker 셋으로만 해석하므로(db.ts 주석)
//   worker 로그인 경로에 단계를 하나 더 끼우면 현장에서 앱을 못 쓴다.

export type TwoFactorSubject = {
  role: string;
  admin_access: boolean;
  site_officer: boolean;
};

// 이 계정이 2단계 인증 대상인가 — 등록을 요구할지, 로그인에서 물을지의 단일 기준.
export function requiresTwoFactor(user: TwoFactorSubject): boolean {
  if (user.role === "owner") return true; // 최고관리자
  if (user.admin_access) return true; // 관리자 메뉴(내보내기·전체 조회) 권한자
  if (user.site_officer) return true; // 현장 담당관(안전관리비 확정 권한)
  return false;
}

// 지금 로그인에서 6자리를 물어야 하는가.
// ⚠ 대상이지만 아직 등록을 안 한 계정은 **통과시킨다**. 여기서 막으면 등록할 방법이 없어
//   계정이 잠긴다(등록 화면 자체가 로그인 뒤에 있다). 미등록자는 화면이 등록을 권한다.
export function shouldChallenge(user: TwoFactorSubject & { totp_enabled: boolean }): boolean {
  return requiresTwoFactor(user) && user.totp_enabled;
}

// 대상인데 아직 등록하지 않은 상태 — 로그인 후 화면이 등록을 안내할 때 쓴다.
export function twoFactorPending(user: TwoFactorSubject & { totp_enabled: boolean }): boolean {
  return requiresTwoFactor(user) && !user.totp_enabled;
}
