// 관리자 — 현장정보 + vital_samples 를 기간/워커 필터로 CSV 스트리밍 다운로드
import { NextResponse } from "next/server";

import { verifyBasicAuth } from "../../../../lib/admin-auth";
import {
  exportSamples,
  exportSiteInfoLogs,
  getWorkerProfiles,
  type ExportRow,
  type SiteInfoRow,
} from "../../../../lib/db";
import {
  STATUS_LABEL,
  coreTempStatus,
  heartRateStatus,
  overallStatus,
  spo2Status,
} from "../../../../lib/severity";

// DB 컬럼 + 위험도 4 컬럼 (산업재해 자료 제출 시 이상치 표시용).
// status_* 는 한글 라벨 (정상/주의/위험/대기) — Excel conditional formatting 으로 색 적용 가능.
const CSV_HEADER = [
  "id",
  "received_at",
  "worker_id",
  "worker_name",
  "employee_id",
  "job_title",
  "guardian_name",
  "guardian_phone",
  "ts",
  "heart_rate",
  "spo2",
  "skin_temp_c",
  "ambient_temp_c",
  "battery_pct",
  "manual_sos",
  "fall_detected",
  "latitude",
  "longitude",
  "hr_status",
  "spo2_status",
  "temp_status",
  "overall_status",
] as const;

const SITE_INFO_HEADER = [
  "snapshot_date",
  "recorded_at",
  "company_name",
  "site_name",
  "construction_type",
  "address",
  "start_date",
  "completion_date",
] as const;

// RFC 4180 — 쉼표/줄바꿈/큰따옴표 포함 시 " 로 감싸고 내부 " 는 "" 로 escape
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// 직급은 관제 웹 오버라이드(worker_profile)가 폰 발신값(job_title)보다 우선 — 효과값으로 export.
function withStatuses(row: ExportRow, profiles: Record<string, string>) {
  return {
    ...row,
    job_title: profiles[row.worker_id] ?? row.job_title,
    hr_status: STATUS_LABEL[heartRateStatus(row.heart_rate)],
    spo2_status: STATUS_LABEL[spo2Status(row.spo2)],
    temp_status: STATUS_LABEL[coreTempStatus(row.skin_temp_c)],
    overall_status: STATUS_LABEL[overallStatus(row)],
  };
}

function toCsv(
  rows: ExportRow[],
  siteInfoRows: SiteInfoRow[],
  profiles: Record<string, string>,
): string {
  const lines: string[] = [
    "현장정보(관리자 저장 기준 일 1회 snapshot)",
    SITE_INFO_HEADER.join(","),
  ];
  for (const row of siteInfoRows) {
    lines.push(
      SITE_INFO_HEADER.map((col) => csvCell((row as Record<string, unknown>)[col])).join(","),
    );
  }

  lines.push("", "생체데이터", CSV_HEADER.join(","));
  for (const row of rows) {
    const enriched = withStatuses(row, profiles);
    lines.push(
      CSV_HEADER.map((col) => csvCell((enriched as Record<string, unknown>)[col])).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function filenameFor(workerId: string | undefined, from: string, to: string) {
  const safeFrom = from.slice(0, 10);
  const safeTo = to.slice(0, 10);
  const wid = workerId ? workerId.replace(/[^a-zA-Z0-9_-]/g, "_") : "all";
  return `vital-${wid}-${safeFrom}_${safeTo}.csv`;
}

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

  // 기본 기간 — 최근 30일 (산업재해 자료 일반 제출 단위)
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

  const rows = await exportSamples({ workerId, from, to });
  const siteInfoRows = await exportSiteInfoLogs({ from, to });
  const csv = toCsv(rows, siteInfoRows, await getWorkerProfiles());

  // 한국어 엑셀 호환을 위해 UTF-8 BOM prefix — 엑셀이 ANSI 로 오인하는 문제 회피
  const bom = "﻿";

  return new NextResponse(bom + csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filenameFor(workerId, from, to)}"`,
      "x-row-count": String(rows.length),
      "x-site-info-rows": String(siteInfoRows.length),
    },
  });
}
