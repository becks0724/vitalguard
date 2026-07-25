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
 * 연결끊김(stale)도 같은 이유로 최소 caution 이다 — 낡은 값이 "정상"으로 보이면 안 된다.
 *
 * 2026-07-26 정정(감사 DLT-LIB-012/014) — 과거에는 stale 과 outside 를 별도 분기로 썼으나
 * 두 분기의 반환식이 동일해 **순서가 아무 효과도 없는 no-op** 이었고, 주석은 "stale 이면 이탈을
 * 얹지 않는다"고 적혀 있어 코드와 어긋났다. 톤 합성에서 둘은 실제로 같은 효과(최소 caution)이므로
 * 한 식으로 합친다. **두 상태의 구분은 톤이 아니라 라벨이 담당한다**(disconnectMetric 참조) —
 * "구획 밖에서 신호 두절"은 수색 위치 단서라 "그냥 연결끊김"과 반드시 구별되어야 한다.
 *
 * 호출부는 **가공하지 않은 생체 톤**을 넘긴다. 과거 통합 신호등은 `stale ? "caution"` 으로 미리
 * 강등해 넘기고 표 행은 원 톤을 넘겨, 같은 작업자가 화면마다 caution/danger 로 갈렸다(DLT-LIB-014).
 */
export function effectiveTone(
  vitalTone: VitalStatus,
  opts: { stale?: boolean; outside?: boolean },
): VitalStatus {
  if (opts.stale || opts.outside) return worseTone(vitalTone, "caution");
  return vitalTone;
}

/**
 * 연결끊김 작업자의 이상 사유 라벨.
 *
 * 구획 밖에서 신호가 끊긴 것은 "배터리 방전"과 전혀 다른 사건이다 — 마지막 확인 위치가
 * 작업구역 밖이라는 뜻이라 수색 시작점이 달라진다. 톤은 같아도 라벨은 구별한다(감사 DLT-LIB-013).
 */
export function disconnectMetric(outside: boolean): string {
  return outside ? "구획밖 연결끊김" : "연결끊김";
}

/** 표에 실제로 렌더할 생체 3종 — 값이 없으면 undefined 로 통일(호출부는 "--" 로 렌더). */
export type GatedVitals = {
  heartRate: number | undefined;
  spo2: number | undefined;
  skinTempC: number | undefined;
};

/**
 * 연결끊김(stale)이면 sticky 직전값을 현재값처럼 보여주지 않는다(false-OK 차단).
 *
 * store.ts 의 sticky merge 는 "아이폰 잠금 중 iOS 가 HealthKit 읽기를 막아 폰이 null 을 보낼 때"
 * 카드가 비지 않게 하려는 장치다. 잠금 중에도 폰은 vital 만 null 로 채워 **계속 POST 하므로**
 * ts 가 갱신되어 stale 이 되지 않는다 — 이 게이트는 잠금 연속성을 깨지 않고 진짜 미수신만 비운다.
 *
 * 서버측 SpO₂ TTL(store.ts SPO2_TTL_MS)은 마지막 샘플 ts 기준이라 송신이 멈추면 나이가 더 이상
 * 자라지 않아 이 경우를 못 잡는다. 표시 계층의 벽시계 기준 게이트가 그 구멍을 메운다.
 */
export function gateStaleVitals(
  sample:
    | { heartRate?: number | null; spo2?: number | null; skinTempC?: number | null }
    | undefined,
  stale: boolean,
): GatedVitals {
  if (stale || sample === undefined) {
    return { heartRate: undefined, spo2: undefined, skinTempC: undefined };
  }
  return {
    heartRate: sample.heartRate ?? undefined,
    spo2: sample.spo2 ?? undefined,
    skinTempC: sample.skinTempC ?? undefined,
  };
}

/** 이상 명단에 표시할 사유 토큰에 위치 사유를 덧붙인다(생체 사유가 없으면 위치 단독). */
export function withOutsideMetric(metrics: string[], outside: boolean): string[] {
  if (!outside) return metrics;
  return [...metrics, "구획이탈"];
}
