// 사고 조사 데이터 API — 사고 시각 전후 창의 생체 시계열 4종 + 이벤트(SOS·낙상) 통합 응답(관리자 전용)
//
// 심부체온 추정은 저장값이 아니라 **조회 시점에 원시 심박으로 재계산**한다(순수 함수·문헌 계수
// 고정이라 같은 입력이면 몇 년 뒤에도 같은 궤적 — docs/incident-review/context-notes.md D-3).
import { NextResponse } from "next/server";
import { estimateCoreTempSeries, type HrPoint } from "@safetymonitor/analyzers";

import { hasAdminMenuAccess } from "../../../../../lib/admin-auth";
import {
  activeEnergyBucketSums,
  alertsBetween,
  heartRateBucketAverages,
  spo2MeasurementsBetween,
} from "../../../../../lib/db";
import {
  incidentWindow,
  isIncidentWindowHours,
  type IncidentWindowHours,
} from "../../../../../lib/incident-report";
import { aliasIdsOf } from "../../../mock/history/real";

const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
// 칼만 워밍업(30분) + 세션 갭 한도(60분) 여유 — 창 시작 시점에 이미 데워진 궤적을 얻는다.
const CORE_TEMP_LOOKBACK_MS = 90 * 60_000;

export async function GET(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const workerId = searchParams.get("workerId") ?? "";
  const at = searchParams.get("at") ?? "";
  const hoursRaw = Number(searchParams.get("hours") ?? 24);

  if (!WORKER_ID_RE.test(workerId)) {
    return NextResponse.json({ ok: false, error: "workerId 형식 오류" }, { status: 400 });
  }
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) {
    return NextResponse.json({ ok: false, error: "at(ISO 시각) 필수" }, { status: 400 });
  }
  if (!isIncidentWindowHours(hoursRaw)) {
    return NextResponse.json(
      { ok: false, error: "hours 는 6·12·24·48 중 하나" },
      { status: 400 },
    );
  }
  const hours = hoursRaw as IncidentWindowHours;
  const { fromMs, toMs } = incidentWindow(atMs, hours);

  try {
    const ids = await aliasIdsOf(workerId);
    // 짧은 창은 1분 해상도(사고 직전·직후 분 단위 재구성), 긴 창은 5분(점 수 억제).
    const hrBucketSec = hours <= 12 ? 60 : 300;

    const [hrRows, hr60Rows, spo2Rows, aeRows, alertRows] = await Promise.all([
      heartRateBucketAverages(ids, fromMs, toMs, hrBucketSec),
      heartRateBucketAverages(ids, fromMs - CORE_TEMP_LOOKBACK_MS, toMs, 60),
      spo2MeasurementsBetween(ids, fromMs, toMs),
      activeEnergyBucketSums(ids, fromMs, toMs, 300),
      alertsBetween(ids, fromMs, toMs),
    ]);

    const hrPoints: HrPoint[] = hr60Rows.map((r) => ({
      tsMs: r.bucket_start_sec * 1000,
      bpm: r.bpm,
    }));
    const coreTempEst = estimateCoreTempSeries(hrPoints)
      .filter((p) => p.tsMs >= fromMs && p.tsMs < toMs)
      .map((p) => ({ tsMs: p.tsMs, value: Math.round(p.tempC * 10) / 10 }));

    return NextResponse.json({
      ok: true,
      workerId,
      at: new Date(atMs).toISOString(),
      hours,
      windowFromMs: fromMs,
      windowToMs: toMs,
      heartRate: hrRows.map((r) => ({
        tsMs: r.bucket_start_sec * 1000,
        value: Math.round(r.bpm),
      })),
      coreTempEst,
      spo2: spo2Rows
        .map((r) => ({
          tsMs: Date.parse(r.spo2_measured_at ?? r.ts),
          value: Math.round(r.spo2),
        }))
        // SQL 은 전송 시각(ts)으로 거르지만 표시는 측정 시각 — 큐 지연 전송분의 측정 시각이
        // 창 밖이면 제외한다(dev 실측에서 발견: 전날 측정이 아침 창에 실려 축 밖 점이 됐다).
        .filter((p) => Number.isFinite(p.tsMs) && p.tsMs >= fromMs && p.tsMs < toMs),
      activeEnergyKcal: aeRows.map((r) => ({
        tsMs: r.bucket_start_sec * 1000,
        value: Math.round(r.kcal * 100) / 100,
      })),
      events: alertRows.map((a) => ({
        ts: a.ts,
        type: a.type,
        ackAt: a.ack_at,
        ackBy: a.ack_by,
      })),
      coreTempNote: "조회 시점 재계산(Buller 2013 문헌 계수·의료 판정 아님)",
    });
  } catch (e) {
    console.error("[incidents] 조사 데이터 조회 실패", e);
    return NextResponse.json({ ok: false, error: "db_error" }, { status: 503 });
  }
}
