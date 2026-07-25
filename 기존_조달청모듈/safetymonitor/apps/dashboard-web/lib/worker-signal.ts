// 작업자 신호등 톤 합성 — 생체 판정에 위치(구획 이탈) 상태를 얹는 순수 함수.
// 컴포넌트 안 useMemo 에 흩어져 있으면 회귀 테스트가 안 붙어 여기로 분리한다.
// DemoDashboard 의 지역 VitalStatus 와 동일한 유니온(구조적 타이핑으로 상호 호환).
export type SignalTone = "idle" | "normal" | "caution" | "danger";
type VitalStatus = SignalTone;

export const TONE_RANK: Record<VitalStatus, number> = {
  idle: 0,
  normal: 1,
  caution: 2,
  danger: 3,
};

export function worseTone(a: VitalStatus, b: VitalStatus): VitalStatus {
  return TONE_RANK[a] >= TONE_RANK[b] ? a : b;
}

/**
 * 생체 톤 + 위치 상태 → 카드/신호등에 표시할 최종 톤.
 *
 * 구획 이탈은 주의(caution) 로 본다. 워치는 작업 중에만 착용하므로 "착용 중 + 구획 밖"은
 * 근무지 이탈로 간주하되, 생체 이상만큼 즉각적 위해는 아니라 danger 로 올리지 않는다.
 * 생체가 이미 danger 면 worst-of 로 danger 가 유지된다.
 *
 * 연결끊김(stale)이면 위치 판정을 신뢰할 수 없으므로 이탈을 얹지 않는다 —
 * 미수신을 이탈로 오인하지 않기 위함(구획 상태머신도 60초 stale 게이트를 둔다).
 */
export function effectiveTone(
  vitalTone: VitalStatus,
  opts: { stale?: boolean; outside?: boolean },
): VitalStatus {
  if (opts.stale) return worseTone(vitalTone, "caution");
  if (opts.outside) return worseTone(vitalTone, "caution");
  return vitalTone;
}

/** 이상 명단에 표시할 사유 토큰에 위치 사유를 덧붙인다(생체 사유가 없으면 위치 단독). */
export function withOutsideMetric(metrics: string[], outside: boolean): string[] {
  if (!outside) return metrics;
  return [...metrics, "구획이탈"];
}
