// 고열 작업–휴식 권고 — KOSHA GUIDE W-12-2017 <표 1> 노출기준을 그대로 구현한다.
//
// 출처 = 한국산업안전보건공단 KOSHA GUIDE W-12-2017 「고열작업환경 관리지침」
//        (산업안전보건법 제24조 · 산업안전보건기준에 관한 규칙 제7장 근거).
//
// 왜 이 표인가 — ACGIH TLV 표는 **저작권 보호 자료**라 OSHA 기술매뉴얼조차 게재하지 않는다
// ("copyrighted by ACGIH® and is not publicly available"). KOSHA 지침은 공개 자료이고
// 한국 공식 기준이며, WBGT 산출식도 우리 구현과 동일하다(0.7Tnwb + 0.2Tg + 0.1Ta).
//
// ⚠ **적용 범위가 다르다.** 이 지침의 대상은 용광로·가열로 등 **실내 열원 작업**이고
//    옥외 폭염작업은 직접 대상이 아니다(옥외 법정 기준은 체감온도 31/33/35℃).
//    따라서 이 산출은 **참고 권고**이며 법정 판정을 대체하지 않는다 — 호출부가 그렇게 표기한다.
//
// ★ 체중·체표면적이 필요 없다. KOSHA 는 작업강도를 kcal/hr 로 정의하고, 우리는 워치가 준
//   **실측 활동에너지**를 쓰므로 개인 체중이 이미 반영돼 있다(ACGIH 의 W 정의는 체표면적을
//   요구해 개인 신체정보가 필요했다 — 그 문제가 여기서 사라진다).

/** 작업강도 등급 — KOSHA <표 1> 각주의 kcal/hr 경계. */
export type WorkIntensity = "light" | "moderate" | "heavy";
/** 작업–휴식 시간비 권고. `exceeded` = 25%/75% 기준마저 넘어 표로 감당되지 않는 상태. */
export type WorkRestRegimen = "continuous" | "rest25" | "rest50" | "rest75" | "exceeded";

/** 작업강도 경계(kcal/hr) — 경작업 ≤200 · 중등작업 200~350 · 중작업 350~500. */
const LIGHT_MAX_KCAL_H = 200;
const MODERATE_MAX_KCAL_H = 350;
const HEAVY_MAX_KCAL_H = 500;

/**
 * KOSHA GUIDE W-12-2017 <표 1> 고열작업의 노출기준 (WBGT ℃).
 * 값을 임의로 바꾸지 않는다 — 지침 개정 시에만 갱신한다.
 */
const EXPOSURE_LIMITS: Record<WorkIntensity, Record<Exclude<WorkRestRegimen, "exceeded">, number>> =
  {
    light: { continuous: 30.0, rest25: 30.6, rest50: 31.4, rest75: 32.2 },
    moderate: { continuous: 26.7, rest25: 28.0, rest50: 29.4, rest75: 31.1 },
    heavy: { continuous: 25.0, rest25: 25.9, rest50: 27.9, rest75: 30.0 },
  };

/** <표 2> 착용복장에 따른 WBGT 노출기준 보정값(CAF ℃). */
export const CLOTHING_ADJUSTMENT = {
  /** 여름작업복 */
  summer: 0,
  /** 상하가 붙은 면작업복 */
  cotton: 2,
  /** 겨울 작업복 */
  winter: 4,
  /** 방수복 */
  waterproof: 6,
} as const;
export type ClothingType = keyof typeof CLOTHING_ADJUSTMENT;

/**
 * 작업대사율(kcal/hr) → 작업강도 등급.
 *
 * 500 kcal/hr 를 넘으면 **null(판정 불가)** 이다 — <표 1> 에 그 구간이 없다. 중작업 기준을
 * 끌어다 쓰면 표에 없는 판정을 우리가 만드는 것이 되므로 하지 않는다.
 */
export function classifyWorkIntensity(kcalPerHour: number): WorkIntensity | null {
  if (!Number.isFinite(kcalPerHour) || kcalPerHour < 0) return null;
  if (kcalPerHour <= LIGHT_MAX_KCAL_H) return "light";
  if (kcalPerHour <= MODERATE_MAX_KCAL_H) return "moderate";
  if (kcalPerHour <= HEAVY_MAX_KCAL_H) return "heavy";
  return null;
}

/** 착용복장 보정을 적용한 WBGT(℃). 기본은 여름작업복(보정 0). */
export function adjustedWbgt(wbgt: number, clothing: ClothingType = "summer"): number {
  return wbgt + CLOTHING_ADJUSTMENT[clothing];
}

/**
 * <표 1> 조회 — 보정된 WBGT 와 작업강도로 허용 작업–휴식 시간비를 정한다.
 *
 * 표의 각 행은 **그 값 이하면 그 작업비가 허용**된다는 뜻이다(계속작업 한계가 가장 낮고,
 * 휴식을 늘릴수록 허용 WBGT 가 올라간다). 가장 관대한 25%/75% 기준마저 넘으면 `exceeded`.
 */
export function workRestRegimen(
  wbgtEff: number,
  intensity: WorkIntensity,
): WorkRestRegimen {
  const limits = EXPOSURE_LIMITS[intensity];
  if (wbgtEff <= limits.continuous) return "continuous";
  if (wbgtEff <= limits.rest25) return "rest25";
  if (wbgtEff <= limits.rest50) return "rest50";
  if (wbgtEff <= limits.rest75) return "rest75";
  return "exceeded";
}

export type WorkRestAdvice = {
  intensity: WorkIntensity;
  regimen: WorkRestRegimen;
  /** 복장 보정 후 WBGT(℃) — 판정에 실제로 쓰인 값. */
  wbgtEff: number;
  /** 적용된 <표 1> 한계값(℃). `exceeded` 면 가장 관대한 25%/75% 한계. */
  limitC: number;
};

/**
 * 작업대사율 + WBGT → 작업–휴식 권고. 입력이 없거나 표 범위 밖이면 **null**.
 *
 * ⚠ 참고 권고다. 옥외 폭염작업의 법정 판정은 체감온도(31/33/35℃)가 담당한다.
 */
export function heatWorkRestAdvice(input: {
  wbgt: number | null | undefined;
  kcalPerHour: number | null | undefined;
  clothing?: ClothingType;
}): WorkRestAdvice | null {
  const { wbgt, kcalPerHour } = input;
  if (!Number.isFinite(wbgt ?? NaN) || !Number.isFinite(kcalPerHour ?? NaN)) return null;

  const intensity = classifyWorkIntensity(kcalPerHour as number);
  if (intensity === null) return null;

  const wbgtEff = adjustedWbgt(wbgt as number, input.clothing);
  const regimen = workRestRegimen(wbgtEff, intensity);
  const limits = EXPOSURE_LIMITS[intensity];
  const limitC =
    regimen === "continuous"
      ? limits.continuous
      : regimen === "rest25"
        ? limits.rest25
        : regimen === "rest50"
          ? limits.rest50
          : limits.rest75;

  return { intensity, regimen, wbgtEff, limitC };
}

/** 화면 표기용 짧은 라벨. */
export const REGIMEN_LABEL: Record<WorkRestRegimen, string> = {
  continuous: "계속작업",
  rest25: "25%휴식",
  rest50: "50%휴식",
  rest75: "75%휴식",
  exceeded: "기준초과",
};

export const INTENSITY_LABEL: Record<WorkIntensity, string> = {
  light: "경작업",
  moderate: "중등작업",
  heavy: "중작업",
};
