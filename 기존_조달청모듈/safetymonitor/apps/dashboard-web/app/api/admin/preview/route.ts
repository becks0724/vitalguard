// 관리자 — CSV 다운로드 전 위험도 미리보기 (최근 N건, 이상 row 강조용)
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import { exportSamples, type ExportRow } from "../../../../lib/db";
import {
  coreTempStatus,
  heartRateStatus,
  overallStatus,
  spo2Status,
  type Status,
} from "../../../../lib/severity";

export type PreviewRow = ExportRow & {
  hr_status: Status;
  spo2_status: Status;
  temp_status: Status;
  overall_status: Status;
};

export type PreviewResponse = {
  ok: true;
  totalMatched: number;
  shown: number;
  dangerCount: number;
  cautionCount: number;
  rows: PreviewRow[];
};

const PREVIEW_LIMIT = 50;

export async function GET(request: Request) {
  if (!verifyBasicAuth(request)) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get("workerId") || undefined;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");

  const now = new Date();
  const defaultTo = now.toISOString();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const from = fromRaw || defaultFrom;
  const to = toRaw || defaultTo;

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json(
      { ok: false, error: "from / to 는 ISO 8601 형식이어야 합니다." },
      { status: 400 },
    );
  }

  const all = await exportSamples({ workerId, from, to });
  // 미리보기 — 가장 최근 N건 우선 표시 (역순). 다운로드는 항상 전체 + 시간 오름차순
  const recentSlice = all.slice(-PREVIEW_LIMIT).reverse();

  const rows: PreviewRow[] = recentSlice.map((row) => {
    const overall = overallStatus(row);
    return {
      ...row,
      hr_status: heartRateStatus(row.heart_rate),
      spo2_status: spo2Status(row.spo2),
      temp_status: coreTempStatus(row.skin_temp_c),
      overall_status: overall,
    };
  });

  // 전체 danger/caution 카운트도 계산해서 미리 보여줌 (요약 배지용)
  let totalDanger = 0;
  let totalCaution = 0;
  for (const row of all) {
    const o = overallStatus(row);
    if (o === "danger") totalDanger += 1;
    else if (o === "caution") totalCaution += 1;
  }

  return NextResponse.json({
    ok: true,
    totalMatched: all.length,
    shown: rows.length,
    dangerCount: totalDanger,
    cautionCount: totalCaution,
    rows,
  } satisfies Omit<PreviewResponse, "dangerCount" | "cautionCount"> & {
    dangerCount: number;
    cautionCount: number;
  });
}
