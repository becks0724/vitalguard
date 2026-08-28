// 무동작 라벨 — 워치의 정지 지속(motionStillSec)을 상태 칸의 글자로만 바꾼다. 판정은 안 건드린다.
//
// ★ 왜 필요한가 (2026-08-28 · docs/vital-still-label). 애플워치를 11분 벗어 뒀는데 화면이 내내
//   `수신 중 · 89bpm` 이었다. 상시 HKWorkoutSession 이 손목 감지를 우회해 **벗어도 그럴듯한 심박이
//   계속 온다**(08-13·08-18·08-28 세 번 재현). 심박도, 모션 변동폭 `mv` 도 벗음을 못 가른다
//   (08-19 통제군 · 착용 바닥 1 = 책상 최소).
//
// ★ 그래서 질문을 바꿨다 — "벗었나" 가 아니라 **"이 사람을 확인하러 가야 하나"**.
//   5분 넘게 0.03g 도 안 움직였다면 의식을 잃었든 워치를 벗어 뒀든 **조치가 같다**(가서 본다).
//   조치가 같으면 둘을 못 가르는 것은 결함이 아니고, 그 구간에 `수신 중` 이 떠서 아무도 안 가는
//   것이 결함이다. 이 라벨은 아는 것만 말한다 — "N분째 움직임 없음". 벗음도 응급도 단정하지 않는다.
//
// ⚠ **판정 불변.** tone(신호등 색·집계·게이트·경보)은 이 값을 모른다. `수신 중`(=아는 게 없다)
//   자리만 대신하고, `주의`·`위험` 은 더 많은 정보라 덮지 않는다. `stale` 이면 끊긴 행의 값이라 안 쓴다.
//   같은 규율의 선례 = `수신 중`(08-20) · `심박끊김/연결끊김`(08-28).

/**
 * 라벨 문턱. 착용 + 의도적 정지 실측 137.5초(08-28)의 2배 이상 · 08-18 착용 정지 82초보다 훨씬 위 ·
 * `absence-check` 10분보다 아래. 사람은 원하는 만큼 가만히 있을 수 있어 **어떤 문턱도 착용 중에
 * 발화한다** — 그래서 이 라벨은 벗음을 말하지 않고 정지 시간만 말한다.
 * 7일 근무시간 실측(EMP-6861) = ≥300s 하루 0~25회(중앙값 3).
 */
export const STILL_LABEL_MS = 300_000;

/** 넉 자 — 상태 칸 폭을 `연결끊김`·`심박끊김`·`수신 중` 과 맞춘다. */
export const STILL_LABEL = "무동작";

export type StillSample = {
  /** 워치 CMMotionManager 기준 정지 지속(초). 못 잰 것은 0 이 아니라 undefined 다. */
  motionStillSec?: number;
};

export type StillLabel = { label: string; elapsedMs: number };

/**
 * 상태 칸에 `무동작` 을 낼지. 낸다면 라벨과 경과(ms).
 *
 * @param stale  행이 끊겼는가 — 끊긴 행의 정지값은 그 시각의 값이라 지금을 말하지 않는다.
 * @param tone   `workerStatus` 의 톤 — `normal` 일 때만. 다른 톤의 라벨이 더 많은 정보다.
 *
 * 경과는 **워치 값 그대로**다 — `now - ts` 를 더하지 않는다. store 가 이 값을 sticky 로 옮기므로
 * 더하면 이중 계산이고, `!stale` 조건이 그 차이를 신선도 문턱(60초) 안으로 묶는다.
 */
export function stillLabel(sample: StillSample, stale: boolean, tone: string): StillLabel | undefined {
  if (stale || tone !== "normal") return undefined;
  const sec = sample.motionStillSec;
  if (typeof sec !== "number" || !Number.isFinite(sec)) return undefined;
  const elapsedMs = sec * 1000;
  return elapsedMs >= STILL_LABEL_MS ? { label: STILL_LABEL, elapsedMs } : undefined;
}
