// 작업자별 누적 생체 시계열 mock 조회 — 24시간/1주일/30일/60일/1년(월별)
import { NextResponse } from "next/server";

import {
  buildHistory,
  buildHistoryBetween,
  summarize,
  summarizeCount,
  type HistoryMetric,
  type HistoryRange,
} from "./data";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED_METRICS: HistoryMetric[] = ["heartRate", "spo2", "skinTempC", "fall"];
const ALLOWED_RANGES: HistoryRange[] = [1, 7, 30, 60, 365];

export async function GET(request: Request) {
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
      { ok: false, error: "workerId / metric (heartRate|spo2|skinTempC|fall) 필수" },
      { status: 400 },
    );
  }

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
    const points = buildHistoryBetween(workerId, metric, from, to);
    return NextResponse.json({
      workerId,
      metric,
      range: 0,
      from,
      to,
      points,
      summary: metric === "fall" ? summarizeCount(points) : summarize(points),
    });
  }

  if (daysParam !== null && !(ALLOWED_RANGES as number[]).includes(rangeRaw)) {
    return NextResponse.json(
      { ok: false, error: "days 는 1|7|30|60|365 중 하나여야 합니다." },
      { status: 400 },
    );
  }

  const points = buildHistory(workerId, metric, range);
  return NextResponse.json({
    workerId,
    metric,
    range,
    points,
    summary: metric === "fall" ? summarizeCount(points) : summarize(points),
  });
}
