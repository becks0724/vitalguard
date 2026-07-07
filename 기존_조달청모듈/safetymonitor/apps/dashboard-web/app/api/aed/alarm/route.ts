// AED 알림 물리 장치(라즈베리파이) 폴링 엔드포인트 — AED 장비 상태 심각도를 CLEAR/WARNING/DANGER 레벨로 반환.
// 장치가 주기 폴링(예: 8초)해 LED/부저를 구동. 심각도는 대시보드 표·통합 신호등과 동일 기준(lib/aed-status, 임계 단일 소스).
import { NextResponse } from "next/server";

import { AED_DEVICES, findAedDevice, normalizeAedItems, type AedDevice } from "../../../../lib/aed-devices";
import {
  aedRowSev,
  alarmLevelOf,
  buildAedStatusInput,
  worstAedSev,
  type AedHistoryEntry,
  type AedSev,
} from "../../../../lib/aed-status";
import {
  getAedConfigs,
  listAedInspections,
  listRegisteredAedDevices,
  type AedConfigOverride,
  type AedInspectionRow,
  type RegisteredAedDevice,
} from "../../../../lib/db";

function tsToDaysAgo(ts: string): number {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// 레지스트리 + DB 점검이력 → 심각도 계산 입력(history = DB NFC 점검 + seed).
function historyOf(d: AedDevice, inspections: AedInspectionRow[]): AedHistoryEntry[] {
  const scanned: AedHistoryEntry[] = inspections
    .filter((i) => i.aed_id === d.id)
    .map((i) => ({ daysAgo: tsToDaysAgo(i.ts), items: normalizeAedItems(i.items) }));
  const seed: AedHistoryEntry[] = d.seedHistory.map((s) => ({ daysAgo: s.daysAgo, items: s.items }));
  return [...scanned, ...seed];
}

function sevOf(d: AedDevice, inspections: AedInspectionRow[]): AedSev {
  return aedRowSev({
    devBatt: d.devBatt,
    battCycleMonths: d.battCycleMonths,
    padCycleMonths: d.padCycleMonths,
    history: historyOf(d, inspections),
  });
}

// 등록 실 장비 심각도 — 최근 교환일(없으면 등록일) 기준 + NFC 점검 이력 병합(데모와 동일 임계 단일 소스).
function registeredSevOf(d: RegisteredAedDevice, inspections: AedInspectionRow[]): AedSev {
  const extra: AedHistoryEntry[] = inspections
    .filter((i) => i.aed_id === d.aedId)
    .map((i) => ({ daysAgo: tsToDaysAgo(i.ts), items: normalizeAedItems(i.items) }));
  return aedRowSev(
    buildAedStatusInput({
      devBatt: d.devBatt,
      battCycleMonths: d.battCycleMonths,
      padCycleMonths: d.padCycleMonths,
      lastSwapDaysAgo: tsToDaysAgo(d.lastSwapTs ?? d.registeredAt),
      extraHistory: extra,
    }),
  );
}

// GET /api/aed/alarm?deviceId=AED-03 — 해당 AED 알림 레벨. deviceId 없으면 전 구역 worst-of(현장 통합 알림).
// 무인증 폴링(알림 레벨은 비민감 상태값). 비-200 응답 시 장치는 직전 레벨을 유지하도록 클라이언트에서 처리 권장.
export async function GET(request: Request) {
  const deviceId = new URL(request.url).searchParams.get("deviceId")?.trim() ?? "";

  // DB 장애에도 장치가 멈추지 않게 — 점검이력·설정 조회 실패 시 seed·레지스트리 기본값으로 계산(graceful).
  let inspections: AedInspectionRow[] = [];
  try {
    inspections = await listAedInspections();
  } catch {
    inspections = [];
  }
  let configs: Record<string, AedConfigOverride> = {};
  try {
    configs = await getAedConfigs();
  } catch {
    configs = {};
  }
  // 설치위치는 관제웹 오버라이드(있으면) 우선 — 대시보드 표와 동일 표기.
  const locOf = (id: string, fallback: string) => configs[id]?.loc || fallback;

  // 등록된 실 연동 장비(관리자 등록) — RPi가 이 aed_id 로 폴링. 조회 실패해도 데모 프리셋으로 graceful.
  let registered: RegisteredAedDevice[] = [];
  try {
    registered = await listRegisteredAedDevices();
  } catch {
    registered = [];
  }

  const updatedAt = new Date().toISOString();
  const headers = { "cache-control": "no-store" };

  if (deviceId) {
    // 실 등록 장비 우선 조회 → 없으면 데모 프리셋.
    const reg = registered.find((d) => d.aedId === deviceId);
    if (reg) {
      const sev = registeredSevOf(reg, inspections);
      return NextResponse.json(
        { ok: true, deviceId: reg.aedId, loc: reg.loc, sev, level: alarmLevelOf(sev), updatedAt },
        { headers },
      );
    }
    const device = findAedDevice(deviceId);
    if (!device) {
      return NextResponse.json({ ok: false, error: "알 수 없는 AED 장비" }, { status: 404, headers });
    }
    const sev = sevOf(device, inspections);
    return NextResponse.json(
      { ok: true, deviceId: device.id, loc: locOf(device.id, device.loc), sev, level: alarmLevelOf(sev), updatedAt },
      { headers },
    );
  }

  // deviceId 미지정 = 현장 전체 worst-of(단일 장치가 현장 통합 알림을 표시할 때).
  // 실 등록 장비가 있으면 그 장비들만(데모는 실 하드웨어 미연동) · 없으면 데모 프리셋(하위호환).
  const worst =
    registered.length > 0
      ? worstAedSev(registered.map((d) => registeredSevOf(d, inspections)))
      : worstAedSev(AED_DEVICES.map((d) => sevOf(d, inspections)));
  return NextResponse.json(
    { ok: true, deviceId: null, loc: "전 구역", sev: worst, level: alarmLevelOf(worst), updatedAt },
    { headers },
  );
}
