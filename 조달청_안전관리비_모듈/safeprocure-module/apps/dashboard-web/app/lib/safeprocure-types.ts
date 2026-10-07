// 안전조달(SafeProcure) 공용 타입 — 런타임 의존 없는 순수 TypeScript 타입.
// (zod 스키마는 g2b.ts/route 에서 외부 응답 파싱 시 별도 사용. 이 파일은 로직·테스트가
//  node 타입스트리핑으로 의존성 없이 돌도록 타입만 둔다.)

/** 산업안전보건관리비 계상기준 공사종류 (고용노동부 고시 제2025-11호 별표1 분류, 신 4공종). */
export type ConstructionType =
  | "건축공사"
  | "토목공사"
  | "중건설공사"
  | "특수건설공사";

/** 안전관리비 예비검증 판정 — '탐지'가 아닌 '의심/검토' (과장 금지 원칙). */
// 과다계상_의심 은 위법 판정이 아니다 — 법정 요율은 '최소' 계상 기준이라 초과 계상 자체는 적법하다.
// 다만 현저한 초과는 대상액 부풀리기·집행 미달의 선행 신호라 실집행(③) 과 함께 볼 대상으로 선별한다.
export type SafetyCostVerdict = "정상" | "과소계상_의심" | "과다계상_의심" | "검토필요";

/** 대상액 구간. */
export type CostBracket = "under5" | "mid" | "over50";

export interface SafetyCostInput {
  constructionType: ConstructionType;
  /** 안전관리비 대상액(원) = 직접재료비+간접재료비+직접노무비. 없으면 추정가격 근사. */
  baseAmount: number;
  /** 대상액이 추정가격 근사치인지(직접 대상액이 아니면 true → 검토필요로 강등). */
  baseAmountIsApprox?: boolean;
  /** 공고/계약에 명시된 안전관리비(원). 없으면 비교 불가 → 검토필요. */
  declaredCost?: number | null;
  /** 공사기간(일). 위험 가중 메타데이터(요율 계산에는 미사용). */
  durationDays?: number | null;
}

export interface SafetyCostCheck {
  constructionType: ConstructionType;
  baseAmount: number;
  bracket: CostBracket;
  rateApplied: number; // 적용 요율(소수, 예 0.0186)
  baseAdded: number; // 가산 기초액(원)
  requiredCost: number; // 산정된 기준 안전관리비(원)
  formula: string; // 사람이 읽는 산정식
  inputSufficiency: "full" | "partial";
  declaredCost: number | null;
  verdict: SafetyCostVerdict;
  rateNote: string; // ⚠ 요율 출처/검증 안내
  /** 끝수 폭(국고금 관리법 제47조)이 판정을 가른 경우의 안내 — 없으면 표시 안 함.
   *  ⚠ 2026-08-27 병렬 세션 lost-update 로 두 번 지워진 필드 — 지우면 typecheck 가 깨진다
   *    (소비처: safety-cost.ts evaluateSafetyCost · ProcureRiskCard.tsx). */
  verdictNote?: string;
}

/** 표준화된 조달 공고 요약(목록용). */
export interface NoticeSummary {
  id: string;
  title: string;
  kind: "공사" | "용역" | "물품";
  agency: string; // 수요기관
  region?: string;
  estimatedPrice: number | null; // 추정가격(원)
  startDate?: string; // ISO yyyy-mm-dd
  endDate?: string;
  licenses: string[]; // 면허/업종 제한
  winRate?: number | null; // 낙찰률(%) — 계약 건은 낙찰정보서비스에서 보강
  /** 시공사(계약업체명, cntrctCorpNm) — 계약 건에만 있다. 시공사 가입 화이트리스트의 출처. */
  contractor?: string | null;
}

/** 공고 상세(분석 입력). */
export interface NoticeDetail extends NoticeSummary {
  taskText: string; // 과업/공고 전문 텍스트
  /** 공고 첨부문서(시방서·과업내용서·공고규격서) — 파일명+나라장터 다운로드 URL 쌍. */
  specDocs?: { name: string; url: string }[];
  contractAmount?: number | null;
  ntceNo?: string | null; // 입찰공고번호 — 낙찰정보서비스 조회 키(계약 응답 ntceNo)
  declaredSafetyCost?: number | null; // 공고/계약 명시 안전관리비(있으면)
  /** 안전관리비 대상액(원). 계약 단계에서 확보되면 정밀 검증, 없으면 추정가격 근사(→검토필요). */
  targetAmount?: number | null;
}

export type RiskTagSource = "ai" | "rule" | "mock";

export interface RiskTag {
  tag: string;
  severity: 1 | 2 | 3;
  evidence: string; // 원문 근거문장(반드시 taskText 부분문자열)
  source: RiskTagSource;
}

export interface RiskProfile {
  noticeId: string;
  score: number; // 0~100
  breakdown: { 위험작업: number; 안전관리비의심: number; 낙찰공기: number; 공종재해통계: number };
  topFactors: string[];
  recommendations: string[]; // 3개
  safetyCost: SafetyCostCheck;
  tags: RiskTag[];
}
