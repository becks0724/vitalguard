// 작업자 컨디션 등급화 — 결정적 규칙(LLM 미사용).
// 최근 24시간 생체 이력·경보 이력을 집계한 신호(ConditionSignals)를 등급+사유코드로 판정한다.
// ⚠ 표현 원칙: 의료 진단이 아니라 '안전 기준 충족 여부'다. 등급은 배치 참고 정보이며
//    최종 배치 결정 권한은 감독관에게 있다(플래그 철학과 동일 — 시스템은 확정 판정을 하지 않는다).
// 임계는 severity/analyzers 단일 source(WORK_HR·THRESHOLDS)를 재사용하고,
// 등급 규칙 자체의 빈도 임계는 CONDITION_RULES 로 한곳에 모아 튜닝 가능하게 둔다.

export type ConditionGrade = "fit" | "caution" | "restricted" | "unknown";

export const GRADE_LABEL: Record<ConditionGrade, string> = {
  fit: "양호",
  caution: "주의",
  restricted: "제한",
  unknown: "미판정",
};

export type ConditionReasonCode =
  | "FALL_24H"
  | "SOS_24H"
  | "SPO2_DANGER_24H"
  | "HR_DANGER_24H"
  | "VITAL_ALERT_24H"
  | "SPO2_CAUTION_FREQ"
  | "HR_CAUTION_FREQ"
  | "LONG_SHIFT"
  | "UNACKED_ALERT"
  | "NO_DATA"
  // 작업자 신호가 아닌 현장 환경 게이트(가스 감지기·기상특보) — gradeCondition 은 발급하지 않고
  // assignment-service 가 환경 배제 사유를 태그에 주입할 때만 사용한다.
  | "SITE_ENV";

export type ConditionReason = {
  code: ConditionReasonCode;
  label: string;
  detail: string;
};

// 최근 24시간 집계 신호 — db.workerConditionSignals() 산출물과 1:1.
export type ConditionSignals = {
  sampleCount: number;
  firstTs: string | null;
  latestTs: string | null;
  spo2CautionCount: number; // SpO₂ < THRESHOLDS.spo2.cautionPct 샘플 수
  spo2DangerCount: number; // SpO₂ < THRESHOLDS.spo2.dangerPct 샘플 수
  hrCautionCount: number; // 작업부하 밴드 고강도(WORK_HR.heavyBpm 이상) 샘플 수
  hrDangerCount: number; // 작업부하 밴드 과부하/급락(overload/collapse) 샘플 수
  fallAlerts: number; // alerts type='fall'
  sosAlerts: number; // alerts type='sos'
  vitalAlerts: number; // alerts type='vital' (생체 위험 전이)
  unackedAlerts: number; // 미대응(ack_at IS NULL) 알림 수
};

// 등급 규칙 빈도 임계 — 여기만 조정하면 됨.
export const CONDITION_RULES = {
  hrDangerRestrict: 2, // 과부하/급락 샘플 n건 이상 → 제한
  spo2CautionFreq: 3, // SpO₂ 주의 샘플 n건 이상 → 주의
  hrCautionFreq: 5, // 고강도 지속 샘플 n건 이상 → 주의
  longShiftHours: 10, // 당일 착용 시간 n시간 이상 → 주의(피로)
} as const;

export type ConditionResult = {
  grade: ConditionGrade;
  reasons: ConditionReason[];
  workedHours: number | null; // 24h 창 내 첫 샘플~마지막 샘플 경과(착용 추정)
};

export const CONDITION_DISCLAIMER =
  "본 등급은 웨어러블 실측 기반의 안전 기준 참고 정보이며 의료적 판단이 아닙니다. 최종 배치 결정 권한은 감독관에게 있습니다.";

