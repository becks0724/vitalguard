// 안전관리비 예비검증 룰엔진 — 결정적(AI 아님) 계산으로 신뢰성 확보.
// 산업안전보건관리비 법정 계상요율(공사종류 × 대상액 구간)로 기준 안전관리비를 산정하고,
// 공고/계약에 명시된 값과 비교해 '정상 / 과소계상_의심 / 검토필요' 로 분류한다.
// 핵심 원칙: 입력이 부족하면 단정하지 않고 '검토필요'로 강등(과장 금지).
import type {
  ConstructionType,
  CostBracket,
  SafetyCostCheck,
  SafetyCostInput,
} from "./safeprocure-types";

// ── ⚠ 요율표 (검증 필요) ────────────────────────────────────────────────
// 출처: 고용노동부 고시 「건설업 산업안전보건관리비 계상 및 사용기준」 별표1 계열 정리본.
// ⚠ 현행 고시 제2025-11호(2025.2.12 시행)는 평균 약 19% 인상이 보고됨.
//   제출/실사용 전 고시 원문 별표1 + 조달청 '공사원가계산 제비율 적용기준'으로 수치 교차검증 필수.
//   (값만 교체하면 됨 — 엔진 로직은 수치와 독립.)
const RATE_NOTE =
  "⚠ 요율 출처: 고용노동부 고시 별표1 정리본. 제출 전 현행 고시(제2025-11호) 원문으로 교차검증 필요.";

type RateRow = {
  under5: number; // 대상액 5억 미만 요율
  mid: { rate: number; base: number }; // 5억~50억: 요율 + 기초액(원)
  over50: number; // 50억 이상 요율
};

export const SAFETY_COST_RATES: Record<ConstructionType, RateRow> = {
  "일반건설공사(갑)": { under5: 0.0293, mid: { rate: 0.0186, base: 5_349_000 }, over50: 0.0197 },
  "일반건설공사(을)": { under5: 0.0309, mid: { rate: 0.0199, base: 5_499_000 }, over50: 0.021 },
  "중건설공사": { under5: 0.0343, mid: { rate: 0.0235, base: 5_400_000 }, over50: 0.0244 },
  "철도·궤도신설공사": { under5: 0.0245, mid: { rate: 0.0157, base: 4_411_000 }, over50: 0.0166 },
  "특수·기타건설공사": { under5: 0.0185, mid: { rate: 0.012, base: 3_250_000 }, over50: 0.0127 },
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
 * 면허/공종·과업 텍스트로 공사종류를 추정(휴리스틱).
 * ⚠ 단순 매핑 — 실 운영 시 표준 공종/면허 코드 매핑표로 교체. 미상이면 (갑) 기본 + 근거 표기.
 */
export function classifyConstructionType(
  licenses: string[],
  text = "",
): { type: ConstructionType; reason: string } {
  const hay = `${licenses.join(" ")} ${text}`;
  const has = (re: RegExp) => re.test(hay);
  if (has(/철도|궤도/)) return { type: "철도·궤도신설공사", reason: "철도·궤도 관련 면허/키워드" };
  if (has(/터널|댐|발전|플랜트|항만|지하철/))
    return { type: "중건설공사", reason: "터널/댐/발전 등 중건설 키워드" };
  if (has(/전기|정보통신|소방|조경|포장|준설|상하수|승강기/))
    return { type: "특수·기타건설공사", reason: "전기/통신/소방/조경 등 전문공종" };
  if (has(/토목|토공|굴착|상수도|하수도|교량|도로/))
    return { type: "일반건설공사(을)", reason: "토목 계열 면허/키워드" };
  return { type: "일반건설공사(갑)", reason: "건축 등 일반 (기본값)" };
}

/** 기준 안전관리비 산정(순수 계산). */
export function computeRequiredSafetyCost(
  constructionType: ConstructionType,
  baseAmount: number,
): { requiredCost: number; rateApplied: number; baseAdded: number; bracket: CostBracket; formula: string } {
  const row = SAFETY_COST_RATES[constructionType];
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

/**
 * 안전관리비 예비검증.
 * - 대상액이 추정가격 근사(baseAmountIsApprox)거나 명시 안전관리비가 없으면 → '검토필요'(단정 금지).
 * - 명시값이 기준액보다 작으면 → '과소계상_의심'.
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
