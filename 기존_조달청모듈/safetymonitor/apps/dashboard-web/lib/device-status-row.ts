// 실시간 수집 표의 기기 상태 행(착용 표식·미착용 배터리) 표기 — 표시 전용
import type { VitalSample } from "@safetymonitor/schemas";

import { isImpactSample } from "./impact-row";

// 09-03 사용자 결정 = 충전 구간을 관제에 남긴다. 원칙 셋 —
// ① 행 성격만 가른다: 서버 수신·저장·링·경보·내보내기·배터리 그래프에는 주입하지 않는다.
// ② 없는 값을 안 채운다: 미착용 배터리·착용 표식은 생체 칸(`--` 넷) 대신 한 줄로 보인다.
// ③ 묶음은 표시만: 워치는 벗은 한 번에 10분마다 최대 9행을 보내며, 원래 행 수 집계는 보존한다.
// 09-29 사용자 결정 = 미착용 배터리를 한 줄로 묶고, 충전하지 않는 저배터리만 주의색으로 강조한다.

export const WATCH_BATTERY_LOW_PCT = 20;

// AED 단말의 AED_DEV_BATT_DANGER 는 다른 기기 기준이므로 워치 표기에 가져다 쓰지 않는다.
export const IDLE_BATTERY_GROUP_GAP_MS = 30 * 60_000;

// 착용 표식 = 착용 여부와 식별 정보만 있는 행. ⛔ worn 이 있다고 표식이 아니다 — 평시 표본도 worn:true 를 싣고,
// 09-29 실측 30일 894행 중 452행은 착용 중 HRV(hrvSdnnMs)만 온 측정 행이었다(순수 표식 405 · 움직임·위치 등 37).
// 그 행을 「착용」 칩으로 그리면 측정 사실이 가려진다 → 식별 필드 밖의 값이 하나라도 있으면 표식이 아니다.
const WORN_MARKER_KEYS = new Set([
  "workerId",
  "workerName",
  "employeeId",
  "jobTitle",
  "guardianName",
  "guardianPhone",
  "ts",
  "source",
  "dataOrigin",
  "worn",
]);

function isPureWornMarker(sample: VitalSample): boolean {
  if (typeof sample.worn !== "boolean") return false;
  return Object.entries(sample).every(([key, value]) => value == null || WORN_MARKER_KEYS.has(key));
}

export type DeviceRowKind = "idle_battery" | "worn_marker";

export type RecentTableItem =
  | { kind: "sample"; sample: VitalSample }
  | { kind: "worn"; sample: VitalSample; worn: boolean }
  | {
      kind: "battery";
      workerId: string;
      newest: VitalSample;
      oldest: VitalSample;
      count: number;
      pctFrom: number;
      pctTo: number;
      status: number | undefined;
      low: boolean;
    };

/** SQL 집계와 같은 순서의 행 판별 — 충격·생체 행은 기기 상태로 다시 세지 않는다. */
export function deviceRowKind(sample: VitalSample): DeviceRowKind | null {
  if (isImpactSample(sample)) return null;
  if (
    sample.activeEnergyKcal != null ||
    sample.heartRate != null ||
    sample.spo2 != null ||
    sample.skinTempC != null
  ) {
    return null;
  }
  if (sample.worn === false && sample.batteryPct != null) return "idle_battery";
  if (isPureWornMarker(sample)) return "worn_marker";
  return null;
}

export function batteryStatusLabel(status?: number): string {
  switch (status) {
    case 2:
      return "충전 중";
    case 3:
      return "충전 안 함";
    case 4:
      return "충전기 연결 · 충전 멈춤";
    case 5:
      return "충전 완료";
    default:
      return "충전 상태 모름";
  }
}

/** 상태를 못 읽은 것을 ‘충전 안 함’으로 그리지 않는다(BatteryStatusTest.kt 원칙). */
export function isWatchBatteryLow(status: number | undefined, pct: number): boolean {
  return status === 3 && pct <= WATCH_BATTERY_LOW_PCT;
}

function isWithinIdleBatteryGroupGap(newer: VitalSample, older: VitalSample): boolean {
  const newerMs = Date.parse(newer.ts);
  const olderMs = Date.parse(older.ts);
  if (!Number.isFinite(newerMs) || !Number.isFinite(olderMs)) return false;
  const gap = newerMs - olderMs;
  return gap >= 0 && gap <= IDLE_BATTERY_GROUP_GAP_MS;
}

/** 최신이 앞인 recent 스트림을, 원본 순서와 작업자별 이웃 관계를 보존해 화면 행으로 접는다. */
export function buildRecentTableItems(recent: VitalSample[]): RecentTableItem[] {
  const items: RecentTableItem[] = [];
  const lastByWorker = new Map<
    string,
    { kind: DeviceRowKind | null; sample: VitalSample; battery?: Extract<RecentTableItem, { kind: "battery" }> }
  >();

  for (const sample of recent) {
    const rowKind = deviceRowKind(sample);
    if (rowKind === "idle_battery") {
      const previous = lastByWorker.get(sample.workerId);
      const battery =
        previous?.kind === "idle_battery" &&
        previous.battery != null &&
        isWithinIdleBatteryGroupGap(previous.sample, sample)
          ? previous.battery
          : null;

      if (battery) {
        battery.oldest = sample;
        battery.count += 1;
        battery.pctFrom = sample.batteryPct!;
      } else {
        const newBattery: Extract<RecentTableItem, { kind: "battery" }> = {
          kind: "battery",
          workerId: sample.workerId,
          newest: sample,
          oldest: sample,
          count: 1,
          pctFrom: sample.batteryPct!,
          pctTo: sample.batteryPct!,
          status: sample.batteryStatus,
          low: isWatchBatteryLow(sample.batteryStatus, sample.batteryPct!),
        };
        items.push(newBattery);
        lastByWorker.set(sample.workerId, { kind: rowKind, sample, battery: newBattery });
        continue;
      }
      lastByWorker.set(sample.workerId, { kind: rowKind, sample, battery });
      continue;
    }

    lastByWorker.set(sample.workerId, { kind: rowKind, sample });
    if (rowKind === "worn_marker") {
      // deviceRowKind 의 조건이므로 여기서는 boolean 이 확정된다.
      items.push({ kind: "worn", sample, worn: sample.worn! });
    } else {
      items.push({ kind: "sample", sample });
    }
  }
  return items;
}

/** 화면 헤더는 묶기 전 원본 행 수를 말해 DB recent 수와 항상 합이 맞는다. */
export function recentTableCounts(recent: VitalSample[]): { vital: number; device: number; impact: number } {
  let vital = 0;
  let device = 0;
  let impact = 0;
  for (const sample of recent) {
    if (isImpactSample(sample)) impact += 1;
    else if (deviceRowKind(sample) != null) device += 1;
    else vital += 1;
  }
  return { vital, device, impact };
}
