// 생리적 부담 지수(PSI) — 심부체온·심박으로 열 부담을 0~10 으로 매기는 문헌 지수. 표시 전용.
//
// 출처 = Moran et al., "A physiological strain index to evaluate heat stress",
//        Am J Physiol 275(1):R129-34, 1998.
//   PSI = 5·(Tc − Tc0)/(39.5 − Tc0) + 5·(HR − HR0)/(180 − HR0)
//   문헌 임계 — 6 이상 = 높은 생리적 부담 구역 · 7.5 이상 = 열손상 고위험.
//
// 왜 이걸 쓰는가 — 기존 온열 임계(37.8/38.0℃)는 우리가 고른 참고값이라 근거를 대기 어렵다.
// PSI 는 식도 임계도 논문에 있어 **우리가 정할 숫자가 하나도 없다**. 체감온도를 기상청 식으로
// 바꾼 것과 같은 원칙이다(표준을 구현할 뿐 발명하지 않는다). 결정 = docs/psi/context-notes.md
//
// ⚠ 한계 — 원식은 Tc 를 직장온도 **실측**으로 전제하는데 우리 입력은 심박 기반 추정치다.
// 추정 오차가 지수로 전파되고 그 전파량을 검증할 정답 데이터가 없어 **판정·알림에 넣지 않는다**.

import { CT0 } from "@safetymonitor/analyzers";

/** 논문 가정 상한 — 심부체온 39.5℃ · 심박 180bpm 에서 PSI 10. */
const TC_MAX = 39.5;
const HR_MAX = 180;
/** 안정심박을 모를 때의 기준 심박 — 논문 가정 하한(60~180 상승폭). */
const HR0_FALLBACK = 60;

/** 문헌 임계 — 높은 생리적 부담 구역. */
export const PSI_HIGH = 6;
/** 문헌 임계 — 열 손상 고위험. */
export const PSI_CRITICAL = 7.5;

export type PsiInput = {
  /** 추정 심부체온(℃) — 없으면 판정 불가. */
  coreTempC: number | null | undefined;
  /** 현재 심박(bpm) — 없으면 판정 불가. */
  heartRate: number | null | undefined;
  /** 개인 안정심박(bpm) — 있으면 기준 심박을 개인화한다. */
  restingHeartRate?: number | null;
};

export type PsiResult = {
  /** 0~10 (문헌 스케일). */
  value: number;
  /** 기준 심박에 개인 안정심박을 썼는가 — false 면 논문 기본값 60. */
  personalized: boolean;
};

/**
 * PSI 산출. 입력이 하나라도 없으면 **null(판정 불가)** 이다 — 0(부담 없음)과 구분한다.
 *
 * Tc0 는 심부체온 추정 필터의 세션 시작값(`CT0`)을 그대로 쓴다. 원 논문의 '노출 전 직장온도'에
 * 대응하는 우리 시스템의 기준점이 그것이고, 같은 숫자를 두 곳에 두면 한쪽만 바뀔 때 어긋난다.
 */
export function computePsi({
  coreTempC,
  heartRate,
  restingHeartRate,
}: PsiInput): PsiResult | null {
  if (!Number.isFinite(coreTempC ?? NaN) || !Number.isFinite(heartRate ?? NaN)) {
    return null;
  }
  const tc = coreTempC as number;
  const hr = heartRate as number;

  // 안정심박이 비현실적이면(오측·결측 폴백) 개인화하지 않는다 — 분모가 무너진다.
  const rhr = restingHeartRate ?? NaN;
  const personalized = Number.isFinite(rhr) && rhr >= 30 && rhr < HR_MAX;
  const hr0 = personalized ? (rhr as number) : HR0_FALLBACK;

  const thermal = (5 * (tc - CT0)) / (TC_MAX - CT0);
  const cardio = (5 * (hr - hr0)) / (HR_MAX - hr0);
  const value = Math.min(10, Math.max(0, thermal + cardio));

  return { value, personalized };
}

export type PsiBand = "normal" | "high" | "critical";

/** 문헌 임계로 구간을 나눈다. 경계값은 그 구간에 포함된다(≥). */
export function psiBand(value: number): PsiBand {
  if (value >= PSI_CRITICAL) return "critical";
  if (value >= PSI_HIGH) return "high";
  return "normal";
}
