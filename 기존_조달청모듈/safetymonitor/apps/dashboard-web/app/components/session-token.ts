// 관제 세션 토큰·역할의 sessionStorage 접근자 — 진입 게이트와 그 안쪽 컴포넌트가 함께 쓴다.
//
// ★ LoginGate.tsx 에서 떼어낸 이유 = **순환 의존**(2026-08-22).
//   LoginGate 가 SessionKeeper 를 렌더하는데, SessionKeeper 는 토큰을 읽으려고 다시
//   LoginGate 를 불렀다. 양쪽 다 타입이 아니라 실행되는 값이라 컴파일 후에도 남는 순환이었다.
//   접근자를 여기로 내리면 두 파일이 모두 이 모듈만 바라본다 — 서로를 보지 않는다.
//
// ⚠ 접근자를 LoginGate 로 되돌리지 말 것. 되돌리면 순환이 되살아나고 `pnpm graph:check` 가 빨개진다.
// ⚠ 키 상수도 여기 있다 — 읽는 쪽과 쓰는 쪽이 갈리면 키가 어긋난다.

// 대시보드 보기 권한 토큰 — 관리자 export(safetymonitor.admin.token.v1)와 별도 키로 보기/내보내기 권한 분리.
export const SESSION_KEY = "safetymonitor.session.v1";
// 로그인 역할(owner=env 관리자 / admin=승인된 가입자) — owner 전용 "사용자 관리" 노출 판정용.
export const ROLE_KEY = "safetymonitor.role.v1";

// 보호된 API 호출(예: PII 포함 GET) 시 Authorization 헤더로 동봉할 로그인 세션 토큰을 읽는다.
export function getSessionToken(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

// 서버가 401 로 거부한 낡은 토큰을 제거 — 게이트가 로그인 화면으로 복귀할 수 있게 한다.
// (LoginGate 는 토큰 존재만 보므로, 무효 토큰이 남으면 게이트 통과+서버 거부 상태에 갇힌다.)
export function clearSessionToken(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(ROLE_KEY);
  } catch {
    /* noop */
  }
}

// 현재 로그인 역할 — owner 만 사용자 관리(승인/거절) UI 노출.
export function getSessionRole(): string | null {
  try {
    return window.sessionStorage.getItem(ROLE_KEY);
  } catch {
    return null;
  }
}

// 가입 유형(orgType) — 토큰 페이로드에서 직접 읽는다(서명 검증은 서버 몫, 여기선 표시·라우팅용).
// ★ 별도 저장 키를 안 만드는 이유 = 로그인 경로가 셋(비번·구글 핸드오프·리프레시)이라 저장을
//   한 곳이라도 빠뜨리면 어긋난다. 클레임은 토큰 자체에 있으니 읽는 쪽을 하나로 모은다.
//   구 토큰(클레임 없음)은 null = 직원으로 해석(시공사 실계정은 클레임 도입 후에만 생긴다).
export function getSessionOrgType(): string | null {
  try {
    const token = window.sessionStorage.getItem(SESSION_KEY);
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { orgType?: string };
    return claims.orgType ?? null;
  } catch {
    return null;
  }
}
