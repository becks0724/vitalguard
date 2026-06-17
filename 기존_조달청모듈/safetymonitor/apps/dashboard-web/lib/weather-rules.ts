// 건설현장 기상 작업중지 정책 — 산업안전보건기준에 관한 규칙 + KOSHA Guide + 에어코리아 + 기상청 기준
// 출처: docs/policy 기상 작업중지 기준 (2026.5 기준)

export type RuleSeverity = "normal" | "caution" | "danger";
export type RuleBinding = "legal" | "recommendation" | "reference";

export type ThresholdStep = {
  severity: RuleSeverity;
  binding: RuleBinding;
  label: string; // 임계 단계명 (예: "33°C 이상 — 휴식 의무")
  action: string; // 권고 조치 또는 의무사항
  source: string; // 법적 근거
};

export type RuleEvaluation = {
  itemKey: string;
  itemLabel: string;
  currentValue: string;
  currentSeverity: RuleSeverity;
  currentStep?: ThresholdStep; // 임계값이 걸린 경우 해당 step
  steps: ThresholdStep[]; // 전체 임계 단계 (참고)
  baseline: string; // "정상" 또는 정보 항목 안내문
  notes?: string; // 추가 설명 (예: "법적 임계 없음. WBGT 추정에 사용.")
};

// 체감온도 (apparent temperature, °C) — 폭염 + 한파 양방향
const HEAT_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "legal",
    label: "35°C 이상 — 1시간/15분 휴식",
    action: "1시간마다 15분 이상 휴식 권고. 옥외 중작업 자제.",
    source: "산업안전보건기준에 관한 규칙 (안전보건규칙)",
  },
  {
    severity: "danger",
    binding: "legal",
    label: "33°C 이상 — 휴식 의무 (강제)",
    action: "2시간 이내 20분 이상 휴식 의무. 위반 시 중대재해처벌법 적용 가능.",
    source: "안전보건규칙 (강제)",
  },
  {
    severity: "caution",
    binding: "legal",
    label: "31°C 이상 — 조치 의무",
    action: "냉방·통풍, 시간조정, 휴식 중 1개 이상 (2시간+ 작업 시).",
    source: "안전보건규칙",
  },
];
const COLD_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "recommendation",
    label: "-18°C 이하 — 옥외 중작업 중지",
    action: "옥외 중작업 중지 권고. 실내 작업으로 전환.",
    source: "KOSHA Guide H-188",
  },
  {
    severity: "danger",
    binding: "recommendation",
    label: "-15°C 이하 — 한파경보",
    action: "30분마다 휴식. 작업시간 단축.",
    source: "KOSHA Guide",
  },
  {
    severity: "caution",
    binding: "recommendation",
    label: "-12°C 이하 — 한파주의보",
    action: "매시간 10~20분 휴식. 방한복 착용 확인.",
    source: "KOSHA Guide",
  },
];

export function evaluateApparentTemp(t: number): RuleEvaluation {
  const all = [...HEAT_STEPS, ...COLD_STEPS];
  let hit: ThresholdStep | undefined;
  if (t >= 35) hit = HEAT_STEPS[0];
  else if (t >= 33) hit = HEAT_STEPS[1];
  else if (t >= 31) hit = HEAT_STEPS[2];
  else if (t <= -18) hit = COLD_STEPS[0];
  else if (t <= -15) hit = COLD_STEPS[1];
  else if (t <= -12) hit = COLD_STEPS[2];

  return {
    itemKey: "apparentTemp",
    itemLabel: "체감온도",
    currentValue: `${t.toFixed(1)}℃`,
    currentSeverity: hit?.severity ?? "normal",
    currentStep: hit,
    steps: all,
    baseline:
      "체감온도 -12℃ ~ 31℃ 범위 = 정상. 31℃ 이상 폭염 단계, -12℃ 이하 한파 단계.",
    notes:
      "법적 강제 항목 (체감온도 33℃ 이상). 단발성 스파이크 제외, 2시간 이상 지속 시 적용.",
  };
}

// 풍속 (m/s, 정책 기준). Open-Meteo 는 km/h 반환 → 변환.
const WIND_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "recommendation",
    label: "15m/s 이상 — 옥외작업 중지",
    action: "옥외작업 원칙 중지. 모든 양중·고소·비계 작업 중단.",
    source: "KOSHA Guide (옥외작업 전체)",
  },
  {
    severity: "caution",
    binding: "legal",
    label: "10m/s 이상 — 타워크레인/고소 중지",
    action:
      "타워크레인 설치·수리·점검·해체 중지 (법적). 비계·고소·양중작업 중지 (권고).",
    source: "안전보건규칙",
  },
];

