// 벗음 의심 라벨 — 15분째 평평한 심박(SD·연속차)을 상태 칸의 글자로만 바꾼다. 판정은 안 건드린다.
//
// ★ 왜 (2026-08-28 · docs/vital-offwrist-suspect). 벗은 애플워치의 심박은 사라지지 않고 **평평해진다** —
//   상시 HKWorkoutSession 아래서 추적 필터가 직전 추정을 붙들기 때문이다. 5분 창 전수(08-16~28 · 착용
//   1019창 · 벗음 7창): 벗음 SD ≤ 2.9 · 연속 표본 차이 평균 ≤ 1.03, 착용 p50 SD 3.04 · 1.25.
//   그러나 착용한 채 가만히 있는 창의 29% 도 한 창 기준으로 벗음처럼 보인다 → **경보로는 못 쓴다.**
//   그래서 라벨이고, `무동작`(정지 ≥ 5분) 아래에서만 뜬다 — 움직이면서 평평한 것은 착용 중 작업이다.
//
// ⚠ **판정 불변.** 톤·게이트·집계·경보·signalLevel 은 이 값을 모른다. 라벨 글자는 이 파일 한 곳.
// ⚠ 문턱은 방향값이다 — 미탐 축의 분모가 7 이라 문턱 간 차이는 표본 잡음과 구별되지 않는다. 현장 데이터가
//   생기면 다시 잰다(docs/vital-still-label/context-notes.md 08-28 밤 절).

/** 창 길이. 전수검사와 같은 5분. */
export const OFFWRIST_WINDOW_MS = 300_000;
/** 연속 평평 창 수. 3 = 15분. 착용-휴식 한 창(29%)이 우연히 이어질 확률을 눌러 12일에 착용 run 5건으로. */
export const OFFWRIST_WINDOWS = 3;
/**
 * 창당 최소 심박 표본. 애플 5초 주기(창당 60)의 절반. 갤럭시(120초 · 창당 ≤ 3)는 여기서 **판정 불가**로
 * 떨어진다 — 갤럭시는 하드웨어 off-body 가 벗음을 `대기` 로 이미 잡는다.
 */
export const OFFWRIST_MIN_SAMPLES = 30;
/** 5분 창 심박 표준편차 상한. 벗음 max 2.9 · 착용 p25 2.47. */
export const OFFWRIST_SD_MAX = 2.5;
/** 연속 표본 차이 절대값 평균 상한. 벗음 max 1.03 · 착용 p50 1.25. */
export const OFFWRIST_MASD_MAX = 1.0;
/** 라벨. `무동작` 아래 한 줄. 벗음을 단정하지 않는다 — "의심". */
export const OFFWRIST_LABEL = "벗음 의심";
/** 거꾸로 세는 창 수 상한(1시간). 지속 표시의 상한이지 판정엔 영향 없다. */
const MAX_WINDOWS = 12;

export type HrPoint = { tsMs: number; bpm: number };
export type OffWristSuspect = { label: string; flatMs: number };

/**
 * 한 창(endMs 직전 5분)의 평평함. `undefined` = 표본 부족(판정 불가). true/false = 판정.
 * 표본은 시각순으로 정렬돼 있어야 한다(연속차 계산이 순서에 의존).
 */
export function windowFlat(sorted: HrPoint[], endMs: number): boolean | undefined {
  const startMs = endMs - OFFWRIST_WINDOW_MS;
  const w = sorted.filter((p) => p.tsMs > startMs && p.tsMs <= endMs && Number.isFinite(p.bpm));
  if (w.length < OFFWRIST_MIN_SAMPLES) return undefined;
  const mean = w.reduce((s, p) => s + p.bpm, 0) / w.length;
  const sd = Math.sqrt(w.reduce((s, p) => s + (p.bpm - mean) ** 2, 0) / w.length);
  let diff = 0;
  let prev: number | undefined;
  for (const p of w) {
    if (prev !== undefined) diff += Math.abs(p.bpm - prev);
    prev = p.bpm;
  }
  const masd = diff / (w.length - 1);
  return sd <= OFFWRIST_SD_MAX && masd <= OFFWRIST_MASD_MAX;
}

/** 지금부터 거꾸로 연속으로 평평한 창 수. 판정 불가(표본 부족)나 평평하지 않은 창에서 멈춘다. */
export function flatWindowCount(points: HrPoint[], nowMs: number): number {
  const sorted = [...points].sort((a, b) => a.tsMs - b.tsMs);
  let count = 0;
  for (let k = 0; k < MAX_WINDOWS; k++) {
    const flat = windowFlat(sorted, nowMs - k * OFFWRIST_WINDOW_MS);
    if (flat !== true) break;
    count++;
  }
  return count;
}

/** 상태 칸에 `벗음 의심` 을 낼지. 낸다면 라벨과 평평 지속(ms · 창 단위). */
export function offWristSuspect(points: HrPoint[], nowMs: number): OffWristSuspect | undefined {
  const count = flatWindowCount(points, nowMs);
  return count >= OFFWRIST_WINDOWS ? { label: OFFWRIST_LABEL, flatMs: count * OFFWRIST_WINDOW_MS } : undefined;
}
