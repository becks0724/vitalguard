// 산소포화도 경보의 「확인」을 측정 한 건 단위로 기억하는 열쇠 — 새로고침해도 같은 측정의 팝업을 다시 띄우지 않는다.
//
// ★ 2026-09-29 경보 14212 — 생체 경보 팝업의 「확인」 기억은 화면 메모리(`DemoDashboard` ackedVital)에만 있었다.
//   생체 경보는 「정상으로 돌아왔다가 다시 위험해지면 또 울려야 한다」는 이유로 브라우저 저장에서 뺐는데,
//   그 탓에 새로고침·새 창에서는 신선도 30분 동안 같은 86% 팝업이 다시 떴다(서버 원장엔 09:08:38 확인 기록).
//   산소포화도는 측정마다 측정 시각이 있다 → 그 측정만 기억하면 새 측정은 열쇠가 달라 그대로 다시 울린다.

export type VitalDangerParts = { hr: boolean; spo2: boolean; core: boolean };

/** 브라우저 저장 열쇠의 종류 칸 — 낙상·SOS 의 「종류|작업자|시각」 자연키와 같은 모양. */
export const SPO2_ACK_KEY_TYPE = "vital-spo2";

/**
 * 산소포화도만 위험이고 측정 시각이 있을 때만 열쇠를 만든다.
 * 심박·체온이 함께 위험이면 null — 그 둘은 측정 단위로 가를 열쇠가 없어 종전 방식(화면 메모리)을 쓴다.
 */
export function spo2AckKey(
  sample: { workerId: string; spo2MeasuredAt?: string | null },
  danger: VitalDangerParts,
): string | null {
  if (!danger.spo2 || danger.hr || danger.core) return null;
  if (!sample.spo2MeasuredAt) return null;
  return `${SPO2_ACK_KEY_TYPE}|${sample.workerId}|${sample.spo2MeasuredAt}`;
}

/** 이 위험 워커의 팝업을 건너뛸까 — 화면 메모리(워커 단위)나 브라우저 저장(측정 단위)에 확인이 있으면. */
export function isVitalAlertAcked(
  workerId: string,
  ackKey: string | null,
  ackedWorkers: ReadonlySet<string>,
  ackedKeys: ReadonlySet<string>,
): boolean {
  return ackedWorkers.has(workerId) || (ackKey !== null && ackedKeys.has(ackKey));
}
