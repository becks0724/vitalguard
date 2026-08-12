// SpO₂ 측정 신선도 — 기회 측정(워치가 정지 상태에서 수 분~15분 간격)이라 값과 측정 나이가 한 몸이다.
//
// 갱신 구조(2026-08-12 사용자 확정) 4층 중 표시·판정 층을 담당한다.
// 수집(측정 이벤트에만 전송)·저장(측정 1건=1행)은 앱이 보장하고, 여기서는
// ① 화면에 "값 + 측정 경과"를 병기하고 ② 낡은 측정(30분 초과)을 위험도 판정에서 제외한다.
// 낡은 저산소 값이 위험 경보를 계속 점등하거나, 유지 표시(sticky)가 현재값으로 오독되는 것을 막는다.
//
// 시계 기준 — 대시보드 작업자 표의 기존 신선도 판정(signalLevel·isStale)과 같은 클라이언트 시계를
// 쓴다. 60초 게이트와 달리 30분 게이트는 분 단위 시계 오차에 둔감해 Date 헤더 보정 없이 충분하다.

export const SPO2_FRESH_MS = 30 * 60 * 1000;

type Spo2Carrier = {
  spo2?: number | null;
  spo2MeasuredAt?: string | null;
  ts: string;
};

/** 측정 나이(ms). spo2 가 없으면 null. 측정 시각이 없는 행(구 앱 데이터)은 ts(전송 시각)로 근사. */
export function spo2AgeMs(sample: Spo2Carrier | undefined, nowMs: number): number | null {
  if (!sample || typeof sample.spo2 !== "number") return null;
  const at = Date.parse(sample.spo2MeasuredAt ?? sample.ts);
  if (Number.isNaN(at)) return null;
  return Math.max(0, nowMs - at);
}

/** 판정용 SpO₂ — 신선(30분 이내)할 때만 값을 돌려주고, 낡거나 없으면 undefined(= 판정 제외). */
export function freshSpo2(sample: Spo2Carrier | undefined, nowMs: number): number | undefined {
  const age = spo2AgeMs(sample, nowMs);
  if (age === null || age > SPO2_FRESH_MS) return undefined;
  return sample?.spo2 ?? undefined;
}

/** 측정 경과 상대 표기 — 앱 홈 카드("측정 N초 전")와 같은 언어. */
export function formatSpo2Age(ageMs: number): string {
  if (ageMs < 60_000) return "방금 전";
  const min = Math.floor(ageMs / 60_000);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}
