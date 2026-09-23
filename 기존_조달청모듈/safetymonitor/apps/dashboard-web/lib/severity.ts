// vital sample → 위험도 판정. analyzers THRESHOLDS 단일 source.
// DB row(snake_case) 와 VitalSample(camelCase) 둘 다 받기 위해 raw 필드를 받는 함수로 분리.
import {
  THRESHOLDS,
  estimateCoreTempC,
  classifyActivity,
  type ActivityState,
} from "@safetymonitor/analyzers";

export type Status = "idle" | "normal" | "caution" | "danger";

export const STATUS_LABEL: Record<Status, string> = {
  idle: "대기",
  normal: "정상",
  caution: "주의",
  danger: "위험",
};

// ── 작업 중 심박 작업부하 밴드 (활동 게이트 — 카드·차트 공유 단일 source) ──
// 육체노동으로 구조적으로 상승한 심박을 안정 임계(110/130)로 오경보하지 않도록,
// 활동이 '작업 중(heavy)'으로 분류될 때만 작업부하 밴드를 적용한다(ISO 8996·ACGIH 참고·튜닝 가능).
// 안전 불변식: 활동 데이터 없음/안정이면 안정 임계(보수적), 완화만 하고 강화는 없음,
// 과부하(overload)·급락(collapse)은 작업 중에도 위험. SpO₂·체온은 활동 무관(미적용).
export const WORK_HR = { heavyBpm: 135, overloadBpm: 155, collapseBpm: 45 } as const;

// 활동 인자(rest/light/heavy/null) 가 '작업 중'인지. 기본은 heavy 만 완화(가장 안전).
export function isWorking(activity: ActivityState | null | undefined): boolean {
  return activity === "heavy";
}

// VitalSample 형태(활동 필드)에서 활동 상태 분류 — classifyActivity 단일 source 재사용.
export function workActivity(inputs: {
  activeEnergyKcal?: number | null;
  steps?: number | null;
  flightsClimbed?: number | null;
}): ActivityState | null {
  return classifyActivity({
    activeEnergyKcal: inputs.activeEnergyKcal ?? undefined,
    steps: inputs.steps ?? undefined,
    flightsClimbed: inputs.flightsClimbed ?? undefined,
  });
}

// 무조건 작업부하 밴드 판정 — 차트 추세 전용(집계 버킷이라 per-점 활동맥락이 없어 작업기준 고정).
export function workHeartRateStatus(hr: number | null | undefined): Status {
  if (hr === null || hr === undefined) return "idle";
  if (hr >= WORK_HR.overloadBpm || hr <= WORK_HR.collapseBpm) return "danger";
  if (hr >= WORK_HR.heavyBpm) return "caution";
  return "normal";
}

// 심박 안정 임계의 '주의' 밴드 (의료 reference) — heartRateStatus 와 SQL 집계가 공유하는 단일 소스.
export const HR_CAUTION = { highBpm: 110, lowBpm: 50 } as const;

// 심박 위험도 — 활동 미지정/안정: danger ≥130·≤40, caution 110~129·41~50 (안정 임계, 의료 reference).
// 활동 '작업 중(heavy)': danger ≥155(과부하)·≤45(급락), caution 135~154(고강도) (작업부하 밴드).
export function heartRateStatus(
  hr: number | null | undefined,
  activity?: ActivityState | null,
): Status {
  if (hr === null || hr === undefined) return "idle";
  if (isWorking(activity)) return workHeartRateStatus(hr);
  if (hr >= THRESHOLDS.heartRate.highBpm || hr <= THRESHOLDS.heartRate.lowBpm) {
    return "danger";
  }
  if (hr >= HR_CAUTION.highBpm || hr <= HR_CAUTION.lowBpm) return "caution";
  return "normal";
}

export function spo2Status(spo2: number | null | undefined): Status {
  if (spo2 === null || spo2 === undefined) return "idle";
  if (spo2 < THRESHOLDS.spo2.dangerPct) return "danger";
  if (spo2 < THRESHOLDS.spo2.cautionPct) return "caution";
  return "normal";
}

/**
 * ★ **심부 체온을 직접 받아 판정한다** — 라이브 판정의 정본(2026-08-26 신설).
 *
 * 입력은 심박 기반 칼만 추정치(`estimateCoreTempSeries`)를 상정한다. 아래
 * `coreTempStatus(skin)` 와 임계는 같지만 **입력의 출처가 다르다** — 그것이 이 함수를
 * 따로 둔 이유다. 손목 실측에는 기기 발열이 섞이고(주변온≥33 구간에서 +0.841℃),
 * 심박 경로는 같은 구간에서 +0.019℃ 로 사실상 안 움직인다(2026-08-26 실측).
 *
 * ⚠ `undefined` 는 "정상"이 아니라 **판정 불가(idle)** 다. 칼만은 30분 심박 이력을 먹는
 *   필터라 워밍업 전에는 값이 없다. 그때 손목 실측으로 폴백하면 이 함수를 만든 이유가
 *   사라지므로 **폴백하지 않는다** — 모르는 것은 모른다고 둔다.
 */
