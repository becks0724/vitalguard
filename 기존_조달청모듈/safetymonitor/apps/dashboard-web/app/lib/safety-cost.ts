// 안전관리비 예비검증 룰엔진 — 결정적(AI 아님) 계산으로 신뢰성 확보.
// 산업안전보건관리비 법정 계상요율(공사종류 × 대상액 구간)로 기준 안전관리비를 산정하고,
// 공고/계약에 명시된 값과 비교해 '정상 / 과소계상_의심 / 과다계상_의심 / 검토필요' 로 분류한다.
// 핵심 원칙: 입력이 부족하면 단정하지 않고 '검토필요'로 강등(과장 금지).
import type {
  ConstructionType,
  CostBracket,
  SafetyCostCheck,
  SafetyCostInput,
} from "./safeprocure-types";

// ── 요율표 (현행 고시 제2025-11호 별표1) ─────────────────────────────────
// 출처: 고용노동부 고시 「건설업 산업안전보건관리비 계상 및 사용기준」 제2025-11호(2025.2.12 시행) 별표1.
//   공식 HWPX 별표1 + 산업안전지원센터 계산기 + koit 인포그래픽 3중 교차검증(2026-06).
//   직전 개정(제2024-53호, 2025.1.1~ 신규계약분)에서 평균 약 19% 인상되며 신 4공종으로 재분류됨.
//   기초액 단위는 '원'(예: 4,325,000원 = 432.5만원) — 만원 환산 혼동 주의.
// ponytail: 별표1의 '보건관리자 선임대상 적용비율' 열은 제외. 본 모듈 타겟(소액 관급공사)은
//   선임대상(공사금액 800억↑ 또는 상시근로자 600명↑)이 될 일이 없어 일반 계상비율만 사용.
//   (필요해지면 RateRow에 healthMgr 비율 추가 + 입력 플래그로 분기.)
const RATE_NOTE =
  "요율 출처: 고용노동부 고시 제2025-11호(2025.2.12 시행) 별표1. 공식 별표1 HWP 최종 대조 권장.";

// 이 요율표가 근거하는 고시 버전 — 법제처 API(lib/moleg.ts)가 최신 고시와 비교해 개정 드리프트를 감지한다.
// 고시 개정 확인 시: 별표1 요율 대조 → SAFETY_COST_RATES 갱신 → 아래 버전 정보 갱신.
export const APPLIED_RATE_NOTICE = {
  name: "건설업 산업안전보건관리비 계상 및 사용기준",
  noticeNo: "제2025-11호",
  effectiveDate: "2025-02-12", // 시행일자(YYYY-MM-DD)
} as const;

export type RateRow = {
  under5: number; // 대상액 5억 미만 요율
  mid: { rate: number; base: number }; // 5억~50억: 요율 + 기초액(원)
  over50: number; // 50억 이상 요율
};

export const SAFETY_COST_RATES: Record<ConstructionType, RateRow> = {
  "건축공사": { under5: 0.0311, mid: { rate: 0.0228, base: 4_325_000 }, over50: 0.0237 },
  "토목공사": { under5: 0.0315, mid: { rate: 0.0253, base: 3_300_000 }, over50: 0.026 },
  "중건설공사": { under5: 0.0364, mid: { rate: 0.0305, base: 2_975_000 }, over50: 0.0311 },
  "특수건설공사": { under5: 0.0207, mid: { rate: 0.0159, base: 2_450_000 }, over50: 0.0164 },
};

const FIVE_EOK = 500_000_000; // 5억
const FIFTY_EOK = 5_000_000_000; // 50억

/** 대상액 구간 판정 — 경계값(정확히 5억/50억)은 상위(이상) 구간에 포함. */
export function bracketOf(baseAmount: number): CostBracket {
  if (baseAmount < FIVE_EOK) return "under5";
  if (baseAmount < FIFTY_EOK) return "mid";
  return "over50";
}