export function evaluateWindKmh(kmh: number): RuleEvaluation {
  const ms = kmh / 3.6;
  let hit: ThresholdStep | undefined;
  if (ms >= 15) hit = WIND_STEPS[0];
  else if (ms >= 10) hit = WIND_STEPS[1];

  return {
    itemKey: "wind",
    itemLabel: "풍속",
    currentValue: `${kmh.toFixed(1)}km/h (${ms.toFixed(1)}m/s)`,
    currentSeverity: hit?.severity ?? "normal",
    currentStep: hit,
    steps: WIND_STEPS,
    baseline: "10m/s (36km/h) 미만 = 정상. 순간풍속 기준, 평균풍속 아님.",
    notes:
      "타워크레인 운전 중지 기준 15m/s 는 법적 강제. 옥외 전체 중지 권고 15m/s 는 KOSHA Guide.",
  };
}

// 미세먼지 PM2.5 (μg/m³, 1시간 측정값 기준)
const PM25_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "recommendation",
    label: "150 이상 — 경보",
    action: "옥외작업 중지 권고. 마스크 의무, 민감군 즉시 실내 대피.",
    source: "에어코리아 PM2.5 경보 기준",
  },
  {
    severity: "danger",
    binding: "recommendation",
    label: "76 이상 — 매우 나쁨",
    action: "중작업 단축, 휴식 강화. 마스크 의무.",
    source: "환경부 대기환경기준",
  },
  {
    severity: "caution",
    binding: "recommendation",
    label: "36 이상 — 나쁨",
    action: "마스크 착용. 민감군(고령·기저질환) 작업 재배치 고려.",
    source: "환경부 대기환경기준",
  },
];

export function evaluatePM25(value: number | undefined): RuleEvaluation {
  let hit: ThresholdStep | undefined;
  if (value !== undefined) {
    if (value >= 150) hit = PM25_STEPS[0];
    else if (value >= 76) hit = PM25_STEPS[1];
    else if (value >= 36) hit = PM25_STEPS[2];
  }

  return {
    itemKey: "pm25",
    itemLabel: "미세먼지 PM2.5",
    currentValue: value === undefined ? "측정 안 됨" : `${value.toFixed(1)} μg/㎥`,
    currentSeverity: hit?.severity ?? "normal",
    currentStep: hit,
    steps: PM25_STEPS,
    baseline:
      "0~15 좋음 / 16~35 보통 / 36~75 나쁨 / 76~150 매우 나쁨 / 151+ 경보.",
    notes:
      "법적 작업중지 의무 없음 (권고 수준). 노동계 법제화 요구 진행 중.",
  };
}

// 자외선지수 (UV Index)
const UV_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "recommendation",
    label: "11 이상 — 위험",
    action: "옥외작업 가급적 중단. 그늘 필수. 자외선 차단 장비 의무.",
    source: "기상청 생활기상지수 행동요령",
  },
  {
    severity: "caution",
    binding: "recommendation",
    label: "8~10 — 매우 높음",
    action: "10~15시 옥외작업 자제 권고. 긴소매·모자·차단제 사용.",
    source: "기상청 생활기상지수",
  },
];

export function evaluateUV(uv: number): RuleEvaluation {
  let hit: ThresholdStep | undefined;
  if (uv >= 11) hit = UV_STEPS[0];
  else if (uv >= 8) hit = UV_STEPS[1];

  return {
    itemKey: "uv",
    itemLabel: "자외선지수",
    currentValue: uv.toFixed(1),
    currentSeverity: hit?.severity ?? "normal",
    currentStep: hit,
    steps: UV_STEPS,
    baseline: "0~2 낮음 / 3~5 보통 / 6~7 높음 / 8~10 매우 높음 / 11+ 위험.",
    notes: "노동부 법적 기준 없음. 기상청 행동요령 권고 수준.",
  };
}

// 강수량 (mm/h, 1시간 누적값 기준)
const RAIN_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "recommendation",
    label: "10mm/h 이상 — 타설 중지",
    action: "콘크리트 타설 중지. 호우주의보 환산 임박.",
    source: "KOSHA Guide",
  },
  {
    severity: "caution",
    binding: "recommendation",
    label: "5mm/h 이상 — 굴착 중지",
    action: "굴착·터파기 중지. 지반 침하·붕괴 위험.",
    source: "KOSHA Guide",
  },
  {
    severity: "caution",
    binding: "recommendation",
    label: "1mm/h 이상 — 철골·도장 중지",
    action: "철골·도장·방수·전기 작업 중지. 미끄럼·감전 위험.",
    source: "KOSHA Guide",
  },
];

