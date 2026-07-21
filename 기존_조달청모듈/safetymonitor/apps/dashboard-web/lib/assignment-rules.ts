// 작업 배치 매칭 규칙 엔진 — 위험작업 태그 × 컨디션 등급/사유 배제표(결정적).
// 태그 어휘는 risk-tagging.ts(공고 태깅)와 동일 7종을 단일 기준으로 사용한다.
// 배제는 '권고'다 — 시스템은 확정 판정을 하지 않으며 최종 배치 결정 권한은 감독관에게 있다.
// 법적 근거는 확실한 조항만 조문 번호를 적고, 나머지는 규칙 단위로 보수적으로 표기한다.
import type { ConditionReasonCode, ConditionResult } from "./worker-condition";

export const ALL_RISK_TAGS = [
  "고소작업",
  "굴착/흙막이",
  "밀폐공간",
  "전기/감전",
  "중장비/양중",
  "해체/철거",
  "도장/화기",
] as const;

export type RiskTagName = (typeof ALL_RISK_TAGS)[number];

// 태그별 법적/규범 근거(배제 사유 표기에 사용).
export const TAG_BASIS: Record<RiskTagName, string> = {
  고소작업: "산업안전보건기준에 관한 규칙 제42조(추락의 방지)·제32조(보호구의 지급)",
  "굴착/흙막이": "산업안전보건기준에 관한 규칙(굴착작업 등의 위험 방지)",
  밀폐공간: "산업안전보건기준에 관한 규칙 제619조(밀폐공간 작업 프로그램의 수립·시행)",
  "전기/감전": "산업안전보건기준에 관한 규칙(전기로 인한 위험 방지)",
  "중장비/양중": "산업안전보건기준에 관한 규칙 제132조 이하(양중기)",
  "해체/철거": "산업안전보건기준에 관한 규칙(해체작업 시 위험 방지)",
  "도장/화기": "산업안전보건기준에 관한 규칙(화재·폭발 등의 예방)",
};

// 사유코드 → 배제 대상 태그 매핑(주의 등급에서 적용).
// 제한(restricted) 등급은 사유 무관 전 태그 배제 권고, 미판정(unknown)은 전 태그 보류.
const REASON_BLOCKS: Partial<Record<ConditionReasonCode, RiskTagName[]>> = {
  SPO2_CAUTION_FREQ: ["밀폐공간", "고소작업"],
  VITAL_ALERT_24H: ["밀폐공간", "고소작업"],
  HR_CAUTION_FREQ: ["고소작업", "해체/철거", "중장비/양중"],
  LONG_SHIFT: ["고소작업", "중장비/양중"],
  // UNACKED_ALERT 는 특정 태그 배제 없이 표시만(감독관 확인 촉구).
};

export type TagAdvice = {
  tag: RiskTagName;
  allowed: boolean;
  pending: boolean; // 미판정(데이터 없음) — 배제가 아니라 보류
  blockedBy: { code: ConditionReasonCode; label: string }[];
  basis: string;
};

export type AssignmentAdvice = {
  grade: ConditionResult["grade"];
  perTag: TagAdvice[];
  note: string;
};

/** 컨디션 판정 결과 × 태그 목록 → 태그별 배치 권고. */
export function matchAssignments(
  condition: ConditionResult,
  tags: readonly RiskTagName[] = ALL_RISK_TAGS,
): AssignmentAdvice {
  const perTag: TagAdvice[] = tags.map((tag) => {
    if (condition.grade === "unknown") {
      return { tag, allowed: false, pending: true, blockedBy: [], basis: TAG_BASIS[tag] };
    }
    if (condition.grade === "restricted") {
      return {
        tag,
        allowed: false,
        pending: false,
        blockedBy: condition.reasons.map((r) => ({ code: r.code, label: r.label })),
        basis: TAG_BASIS[tag],
      };
    }
    const blockedBy = condition.reasons
      .filter((r) => (REASON_BLOCKS[r.code] ?? []).includes(tag))
      .map((r) => ({ code: r.code, label: r.label }));
    return { tag, allowed: blockedBy.length === 0, pending: false, blockedBy, basis: TAG_BASIS[tag] };
  });

  const note =
    condition.grade === "unknown"
      ? "생체 데이터가 없어 배치 판단을 보류합니다(워치 착용 확인 후 재조회)."
      : condition.grade === "restricted"
        ? "제한 등급 — 고위험 작업 배치를 제한 권고합니다. 일반 작업 배치는 감독관 판단에 따릅니다."
        : condition.grade === "caution"
          ? "주의 등급 — 일부 고위험 작업만 배제 권고합니다."
          : "양호 등급 — 전 작업 배치 가능(권고).";

  return { grade: condition.grade, perTag, note };
}
