// AED 장비 상태(심각도) 순수 계산 — 대시보드 표·통합 신호등·물리 알림(라즈베리파이) 엔드포인트가 공유(임계 단일 소스, I/O 없음).
import type { AedItem } from "./aed-devices";

export type AedSev = "normal" | "caution" | "danger";

// ── AED 관리 임계·교환 주기 ───────────────────────────────────────
// 단말(알림 장비) 배터리 — 유일하게 실시간 측정 가능.
export const AED_DEV_BATT_DANGER = 20; // 단말 배터리 부족
export const AED_DEV_BATT_CAUTION = 50; // 단말 배터리 주의
// AED 본체 배터리·전극패드 — 실시간 상태 측정 불가 → 교환 주기로만 관리.
export const AED_SWAP_DUE_SOON_DAYS = 90; // 교환 임박(주의) — 잔여 90일 이내

// 심각도 계산 입력 — 레지스트리 필드 + 병합 이력(DB 점검 + seed). 표시 필드(loc 등)는 불필요.
export type AedHistoryEntry = { daysAgo: number; items: AedItem[] };
export type AedStatusInput = {
  devBatt: number;
  battCycleMonths: number;
  padCycleMonths: number;
  history: AedHistoryEntry[];
};

const SEV_RANK: Record<AedSev, number> = { normal: 0, caution: 1, danger: 2 };
export function worstAedSev(sevs: AedSev[]): AedSev {
  return sevs.reduce<AedSev>((acc, s) => (SEV_RANK[s] > SEV_RANK[acc] ? s : acc), "normal");
}

// 교환 경과일 — history 에서 해당 항목의 가장 최근 교체일을 파생. 기록 없으면 신규 설치로 간주(오탐 방지).
export function recentSwapDaysAgo(r: AedStatusInput, item: AedItem): number {
  const recs = r.history.filter((h) => h.items.includes(item)).map((h) => h.daysAgo);
  return recs.length ? Math.min(...recs) : 0;
}
export function battDaysSince(r: AedStatusInput): number {
  return recentSwapDaysAgo(r, "battery");
}
export function padDaysSince(r: AedStatusInput): number {
  return recentSwapDaysAgo(r, "pad");
}
// 교환까지 잔여일(음수 = 권장 주기 경과).
export function battDueDays(r: AedStatusInput): number {
  return r.battCycleMonths * 30 - battDaysSince(r);
}
export function padDueDays(r: AedStatusInput): number {
  return r.padCycleMonths * 30 - padDaysSince(r);
}

export function aedDevBattSev(b: number): AedSev {
  return b <= AED_DEV_BATT_DANGER ? "danger" : b <= AED_DEV_BATT_CAUTION ? "caution" : "normal";
}
export function aedCycleSev(dueDays: number): AedSev {
  return dueDays < 0 ? "danger" : dueDays <= AED_SWAP_DUE_SOON_DAYS ? "caution" : "normal";
}

// 종합 심각도 = worst-of(단말 배터리 · 본체 배터리 교환주기 · 패드 교환주기). 대시보드 aedStatus 와 동일 기준.
export function aedRowSev(r: AedStatusInput): AedSev {
  return worstAedSev([
    aedDevBattSev(r.devBatt),
    aedCycleSev(battDueDays(r)),
    aedCycleSev(padDueDays(r)),
  ]);
}

// 물리 알림 레벨 — 정상=CLEAR(전부 OFF) · 주의=WARNING(노랑 깜빡) · 위험=DANGER(빨강 깜빡+부저). 라즈베리파이 장치 신호 3단계와 일치.
export type AlarmLevel = "CLEAR" | "WARNING" | "DANGER";
export function alarmLevelOf(sev: AedSev): AlarmLevel {
  return sev === "danger" ? "DANGER" : sev === "caution" ? "WARNING" : "CLEAR";
}