export function evaluatePrecipitation(mm: number): RuleEvaluation {
  let hit: ThresholdStep | undefined;
  if (mm >= 10) hit = RAIN_STEPS[0];
  else if (mm >= 5) hit = RAIN_STEPS[1];
  else if (mm >= 1) hit = RAIN_STEPS[2];

  return {
    itemKey: "precipitation",
    itemLabel: "강수량",
    currentValue: `${mm.toFixed(1)} mm/h`,
    currentSeverity: hit?.severity ?? "normal",
    currentStep: hit,
    steps: RAIN_STEPS,
    baseline:
      "0~1 mm/h 정상 / 1+ 철골·도장 중지 / 5+ 굴착 중지 / 10+ 타설 중지.",
    notes: "1시간 누적값 기준 (일강수량 아님). 30~50mm/h 환산 시 호우주의보/경보.",
  };
}

// 불쾌지수 (Discomfort Index / 온습도지수) — 기온 + 습도로 산출 (기상청 표준 공식)
// DI = 0.81×T + 0.01×H×(0.99×T − 14.3) + 46.3  (T: 기온℃, H: 상대습도%)
const DISCOMFORT_STEPS: ThresholdStep[] = [
  {
    severity: "danger",
    binding: "reference",
    label: "80 이상 — 매우 높음 (전원 불쾌)",
    action: "거의 모든 작업자가 불쾌감. 옥외 중작업 자제, 그늘 휴게·수분 보충 강화.",
    source: "기상청 생활기상지수 (불쾌지수)",
  },
  {
    severity: "caution",
    binding: "reference",
    label: "75 이상 — 높음 (50% 불쾌)",
    action: "절반 정도가 불쾌감. 집중력 저하 주의, 휴식·수분 보충 권고.",
    source: "기상청 생활기상지수 (불쾌지수)",
  },
];

// 불쾌지수 산출. 기온·습도는 호출부에서 유효값(숫자) 보장.
export function computeDiscomfortIndex(tempC: number, humidityPct: number): number {
  return 0.81 * tempC + 0.01 * humidityPct * (0.99 * tempC - 14.3) + 46.3;
}

// 불쾌지수 단계명 (기상청 4단계)
export function discomfortGrade(di: number): string {
  if (di >= 80) return "매우 높음";
  if (di >= 75) return "높음";
  if (di >= 68) return "보통";
  return "낮음";
}

export function evaluateDiscomfortIndex(tempC: number, humidityPct: number): RuleEvaluation {
  const di = computeDiscomfortIndex(tempC, humidityPct);
  let hit: ThresholdStep | undefined;
  if (di >= 80) hit = DISCOMFORT_STEPS[0];
  else if (di >= 75) hit = DISCOMFORT_STEPS[1];

  return {
    itemKey: "discomfort",
    itemLabel: "불쾌지수",
    currentValue: `${di.toFixed(1)} (${discomfortGrade(di)})`,
    currentSeverity: hit?.severity ?? "normal",
    currentStep: hit,
    steps: DISCOMFORT_STEPS,
    baseline:
      "68 미만 낮음(쾌적) / 68~75 보통 / 75~80 높음 / 80+ 매우 높음. 기온+습도 기반.",
    notes:
      "법적 작업중지 기준 아님 (기상청 참고 지표). 체온 위험 판정은 '체감온도' 항목 기준.",
  };
}

// 정보 항목 — 임계 없음. 클릭 시 정보 모달만 표시.
export function infoEvaluation(
  itemKey: string,
  itemLabel: string,
  currentValue: string,
  baseline: string,
  notes: string,
): RuleEvaluation {
  return {
    itemKey,
    itemLabel,
    currentValue,
    currentSeverity: "normal",
    steps: [],
    baseline,
    notes,
  };
}

export const BINDING_LABEL: Record<RuleBinding, string> = {
  legal: "법적 강제",
  recommendation: "권고",
  reference: "참고",
};

export const SEVERITY_LABEL: Record<RuleSeverity, string> = {
  normal: "정상",
  caution: "주의",
  danger: "위험",
};

export const SEVERITY_BADGE_CLASS: Record<RuleSeverity, string> = {
  normal: "border-emerald-500/60 bg-emerald-100 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200",
  caution: "border-amber-500/60 bg-amber-100 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200",
  danger: "border-red-500/60 bg-red-100 text-red-800 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-200",
};

