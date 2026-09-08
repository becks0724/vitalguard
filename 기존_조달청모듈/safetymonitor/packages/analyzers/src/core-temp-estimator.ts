// 심박 기반 심부체온 추정 — USARIEM Buller 확장 칼만필터(2013) 문헌 계수 고정. 표시 전용(판정 미주입).
//
// 원리 — 심부체온이 오르면 체온 조절(피부 혈류 증가)로 심박이 예측 가능한 2차 곡선을 따라 오른다.
// 이 관측 모델을 거꾸로 타서 1분 평균 심박 시계열에서 체온을 추정한다. 문헌 검증 RMSE 0.21~0.30℃
// (삼킨 캡슐 실측 대비·야외 작업 부하). 계수는 논문값 그대로 두고 임의 조정하지 않는다 —
// 정답(실측 심부체온)이 없어 자체 보정은 검증 불가능한 조작이 된다.
//
// 한계(호출부·표기가 짊어질 것) — ① 심박 억제 약물(베타차단제 등)은 과소추정 = 놓침 방향
// ② 긴장·카페인·탈수는 과대추정(오경보 방향) ③ 임계 근처 ±0.5℃ 회색지대 ④ "측정" 아닌 "추정".

export type HrPoint = {
  /** 측정(수집) 시각 epoch ms */
  tsMs: number;
  bpm: number;
};

export type CoreTempEstimate = {
  /** 추정 심부체온(℃) */
  tempC: number;
  /** 추정에 쓰인 1분 버킷 수 — 신뢰 참고용 */
  basisMinutes: number;
  /** 마지막 심박 버킷의 분 시작 시각(epoch ms) — 신선도 판정용 */
  lastHrTsMs: number;
};

// 문헌 계수(Buller 2013) — CT₀ 37.1℃ · 과정 잡음 γ=0.022℃/분 · 관측 잡음 σ=18.88bpm
// 관측 모델 HR = b₂·CT² + b₁·CT + b₀ (CT 37.1℃ ↔ HR ≈ 83bpm · 38.5℃ ↔ ≈ 137bpm).
/** 세션 시작 기준 심부체온(℃) — PSI 의 Tc0 도 이 값을 쓴다(숫자를 두 곳에 두지 않는다). */
export const CT0 = 37.1;
const GAMMA_SQ = 0.022 ** 2;
const SIGMA_SQ = 18.88 ** 2;
const B0 = -7887.1;
const B1 = 384.4286;
const B2 = -4.5714;

function expectedHr(ct: number): number {
  return B2 * ct * ct + B1 * ct + B0;
}

/** 워밍업 하한 — 유효 심박이 이 분수(버킷 수) 미만이면 추정을 내지 않는다(초기값 편향 구간). */
export const CORE_TEMP_MIN_MINUTES = 30;

/** 세션 경계 — 심박 공백이 이 분수를 넘으면 미착용으로 보고 필터를 리셋(새 워밍업)한다.
 *  밤새 벗어둔 워치의 궤적이 이어진 척 그려지는 것을 막는다. 이내의 짧은 공백은 불확실성만 키운다. */
export const CORE_TEMP_SESSION_GAP_MINUTES = 60;

/** 광학 심박 오측 가드 — 범위 밖 bpm 은 버킷에 넣지 않는다. */
const BPM_MIN = 30;
const BPM_MAX = 220;

export type CoreTempSeriesPoint = {
  /** 1분 버킷 시작 시각(epoch ms) */
  tsMs: number;
  tempC: number;
};

// 1분 버킷 평균으로 접기 — 오측(bpm 범위 밖)·비유한 ts 는 버리고, 분 인덱스 오름차순으로 돌려준다.
function minuteBuckets(points: HrPoint[]): { minute: number; hr: number }[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.tsMs) || !(p.bpm >= BPM_MIN && p.bpm <= BPM_MAX)) continue;
    const minute = Math.floor(p.tsMs / 60_000);
    const b = buckets.get(minute) ?? { sum: 0, n: 0 };
    b.sum += p.bpm;
    b.n += 1;
    buckets.set(minute, b);
  }
  return [...buckets.entries()]
    .map(([minute, b]) => ({ minute, hr: b.sum / b.n }))
    .sort((a, b) => a.minute - b.minute);
}

