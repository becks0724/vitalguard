// 공고 첨부 「설계내역서·공내역서」에서 안전관리비 검증에 필요한 원가 값을 뽑는다.
//
// ★ 왜 필요한가 — 조달 API 는 이 값을 **주지 않는다**(2026-08-27 실측: 입찰공고 143개 필드 ·
//   계약 43개 필드 어디에도 안전관리비 항목 없음). 값은 첨부 내역서 안에만 있다.
//
// ★ 무엇을 뽑나 — 둘은 성격이 다르다.
//   ① 대상액 구성(재료비·직접노무비·관급자재) = 기준액 **계산의 입력**
//   ② 계상액(산업안전보건관리비 금액)        = 기준액과 **비교할 대상**
//
// ⚠ 뽑아 놓고 단정하지 않는다. 이 모듈은 **초안(draft)** 만 만든다 —
//   확정은 근거 문서를 본 담당관이 한다(피검증자 자기신고 방지). 그래서 반환에 근거 위치를 싣는다.
import { cellKey, readXlsx, type Sheet } from "./xlsx-lite";

/** 한 항목의 추출 결과 — 값과 함께 **어디서 나왔는지**를 always 싣는다(담당관이 원본과 대조해야 한다). */
export type CostHit = {
  amount: number | null;
  /** 문서에 적힌 요율(%). 안전관리비 행에만 있다. */
  ratePercent?: number | null;
  sheet: string;
  row: number;
  label: string;
};

export type SpecCostDraft = {
  /** 계상액 — 발주처가 적어 둔 산업안전보건관리비. 공란 내역서면 amount = null. */
  safetyCost: CostHit | null;
  material: CostHit | null;
  labor: CostHit | null;
  govSupply: CostHit | null;
  /** 대상액 = 재료비 + 직접노무비 + 관급자재. 구성이 하나라도 없으면 null(추정하지 않는다). */
  targetAmount: number | null;
  /** 사람이 읽는 상태 메모 — 화면·로그에 그대로 쓴다. */
  notes: string[];
};

// ⚠ 「산업안전보건관리비」와 「안전관리비」는 **다른 항목**이다(후자는 건설기술진흥법 계열).
//   실측 파일에 두 행이 나란히 있었다(r18 산업안전보건관리비 5,744,631 / r19 안전관리비 661,000).
//   여기서 후자를 집으면 검증이 통째로 틀린 값을 쓴다.
const SAFETY_LABEL = /산업\s*안전\s*보건\s*관리비/;
const MATERIAL_LABEL = /(직접)?\s*재료비/;
const LABOR_LABEL = /직접\s*노무비/;
const GOV_LABEL = /관급\s*(자재|재료)|지급\s*자재/;
// 라벨처럼 보이지만 항목 행이 아닌 것들 — 계산 설명·소계 주석·부분 항목.
// (실측: "잡재료비"·"재료비 할증 계수"·"직접노무비의"·"분전반 외함(재료비 제외)")
const NOT_ITEM = /잡\s*재료비|할증|제외|계수|노무비의|\*|합\s*계|소\s*계/;

