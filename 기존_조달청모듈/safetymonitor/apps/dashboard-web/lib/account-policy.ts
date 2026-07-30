// 회원가입 아이디·비밀번호 규칙의 단일 소스 — 서버(register·check-username·profile)와 가입 폼이 이 함수만 쓴다.
// 종전엔 같은 정규식이 서버 2곳·클라 1곳에 복제돼 있어 한 곳만 고치면 조용히 어긋났다.

// 아이디 — 형식은 자유(한글·대문자·특수기호 허용), 길이만 국내 통용값으로 제한.
export const USERNAME_MIN = 4;
export const USERNAME_MAX = 20;

// 비밀번호 — "최소 8자 이상 최대 20자 미만"(사용자 요청 문구) = 8~19자.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 19;

// env owner 와 혼동되는 아이디는 가입 차단(로그인 1순위가 env owner 라 그림자 계정 방지).
const RESERVED = new Set(["admin", "owner", "root", "administrator", "superuser"]);

export type UsernameVerdict = "ok" | "invalid" | "reserved";

// 아이디 판정 — 길이·공백/제어문자·예약어. 그 외 문자는 제한하지 않는다.
export function checkUsername(raw: string): UsernameVerdict {
  const u = raw.trim();
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return "invalid";
  // 앞뒤 공백은 trim 으로 걷어냈으므로 여기 걸리는 건 가운데 공백·제어문자뿐이다.
  for (const ch of u) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return "invalid";
  }
  if (RESERVED.has(u.toLowerCase())) return "reserved";
  return "ok";
}

export type PasswordVerdict =
  | "ok"
  | "too_short"
  | "too_long"
  | "has_birth"
  | "has_phone";

// 비밀번호 판정 — 길이 + 본인 생년월일·연락처 포함 금지.
// 숫자만 뽑아 비교한다. 사용자가 `1990-01-01` 을 `19900101`·`900101` 어느 쪽으로 넣든 걸리게 하려는 것.
export function checkPassword(
  password: string,
  owner: { birthDate?: string | null; phone?: string | null },
): PasswordVerdict {
  if (password.length < PASSWORD_MIN) return "too_short";
  if (password.length > PASSWORD_MAX) return "too_long";

  const digits = password.replace(/\D/g, "");
  if (!digits) return "ok"; // 숫자가 없으면 생년월일·연락처와 겹칠 수 없다

  const birth = (owner.birthDate ?? "").replace(/\D/g, "");
  if (birth.length === 8 && (digits.includes(birth) || digits.includes(birth.slice(2)))) {
    return "has_birth";
  }

  const phone = (owner.phone ?? "").replace(/\D/g, "");
  if (phone.length >= 10 && (digits.includes(phone) || digits.includes(phone.slice(-8)))) {
    return "has_phone";
  }

  return "ok";
}

// 생년월일 — YYYY-MM-DD 형식과 실제 존재하는 날짜인지, 그리고 상식 범위(1900년~오늘)인지.
export function isValidBirthDate(raw: string): boolean {
  const v = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  // Date 는 2026-02-31 을 3월로 굴려버리므로, 되돌린 문자열이 같은지로 실재 날짜를 확인한다.
  if (d.toISOString().slice(0, 10) !== v) return false;
  const year = Number(v.slice(0, 4));
  return year >= 1900 && d.getTime() <= Date.now();
}

// 서버 응답용 한국어 안내(클라이언트는 자체 다국어 문구를 쓰므로 판정값만 참고한다).
export function usernameMessage(verdict: Exclude<UsernameVerdict, "ok">): string {
  return verdict === "reserved"
    ? "사용할 수 없는 아이디입니다."
    : `아이디는 ${USERNAME_MIN}~${USERNAME_MAX}자이며 공백을 쓸 수 없습니다.`;
}

export function passwordMessage(verdict: Exclude<PasswordVerdict, "ok">): string {
  switch (verdict) {
    case "too_short":
      return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 합니다.`;
    case "too_long":
      return `비밀번호는 ${PASSWORD_MAX}자 이하여야 합니다.`;
    case "has_birth":
      return "비밀번호에 생년월일을 넣을 수 없습니다.";
    case "has_phone":
      return "비밀번호에 연락처를 넣을 수 없습니다.";
  }
}
