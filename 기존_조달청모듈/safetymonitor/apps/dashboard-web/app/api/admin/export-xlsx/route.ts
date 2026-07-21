// 관리자 — XLSX 내보내기
// 시트1: 현장정보 일 1회 snapshot / 시트2: 생체데이터 이상치 빨강 / 시트3: 현장환경 이력
// 시트2 는 최근 XLSX_VITAL_ROW_CAP 건 상한 — exceljs 는 워크북 전체를 메모리에 만들므로(스타일 포함)
// 무제한 행은 OOM 경로. 전체 원본 다운로드 책임은 스트리밍 CSV 가 진다(상한 초과 시 안내 행 표기).
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

import { hasAdminMenuAccess } from "../../../../lib/admin-auth";
import {
  countExportRows,
  exportSamplesCapped,
  exportSiteInfoLogs,
  exportWeatherLogs,
  getWorkerProfiles,
  type ExportRow,
  type SiteInfoRow,
  type WeatherLogRow,
} from "../../../../lib/db";
import {
  releaseExportSlot,
  tryAcquireExportSlot,
} from "../../../../lib/export-guard";
import {
  STATUS_LABEL,
  coreTempStatus,
  heartRateStatus,
  overallStatus,
  spo2Status,
  type Status,
} from "../../../../lib/severity";

// 시트2 생체데이터 행 상한 — 열람·보고용 실용 범위. 초과분은 CSV(전체 스트리밍)로 안내.
const XLSX_VITAL_ROW_CAP = 50_000;

// 위험 = 빨강 굵게, 주의 = 주황, 정상/대기 = 기본
const FONT_BY_STATUS: Record<Status, Partial<ExcelJS.Font>> = {
  idle: { color: { argb: "FF9CA3AF" } },
  normal: { color: { argb: "FF166534" } },
  caution: { color: { argb: "FFB45309" }, bold: true },
  danger: { color: { argb: "FFDC2626" }, bold: true },
};

const FILL_DANGER: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFDE8E8" },
};
const FILL_CAUTION: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFEF3C7" },
};

function filenameFor(workerId: string | undefined, from: string, to: string) {
  const wid = workerId ? workerId.replace(/[^a-zA-Z0-9_-]/g, "_") : "all";
  return `safetymonitor-${wid}-${from.slice(0, 10)}_${to.slice(0, 10)}.xlsx`;
}