/** 숫자로 읽을 수 있으면 숫자, 아니면 null. 콤마·공백·원 표기를 걷어낸다. */
function num(v: string): number | null {
  const s = v.replace(/[,\s원]/g, "");
  if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 한 행의 셀을 열 순서로 훑는다. */
function rowCells(sheet: Sheet, row: number, maxCol = 64): { col: number; value: string }[] {
  const out: { col: number; value: string }[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const v = sheet.cells.get(cellKey(row, c));
    if (v !== undefined) out.push({ col: c, value: v });
  }
  return out;
}

/**
 * 라벨 행에서 금액·요율을 고른다.
 * - 금액 = 양수이면서 1,000 이상인 **첫** 숫자(열 순서). 실측 배치 `요율 | 금액 | 요율 | 0 | -금액` 기준.
 * - 요율 = 0 초과 100 미만 숫자(퍼센트). 금액보다 앞 열에 오는 경우가 많다.
 * ⚠ 음수(대비 열)와 0(집행 열)은 금액 후보에서 뺀다 — 실측에서 `H=-5744631`, `G=0` 이 함께 있었다.
 */
function pickAmountAndRate(cells: { col: number; value: string }[]): { amount: number | null; ratePercent: number | null } {
  let amount: number | null = null;
  let ratePercent: number | null = null;
  for (const { value } of cells) {
    const n = num(value);
    if (n === null) continue;
    if (amount === null && n >= 1000) amount = n;
    if (ratePercent === null && n > 0 && n < 100) ratePercent = n;
  }
  return { amount, ratePercent };
}

/**
 * 라벨이 여러 곳에 나오므로 **첫 일치를 쓰지 않고 채점해서 고른다.**
 * ⚠ 이걸 안 하면 소계 행의 주석 셀("산업안전보건관리비:" 이 K열에 적힌 행)을 집어
 *   전혀 다른 금액(소계 145,383,748)을 계상액으로 읽는다 — 2026-08-27 실측으로 드러난 결함.
 * 규칙 ① 값은 **라벨 오른쪽 열**에서만 찾는다(왼쪽은 다른 항목의 값이다).
 *      ② 금액·요율이 실제로 있는 행에 가점 — 빈 총괄표 행보다 값이 있는 원가계산서 행을 고른다.
 *      ③ 라벨이 앞쪽 열에 있으면 가점(항목 열은 보통 좌측이고, 우측은 주석이다).
 */
function findBest(sheets: Sheet[], test: (label: string) => boolean): CostHit | null {
  let best: { hit: CostHit; score: number; col: number } | null = null;
  for (const sheet of sheets) {
    for (const [key, value] of sheet.cells) {
      if (!test(value) || NOT_ITEM.test(value)) continue;
      const [rowStr, colStr] = key.split(",");
      const row = Number(rowStr);
      const labelCol = Number(colStr);
      const right = rowCells(sheet, row).filter((c) => c.col > labelCol);
      const { amount, ratePercent } = pickAmountAndRate(right);
      const score = (amount !== null ? 3 : 0) + (ratePercent !== null ? 2 : 0) + (labelCol <= 6 ? 1 : 0);
      if (!best || score > best.score || (score === best.score && labelCol < best.col)) {
        best = { hit: { amount, ratePercent, sheet: sheet.name, row, label: value.trim() }, score, col: labelCol };
      }
    }
  }
  return best?.hit ?? null;
}

/** 파싱된 시트에서 원가 초안을 만든다(순수 함수 — 테스트 대상). */
export function draftFromSheets(sheets: Sheet[]): SpecCostDraft {
  const notes: string[] = [];
  const safetyCost = findBest(sheets, (l) => SAFETY_LABEL.test(l));
  const material = findBest(sheets, (l) => MATERIAL_LABEL.test(l));
  const labor = findBest(sheets, (l) => LABOR_LABEL.test(l));
  const govSupply = findBest(sheets, (l) => GOV_LABEL.test(l));

  if (!safetyCost) notes.push("산업안전보건관리비 항목을 찾지 못했습니다.");
  else if (safetyCost.amount === null) {
    notes.push(
      safetyCost.ratePercent !== null
        ? `산업안전보건관리비 요율(${safetyCost.ratePercent}%)만 있고 금액이 비어 있습니다 — 공란 내역서로 보입니다.`
        : "산업안전보건관리비 행은 있으나 금액이 비어 있습니다.",
    );
  }

  // 대상액은 **구성이 다 있을 때만** 만든다. 하나라도 없으면 추정하지 않는다(과장 금지).
  const parts = [material?.amount ?? null, labor?.amount ?? null];
  const targetAmount =
    parts.every((p) => p !== null) ? (material!.amount! + labor!.amount! + (govSupply?.amount ?? 0)) : null;
  if (targetAmount === null) notes.push("대상액 구성(재료비·직접노무비)이 부족해 대상액을 만들지 않았습니다.");

  // 교차검증 — 금액 ÷ 요율이 대상액과 크게 어긋나면 사람이 봐야 한다(둘 다 있을 때만).
  if (safetyCost?.amount != null && safetyCost.ratePercent != null && targetAmount != null) {
    const implied = safetyCost.amount / (safetyCost.ratePercent / 100);
    const gap = Math.abs(implied - targetAmount) / targetAmount;
    if (gap > 0.1) {
      notes.push(
        `문서 내 정합 경고 — 금액÷요율(${Math.round(implied).toLocaleString("ko-KR")}원)이 대상액(${targetAmount.toLocaleString("ko-KR")}원)과 ${Math.round(gap * 100)}% 어긋납니다.`,
      );
    }
  }

  return { safetyCost, material, labor, govSupply, targetAmount, notes };
}

/** xlsx 바이트 → 원가 초안. 읽을 수 없는 형식(구형 .xls·PDF)이면 notes 로 사유를 남긴다. */
export function draftFromXlsx(data: Uint8Array): SpecCostDraft {
  const sheets = readXlsx(data);
  if (sheets.length === 0) {
    return {
      safetyCost: null,
      material: null,
      labor: null,
      govSupply: null,
      targetAmount: null,
      notes: ["열 수 없는 파일입니다(구형 .xls·PDF·암호화 등). 담당관이 직접 확인해야 합니다."],
    };
  }
  return draftFromSheets(sheets);
}
