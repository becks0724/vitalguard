// 관리자 앱 조회 게이트 — 모바일 세션 토큰 + **살아 있는** 관리 권한.
//
// 왜 `/api/monitor/*` 를 열지 않고 `/api/app/admin/*` 을 새로 만드나. 그쪽 인가는
// `verifyBasicAuth`(관제 세션·오너 자격)이고 응답은 **전 작업자 + PII** 다. 거기에 앱 토큰을
// 통과시키면 작업자 폰이 동료 전원의 생체를 보게 된다(`app/api/app/me/vitals/route.ts` 주석).
// 축을 지킨다 — **앱이 쓰는 것 `/api/app/*` · 관제가 쓰는 것 `/api/monitor/*`**.
//
// ★ 검증은 `verifyMobileAccessJwt` 만 쓴다. 레거시 `signAppJwt`(워치·수집 단말)는 2단계 인증을
//   거치지 않으므로 여기 닿으면 안 된다. 그 토큰에는 `aud`·`tokenUse`·`v:2`·`sessionId` 가 없어
//   **구조적으로** 막힌다(2026-09-03 가드에서 실제 서명·검증으로 시험).
//
// ★★ 권한은 **토큰이 아니라 DB 에서** 읽는다. 모바일 refresh 는 30일이고 갱신은 세션 행에 저장된
//    `role` 로 access 를 재발급하므로(`session/refresh/route.ts`), 권한을 회수해도 토큰은 최대
//    30일 동안 옛 값을 실어 나른다. `admin_access` 회수·퇴사(`status`)가 **즉시** 듣게 하려면
//    매 요청에서 살아 있는 행을 봐야 한다. 관제웹 `hasAdminMenuAccess` 도 같은 형태이고,
//    여기서는 `status` 까지 본다 — 웹 세션은 서버 TTL 이 짧지만 앱은 30일이라 노출이 다르다.
import { bearerToken, mobileUnauthorizedAction, verifyMobileAccessJwt } from "./app-jwt";
import { findUserByUsername } from "./db";

export type AppAdminPrincipal = {
  /** 로그인 ID(username) */
  username: string;
  role: string;
  /** 사번 — 본인 데이터를 함께 보여줄 때 쓴다. 관리자 조회의 스코프 키가 아니다. */
  workerId: string | null;
};

export type AppAdminGate =
  | { ok: true; principal: AppAdminPrincipal }
  | { ok: false; status: number; body: Record<string, unknown> };

/** 401 은 "다시 인증하라", 403 은 "인증은 됐으나 권한이 없다" — 앱이 둘을 다르게 처리해야 한다. */
const forbidden = { ok: false as const, status: 403, body: { ok: false, error: "forbidden" } };

/**
 * 관리자 앱 조회 자격 확인.
 *
 * 반환이 `ok:false` 면 **그대로 응답**한다 — 사유를 라우트마다 다시 쓰면 갈라진다.
 * 401 에는 `action` 을 실어 만료(refresh 로 회복)와 재로그인 필요를 구분한다(앱은 `reauth` 를
 * 받으면 refresh 토큰까지 지운다 · `session/me` 와 같은 규칙).
 */
export async function requireAppAdmin(request: Request): Promise<AppAdminGate> {
  const token = bearerToken(request);
  const claims = verifyMobileAccessJwt(token);
  if (!claims) {
    return {
      ok: false,
      status: 401,
      body: { ok: false, error: "unauthorized", action: mobileUnauthorizedAction(token) },
    };
  }

  let user: Awaited<ReturnType<typeof findUserByUsername>>;
  try {
    user = await findUserByUsername(claims.sub);
  } catch (e) {
    // ⚠ 조회 실패는 "권한 없음" 이 아니라 **판정 불가**다. 여기서 통과시키면 DB 장애가 곧
    //   인가 우회가 된다. 503 으로 닫고 앱이 재시도하게 한다(403 이면 앱이 로그아웃해 버린다).
    console.warn("[app-admin] 권한 조회 실패 — 판정 불가로 닫는다", e);
    return { ok: false, status: 503, body: { ok: false, error: "권한 확인 실패" } };
  }

  if (!user) {
    // DB 행이 없는 계정은 env owner(부트스트랩 관리자) 하나뿐이다 — 그 계정만 토큰의 role 로
    // 인정한다. 관제웹도 같은 예외를 둔다(`/api/admin/totp` 의 NO_DB_ROW 주석).
    return claims.role === "owner"
      ? { ok: true, principal: { username: claims.sub, role: "owner", workerId: claims.workerId } }
      : forbidden;
  }

  // 퇴사·거절 계정은 토큰이 남아 있어도 막는다(`users.status` 를 rejected 로 내리는 것이
  // 이 프로젝트의 자격 회수 수단이다 — CLAUDE.md "자격 회수").
  if (user.status !== "approved") return forbidden;
  // 권한 판정은 관제웹과 같은 축이다 — role owner 또는 admin_access 비트.
  // ⚠ role 을 늘려 나누지 않는다(배포된 앱이 owner/admin/worker 셋만 해석한다 · db.ts 주석).
  if (user.role !== "owner" && !user.admin_access) return forbidden;

  return {
    ok: true,
    principal: { username: user.username, role: user.role, workerId: claims.workerId },
  };
}
