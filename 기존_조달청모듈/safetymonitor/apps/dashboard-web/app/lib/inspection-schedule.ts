// 설비 점검 자동 일정 — AED 교환주기(배터리 48·패드 24개월) 잔여일 → 캘린더 예정일 마커. 순수 모듈(I/O 없음).
// D-day·심각도는 lib/aed-status(단일 소스) 재사용. NFC 점검이 최근 교체로 반영되면 예정일이 자동 이동.
import {
  aedCycleSev,
  battDueDays,
  padDueDays,
  type AedSev,
  type AedStatusInput,
} from "../../lib/aed-status";

export type InspectionItem = "battery" | "pad";

export const INSPECTION_ITEM_LABEL: Record<InspectionItem, string> = {
  battery: "AED 배터리 교환",
  pad: "AED 패드 교환",
};

// 캘린더에 얹을 점검 예정 마커 1건.
export type InspectionMarker = {
  deviceId: string;
  loc: string;
  item: InspectionItem;
  dueDateKey: string; // YYYY-MM-DD (KST)
  dueDays: number; // 잔여일(음수 = 권장 주기 경과)
  severity: AedSev; // aedCycleSev: normal/caution(임박 ≤90)/danger(경과)
};

// 점검 대상 장비 1대 — 심각도 계산 입력 + 표시용 식별.
export type InspectionDevice = {
  deviceId: string;
  loc: string;
  input: AedStatusInput;
};

// ms 타임스탬프 → KST(+9h) 기준 YYYY-MM-DD.
export function kstDateKey(ms: number): string {
  const d = new Date(ms + 9 * 3600000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 장비별 배터리·패드 교환 예정일 마커 생성. todayMs 주입(순수·테스트 가능).
export function buildInspectionMarkers(
  devices: InspectionDevice[],
  todayMs: number,
): InspectionMarker[] {
  const markers: InspectionMarker[] = [];
  for (const dev of devices) {
    const items: { item: InspectionItem; dueDays: number }[] = [
      { item: "battery", dueDays: battDueDays(dev.input) },
      { item: "pad", dueDays: padDueDays(dev.input) },
    ];
    for (const { item, dueDays } of items) {
      markers.push({
        deviceId: dev.deviceId,
        loc: dev.loc,
        item,
        dueDateKey: kstDateKey(todayMs + dueDays * 86400000),
        dueDays,
        severity: aedCycleSev(dueDays),
      });
    }
  }
  return markers;
}

// 날짜 범위(YYYY-MM-DD, 포함) 필터 — 캘린더 보이는 달 윈도만.
export function markersInRange(
  markers: InspectionMarker[],
  fromKey: string,
  toKey: string,
): InspectionMarker[] {
  return markers.filter((m) => m.dueDateKey >= fromKey && m.dueDateKey <= toKey);
}

// 하루치 마커의 종합 심각도(worst) — 셀 배지 색.
export function worstMarkerSev(markers: InspectionMarker[]): AedSev | null {
  if (markers.length === 0) return null;
  if (markers.some((m) => m.severity === "danger")) return "danger";
  if (markers.some((m) => m.severity === "caution")) return "caution";
  return "normal";
}