function buildVitalSheet(
  wb: ExcelJS.Workbook,
  rows: ExportRow[],
  profiles: Record<string, string>,
) {
  const ws = wb.addWorksheet("생체데이터");
  ws.columns = [
    { header: "id", key: "id", width: 8 },
    { header: "수신시각", key: "received_at", width: 24 },
    { header: "작업자ID", key: "worker_id", width: 14 },
    { header: "이름", key: "worker_name", width: 10 },
    { header: "사원번호", key: "employee_id", width: 12 },
    { header: "직급/직책", key: "job_title", width: 14 },
    { header: "보호자", key: "guardian_name", width: 12 },
    { header: "보호자연락처", key: "guardian_phone", width: 14 },
    { header: "측정시각", key: "ts", width: 24 },
    { header: "심박(bpm)", key: "heart_rate", width: 10 },
    { header: "SpO₂(%)", key: "spo2", width: 9 },
    { header: "손목온도(℃)", key: "skin_temp_c", width: 11 },
    { header: "환경온도(℃)", key: "ambient_temp_c", width: 11 },
    { header: "배터리(%)", key: "battery_pct", width: 9 },
    { header: "SOS", key: "manual_sos", width: 6 },
    { header: "낙상", key: "fall_detected", width: 6 },
    { header: "위도", key: "latitude", width: 16 },
    { header: "경도", key: "longitude", width: 16 },
    { header: "심박상태", key: "hr_status", width: 9 },
    { header: "SpO₂상태", key: "spo2_status", width: 9 },
    { header: "체온상태", key: "temp_status", width: 9 },
    { header: "종합상태", key: "overall_status", width: 9 },
  ];

  // 헤더 스타일
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    const hrS = heartRateStatus(row.heart_rate);
    const spo2S = spo2Status(row.spo2);
    const tempS = coreTempStatus(row.skin_temp_c);
    const overall = overallStatus(row);

    const added = ws.addRow({
      id: row.id,
      received_at: row.received_at,
      worker_id: row.worker_id,
      worker_name: row.worker_name ?? "",
      employee_id: row.employee_id ?? "",
      job_title: profiles[row.worker_id] ?? row.job_title ?? "",
      guardian_name: row.guardian_name ?? "",
      guardian_phone: row.guardian_phone ?? "",
      ts: row.ts,
      heart_rate: row.heart_rate ?? "",
      spo2: row.spo2 ?? "",
      skin_temp_c: row.skin_temp_c ?? "",
      ambient_temp_c: row.ambient_temp_c ?? "",
      battery_pct: row.battery_pct ?? "",
      manual_sos: row.manual_sos === 1 ? "Y" : "",
      fall_detected: row.fall_detected === 1 ? "Y" : "",
      latitude: row.latitude ?? "",
      longitude: row.longitude ?? "",
      hr_status: STATUS_LABEL[hrS],
      spo2_status: STATUS_LABEL[spo2S],
      temp_status: STATUS_LABEL[tempS],
      overall_status: STATUS_LABEL[overall],
    });

    // 메트릭 값 + 상태 셀에 status 색 적용
    added.getCell("heart_rate").font = FONT_BY_STATUS[hrS];
    added.getCell("hr_status").font = FONT_BY_STATUS[hrS];
    added.getCell("spo2").font = FONT_BY_STATUS[spo2S];
    added.getCell("spo2_status").font = FONT_BY_STATUS[spo2S];
    added.getCell("skin_temp_c").font = FONT_BY_STATUS[tempS];
    added.getCell("temp_status").font = FONT_BY_STATUS[tempS];
    added.getCell("overall_status").font = FONT_BY_STATUS[overall];

    // SOS/낙상 발생 셀 강조
    if (row.manual_sos === 1) added.getCell("manual_sos").font = FONT_BY_STATUS.danger;
    if (row.fall_detected === 1) added.getCell("fall_detected").font = FONT_BY_STATUS.danger;

    // 이상치 행 배경 강조 — 위험=연빨강, 주의=연주황
    if (overall === "danger") {
      added.eachCell((cell) => (cell.fill = FILL_DANGER));
    } else if (overall === "caution") {
      added.eachCell((cell) => (cell.fill = FILL_CAUTION));
    }
  }

  return ws;
}

