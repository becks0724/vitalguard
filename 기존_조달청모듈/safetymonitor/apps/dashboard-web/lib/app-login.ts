// 앱 로그인 자격 검증 — 계정 조회·scrypt 검증·승인 확인·사번 결정까지 한 곳에서.
//
// 왜 라우트에서 뺐나. 모바일 세션 API(POST /api/mobile/v1/session/login)가 추가될 예정인데,
// 같은 검증을 라우트마다 복제하면 두 경로의 판정이 갈라진다. 한쪽만 고친 채 다른 쪽이 남는 사고가
// 실제로 있었다(2026-07-29 사번 빈 문자열 → 수집 401, 배포 4회 롤백). 판정은 여기 한 곳에서만 한다.
//
// 시도 제한(잠금)은 여기 없다 — 라우트가 응답 형식을 정해야 하고, 성공/실패 기록 시점도
// 라우트마다 다르기 때문(lib/login-attempts 참조).
import { verifyCredentials } from "./admin-auth";
import { bootstrapOwnerWorkerId } from "./app-jwt";
import { findUserByUsername } from "./db";
import { defaultEmployeeId } from "./employee-id";
import { verifyPassword } from "./password";

export type AppPrincipal = {
  /** JWT sub — 로그인 ID(username) 또는 부트스트랩 owner ID */
  sub: string;
  role: string; // owner | admin | worker
  name: string | null;
  /** 사번(employee_id) — 생체·미디어 레코드와 매칭하는 키 */
  workerId: string | null;
};

export type AppLoginOutcome =
  | { ok: true; principal: AppPrincipal }
  /** 계정이 없거나 비밀번호 불일치. 둘을 구분해 응답하면 계정 존재 여부가 샌다. */
  | { ok: false; reason: "invalid_credentials" }
  /** 비밀번호는 맞았으나 승인 전. 이 경우는 무차별 대입이 아니므로 잠금 카운터를 올리지 않는다. */
  | { ok: false; reason: "not_approved" };

export async function authenticateAppLogin(
  id: string,
  password: string,
): Promise<AppLoginOutcome> {
  // 1) env owner(부트스트랩 관리자) 우선 — DB 행이 없어도 생체 전송의 사번 바인딩을 만족해야 하므로
  //    로그인 ID 원문 대신 안정적인 불투명 식별자를 쓴다.
  if (verifyCredentials(id, password)) {
    return {
      ok: true,
      principal: { sub: id, role: "owner", name: null, workerId: bootstrapOwnerWorkerId(id) },
    };
  }

  // 2) DB 계정(관리자·근로자) — scrypt 검증 후 승인 상태 확인.
  const account = await findUserByUsername(id);
  // Google 전용 계정(password_hash null)은 비번 로그인 불가.
  const passwordOk =
    account && account.password_hash
      ? await verifyPassword(password, account.password_hash)
      : false;
  if (!account || !passwordOk) return { ok: false, reason: "invalid_credentials" };
  if (account.status !== "approved") return { ok: false, reason: "not_approved" };

  // 사번 — `?? null` 만으로는 부족하다. `??` 는 null·undefined 만 거르므로 빈 문자열('')이 그대로
  // 통과해 workerId:"" 인 토큰이 발급되고, 수집 라우트의 `!claims?.workerId` 가 falsy 로 잡아 401 을 낸다.
  // 앱은 토큰을 실어 보내는데도 거부되므로 원인이 드러나지 않는다(2026-07-29 배포 4회 롤백의 원인).
  // 값이 비면 서버가 이미 쓰는 규칙(EMP-<username>)으로 되살린다 — 백필·앱 폴백과 같은 값이라
  // 기존 생체·미디어 레코드와 즉시 맞물린다.
  const storedEmployeeId = (account.employee_id ?? "").trim();
  const workerId = storedEmployeeId || defaultEmployeeId(account.username) || null;

  return {
    ok: true,
    principal: {
      sub: account.username,
      role: account.role,
      name: account.name ?? null,
      workerId,
    },
  };
}

/**
 * 잠금 카운터에 성공으로 기록할지 여부.
 * 비밀번호가 맞았다면 승인 전이어도 무차별 대입이 아니므로 카운터를 리셋한다(기존 동작 유지).
 */
export function countsAsPasswordSuccess(outcome: AppLoginOutcome): boolean {
  return outcome.ok || outcome.reason === "not_approved";
}
