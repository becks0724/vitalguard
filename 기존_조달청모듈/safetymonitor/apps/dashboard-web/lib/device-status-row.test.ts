// 기기 상태 행의 SQL 동등 판별·표시 묶기 테스트 — 2026-09-29 미착용 배터리 실측 고정.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { VitalSample } from "@safetymonitor/schemas";

import {
  WATCH_BATTERY_LOW_PCT,
  batteryStatusLabel,
  buildRecentTableItems,
  deviceRowKind,
  isWatchBatteryLow,
  recentTableCounts,
} from "./device-status-row";

function vital(overrides: Partial<VitalSample>): VitalSample {
  return { workerId: "EMP-admin3470", ts: "2026-09-29T10:38:37.930Z", ...overrides };
}

test("오늘 사례 — 미착용 배터리 9행은 한 줄, 착용 표식 2행은 각각 남긴다", () => {
  const pcts = [87, 77, 67, 57, 45, 32, 22, 14, 6];
  const newest = Date.parse("2026-09-29T10:38:37.930Z");
  const recent = [
    ...pcts.map((batteryPct, index) =>
      vital({ ts: new Date(newest - index * 10 * 60_000).toISOString(), worn: false, batteryPct, batteryStatus: 2 }),
    ),
    vital({ ts: "2026-09-29T09:16:32.814Z", worn: false }),
    vital({ ts: "2026-09-29T09:16:31.591Z", worn: true }),
  ];
  const items = buildRecentTableItems(recent);
  assert.equal(items.length, 3);
  const [battery, ...markers] = items;
  if (!battery || battery.kind !== "battery") {
    assert.fail("첫 항목은 미착용 배터리 묶음이어야 한다");
  } else {
    assert.deepEqual(
      { count: battery.count, pctFrom: battery.pctFrom, pctTo: battery.pctTo, status: battery.status, low: battery.low },
      { count: 9, pctFrom: 6, pctTo: 87, status: 2, low: false },
    );
  }
  assert.deepEqual(markers.map((item) => item.kind), ["worn", "worn"]);
  assert.equal(recentTableCounts(recent).device, 11);
});

test("생체 행은 표식이 아니다", () => {
  const sample = vital({ worn: true, heartRate: 82 });
  assert.equal(deviceRowKind(sample), null);
  assert.equal(buildRecentTableItems([sample]).at(0)?.kind, "sample");
});

test("착용 중 HRV·배터리만 온 측정 행은 착용 표식이 아니다(09-29 실측 452행)", () => {
  // 실측 키 모양 — worn:true + batteryPct·batteryChargeUah·batteryStatus + hrvSdnnMs(표에 HRV 칸이 없어 「--」로 보인다)
  const hrvRow = vital({ worn: true, batteryPct: 64, batteryChargeUah: 180_000, batteryStatus: 3, hrvSdnnMs: 41.2 });
  assert.equal(deviceRowKind(hrvRow), null);
  assert.equal(buildRecentTableItems([hrvRow]).at(0)?.kind, "sample");
  // 착용 중 배터리만 온 행도 표식이 아니다(미착용 배터리는 worn:false 일 때만)
  assert.equal(deviceRowKind(vital({ worn: true, batteryPct: 64 })), null);
  // 움직임·위치만 온 행도 표식이 아니다
  assert.equal(deviceRowKind(vital({ worn: true, motionStillSec: 12, latitude: 35.15, longitude: 126.91 })), null);
  // 통제 — 식별 정보(이름·출처)만 있는 순수 표식은 그대로 표식이다
  assert.equal(
    deviceRowKind(vital({ worn: false, workerName: "김태곤", source: "VitAlGuard-GalaxyWatch", dataOrigin: "wearos_data_vitalguard" })),
    "worn_marker",
  );
});

test("충격 판정이 기기 상태보다 우선한다", () => {
  const sample = vital({ worn: false, batteryPct: 10, fallCandidate: true });
  assert.equal(deviceRowKind(sample), null);
  assert.deepEqual(recentTableCounts([sample]), { vital: 0, device: 0, impact: 1 });
  assert.equal(buildRecentTableItems([sample]).at(0)?.kind, "sample");
});

test("다른 작업자의 행이 끼어도 같은 작업자의 미착용 배터리는 묶인다", () => {
  const items = buildRecentTableItems([
    vital({ ts: "2026-09-29T10:30:00.000Z", worn: false, batteryPct: 80 }),
    vital({ workerId: "EMP-other", ts: "2026-09-29T10:25:00.000Z", heartRate: 75 }),
    vital({ ts: "2026-09-29T10:20:00.000Z", worn: false, batteryPct: 70 }),
  ]);
  assert.equal(items.filter((item) => item.kind === "battery").length, 1);
});

test("같은 작업자의 다른 행 또는 30분 초과 간격은 미착용 배터리 묶음을 끊는다", () => {
  const interrupted = buildRecentTableItems([
    vital({ ts: "2026-09-29T10:30:00.000Z", worn: false, batteryPct: 80 }),
    vital({ ts: "2026-09-29T10:25:00.000Z", heartRate: 75 }),
    vital({ ts: "2026-09-29T10:20:00.000Z", worn: false, batteryPct: 70 }),
  ]);
  const gapped = buildRecentTableItems([
    vital({ ts: "2026-09-29T10:31:00.000Z", worn: false, batteryPct: 80 }),
    vital({ ts: "2026-09-29T10:00:00.000Z", worn: false, batteryPct: 70 }),
  ]);
  assert.equal(interrupted.filter((item) => item.kind === "battery").length, 2);
  assert.equal(gapped.filter((item) => item.kind === "battery").length, 2);
});

test("배터리 부족은 충전 안 함 상태의 20% 이하에서만 강조한다", () => {
  assert.equal(WATCH_BATTERY_LOW_PCT, 20);
  assert.equal(isWatchBatteryLow(3, 20), true);
  assert.equal(isWatchBatteryLow(3, 21), false);
  assert.equal(isWatchBatteryLow(2, 6), false);
  assert.equal(isWatchBatteryLow(undefined, 10), false);
});

test("충전 상태 원시값 문구를 빠짐없이 보인다", () => {
  assert.deepEqual([1, 2, 3, 4, 5, undefined].map(batteryStatusLabel), [
    "충전 상태 모름",
    "충전 중",
    "충전 안 함",
    "충전기 연결 · 충전 멈춤",
    "충전 완료",
    "충전 상태 모름",
  ]);
});

test("원본 recent 행 수는 생체·기기 상태·충격 판정 합계로 보존된다", () => {
  const recent = [
    vital({ heartRate: 75 }),
    vital({ worn: true }),
    vital({ worn: false, batteryPct: 50 }),
    vital({ fallDetected: true, worn: false, batteryPct: 10 }),
  ];
  const counts = recentTableCounts(recent);
  assert.equal(counts.vital + counts.device + counts.impact, recent.length);
});