function buildWeatherSheet(wb: ExcelJS.Workbook, rows: WeatherLogRow[]) {
  const ws = wb.addWorksheet("현장환경");
  ws.columns = [
    { header: "id", key: "id", width: 8 },
    { header: "기록시각", key: "recorded_at", width: 24 },
    { header: "위도", key: "lat", width: 12 },
    { header: "경도", key: "lon", width: 12 },
    { header: "작업자수", key: "worker_count", width: 9 },
    { header: "날씨코드", key: "weather_code", width: 9 },
    { header: "기온(℃)", key: "temperature_c", width: 9 },
    { header: "체감온도(℃)", key: "apparent_temp_c", width: 11 },
    { header: "습도(%)", key: "humidity_pct", width: 9 },
    { header: "풍속(km/h)", key: "wind_kmh", width: 10 },
    { header: "강수량(mm/h)", key: "precipitation_mm", width: 12 },
    { header: "자외선지수", key: "uv_index", width: 10 },
    { header: "PM10", key: "pm10", width: 8 },
    { header: "PM2.5", key: "pm25", width: 8 },
    { header: "일출", key: "sunrise", width: 18 },
    { header: "일몰", key: "sunset", width: 18 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    ws.addRow({
      id: row.id,
      recorded_at: row.recorded_at,
      lat: row.lat,
      lon: row.lon,
      worker_count: row.worker_count ?? "",
      weather_code: row.weather_code ?? "",
      temperature_c: row.temperature_c ?? "",
      apparent_temp_c: row.apparent_temp_c ?? "",
      humidity_pct: row.humidity_pct ?? "",
      wind_kmh: row.wind_kmh ?? "",
      precipitation_mm: row.precipitation_mm ?? "",
      uv_index: row.uv_index ?? "",
      pm10: row.pm10 ?? "",
      pm25: row.pm25 ?? "",
      sunrise: row.sunrise ?? "",
      sunset: row.sunset ?? "",
    });
  }

  return ws;
}

function buildSiteInfoSheet(wb: ExcelJS.Workbook, rows: SiteInfoRow[]) {
  const ws = wb.addWorksheet("현장정보");
  ws.columns = [
    { header: "snapshot_date", key: "snapshot_date", width: 14 },
    { header: "기록시각", key: "recorded_at", width: 24 },
    { header: "기업명", key: "company_name", width: 24 },
    { header: "현장명", key: "site_name", width: 28 },
    { header: "공사종류", key: "construction_type", width: 20 },
    { header: "주소", key: "address", width: 36 },
    { header: "착수 날짜", key: "start_date", width: 14 },
    { header: "준공 날짜", key: "completion_date", width: 14 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F2937" },
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    ws.addRow({
      snapshot_date: row.snapshot_date,
      recorded_at: row.recorded_at,
      company_name: row.company_name ?? "",
      site_name: row.site_name ?? "",
      construction_type: row.construction_type ?? "",
      address: row.address ?? "",
      start_date: row.start_date ?? "",
      completion_date: row.completion_date ?? "",
    });
  }

  return ws;
}

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

  // 동시 내보내기 1건 제한 — CSV 스트리밍과 공유 가드(메모리 중첩 방지)
  if (!tryAcquireExportSlot()) {
    return NextResponse.json(
      { ok: false, error: "다른 내보내기가 진행 중입니다. 완료 후 다시 시도하세요." },
      { status: 429 },
    );
  }
  const startedAt = Date.now();
  try {
    // 기간 일치 총 건수 + 최근 상한 건(시간 오름차순) — 전체 로드 금지
    const [totalRows, vitalRows, weatherRows, siteInfoRows, profiles] =
      await Promise.all([
        countExportRows({ workerId, from, to }),
        exportSamplesCapped({ workerId, from, to, limit: XLSX_VITAL_ROW_CAP }),
        // 현장 환경은 워커 무관 (현장 공통) — 기간만 필터
        exportWeatherLogs({ from, to }),
        // 현장 정보는 관리자 저장 시 하루 1회 snapshot 으로 보존
        exportSiteInfoLogs({ from, to }),
        getWorkerProfiles(),
      ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = "SafetyMonitor";
    wb.created = now;
    buildSiteInfoSheet(wb, siteInfoRows);
    const vitalWs = buildVitalSheet(wb, vitalRows, profiles);
    buildWeatherSheet(wb, weatherRows);

    // 상한 초과 시 시트 최상단 안내 행 — 잘림이 침묵하지 않게 명시(전체는 CSV 안내)
    if (totalRows > vitalRows.length) {
      vitalWs.spliceRows(1, 0, [
        `⚠ 기간 일치 ${totalRows.toLocaleString()}건 중 최근 ${vitalRows.length.toLocaleString()}건만 표시 — 전체 데이터는 CSV 다운로드를 이용하세요`,
      ]);
      const notice = vitalWs.getRow(1);
      notice.font = { bold: true, color: { argb: "FFDC2626" } };
      vitalWs.views = [{ state: "frozen", ySplit: 2 }];
    }

    const buffer = await wb.xlsx.writeBuffer();
    // eslint-disable-next-line no-console -- 내보내기 관측 로그(시작/완료/행수/소요) 의도적 유지
    console.log(
      `[export-xlsx] 완료 rows=${vitalRows.length} total=${totalRows} ms=${Date.now() - startedAt}`,
    );

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filenameFor(workerId, from, to)}"`,
        "x-vital-rows": String(vitalRows.length),
        "x-vital-rows-total": String(totalRows),
        "x-weather-rows": String(weatherRows.length),
        "x-site-info-rows": String(siteInfoRows.length),
      },
    });
  } finally {
    releaseExportSlot();
  }
}
