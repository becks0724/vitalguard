// 설비 점검 자동 일정 — AED 교환주기(배터리·패드) 예정일 마커. 캘린더가 조회해 자동 표출(수동 등록 없음).
// 대상 조합 = 등록 실장비(aed_registered_device) + 프리셋(AED_DEVICES) + NFC 점검(aed_inspections) + config loc 오버라이드.
// 이 조합은 /api/aed/alarm 과 동일 기준(임계 단일 소스 lib/aed-status). NFC 점검이 최근 교체로 반영되면 예정일 자동 이동.
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../lib/admin-auth";
import { AED_DEVICES, normalizeAedItems } from "../../../lib/aed-devices";
import { bearerToken, verifyAppJwt } from "../../../lib/app-jwt";
import { buildAedStatusInput, type AedHistoryEntry } from "../../../lib/aed-status";
import {
  getAedConfigs,
  listAedInspections,
  listRegisteredAedDevices,
  type AedConfigOverride,
  type AedInspectionRow,
  type RegisteredAedDevice,
} from "../../../lib/db";
import {
  buildInspectionMarkers,
  markersInRange,
  type InspectionDevice,
} from "../../lib/inspection-schedule";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function tsToDaysAgo(ts: string): number {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// 특정 aed_id 의 NFC 점검 이력 → extraHistory(최근 교체 반영).
function extraHistoryOf(aedId: string, inspections: AedInspectionRow[]): AedHistoryEntry[] {
  return inspections
    .filter((i) => i.aed_id === aedId)
    .map((i) => ({ daysAgo: tsToDaysAgo(i.ts), items: normalizeAedItems(i.items) }));
}

export async function GET(request: Request) {
  // 조회 = 대시보드 세션 또는 앱 로그인 JWT (캘린더 events/labels GET 과 동일 게이트, 읽기 전용).
  if (!verifyBasicAuth(request) && verifyAppJwt(bearerToken(request)) === null) {
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ ok: false, error: "from/to (YYYY-MM-DD) 필요" }, { status: 400 });
  }

  // DB 장애에도 캘린더 본기능 유지 — 조회 실패 시 seed/프리셋 기본값으로 graceful.
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
  let registered: RegisteredAedDevice[] = [];
  try {
    registered = await listRegisteredAedDevices();
  } catch {
    registered = [];
  }

  const locOf = (id: string, fallback: string) => configs[id]?.loc || fallback;

  // 등록 실장비 + 프리셋 → 점검 대상(심각도 계산 입력). 등록 실장비와 id 겹치는 프리셋은 제외(중복 방지).
  const registeredIds = new Set(registered.map((d) => d.aedId));
  const devices: InspectionDevice[] = [
    ...registered.map<InspectionDevice>((d) => ({
      deviceId: d.aedId,
      loc: locOf(d.aedId, d.loc),
      input: buildAedStatusInput({
        devBatt: d.devBatt,
        battCycleMonths: d.battCycleMonths,
        padCycleMonths: d.padCycleMonths,
        lastSwapDaysAgo: tsToDaysAgo(d.lastSwapTs ?? d.registeredAt),
        extraHistory: extraHistoryOf(d.aedId, inspections),
      }),
    })),
    ...AED_DEVICES.filter((d) => !registeredIds.has(d.id)).map<InspectionDevice>((d) => ({
      deviceId: d.id,
      loc: locOf(d.id, d.loc),
      input: {
        devBatt: d.devBatt,
        battCycleMonths: d.battCycleMonths,
        padCycleMonths: d.padCycleMonths,
        history: [
          ...extraHistoryOf(d.id, inspections),
          ...d.seedHistory.map((s) => ({ daysAgo: s.daysAgo, items: s.items })),
        ],
      },
    })),
  ];

  const markers = markersInRange(buildInspectionMarkers(devices, Date.now()), from, to);
  return NextResponse.json({ ok: true, markers });
}
