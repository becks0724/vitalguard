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
const CT0 = 37.1;
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

/** 광학 심박 오측 가드 — 범위 밖 bpm 은 버킷에 넣지 않는다. */
const BPM_MIN = 30;
const BPM_MAX = 220;

/**
 * 심박 시계열 → 심부체온 추정. 순수 함수(I/O·시계 없음) — 같은 입력이면 항상 같은 출력.
 * 1분 버킷 평균으로 접고, 결측 분은 예측만 반복(불확실성 증가)해 갭 후 재수렴한다.
 * 유효 버킷 30분 미만이면 null(워밍업 미달 — 표시하지 않는 것이 정직).
 */
export function estimateCoreTemp(points: HrPoint[]): CoreTempEstimate | null {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const p of points) {
    if (!Number.isFinite(p.tsMs) || !(p.bpm >= BPM_MIN && p.bpm <= BPM_MAX)) continue;
    const minute = Math.floor(p.tsMs / 60_000);
    const b = buckets.get(minute) ?? { sum: 0, n: 0 };
    b.sum += p.bpm;
    b.n += 1;
    buckets.set(minute, b);
  }
  const minutes = [...buckets.keys()].sort((a, b) => a - b);
  if (minutes.length < CORE_TEMP_MIN_MINUTES) return null;

  let ct = CT0;
  let v = 0; // 상태 분산 — 문헌 초기값 0(첫 스텝부터 γ² 로 자란다)
  let prevMinute = minutes[0]! - 1;
  for (const minute of minutes) {
    const bucket = buckets.get(minute)!;
    const hr = bucket.sum / bucket.n;
    // 예측 — 결측 분만큼 과정 잡음을 누적(갭이 길수록 다음 관측이 강하게 끌어당긴다)
    v += GAMMA_SQ * (minute - prevMinute);
    // 보정(확장 칼만 — 관측 모델을 현재 추정점에서 선형화)
    const m = 2 * B2 * ct + B1;
    const k = (v * m) / (m * m * v + SIGMA_SQ);
    ct += k * (hr - expectedHr(ct));
    v *= 1 - k * m;
    prevMinute = minute;
  }
  return { tempC: ct, basisMinutes: minutes.length, lastHrTsMs: minutes[minutes.length - 1]! * 60_000 };
}