export function coreTempStatusC(coreTempC: number | null | undefined): Status {
  if (coreTempC === null || coreTempC === undefined) return "idle";
  if (coreTempC >= THRESHOLDS.coreTemp.dangerC) return "danger";
  if (coreTempC >= THRESHOLDS.coreTemp.cautionC) return "caution";
  return "normal";
}

/**
 * 칼만 추정의 유효기간(분) — 마지막 **심박**으로부터.
 *
 * ★ 왜 필요한가(2026-08-26 실측). 서버는 심박 이력이 끊겨도 마지막 추정치를 계속 내려보낸다.
 *   그날 EMP-6861 은 **심박이 32분째 없는데 행(피부온·배터리)은 3분 전까지 들어왔다** —
 *   즉 행 신선도로는 안 걸리고, 판정은 32분 전 심박에서 나온 값으로 이뤄진다.
 *   종전 손목 기반 판정은 값이 행과 함께 와서 자동으로 신선했다. 칼만으로 옮기면서
 *   **"판정 근거가 행보다 임의로 늙을 수 있다"** 는 성질이 새로 생겼고, 그 구멍을 여기서 막는다.
 *
 * ★ 값의 근거 = 문헌 계수에서 파생한다(매직넘버 아님). 과정 잡음 γ=0.022℃/분이므로 심박 없이
 *   t분이 지나면 상태 표준편차가 대략 γ·√t 만큼 자란다. 모델 자체 오차(RMSE 0.21~0.30℃)에
 *   닿는 지점이 자연스러운 경계이고, γ·√t ≈ 0.22℃ 가 되는 t 가 100분이다 — 너무 길다.
 *   실제로는 **심박이 끊기면 그 사이 열부하 변화를 아예 못 본다**는 쪽이 더 큰 위험이라,
 *   "정상 수집이면 이 안에 반드시 새 심박이 온다" 는 관측 주기 기준으로 잡는다.
 *   갤럭시 전송 주기 120초 · 애플 30초 배칭이므로 **10분이면 정상 수집에서는 결코 안 걸리고**
 *   (5배 여유), 스트림이 죽으면 곧바로 걸린다. 이 구간의 표류는 γ·√10 ≈ 0.07℃ 로 무시할 만하다.
 */
export const CORE_TEMP_EST_MAX_AGE_MIN = 10;

/**
 * 신선도까지 본 심부체온 판정 — **라이브 판정은 이것을 쓴다**.
 *
 * `lastHrTs` 가 없거나 유효기간을 넘겼으면 `idle`(판정 불가)다. 값을 그대로 쓰지 않는 이유는
 * 이 레포가 반복해 고쳐 온 형태이기 때문이다 — 낡은 값을 현재값처럼 보여주면 화면이 거짓말을 한다
 * (하트비트 12시간 · sticky 병합 · 지도 고스트 강등이 전부 같은 계열이다).
 */
export function coreTempStatusFresh(
  est: { tempC: number; lastHrTs: string } | undefined,
  nowMs: number,
): Status {
  if (!est) return "idle";
  const ageMs = nowMs - Date.parse(est.lastHrTs);
  if (!Number.isFinite(ageMs) || ageMs > CORE_TEMP_EST_MAX_AGE_MIN * 60_000) return "idle";
  return coreTempStatusC(est.tempC);
}

/**
 * 손목 온도 → 추정 심부 체온 변환 후 판정.
 *
 * ⚠ **입력이 오염된다.** 워치 온도 센서가 기기 표면 근처라 발열이 섞이고, `wristToCoreOffsetC`
 * 자체도 근거 미확인이다. 그래서 **라이브 판정에는 위 `coreTempStatusC` 를 쓴다.**
 *
 * ⛔ **2026-09-23 — 프로덕션에서 이 함수를 부르는 곳은 이제 0 이다. 새로 부르지 마라.**
 *   옛 주석이 이 자리를 "칼만을 만들 수 없는 자리에 남겨 둔 것" 이라며 셋을 열거했는데
 *   (행 단위 과거 조회·내보내기·수집 시점 경보), 그 전제가 **09-18 에 깨졌다.**
 *   그날 세 번째 선택지 `skinTempStatus`(변환 없이 피부온 임계로 잰다)가 생겼고
 *   앞의 둘은 그리로 옮겼는데 **주석은 안 고쳤다.** 그래서 남은 한 줄(`dangerMetrics`)이
 *   "원래 이런 곳" 으로 읽혀 **닷새 더 살아남았다** — 그동안 텔레그램은 38.0℃ 에 울리고
 *   화면은 같은 건을 「주의」로 칠했다(26일 표본 78건 어긋남). 09-23 에 정렬했다.
 *   못 박는 시험 = `lib/2026-09-23-collection-alert-skin-threshold.guard.test.ts`.
 *
 * 남겨 두는 이유는 하나 — `lib/severity.test.ts` 가 이 변환의 동작을 기록한다.
 * 판정에 쓸 곳을 찾고 있다면 아래 `skinTempStatus` 다.
 */
