// B2B 승인 기업 목록 — 회원가입 회사(상호) 선택지(승인된 기업만 가입 가능).
// 기업 추가/삭제는 아래 배열만 편집(개발사 관리). 향후 DB/관리 UI 전환 시 이 단일 소스를 교체.
//
// ⚠ 유형(org_type)과 소속(company)은 1:1 이 아니다 — 유형은 **담당 업무**이고 회사는 **소속 기관**이다.
//   행정안전부 소속이면서 안전관리비를 담당할 수 있으므로 한 유형이 여러 기관을 받는다.
import { type OrgType } from "./org-type";

// 자사(개발사) — VitAlGuard 관리자 유형이 쓰는 유일한 상호.
// 「(주)바이탈가드」 표기는 같은 회사를 DB 에 두 문자열로 쌓게 해 목록에서 뺐다(2026-08-01, 사용자 결정).
// ⚠ 목록에서만 뺐을 뿐 그 표기의 기존 계정 1건은 DB 에 그대로 남아 있다(2026-08-28 실측).
export const VITALGUARD_COMPANY = "VitAlGuard";

// 안전관리비 검증 담당 기관 — 'jodal'(조달청 관리자) 유형의 선택지.
// 행정안전부는 소속은 다르지만 안전관리비 검증을 담당하므로 여기 둔다(2026-08-28 사용자 결정).
export const JODAL_COMPANIES = ["조달청", "행정안전부"];

// 공단 보조금 검증 담당 기관 — 'kosha'(산업안전공단 관리자) 유형의 선택지.
// 고용노동부는 공단의 상급기관이자 산업안전보건 주무부처라 보조금 쪽에 둔다(2026-08-28).
export const KOSHA_COMPANIES = ["산업안전공단", "고용노동부"];

// 현장 관리자 — contractor 유형의 선택지(2026-08-27 실계정 발급 결정 · 데모용).
// 출처 = 나라장터 실계약 3건의 주계약업체(계약 API corpList 원시 응답 실측, 2026-08-27):
//   R26TE13895124 시민문화복지센터 내진성능 보강공사 → 주식회사 백산건설
//   R26TE13894834 사직동 코워킹스페이스 리모델링공사 → 현대도건 주식회사
//   R26TE13877355 삼계2교 외 2개소 교량보수공사     → 성광종합건설(주)
// ⚠ 목록을 비우면 현장 관리자 가입이 서버 게이트에서 다시 잠긴다(고를 상호가 없어진다).
export const CONTRACTOR_COMPANIES: string[] = ["주식회사 백산건설", "현대도건 주식회사", "성광종합건설(주)"];

export const ALLOWED_COMPANIES = [
  VITALGUARD_COMPANY,
  ...JODAL_COMPANIES,
  ...KOSHA_COMPANIES,
  ...CONTRACTOR_COMPANIES,
];

// 가입 유형이 고를 수 있는 상호 — 화면(선택지)과 서버(게이트)가 같은 함수를 본다.
// 둘이 어긋나면 "고를 수는 있는데 저장은 거부되는" 항목이 생긴다.
// ⚠ test(테스트 계정)는 전체 허용 — 시연에서 어느 기관으로든 세울 수 있어야 한다.
//   가입 폼에는 노출되지 않으므로(SIGNUP_ORG_TYPES) 이 관대함이 가입 경로를 열지는 않는다.
export function companiesForOrgType(orgType: OrgType | string): string[] {
  if (orgType === "vitalguard") return [VITALGUARD_COMPANY];
  if (orgType === "kosha") return KOSHA_COMPANIES;
  if (orgType === "contractor") return CONTRACTOR_COMPANIES;
  if (orgType === "test") return ALLOWED_COMPANIES;
  // jodal + 구 'member' 잔여분
  return JODAL_COMPANIES;
}

// 제출된 회사(상호)가 승인 목록에 있는지 검증(서버 게이트 — API 직접 호출 우회 차단).
export function isAllowedCompany(name: string): boolean {
  return ALLOWED_COMPANIES.includes(name.trim());
}

// 가입 유형↔상호 정합성 — VitAlGuard 관리자가 회원사 상호로, 조달청 관리자가 자사 상호로
// 가입하는 것을 막는다. 화면에서 선택지를 좁히는 것만으로는 API 직접 호출을 못 막는다.
export function isAllowedCompanyForOrgType(name: string, orgType: OrgType | string): boolean {
  return companiesForOrgType(orgType).includes(name.trim());
}
