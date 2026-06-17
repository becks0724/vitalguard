// AED(자동심장충격기) 장비 레지스트리 — NFC 점검 시스템 공유(대시보드 표시 + 점검 페이지 + API 검증).
// 단말 배터리(devBatt)는 실시간 샘플. AED 본체 배터리·전극패드는 실측 불가 → 교환 주기로만 관리.
// seedHistory = NFC 도입 전 기록(상대 경과일). 이후 점검·교체는 DB(aed_inspections, NFC 태깅으로 기록).

export type AedItem = "battery" | "pad";
export type AedSeedRecord = { daysAgo: number; items: AedItem[]; by: string };

export type AedDevice = {
  id: string; // NFC 태그 URL 식별자(점검 페이지 ?id=)
  loc: string; // 설치 위치
  manager: string; // 대표 관리책임자(여러 명이 점검 — 실제 점검자는 NFC 태깅 시 입력)
  devBatt: number; // 알림 단말 배터리 %(실시간 — "배터리 부족"은 이것만)
  battCycleMonths: number; // AED 본체 배터리 권장 교환 주기(개월)
  padCycleMonths: number; // 전극패드 권장 교환 주기(개월)
  seedHistory: AedSeedRecord[]; // NFC 도입 전 교체·점검 기록
};

export const AED_DEVICES: AedDevice[] = [
  { id: "AED-01", loc: "본관 1층 로비", manager: "김안전", devBatt: 92, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 120, items: ["battery", "pad"], by: "김안전" }] },
  { id: "AED-02", loc: "현장 사무동", manager: "박보건", devBatt: 78, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 300, items: ["battery", "pad"], by: "박보건" }] },
  { id: "AED-03", loc: "지하 주차장 B1", manager: "이현장", devBatt: 18, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 700, items: ["pad"], by: "이현장" }, { daysAgo: 1410, items: ["battery", "pad"], by: "이현장" }] },
  { id: "AED-04", loc: "식당동 입구", manager: "최관리", devBatt: 62, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 200, items: ["battery"], by: "최관리" }, { daysAgo: 710, items: ["battery", "pad"], by: "최관리" }] },
  { id: "AED-05", loc: "자재 창고", manager: "정보건", devBatt: 88, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 200, items: ["pad"], by: "정보건" }, { daysAgo: 1400, items: ["battery", "pad"], by: "정보건" }] },
  { id: "AED-06", loc: "타워크레인 베이스", manager: "강현장", devBatt: 81, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 150, items: ["battery", "pad"], by: "강현장" }] },
  { id: "AED-07", loc: "안전교육장", manager: "윤보건", devBatt: 45, battCycleMonths: 48, padCycleMonths: 24,
    seedHistory: [{ daysAgo: 250, items: ["battery", "pad"], by: "윤보건" }] },
];

export function findAedDevice(id: string): AedDevice | undefined {
  return AED_DEVICES.find((d) => d.id === id);
}

// 저장된 items(JSON 문자열/배열) → AedItem[] 정규화.
export function normalizeAedItems(raw: unknown): AedItem[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is AedItem => x === "battery" || x === "pad");
}