export function coreTempStatus(skinTempC: number | null | undefined): Status {
  if (skinTempC === null || skinTempC === undefined) return "idle";
  return coreTempStatusC(estimateCoreTempC(skinTempC));
}

/**
 * ★ **피부온을 변환 없이 그대로 판정한다**(2026-09-18 신설 — 위 `coreTempStatus` 를 대체).
 *
 * 왜 바꿨나 — `coreTempStatus` 는 `피부온 + 0.5` 를 「심부 추정」이라 부르고 심부 임계로 쟀다.
 * 그 오프셋은 출처가 없고(근거 커밋 0건), 값이 틀렸고(실측 1.71 대 코드 0.50),
 * 형태가 틀렸다(상수 아님 · 38~40℃ 구간에서 부호 반대). 실측으로 가장 큰 증거는
 * **임계가 없는 아래쪽**에 있었다 — 최근 30일 6,168행 중 그 계산이 35℃ 미만을
 * 1,111행(18.0%), 최저 25.98℃ 를 낸다. 정상 작업자를 중증 저체온으로 부르는 값이다.
 *
 * ⟹ 없는 변환을 지어내지 않는다. **실측 피부온을 피부온 임계로 잰다**(`THRESHOLDS.skinTemp`).
 *   그 임계는 워치(`wear/core/Severity.kt`)와 같은 값이라, 같은 피부온에 두 기준이 걸리던
 *   상태도 함께 풀린다.
 *
 * ⚠ **판정이 옳아진 것이 아니라 근거 없는 상수가 빠진 것이다.** 38.0/38.5 도 잠정값이다.
 * ⚠ 라이브 화면 판정은 여전히 심박 칼만(`coreTempStatusC`)이다. 이 함수는 칼만을 만들 수
 *   없는 자리(행 단위 과거 조회·내보내기·집계)에만 쓴다 — 그 입력에는 기기 발열이 섞인다.
 */
export function skinTempStatus(skinTempC: number | null | undefined): Status {
  if (skinTempC === null || skinTempC === undefined) return "idle";
  if (skinTempC >= THRESHOLDS.skinTemp.dangerC) return "danger";
  if (skinTempC >= THRESHOLDS.skinTemp.cautionC) return "caution";
  return "normal";
}

// SQL 집계(내보내기 미리보기 카운트)용 임계 파라미터 — 위 판정 함수들과 동일 상수에서 파생(단일 소스).
// SQL 쪽에 숫자를 하드코딩하지 않기 위해 쿼리 파라미터로 바인딩해 전달한다(과거 감사 M5 임계 중복 재발 방지).
export const SEVERITY_SQL_PARAMS = {
  hrDangerHigh: THRESHOLDS.heartRate.highBpm,
  hrDangerLow: THRESHOLDS.heartRate.lowBpm,
  hrCautionHigh: HR_CAUTION.highBpm,
  hrCautionLow: HR_CAUTION.lowBpm,
  spo2Danger: THRESHOLDS.spo2.dangerPct,
  spo2Caution: THRESHOLDS.spo2.cautionPct,
  // ★ 2026-09-18 — `tempOffset` 을 뺐다. SQL 도 `skin_temp_c + offset >= core임계` 가 아니라
  //   `skin_temp_c >= 피부온임계` 로 잰다(위 `skinTempStatus` 와 같은 식).
  skinDanger: THRESHOLDS.skinTemp.dangerC,
  skinCaution: THRESHOLDS.skinTemp.cautionC,
} as const;

export type SeveritySqlParams = typeof SEVERITY_SQL_PARAMS;

export type StatusInputs = {
  heart_rate: number | null;
  spo2: number | null;
  skin_temp_c: number | null;
  manual_sos: number | null;
  fall_detected: number | null;
};

// 종합: 낙상 또는 SOS 가 트리거되면 즉시 danger, 아니면 3 메트릭 worst-of
export function overallStatus(row: StatusInputs): Status {
  if (row.fall_detected === 1) return "danger";
  if (row.manual_sos === 1) return "danger";
  const statuses: Status[] = [
    heartRateStatus(row.heart_rate),
    spo2Status(row.spo2),
    // ★ 2026-09-18 — `coreTempStatus`(피부온+0.5) → `skinTempStatus`(피부온 그대로).
    skinTempStatus(row.skin_temp_c),
  ];
  if (statuses.includes("danger")) return "danger";
  if (statuses.includes("caution")) return "caution";
  if (statuses.includes("normal")) return "normal";
  return "idle";
}
