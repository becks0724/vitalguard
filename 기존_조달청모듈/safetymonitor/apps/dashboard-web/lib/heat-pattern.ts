// 저활동·고심박 패턴 감지(온열 ②) — "쉬는데 심박이 안 내려옴"을 표시 주석으로 알린다. 판정 미주입.
//
// 목적 — 심박 하나로는 "운동성 상승"과 "열 축적·탈수·긴장"을 구분할 수 없다. 활동 에너지
// (대사 열생산 대리)가 낮은데 심박이 지속 상승이면 후자 쪽 신호이고, 이때 심부체온 추정
// (심박 기반 칼만)은 과대추정 방향일 수 있다 — 관제자가 추정치를 믿을지 판단할 근거를 준다.
//
// 원칙 — 이 결과는 표시(툴팁·라벨) 전용이다. workerStatus/overallStatus/경보에 넣지 않는다
// (가드 테스트 고정). 칼만 수식에도 넣지 않는다 — 실측 심부체온 정답 없이 계수 변경은 검증 불가.
//
// 판정 불가(null)와 정상(flagged=false)을 구분한다 — 활동 에너지 파이프라인이 없는 워커
// (구 앱·권한 미허용)는 "낮음"이 아니라 "모름"이고, 모름에 주석을 달면 오독이다.

export type HrEnergyPoint = {
  /** 샘플 시각 epoch ms */
  tsMs: number;
  hr?: number;
  /** 직전 배치 이후 소모 증분(kcal) — 워치 5초 델타 계약 */
  aeKcal?: number;
};

export type HeatPatternResult = {
  flagged: boolean;
  /** 창 내 1분 버킷 평균의 평균(bpm) */
  hrAvg: number;
  /** 창 내 분당 소모율(kcal/min) — 심박이 살아 있던 분 기준, 에너지 없는 분은 0 소모로 센다 */
  aeKcalPerMin: number;
  /** 심박 커버 분 수(지속성 근거) */
  coveredMinutes: number;
};

/** 판정 창 — 순간이 아니라 지속을 본다(단발 긴장·오측 배제). */
export const HEAT_PATTERN_WINDOW_MIN = 15;
/** 창 15분 중 심박 커버 최소 분 — 미만이면 지속성 판단 불가(null). */
export const HEAT_PATTERN_MIN_COVERED_MIN = 10;
/** 지속 고심박 경계(창 평균) — 휴식 정상 상한(<90)에 여유를 둔 보수값. 경계 포함(≥). */
export const HEAT_PATTERN_HR_BPM = 100;
/**
 * 저활동 경계(kcal/min) — 휴식~서있기 0~1.5, 가벼운 작업 3~5. 경계 포함(≤).
 *
 * ★★★ 이 조건은 **2026-08-13 배포 이래 한 번도 참이 된 적이 없고 될 수도 없다.**
 * 기다려도 오지 않으므로 "아직 안 뜬 것" 으로 읽지 말 것.
 *
 * 근거(2026-08-15 실측 · 08-13 이후 심박 커버 ≥10 인 온전한 분 2,067개)
 *   분당 최소 2.40 kcal · 평균 4.81 · 최대 52.79 · **임계 1.5 이하 분 0개**
 * 분당 최솟값이 임계를 넘으므로 어떤 15분 창 평균도 임계 이하가 될 수 없다.
 *
 * 원인은 우리 코드가 아니다 — 상시 `HKWorkoutSession` 때문에 애플이 하루 종일을
 * "운동 중" 으로 간주해 앉아 있어도 활동에너지를 시간당 약 288 kcal 로 산출한다
 * (건강 앱 대조: 2,201 cal ÷ 운동 472분 = 분당 4.66, 우리 DB 4.77~4.79 로 일치).
 * 상시 워크아웃은 폰 강제종료·잠금 생존의 핵심 장치라 포기할 수 없다.
 *
 * ⚠ **임계를 4.8 위로 올리는 것은 해법이 아니다.** 1.5 의 근거(일반 대사 참고값)는 옳고
 * 축이 안 맞는 쪽은 워치 값이다. 맞추면 근거 없는 숫자가 된다.
 *
 * 대체 설계(심박 주 · 걸음 배제 보조)는 확정됐고 구현만 남았다 —
 * `apps/dashboard-web/docs/heat-activity-axis/checklist.md`.
 * 그때까지 이 상수와 조건은 **기록으로 남긴다**(지우면 왜 그랬는지가 사라진다).
 */
export const HEAT_PATTERN_LOW_KCAL_PER_MIN = 1.5;

// 광학 심박 오측 가드 — core-temp-estimator 와 같은 범위.
const BPM_MIN = 30;
const BPM_MAX = 220;

/**
 * 워커 1명의 최근 시계열(활동 에너지 파이프라인 확인용으로 창보다 긴 구간을 받는다)에서
 * 저활동·고심박 패턴을 판정한다. 순수 함수 — 같은 입력이면 항상 같은 출력.
 *
 * null = 판정 불가 — ① 전체 구간에 aeKcal 이 한 건도 없음(에너지 파이프라인 없는 워커:
 * 창 내 에너지 0 이 "저활동"인지 "미수집"인지 구분 불가) ② 창 내 심박 커버 10분 미만.
 */
export function detectLowActivityHighHr(
  points: HrEnergyPoint[],
  nowMs: number,
): HeatPatternResult | null {
  // 파이프라인 존재 확인은 창 밖(조회 구간 전체)까지 본다 — 15분 내내 쉬면 증분 0.01kcal
  // 미만이라 워치가 에너지 항목을 아예 안 싣는 것이 정상 동작이기 때문.
  const hasEnergyPipeline = points.some((p) => p.aeKcal != null && Number.isFinite(p.aeKcal));
  if (!hasEnergyPipeline) return null;

  const fromMs = nowMs - HEAT_PATTERN_WINDOW_MIN * 60_000;
  const hrByMinute = new Map<number, { sum: number; n: number }>();
  let aeSum = 0;
  for (const p of points) {
    if (!Number.isFinite(p.tsMs) || p.tsMs < fromMs || p.tsMs > nowMs) continue;
    const minute = Math.floor(p.tsMs / 60_000);
    if (p.hr != null && p.hr >= BPM_MIN && p.hr <= BPM_MAX) {
      const b = hrByMinute.get(minute) ?? { sum: 0, n: 0 };
      b.sum += p.hr;
      b.n += 1;
      hrByMinute.set(minute, b);
    }
    if (p.aeKcal != null && Number.isFinite(p.aeKcal) && p.aeKcal >= 0) {
      aeSum += p.aeKcal;
    }
  }

  const coveredMinutes = hrByMinute.size;
  if (coveredMinutes < HEAT_PATTERN_MIN_COVERED_MIN) return null;

  let bucketMeanSum = 0;
  for (const b of hrByMinute.values()) bucketMeanSum += b.sum / b.n;
  const hrAvg = bucketMeanSum / coveredMinutes;
  // 분모 = 심박 커버 분(워치가 살아 있던 시간). 파이프라인이 확인된 워커의 에너지 없는 분은
  // 0 소모로 세는 것이 맞다 — 전체 창(15분)으로 나누면 수신 공백이 저활동으로 둔갑한다.
  const aeKcalPerMin = aeSum / coveredMinutes;

  return {
    flagged: hrAvg >= HEAT_PATTERN_HR_BPM && aeKcalPerMin <= HEAT_PATTERN_LOW_KCAL_PER_MIN,
    hrAvg: Math.round(hrAvg),
    aeKcalPerMin: Math.round(aeKcalPerMin * 100) / 100,
    coveredMinutes,
  };
}
