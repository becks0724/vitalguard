// CSV 내보내기 순수 헬퍼 — 스트리밍 라우트와 골든마스터(형식 고정) 테스트가 공유하는 단일 소스.
// 형식 규약: [현장정보 블록] 빈 줄 [생체데이터 헤더] [행들], 각 줄 \n 구분·마지막 \n. (조달 제출 양식 — 변경 금지)
import type { ExportRow, SiteInfoRow } from "./db";
import {
  STATUS_LABEL,
  coreTempStatus,
  heartRateStatus,
  overallStatus,
  spo2Status,
} from "./severity";

// DB 컬럼 + 위험도 4 컬럼 (산업재해 자료 제출 시 이상치 표시용).
// status_* 는 한글 라벨 (정상/주의/위험/대기) — Excel conditional formatting 으로 색 적용 가능.
export const CSV_HEADER = [
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

export const SITE_INFO_HEADER = [
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
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// 직급은 관제 웹 오버라이드(worker_profile)가 폰 발신값(job_title)보다 우선 — 효과값으로 export.
export function withStatuses(row: ExportRow, profiles: Record<string, string>) {
  return {
    ...row,
    job_title: profiles[row.worker_id] ?? row.job_title,
    hr_status: STATUS_LABEL[heartRateStatus(row.heart_rate)],
    spo2_status: STATUS_LABEL[spo2Status(row.spo2)],
    temp_status: STATUS_LABEL[coreTempStatus(row.skin_temp_c)],
    overall_status: STATUS_LABEL[overallStatus(row)],
  };
}

// 문서 서두 — 현장정보 블록 + 빈 줄 + 생체데이터 헤더까지 (마지막 \n 포함).
// 이후 rowsToCsvChunk 를 이어 붙이면 기존 단일 문자열 조립과 바이트 동일한 문서가 된다.
export function csvPrologue(siteInfoRows: SiteInfoRow[]): string {
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
  return lines.join("\n") + "\n";
}

// 생체데이터 행 배치 → CSV 청크 (각 행 \n 종결) — 스트리밍에서 배치 단위로 호출.
export function rowsToCsvChunk(
  rows: ExportRow[],
  profiles: Record<string, string>,
): string {
  let out = "";
  for (const row of rows) {
    const enriched = withStatuses(row, profiles);
    out +=
      CSV_HEADER.map((col) => csvCell((enriched as Record<string, unknown>)[col])).join(",") +
      "\n";
  }
  return out;
}

export function csvFilenameFor(
  workerId: string | undefined,
  from: string,
  to: string,
): string {
  const safeFrom = from.slice(0, 10);
  const safeTo = to.slice(0, 10);
  const wid = workerId ? workerId.replace(/[^a-zA-Z0-9_-]/g, "_") : "all";
  return `vital-${wid}-${safeFrom}_${safeTo}.csv`;
}