function hoursBetween(firstTs: string | null, latestTs: string | null): number | null {
  if (!firstTs || !latestTs) return null;
  const a = Date.parse(firstTs);
  const b = Date.parse(latestTs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3_600_000;
}

/** 순수 판정 — 신호 집계 → 등급 + 사유. */
export function gradeCondition(signals: ConditionSignals): ConditionResult {
  if (signals.sampleCount === 0) {
    return {
      grade: "unknown",
      reasons: [
        {
          code: "NO_DATA",
          label: "생체 데이터 없음",
          detail: "최근 24시간 워치 실측 데이터가 없어 판정을 보류합니다(배치 전 착용 확인 필요).",
        },
      ],
      workedHours: null,
    };
  }

  const workedHours = hoursBetween(signals.firstTs, signals.latestTs);
  const restricted: ConditionReason[] = [];
  const caution: ConditionReason[] = [];

  if (signals.fallAlerts > 0) {
    restricted.push({
      code: "FALL_24H",
      label: "24시간 내 낙상 신호",
      detail: `낙상 경보 ${signals.fallAlerts}건 — 확인 전 고위험 작업 배제 기준이 적용됩니다.`,
    });
  }
  if (signals.sosAlerts > 0) {
    restricted.push({
      code: "SOS_24H",
      label: "24시간 내 SOS 발신",
      detail: `SOS 경보 ${signals.sosAlerts}건 — 사유 확인 전까지 고위험 작업 배치를 제한 권고합니다.`,
    });
  }
  if (signals.spo2DangerCount > 0) {
    restricted.push({
      code: "SPO2_DANGER_24H",
      label: "혈중산소 안전 기준 미달 이력",
      detail: `SpO₂ 위험 구간 실측 ${signals.spo2DangerCount}건 — 해당 작업 배치 안전 기준 미충족.`,
    });
  }
  if (signals.hrDangerCount >= CONDITION_RULES.hrDangerRestrict) {
    restricted.push({
      code: "HR_DANGER_24H",
      label: "심박 과부하/급락 반복",
      detail: `작업부하 위험 구간 실측 ${signals.hrDangerCount}건 — 고부하 작업 기준 미충족.`,
    });
  }

  if (signals.vitalAlerts > 0) {
    caution.push({
      code: "VITAL_ALERT_24H",
      label: "24시간 내 생체 경보",
      detail: `생체 위험 전이 경보 ${signals.vitalAlerts}건 발생 이력.`,
    });
  }
  if (signals.spo2CautionCount >= CONDITION_RULES.spo2CautionFreq) {
    caution.push({
      code: "SPO2_CAUTION_FREQ",
      label: "혈중산소 주의 구간 빈발",
      detail: `SpO₂ 주의 구간 실측 ${signals.spo2CautionCount}건.`,
    });
  }
  if (signals.hrCautionCount >= CONDITION_RULES.hrCautionFreq) {
    caution.push({
      code: "HR_CAUTION_FREQ",
      label: "고강도 부하 지속",
      detail: `작업부하 고강도 구간 실측 ${signals.hrCautionCount}건.`,
    });
  }
  if (workedHours !== null && workedHours >= CONDITION_RULES.longShiftHours) {
    caution.push({
      code: "LONG_SHIFT",
      label: "장시간 연속 작업 신호",
      detail: `24시간 창 내 착용 ${workedHours.toFixed(1)}시간 — 연속 작업 안전 기준이 적용됩니다.`,
    });
  }
  if (signals.unackedAlerts > 0) {
    caution.push({
      code: "UNACKED_ALERT",
      label: "미대응 경보 존재",
      detail: `대응 확인되지 않은 경보 ${signals.unackedAlerts}건 — 확인 후 배치 권고.`,
    });
  }

  if (restricted.length > 0) {
    return { grade: "restricted", reasons: [...restricted, ...caution], workedHours };
  }
  if (caution.length > 0) {
    return { grade: "caution", reasons: caution, workedHours };
  }
  return { grade: "fit", reasons: [], workedHours };
}