function fmtWon(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/**
 * 면허/공종·과업 텍스트로 공사종류를 추정(휴리스틱, 신 4공종).
 * ⚠ 단순 매핑 — 별표1 비고의 공종 정의/소관부처 기준으로 정밀 매핑표 교체 권장.
 * 판정 순서: ① 대형구조물 키워드(면허보다 우선 — 지하철/플랜트는 토목·건축 면허로도 중건설)
 *   → ② 면허(업종) 우선(공식 분류라 과업 부수공정 키워드보다 신뢰도 높음 — 건물 신축의 "전기/터파기"
 *      부수공정 오분류 방지) → ③ 면허 불명 시 과업텍스트 폴백 → ④ 미상이면 건축 기본.
 */
export function classifyConstructionType(
  licenses: string[],
  text = "",
): { type: ConstructionType; reason: string } {
  const lic = licenses.join(" ");
  const hay = `${lic} ${text}`;
  const has = (re: RegExp) => re.test(hay);

  // ① 대형구조물 키워드 — 면허보다 우선
  if (has(/댐|발전|플랜트|터널|지하철|철도|궤도|항만|방조제/))
    return { type: "중건설공사", reason: "댐/터널/발전/지하철 등 대형 구조물 키워드" };

  // ② 면허(업종) 우선 — 과업문 부수공정 키워드보다 신뢰
  if (/건축/.test(lic)) return { type: "건축공사", reason: "건축공사업 면허" };
  if (/토목/.test(lic)) return { type: "토목공사", reason: "토목공사업 면허" };
  if (/산업[·\s]?환경설비|기계설비/.test(lic))
    return { type: "중건설공사", reason: "산업·환경설비/기계설비 면허" };
  if (/전기|정보통신|통신|소방|조경|승강기|준설/.test(lic))
    return { type: "특수건설공사", reason: "전기/통신/소방/조경 등 전문 면허" };

  // ③ 면허 불명 → 과업텍스트 폴백
  if (has(/전기|정보통신|통신|소방|조경|승강기|준설/))
    return { type: "특수건설공사", reason: "전기/통신/소방/조경 등 전문공종(과업)" };
  if (has(/토목|토공|굴착|터파기|상수도|하수도|상하수|관로|교량|도로|포장|사면|옹벽/))
    return { type: "토목공사", reason: "토목 계열 키워드(과업)" };
  // ④ 기본값
  return { type: "건축공사", reason: "건축 등 일반 (기본값)" };
}

/** 기준 안전관리비 산정(순수 계산). */
export function computeRequiredSafetyCost(
  constructionType: ConstructionType,
  baseAmount: number,
  // 요율표 주입 — 기본은 내장(고시 제2025-11호), 법제처 별표1 실시간 파싱값(lib/moleg)으로 교체 가능.
  rates: Record<ConstructionType, RateRow> = SAFETY_COST_RATES,
): { requiredCost: number; rateApplied: number; baseAdded: number; bracket: CostBracket; formula: string } {
  const row = rates[constructionType];
  const bracket = bracketOf(baseAmount);

  let rateApplied: number;
  let baseAdded = 0;
  if (bracket === "under5") rateApplied = row.under5;
  else if (bracket === "mid") {
    rateApplied = row.mid.rate;
    baseAdded = row.mid.base;
  } else rateApplied = row.over50;

  const requiredCost = Math.round(baseAmount * rateApplied + baseAdded);

  const bracketLabel =
    bracket === "under5" ? "5억 미만" : bracket === "mid" ? "5억 이상 50억 미만" : "50억 이상";
  const formula =
    baseAdded > 0
      ? `${fmtWon(baseAmount)} × ${fmtPct(rateApplied)} + ${fmtWon(baseAdded)} = ${fmtWon(requiredCost)} (${bracketLabel})`
      : `${fmtWon(baseAmount)} × ${fmtPct(rateApplied)} = ${fmtWon(requiredCost)} (${bracketLabel})`;

  return { requiredCost, rateApplied, baseAdded, bracket, formula };
}

// 과다계상 선별 배수 — 법정 계상액의 이 배수를 넘으면 '과다계상_의심'.
// 1.3 인 이유: 법정 요율은 '최소' 기준이라 초과 계상 자체는 적법하고, 설계변경·공종 특성으로 20~30%
// 차이는 흔하다. 그 위부터를 대상액 부풀리기·집행 미달 가능성이 있는 검토 대상으로 좁힌다.
// 단정이 아니라 선별이므로 '_의심' 이며, 확정은 실집행(③ 워치 출역) 대조와 발주처 판단 몫이다.
export const OVER_APPROPRIATION_RATIO = 1.3;

/**
 * 안전관리비 예비검증.
 * - 대상액이 추정가격 근사(baseAmountIsApprox)거나 명시 안전관리비가 없으면 → '검토필요'(단정 금지).
 * - 명시값이 기준액보다 작으면 → '과소계상_의심'.
 * - 명시값이 기준액의 OVER_APPROPRIATION_RATIO 배를 넘으면 → '과다계상_의심'.
 * - 그 외 → '정상'.
 */
export function evaluateSafetyCost(input: SafetyCostInput): SafetyCostCheck {
  const { constructionType, baseAmount } = input;
  const declaredCost = input.declaredCost ?? null;
  const inputSufficiency: "full" | "partial" =
    input.baseAmountIsApprox || declaredCost == null ? "partial" : "full";

  const { requiredCost, rateApplied, baseAdded, bracket, formula } = computeRequiredSafetyCost(
    constructionType,
    baseAmount,
  );

  let verdict: SafetyCostCheck["verdict"];
  if (inputSufficiency === "partial") {
    verdict = "검토필요";
  } else if ((declaredCost as number) < requiredCost) {
    verdict = "과소계상_의심";
  } else if ((declaredCost as number) > requiredCost * OVER_APPROPRIATION_RATIO) {
    verdict = "과다계상_의심";
  } else {
    verdict = "정상";
  }

  return {
    constructionType,
    baseAmount,
    bracket,
    rateApplied,
    baseAdded,
    requiredCost,
    formula,
    inputSufficiency,
    declaredCost,
    verdict,
    rateNote: RATE_NOTE,
  };
}