/**
 * 심박 시계열 → 심부체온 추정 궤적. 순수 함수(I/O·시계 없음) — 같은 입력이면 항상 같은 출력.
 * 60분 초과 공백에서 세션을 끊어 필터를 리셋하고, 각 세션의 워밍업(30분) 구간은 점을 내지 않는다
 * — 차트에서 미착용 공백이 끊긴 선으로 보이는 것이 정직한 표현이다.
 */
export function estimateCoreTempSeries(points: HrPoint[]): CoreTempSeriesPoint[] {
  const series: CoreTempSeriesPoint[] = [];
  let ct = CT0;
  let v = 0; // 상태 분산 — 문헌 초기값 0(첫 스텝부터 γ² 로 자란다)
  let prevMinute: number | null = null;
  let segMinutes = 0;
  for (const { minute, hr } of minuteBuckets(points)) {
    const gap = prevMinute === null ? 1 : minute - prevMinute;
    if (gap > CORE_TEMP_SESSION_GAP_MINUTES) {
      ct = CT0;
      v = 0;
      segMinutes = 0;
    }
    // 예측 — 결측 분만큼 과정 잡음을 누적(공백이 길수록 다음 관측이 강하게 끌어당긴다)
    v += GAMMA_SQ * Math.min(gap, CORE_TEMP_SESSION_GAP_MINUTES);
    // 보정(확장 칼만 — 관측 모델을 현재 추정점에서 선형화)
    const m = 2 * B2 * ct + B1;
    const k = (v * m) / (m * m * v + SIGMA_SQ);
    ct += k * (hr - expectedHr(ct));
    v *= 1 - k * m;
    segMinutes += 1;
    if (segMinutes >= CORE_TEMP_MIN_MINUTES) {
      series.push({ tsMs: minute * 60_000, tempC: ct });
    }
    prevMinute = minute;
  }
  return series;
}

/**
 * 마지막 세션의 누적 버킷 수 — **워밍업 진행률 표시 전용**이다.
 *
 * 왜 필요한가 — `estimateCoreTemp` 가 null 을 내면 호출부는 "얼마나 남았는지"를 알 수 없어
 * 화면이 워밍업 중과 센서 미수신을 같은 빈칸으로 그린다. 그 빈칸이 고장으로 읽혔다.
 * 값 판정은 여전히 `estimateCoreTemp` 만 한다 — 여기서 나온 수는 라벨(N/30)에만 쓴다.
 *
 * ⚠ 세션 경계(60분 공백) 규칙이 `estimateCoreTempSeries` 와 갈리면 진행률이 거짓말을 한다.
 *   단위 테스트가 두 함수의 경계를 같은 표본으로 함께 고정한다.
 */
export function coreTempWarmupBuckets(points: HrPoint[]): number {
  let segMinutes = 0;
  let prevMinute: number | null = null;
  for (const { minute } of minuteBuckets(points)) {
    if (prevMinute !== null && minute - prevMinute > CORE_TEMP_SESSION_GAP_MINUTES) segMinutes = 0;
    segMinutes += 1;
    prevMinute = minute;
  }
  return segMinutes;
}

/**
 * 심박 시계열 → 현재 심부체온 추정(궤적의 마지막 점). 마지막 세션이 워밍업(30분) 미달이면
 * null — 표시하지 않는 것이 정직. basisMinutes 는 궤적에 기여한 유효 분(전 세션 합).
 */
export function estimateCoreTemp(points: HrPoint[]): CoreTempEstimate | null {
  const series = estimateCoreTempSeries(points);
  const last = series[series.length - 1];
  if (!last) return null;
  const basisMinutes = minuteBuckets(points).length;
  return { tempC: last.tempC, basisMinutes, lastHrTsMs: last.tsMs };
}
