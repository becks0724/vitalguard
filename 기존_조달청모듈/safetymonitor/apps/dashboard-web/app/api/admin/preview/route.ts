// 관리자 — CSV 다운로드 전 위험도 미리보기 (최근 N건, 이상 row 강조용)
// 전체 로드 금지: 최근 N건은 LIMIT 푸시다운, 전체/위험/주의 건수는 SQL 집계(임계 파라미터 바인딩).
// 과거 전체 기간 313k 행 로드가 Node 힙 OOM → 컨테이너 사망(503)을 유발했던 경로.
import { NextResponse } from "next/server";

import { hasAdminMenuAccess } from "../../../../lib/admin-auth";
import {
  countSamplesBySeverity,
  previewRecentSamples,
  type ExportRow,
} from "../../../../lib/db";
import {
  SEVERITY_SQL_PARAMS,
  skinTempStatus,
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
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const workerId = url.searchParams.get("workerId") || undefined;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  // countOnly=1 — 기간 일치 건수 배지용(행 조회 생략, 집계만)
  const countOnly = url.searchParams.get("countOnly") === "1";

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

  const range = { workerId, from, to };
  const [counts, recent] = await Promise.all([
    countSamplesBySeverity(range, SEVERITY_SQL_PARAMS),
    countOnly
      ? Promise.resolve([] as ExportRow[])
      : previewRecentSamples({ ...range, limit: PREVIEW_LIMIT }),
  ]);

  // 개별 행 상태 라벨링은 기존과 동일하게 TS 판정 함수 사용(50건 한정이라 비용 무시 가능)
  const rows: PreviewRow[] = recent.map((row) => ({
    ...row,
    hr_status: heartRateStatus(row.heart_rate),
    spo2_status: spo2Status(row.spo2),
    temp_status: skinTempStatus(row.skin_temp_c),
    overall_status: overallStatus(row),
  }));

  return NextResponse.json({
    ok: true,
    totalMatched: counts.total,
    shown: rows.length,
    dangerCount: counts.danger,
    cautionCount: counts.caution,
    rows,
  } satisfies PreviewResponse);
}
