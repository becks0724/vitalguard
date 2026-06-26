// 관리자 — 낙상 ML 학습 데이터셋 CSV 내보내기 (활성화 요소 전부 + 알고리즘 판정 + 정답 라벨)
import { NextResponse } from "next/server";

import { hasAdminMenuAccess } from "../../../../lib/admin-auth";
import { exportFallDataset, type FallDatasetRow } from "../../../../lib/db";

// 한 행 = 낙상 디텍터 후보 1건. feature(충격/정지/자유낙하/회전) + 알고리즘 판정 + 관제자 정답 라벨.
const CSV_HEADER = [
  "id",
  "ts",
  "received_at",
  "worker_id",
  "worker_name",
  "employee_id",
  "fall_decision", // 알고리즘 3분류 판정(fall/rejected_*)
  "fall_candidate_id",
  "fall_update_phase",
  "fall_prompt_outcome",
  "fall_prompt_response_sec",
  "algo_predicted_fall", // 알고리즘 양성 여부(1=발화)
  "accel_magnitude_g", // feature — 충격 피크 G
  "motion_still_sec", // feature — 충격 후 누적 저활동초
  "freefall_preceded", // feature — 자유낙하 전조(1/0)
  "peak_rotation_rad_s", // feature — 자이로 회전 피크
  "hr_pre_mean_10s",
  "hr_at_impact",
  "hr_post_mean_30s",
  "hr_post_peak_30s",
  "hr_delta_mean",
  "hr_delta_peak",
  "heart_rate",
  "spo2",
  "battery_pct",
  "latitude",
  "longitude",
  "ground_truth_label", // 학습 타깃 — 관제자 수기(true_fall/false_positive/unsure)
  "label_note",
  "labeled_by",
  "labeled_at",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToRecord(row: FallDatasetRow): Record<string, unknown> {
  return {
    id: row.id,
    ts: row.ts,
    received_at: row.received_at,
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    employee_id: row.employee_id,
    fall_decision: row.fall_decision,
    fall_candidate_id: row.fall_candidate_id,
    fall_update_phase: row.fall_update_phase,
    fall_prompt_outcome: row.fall_prompt_outcome,
    fall_prompt_response_sec: row.fall_prompt_response_sec,
    algo_predicted_fall: row.fall_decision === "fall" || row.fall_detected === 1 ? 1 : 0,
    accel_magnitude_g: row.accel_magnitude_g,
    motion_still_sec: row.motion_still_sec,
    freefall_preceded: row.freefall_preceded,
    peak_rotation_rad_s: row.peak_rotation_rad_s,
    hr_pre_mean_10s: row.hr_pre_mean_10s,
    hr_at_impact: row.hr_at_impact,
    hr_post_mean_30s: row.hr_post_mean_30s,
    hr_post_peak_30s: row.hr_post_peak_30s,
    hr_delta_mean: row.hr_delta_mean,
    hr_delta_peak: row.hr_delta_peak,
    heart_rate: row.heart_rate,
    spo2: row.spo2,
    battery_pct: row.battery_pct,
    latitude: row.latitude,
    longitude: row.longitude,
    ground_truth_label: row.ground_truth_label,
    label_note: row.label_note,
    labeled_by: row.labeled_by,
    labeled_at: row.labeled_at,
  };
}

export async function GET(request: Request) {
  if (!(await hasAdminMenuAccess(request))) {
    return NextResponse.json(
      { ok: false, error: "관리자 인증 필요" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
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

  const rows = await exportFallDataset({ from, to });
  const lines: string[] = [CSV_HEADER.join(",")];
  for (const row of rows) {
    const record = rowToRecord(row);
    lines.push(CSV_HEADER.map((col) => csvCell(record[col])).join(","));
  }
  const csv = lines.join("\n") + "\n";

  const bom = "﻿"; // 엑셀 한글 호환 UTF-8 BOM
  const fileFrom = from.slice(0, 10);
  const fileTo = to.slice(0, 10);

  return new NextResponse(bom + csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fall-ml-${fileFrom}_${fileTo}.csv"`,
      "x-row-count": String(rows.length),
    },
  });
}
