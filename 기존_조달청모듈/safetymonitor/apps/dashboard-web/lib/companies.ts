// B2B 승인 기업 목록 — 회원가입 회사(상호) 선택지(승인된 기업만 가입 가능).
// 기업 추가/삭제는 아래 배열만 편집(개발사 관리). 향후 DB/관리 UI 전환 시 이 단일 소스를 교체.
import type { OrgType } from "./org-type";

// 자사(개발사) — VitAlGuard 관리자 유형이 쓰는 유일한 상호.
// 「(주)바이탈가드」 표기는 같은 회사를 DB 에 두 문자열로 쌓게 해 목록에서 뺐다(2026-08-01, 사용자 결정).
export const VITALGUARD_COMPANY = "VitAlGuard";

// 회원사 — 회원사 관리자 유형의 선택지.
export const MEMBER_COMPANIES = ["스마트인재개발원", "조달청", "고용노동부", "행정안전부"];

// 시공사 — contractor 유형의 선택지(2026-08-27 실계정 발급 결정 · 데모용).
// 출처 = 나라장터 실계약 3건의 주계약업체(계약 API corpList 원시 응답 실측, 2026-08-27):
//   R26TE13895124 시민문화복지센터 내진성능 보강공사 → 주식회사 백산건설
//   R26TE13894834 사직동 코워킹스페이스 리모델링공사 → 현대도건 주식회사
//   R26TE13877355 삼계2교 외 2개소 교량보수공사     → 성광종합건설(주)
// ⚠ 목록을 비우면 시공사 가입이 서버 게이트에서 다시 잠긴다(고를 상호가 없어진다).
export const CONTRACTOR_COMPANIES: string[] = ["주식회사 백산건설", "현대도건 주식회사", "성광종합건설(주)"];

export const ALLOWED_COMPANIES = [VITALGUARD_COMPANY, ...MEMBER_COMPANIES, ...CONTRACTOR_COMPANIES];

// 가입 유형이 고를 수 있는 상호 — 화면(선택지)과 서버(게이트)가 같은 함수를 본다.
// 둘이 어긋나면 "고를 수는 있는데 저장은 거부되는" 항목이 생긴다.
export function companiesForOrgType(orgType: OrgType): string[] {
  if (orgType === "vitalguard") return [VITALGUARD_COMPANY];
  if (orgType === "contractor") return CONTRACTOR_COMPANIES;
  return MEMBER_COMPANIES;
}

// 제출된 회사(상호)가 승인 목록에 있는지 검증(서버 게이트 — API 직접 호출 우회 차단).
export function isAllowedCompany(name: string): boolean {
  return ALLOWED_COMPANIES.includes(name.trim());
}

// 가입 유형↔상호 정합성 — VitAlGuard 관리자가 회원사 상호로, 회원사 관리자가 자사 상호로
// 가입하는 것을 막는다. 화면에서 선택지를 좁히는 것만으로는 API 직접 호출을 못 막는다.
export function isAllowedCompanyForOrgType(name: string, orgType: OrgType): boolean {
  return companiesForOrgType(orgType).includes(name.trim());
}
