// B2B 승인 기업 목록 — 회원가입 회사(상호) 선택지(승인된 기업만 가입 가능).
// 기업 추가/삭제는 아래 배열만 편집(개발사 관리). 향후 DB/관리 UI 전환 시 이 단일 소스를 교체.
export const ALLOWED_COMPANIES = [
  "(주)바이탈가드",
  "VitAlGuard",
  "스마트인재개발원",
  "조달청",
  "고용노동부",
];

// 제출된 회사(상호)가 승인 목록에 있는지 검증(서버 게이트 — API 직접 호출 우회 차단).
export function isAllowedCompany(name: string): boolean {
  return ALLOWED_COMPANIES.includes(name.trim());
}
