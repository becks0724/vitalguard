// 작업자별 누적 생체 시계열 조회 — 24시간/1주일/30일/60일/1년(월별)
// 심박·심부체온 추정(coreTempEst)은 DB 실데이터 경로(real.ts), SpO₂·낙상은 아직 모의 경로(이월).
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import {
  buildHistory,
  buildHistoryBetween,
  summarize,
  summarizeCount,
  type HistoryMetric,
  type HistoryRange,
} from "./data";
import { buildRealHistory, CORE_TEMP_EST_MAX_DAYS, type RealMetric } from "./real";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED_METRICS: HistoryMetric[] = ["heartRate", "spo2", "coreTempEst", "activity", "fall"];
const ALLOWED_RANGES: HistoryRange[] = [1, 7, 30, 60, 365];
const REAL_METRICS: RealMetric[] = ["heartRate", "coreTempEst", "spo2", "activity"];

// KST 달력일 경계 → epoch ms. 프리셋(days)은 "지금부터 N일 전".
const kstDayStartMs = (day: string) => Date.parse(`${day}T00:00:00+09:00`);

export async function GET(request: Request) {
  // 생체 시계열은 로그인 세션에만 — 2026-08-12 실데이터화로 이 라우트가 실측 심박·활동을 내주게
  // 됐는데 게이트가 없어 사번만 알면 무인증 조회가 가능했다(2026-08-13 발견·수리). vital GET 과
  // 같은 게이트(verifyBasicAuth)·같은 이유("관제 생체 스트림은 URL 을 아는 누구에게도 공개하지 않는다").
  if (!verifyBasicAuth(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const workerId = searchParams.get("workerId");
  const metric = searchParams.get("metric") as HistoryMetric | null;
  // days 미제공이면 7일 기본값. 제공됐는데 ALLOWED_RANGES 밖이면(workerId/metric 과 동일 엄격도) 400 거부.
  const daysParam = searchParams.get("days");
  const rangeRaw = Number(daysParam);
  const range = (ALLOWED_RANGES as number[]).includes(rangeRaw)
    ? (rangeRaw as HistoryRange)
    : 7;

  if (!workerId || !metric || !ALLOWED_METRICS.includes(metric)) {
    return NextResponse.json(
      { ok: false, error: "workerId / metric (heartRate|spo2|coreTempEst|fall) 필수" },
      { status: 400 },
    );
  }
  const isReal = (REAL_METRICS as HistoryMetric[]).includes(metric);

  // 사용자 지정 기간(from/to, YYYY-MM-DD) — 둘 다 있으면 프리셋(days) 대신 구간 조회.
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from !== null || to !== null) {
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return NextResponse.json(
        { ok: false, error: "from / to 는 YYYY-MM-DD 형식이며 from ≤ to 여야 합니다." },
        { status: 400 },
      );
    }
    const fromMs = kstDayStartMs(from);
    const toMs = kstDayStartMs(to) + 86_400_000; // 종료일 포함
    if (metric === "coreTempEst" && toMs - fromMs > CORE_TEMP_EST_MAX_DAYS * 86_400_000) {
      return NextResponse.json(
        { ok: false, error: `심부체온 추정 추세는 최대 ${CORE_TEMP_EST_MAX_DAYS}일 구간까지 제공합니다.` },
        { status: 400 },
      );
    }
    const points = isReal
      ? await buildRealHistory(workerId, metric as RealMetric, fromMs, toMs)
      : buildHistoryBetween(workerId, metric, from, to);
    return NextResponse.json({
      workerId,
      metric,
      range: 0,
      from,
      to,
      windowFromMs: isReal ? fromMs : undefined,
      windowToMs: isReal ? toMs : undefined,
      points,
      summary: metric === "fall" ? summarizeCount(points) : summarize(points),
      source: isReal ? (metric === "coreTempEst" ? "estimated" : "measured") : "mock",
    });
  }

  if (daysParam !== null && !(ALLOWED_RANGES as number[]).includes(rangeRaw)) {
    return NextResponse.json(
      { ok: false, error: "days 는 1|7|30|60|365 중 하나여야 합니다." },
      { status: 400 },
    );
  }
  if (metric === "coreTempEst" && range > CORE_TEMP_EST_MAX_DAYS) {
    return NextResponse.json(
      { ok: false, error: `심부체온 추정 추세는 24시간·1주일 범위에서만 제공합니다.` },
      { status: 400 },
    );
  }

  const presetToMs = Date.now();
  const presetFromMs = presetToMs - range * 86_400_000;
  const points = isReal
    ? await buildRealHistory(workerId, metric as RealMetric, presetFromMs, presetToMs)
    : buildHistory(workerId, metric, range);
  return NextResponse.json({
    workerId,
    metric,
    range,
    windowFromMs: isReal ? presetFromMs : undefined,
    windowToMs: isReal ? presetToMs : undefined,
    points,
    summary: metric === "fall" ? summarizeCount(points) : summarize(points),
    source: isReal ? (metric === "coreTempEst" ? "estimated" : "measured") : "mock",
  });
}
