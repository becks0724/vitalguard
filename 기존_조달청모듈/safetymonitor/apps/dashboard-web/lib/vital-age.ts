// 생체 수신 나이 산출 — 연결끊김 판정의 기준 시각을 정한다(행 도착이 아니라 심박 측정 기준).
//
// ★ 행 ts 로 재면 안 된다(2026-08-15 실측). 워치를 벗어도 워크아웃 세션이 활동에너지를 계속
// 누적해 **5초마다 행이 들어온다** — 미착용 구간에도 12건/분이 그대로 왔다. 그래서 행 ts 기준
// 신선도는 영원히 통과한다.
//
// ⚠ 이 수정이 고치는 것은 "정상으로 잘못 세는 것"이 **아니다**. 심박이 null 이면
// `heartRateStatus` 가 idle 을 돌려주고 `overallStatus` 도 idle 이라 집계는 이미 "대기"로 센다
// (08-12 신호등 false-OK 수정이 그대로 작동). "정상" 으로 세던 것은 **워치가 마지막 값을 무한
// 복사하던 시절**의 이야기이고 그쪽은 heartbeatMaxAge 로 이미 막았다.
// 여기서 바로잡는 것은 셋이다 —
//   ① **"대기"와 "연결끊김"의 구분.** 받은 적 없는 것(출근 전)과 받다가 끊긴 것은 관리자에게
//      전혀 다른 신호다. 행 ts 가 계속 갱신되면 후자가 전자로 보인다.
//   ② **신호 막대(signalLevel).** 행 ts 기준이라 생체가 끊겨도 4칸 꽉 찬 "수신 양호"로 보였다.
//   ③ **잔여 sticky 생체값.** stale 이 아니면 `gateStaleVitals` 가 안 걸려 SpO₂·체온의 직전값이
//      현재값처럼 남는다.
//
// 왜 심박 하나로 생체 전체를 판정하는가 — 최근 24시간 실측에서 **연속으로 오는 생체 신호는
// 심박뿐**이다(심박 99.3% · SpO₂ 4건 · 손목온도·HRV·안정심박·보행심박·호흡수 전부 0건).
// SpO₂ 는 같은 광학(PPG) 센서라 손목이 떨어지면 함께 멈추고, 심부체온 추정과 PSI 는 **심박을
// 입력으로 쓴다**. 즉 심박이 끊긴 시점에 독립적으로 살아 있는 생체 신호는 하나도 없다.
// 활동에너지·걸음은 생체가 아니라 움직임 누적이고 **사람이 없어도 나온다**.
export type VitalAgeSample = {
  ts: string;
  heartRateMeasuredAt?: string;
};

/**
 * 생체 수신 나이(ms). 심박 측정 시각이 있으면 그것을, 없으면 행 ts 를 기준으로 잰다.
 *
 * 측정 시각이 없는 샘플(구 앱·이벤트 전용 행)은 종전 동작 그대로 행 ts 폴백 — 하위 호환.
 * 파싱 불가한 값도 같은 폴백을 탄다(NaN 이 비교를 통과해 "항상 신선"이 되는 것을 막는다).
 */
export function vitalAgeMs(sample: VitalAgeSample, nowMs: number): number {
  const rowMs = new Date(sample.ts).getTime();
  const hrAt = sample.heartRateMeasuredAt;
  if (hrAt !== undefined) {
    const hrMs = new Date(hrAt).getTime();
    if (Number.isFinite(hrMs)) return nowMs - hrMs;
  }
  return nowMs - rowMs;
}
