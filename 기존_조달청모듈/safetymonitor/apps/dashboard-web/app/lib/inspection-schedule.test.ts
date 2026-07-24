// 설비 점검 예정 마커 단위 테스트 — dueDays→예정일·심각도·범위 필터·worst.
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildInspectionMarkers, kstDateKey, markersInRange, worstMarkerSev } from "./inspection-schedule";
import type { InspectionDevice } from "./inspection-schedule";
import type { AedStatusInput } from "../../lib/aed-status";

// 2026-07-24 00:00 KST = 2026-07-23T15:00:00Z
const T = Date.UTC(2026, 6, 23, 15, 0, 0);

// 배터리·패드 교체일을 각각 지정(항목별 분리 이력).
function input(
  battMonths: number,
  padMonths: number,
  battDaysAgo: number,
  padDaysAgo: number,
): AedStatusInput {
  return {
    devBatt: 90,
    battCycleMonths: battMonths,
    padCycleMonths: padMonths,
    history: [
      { daysAgo: battDaysAgo, items: ["battery"] },
      { daysAgo: padDaysAgo, items: ["pad"] },
    ],
  };
}

test("kstDateKey — UTC 15:00 = 다음날 KST 00:00", () => {
  assert.equal(kstDateKey(T), "2026-07-24");
  assert.equal(kstDateKey(T + 86400000), "2026-07-25");
});

test("배터리·패드 예정일 = 오늘 + (주기×30 − 경과일)", () => {
  // 배터리 48개월=1440일, 경과 1400일 → 잔여 40일(임박). 패드 24개월=720일, 경과 700일 → 잔여 20일(임박).
  const devs: InspectionDevice[] = [{ deviceId: "AED-X", loc: "1층", input: input(48, 24, 1400, 700) }];
  const m = buildInspectionMarkers(devs, T);
  const batt = m.find((x) => x.item === "battery")!;
  const pad = m.find((x) => x.item === "pad")!;
  assert.equal(batt.dueDays, 40);
  assert.equal(batt.dueDateKey, kstDateKey(T + 40 * 86400000));
  assert.equal(batt.severity, "caution"); // ≤90 임박
  assert.equal(pad.dueDays, 20);
  assert.equal(pad.severity, "caution");
});

test("경과(danger)·먼 미래(normal) 심각도", () => {
  const overdue: InspectionDevice[] = [{ deviceId: "AED-O", loc: "지하", input: input(48, 24, 1500, 800) }];
  const mo = buildInspectionMarkers(overdue, T);
  assert.equal(mo.find((x) => x.item === "battery")!.severity, "danger"); // 1440-1500<0
  const fresh: InspectionDevice[] = [{ deviceId: "AED-N", loc: "신규", input: input(48, 24, 0, 0) }];
  const mn = buildInspectionMarkers(fresh, T);
  assert.equal(mn.find((x) => x.item === "battery")!.severity, "normal"); // 잔여 1440일
});

test("markersInRange — 윈도 필터", () => {
  const devs: InspectionDevice[] = [{ deviceId: "AED-X", loc: "1층", input: input(48, 24, 1400, 700) }];
  const m = buildInspectionMarkers(devs, T); // batt 2026-09-02(D+40), pad 2026-08-13(D+20)
  assert.equal(markersInRange(m, "2026-08-01", "2026-08-31").length, 1); // pad만
  assert.equal(markersInRange(m, "2026-07-01", "2026-12-31").length, 2);
  assert.equal(markersInRange(m, "2026-01-01", "2026-01-31").length, 0);
});

test("worstMarkerSev", () => {
  assert.equal(worstMarkerSev([]), null);
  assert.equal(
    worstMarkerSev([
      { deviceId: "a", loc: "", item: "battery", dueDateKey: "2026-08-01", dueDays: 10, severity: "caution" },
      { deviceId: "b", loc: "", item: "pad", dueDateKey: "2026-08-01", dueDays: -5, severity: "danger" },
    ]),
    "danger",
  );
});
