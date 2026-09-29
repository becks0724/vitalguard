/** 앱 본인 프로필 전용 DTO. 전화 원문·보호자·인증 비밀은 반환하지 않는다. */
export function maskProfilePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 10 || digits.length === 11)
    return `${digits.slice(0, 3)}-${"*".repeat(digits.length - 7)}-**${digits.slice(-2)}`;
  return `${digits.slice(0, 3)}${"*".repeat(digits.length - 5)}${digits.slice(-2)}`;
}

type ProfileSource = {
  name?: string | null; company?: string | null; department?: string | null;
  job_title?: string | null; employee_id?: string | null; phone?: string | null; email?: string | null;
};
export function appMemberProfile(username: string, role: string, profile: ProfileSource | null) {
  return {
    username, role,
    name: profile?.name ?? null,
    company: profile?.company ?? null,
    department: profile?.department ?? null,
    jobTitle: profile?.job_title ?? null,
    employeeId: profile?.employee_id ?? null,
    phoneMasked: maskProfilePhone(profile?.phone),
    email: profile?.email ?? null,
  };
}
