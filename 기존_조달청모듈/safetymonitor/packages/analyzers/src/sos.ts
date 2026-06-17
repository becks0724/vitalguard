// SOS 수동 호출 분석기 — Watch 측 사용자가 명시적으로 트리거한 신호를 HazardEvent 로 승격
import type { HazardEvent } from "@safetymonitor/schemas";

export interface SosInput {
  workerId: string;
  ts: string;
  message?: string;
}

export function buildSosEvent({
  workerId,
  ts,
  message,
}: SosInput): HazardEvent {
  return {
    eventId: `sos-${workerId}-${ts}`,
    workerId,
    type: "manual_sos",
    severity: "danger",
    ts,
    detail: {
      message: message ?? "작업자 수동 SOS 호출",
    },
  };
}
