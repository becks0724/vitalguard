// 보호자 이름/관계 공유 로직 — 저장값은 "이름 (관계)" 단일 문자열(알람 표출·DEMO_GUARDIANS 포맷과 동일).
//   관계는 프리셋 선택 + '기타' 직접입력. 이름만 있으면 관계 괄호 없이 이름만 저장(관계는 선택).
export const GUARDIAN_RELATIONS = ["배우자", "자녀", "부모", "형제자매", "친척", "지인", "기타"];

// 저장 문자열 분해 — "김보호 (배우자)" → {name:'김보호', relation:'배우자', custom:''}.
//   프리셋에 없는 관계(예: "이모")는 relation='기타', custom='이모'. 괄호 없으면 전체가 이름.
export function parseGuardian(stored: string | null): {
  name: string;
  relation: string;
  custom: string;
} {
  const s = (stored ?? "").trim();
  if (!s) return { name: "", relation: "", custom: "" };
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { name: s, relation: "", custom: "" };
  const name = (m[1] ?? "").trim();
  const rel = (m[2] ?? "").trim();
  if (!rel) return { name, relation: "", custom: "" };
  if (GUARDIAN_RELATIONS.includes(rel) && rel !== "기타") {
    return { name, relation: rel, custom: "" };
  }
  return { name, relation: "기타", custom: rel };
}

// 이름 + 관계(프리셋 또는 '기타' 직접입력) → 저장 문자열. 이름 없으면 빈 문자열(=미등록).
export function composeGuardian(name: string, relation: string, custom: string): string {
  const n = name.trim();
  if (!n) return "";
  const rel = (relation === "기타" ? custom : relation).trim();
  return rel ? `${n} (${rel})` : n;
}
