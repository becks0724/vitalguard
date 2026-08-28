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

// ── 요율표 (현행 고시 제2025-11호 별표1) ─────────────────────────────────
// 출처: 고용노동부 고시 「건설업 산업안전보건관리비 계상 및 사용기준」 제2025-11호(2025.2.12 시행) 별표1.
//   공식 HWPX 별표1 + 산업안전지원센터 계산기 + koit 인포그래픽 3중 교차검증(2026-06).
//   직전 개정(제2024-53호, 2025.1.1~ 신규계약분)에서 평균 약 19% 인상되며 신 4공종으로 재분류됨.
//   기초액 단위는 '원'(예: 4,325,000원 = 432.5만원) — 만원 환산 혼동 주의.
// ponytail: 별표1의 '보건관리자 선임대상 적용비율' 열은 제외. 본 모듈 타겟(소액 관급공사)은
//   선임대상(공사금액 800억↑ 또는 상시근로자 600명↑)이 될 일이 없어 일반 계상비율만 사용.
//   (필요해지면 RateRow에 healthMgr 비율 추가 + 입력 플래그로 분기.)
// ── 2차 출처 대조 (2026-08-22) ──────────────────────────────────────
// 조달청 교재 『3권 공공계약관리』 표 28(인쇄 p.257~258, 원출처 「공사 원가계산 간접공사비
//   (제비율) 적용기준」 2025, 조달청)과 1:1 대조함. 원문 발췌·대조표는
//   ../../../../../artifacts/안전관리비_요율_근거.md 참조.
//   · 5억 미만 / 5억~50억 요율 / 기초액 → 전부 일치.
//   · 50억 이상만 불일치 (책 1.97/2.10/2.44/1.66 vs 아래 2.37/2.60/3.11/1.64).
//     기초액은 구간 경계에서 기준액이 튀지 않게 하는 장치인데, 아래 값은 8개 경계 전부
//     격차 1.3% 이내인 반면 책 값은 50억에서 3개 공종이 −17~−21% 급락한다. 따라서 아래를
//     유지하되, 확정은 고시 별표1 원문 대조로만 한다(그 전까지 50억 이상 판정은 잠정).
//
// ── 원문에 있으나 이 파일이 아직 반영하지 않은 규칙 ─────────────────────
//   ① 관급 포함 시 1.2배 캡 — min((재+직노+관급)×율, (재+직노)×율×1.2)  [표 28 주2]
//      캡 발동 조건은 관급 > 0.2×(재+직노). 미반영이라 과다계상 방향을 못 잡는다.
//   ② 대상액 정의의 관급 포함/제외 2안                                  [표 28 주1]
//   ③ 총공사금액(도급+관급자설치) 2,000만 원 미만은 의무 적용 대상 아님    [표 28 본문]
//   ④ 안전관리비는 A값이라 낙찰률이 곱해지지 않음 — 낙찰하한 = (예정가격−A)×하한율+A
//      A = 국민연금+건강보험+퇴직공제부금비+노인장기요양보험+산업안전보건관리비
//          +건설안전관리비+품질관리비                                    [3권 p.275 표 41]
//   반영안·알고리즘 설계는 ../../../../../artifacts/안전관리비_검증_알고리즘.md 참조.
const RATE_NOTE =
  "요율 출처: 고용노동부 고시 제2025-11호(2025.2.12 시행) 별표1. 공식 별표1 HWP 최종 대조 권장. " +
  "50억 이상 요율은 2차 출처(조달청 3권 표 28)와 불일치가 남아 있어 해당 구간 판정은 잠정.";

type RateRow = {
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
