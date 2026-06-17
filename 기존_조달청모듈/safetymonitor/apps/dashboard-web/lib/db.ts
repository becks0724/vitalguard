// SQLite 영속 저장소 — vital sample 무한 축적용 (산업재해 자료 제출 대비)
// 단일 file `.runtime/safetymonitor.db` 자동 생성. HMR 안전 — globalThis 캐시
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { VitalSample } from "@safetymonitor/schemas";

type DbBundle = {
  db: Database.Database;
  insert: Database.Statement;
  count: Database.Statement<[]>;
  listWorkers: Database.Statement<[]>;
  exportAll: Database.Statement;
  exportFiltered: Database.Statement;
  insertWeather: Database.Statement;
  exportWeather: Database.Statement;
  upsertSiteInfoDaily: Database.Statement;
  getLatestSiteInfo: Database.Statement<[]>;
  exportSiteInfo: Database.Statement;
  upsertWorkerProfile: Database.Statement;
  listWorkerProfiles: Database.Statement<[]>;
  insertAlert: Database.Statement;
  listAlerts: Database.Statement;
  ackAlert: Database.Statement;
  insertAedInspection: Database.Statement;
  listAedInspectionsStmt: Database.Statement;
  exportFallDataset: Database.Statement;
  listFallCandidates: Database.Statement;
  fallStats: Database.Statement<[]>;
  setFallLabelStmt: Database.Statement;
  updateFallCandidateState: Database.Statement;
};

// CSV 내보내기 행 형식 — DB 컬럼명 그대로 (관제자가 엑셀에서 인식하기 쉽게).
export type ExportRow = {
  id: number;
  worker_id: string;
  worker_name: string | null;
  employee_id: string | null;
  job_title: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  ts: string;
  heart_rate: number | null;
  spo2: number | null;
  skin_temp_c: number | null;
  ambient_temp_c: number | null;
  battery_pct: number | null;
  manual_sos: number | null;
  fall_detected: number | null;
  latitude: number | null;
  longitude: number | null;
  hrv_sdnn_ms: number | null;
  resting_heart_rate: number | null;
  active_energy_kcal: number | null;
  steps: number | null;
  walking_heart_rate: number | null;
  flights_climbed: number | null;
  respiratory_rate: number | null;
  received_at: string;
};

export type WorkerSummary = {
  worker_id: string;
  worker_name: string | null;
  employee_id: string | null;
  job_title: string | null;
  sample_count: number;
  first_ts: string;
  last_ts: string;
};

// 현장 환경 snapshot 행 — weather_log 테이블 (산업재해 시점 폭염/한파 근거 첨부용)
export type WeatherLogRow = {
  id: number;
  lat: number;
  lon: number;
  worker_count: number | null;
  weather_code: number | null;
  temperature_c: number | null;
  apparent_temp_c: number | null;
  humidity_pct: number | null;
  wind_kmh: number | null;
  precipitation_mm: number | null;
  uv_index: number | null;
  pm10: number | null;
  pm25: number | null;
  sunrise: string | null;
  sunset: string | null;
  recorded_at: string;
};

export type SiteInfoInput = {
  companyName: string;
  siteName: string;
  constructionType: string;
  address: string;
  startDate: string;
  completionDate: string;
};

export type SiteInfoRow = {
  id: number;
  snapshot_date: string;
  company_name: string | null;
  site_name: string | null;
  construction_type: string | null;
  address: string | null;
  start_date: string | null;
  completion_date: string | null;
  recorded_at: string;
};

const globalForDb = globalThis as typeof globalThis & {
  __safetyMonitorDb?: DbBundle;
};

function init(): DbBundle {
  // dev 서버 cwd 는 apps/dashboard-web — 모노레포 루트의 .runtime 에 저장
  const runtimeDir = path.resolve(process.cwd(), "..", "..", ".runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const dbPath = path.join(runtimeDir, "safetymonitor.db");

  const db = new Database(dbPath);
  // WAL 모드 — 읽기/쓰기 동시성 향상, dev 서버 + 백그라운드 polling 가정
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS vital_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id TEXT NOT NULL,
      worker_name TEXT,
      employee_id TEXT,
      guardian_name TEXT,
      guardian_phone TEXT,
      ts TEXT NOT NULL,
      heart_rate REAL,
      spo2 REAL,
      skin_temp_c REAL,
      ambient_temp_c REAL,
      battery_pct INTEGER,
      manual_sos INTEGER,
      fall_detected INTEGER,
      latitude REAL,
      longitude REAL,
      received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vs_worker_ts ON vital_samples(worker_id, ts);
    CREATE INDEX IF NOT EXISTS idx_vs_ts ON vital_samples(ts);

    CREATE TABLE IF NOT EXISTS weather_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      worker_count INTEGER,
      weather_code INTEGER,
      temperature_c REAL,
      apparent_temp_c REAL,
      humidity_pct REAL,
      wind_kmh REAL,
      precipitation_mm REAL,
      uv_index REAL,
      pm10 REAL,
      pm25 REAL,
      sunrise TEXT,
      sunset TEXT,
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wl_recorded ON weather_log(recorded_at);

    CREATE TABLE IF NOT EXISTS site_info_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL UNIQUE,
      company_name TEXT,
      site_name TEXT,
      construction_type TEXT,
      address TEXT,
      start_date TEXT,
      completion_date TEXT,
      recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sid_snapshot ON site_info_daily(snapshot_date);

    -- SOS/낙상 알림 이력 — 발생/대응(ack) 시각·대응자 보존(산업재해 자료 "알림→대응 시각" 첨부).
    -- (worker_id, type, ts) UNIQUE 로 폰 재전송·backlog flush 시 중복 방지.
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worker_id TEXT NOT NULL,
      worker_name TEXT,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ack_at TEXT,
      ack_by TEXT,
      UNIQUE(worker_id, type, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

    CREATE TABLE IF NOT EXISTS aed_inspections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aed_id TEXT NOT NULL,
      loc TEXT,
      inspector TEXT NOT NULL,
      items TEXT,
      ts TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_aed_insp ON aed_inspections(aed_id, ts);

    -- 주간 검증 보고서(④ 종합) — 시공사 제출 입력(세금계산서·계좌·대장·사진 집계).
    -- contract_id 단일행 upsert. 검증자는 수정 불가(피검증자 제출분), 워치 실측과 대조 전용.
    CREATE TABLE IF NOT EXISTS weekly_report_inputs (
      contract_id TEXT PRIMARY KEY,
      supplier TEXT,
      supplier_bno TEXT,
      claimed_headcount INTEGER,
      invoice_total INTEGER,
      paid_total INTEGER,
      ledger_headcount INTEGER,
      photo_count INTEGER,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    -- 주간보고서 제출 이력 — 감독관 발송 시 1행(감사 추적).
    CREATE TABLE IF NOT EXISTS weekly_report_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT NOT NULL,
      period TEXT,
      verdict TEXT,
      suspect_count INTEGER,
      submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wrs_submitted ON weekly_report_submissions(submitted_at);
  `);

  // 멱등 마이그레이션 — 기존 DB 에 신규 컬럼(스트레스 입력 + 직급)이 없으면 ADD COLUMN.
  // CREATE TABLE IF NOT EXISTS 는 기존 테이블을 건드리지 않으므로 별도 패치 필요.
  // 컬럼명은 코드 내 리터럴 상수 (사용자 입력 아님 — SQL injection 무관).
  const migrationColumns: Array<{ name: string; type: string }> = [
    { name: "hrv_sdnn_ms", type: "REAL" },
    { name: "resting_heart_rate", type: "REAL" },
    { name: "active_energy_kcal", type: "REAL" },
    { name: "steps", type: "INTEGER" },
    { name: "walking_heart_rate", type: "REAL" },
    { name: "flights_climbed", type: "INTEGER" },
    { name: "respiratory_rate", type: "REAL" },
    { name: "job_title", type: "TEXT" }, // 직급/직책 — 폰 ⚙️ 발신값
    // 낙상 ML 데이터 수집(fall-ml) — 충격/정지는 종전 raw_json 에만 있었으나 ML 질의·통계를 위해
    // 전용 컬럼화. 레거시 행은 NULL 이지만 export 시 raw_json COALESCE 로 백필한다.
    { name: "accel_magnitude_g", type: "REAL" },
    { name: "motion_still_sec", type: "REAL" },
    { name: "fall_candidate", type: "INTEGER" },
    { name: "freefall_preceded", type: "INTEGER" },
    { name: "peak_rotation_rad_s", type: "REAL" },
    { name: "fall_decision", type: "TEXT" },
    { name: "fall_candidate_id", type: "TEXT" },
    { name: "fall_update_phase", type: "TEXT" },
    { name: "fall_prompt_outcome", type: "TEXT" },
    { name: "fall_prompt_response_sec", type: "REAL" },
    { name: "hr_pre_mean_10s", type: "REAL" },
    { name: "hr_at_impact", type: "REAL" },
    { name: "hr_post_mean_30s", type: "REAL" },
    { name: "hr_post_peak_30s", type: "REAL" },
    { name: "hr_delta_mean", type: "REAL" },
    { name: "hr_delta_peak", type: "REAL" },
  ];
  const existingCols = new Set(
    (db.prepare("PRAGMA table_info(vital_samples)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  for (const col of migrationColumns) {
    if (!existingCols.has(col.name)) {
      db.exec(`ALTER TABLE vital_samples ADD COLUMN ${col.name} ${col.type}`);
    }
  }

  // 직급/직책 관제 웹 오버라이드 — workerId 키 단일행 upsert. 폰 발신값(vital_samples.job_title)보다 우선.
  db.exec(`
    CREATE TABLE IF NOT EXISTS worker_profile (
      worker_id TEXT PRIMARY KEY,
      job_title TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  // 낙상 ML 정답 라벨 — 관제자가 각 후보 샘플에 실제 낙상 여부를 수기 라벨링(지도학습 정답).
  // sample_id = vital_samples.id 단일행 upsert. label ∈ {true_fall, false_positive, unsure}.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fall_labels (
      sample_id INTEGER PRIMARY KEY,
      label TEXT,
      note TEXT,
      labeled_by TEXT,
      labeled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const insert = db.prepare(`
    INSERT INTO vital_samples (
      worker_id, worker_name, employee_id, job_title, guardian_name, guardian_phone,
      ts, heart_rate, spo2, skin_temp_c, ambient_temp_c, battery_pct,
      manual_sos, fall_detected, latitude, longitude,
      hrv_sdnn_ms, resting_heart_rate, active_energy_kcal, steps,
      walking_heart_rate, flights_climbed, respiratory_rate,
      accel_magnitude_g, motion_still_sec, fall_candidate,
      freefall_preceded, peak_rotation_rad_s, fall_decision,
      fall_candidate_id, fall_update_phase, fall_prompt_outcome, fall_prompt_response_sec,
      hr_pre_mean_10s, hr_at_impact, hr_post_mean_30s, hr_post_peak_30s,
      hr_delta_mean, hr_delta_peak, raw_json
    ) VALUES (
      @worker_id, @worker_name, @employee_id, @job_title, @guardian_name, @guardian_phone,
      @ts, @heart_rate, @spo2, @skin_temp_c, @ambient_temp_c, @battery_pct,
      @manual_sos, @fall_detected, @latitude, @longitude,
      @hrv_sdnn_ms, @resting_heart_rate, @active_energy_kcal, @steps,
      @walking_heart_rate, @flights_climbed, @respiratory_rate,
      @accel_magnitude_g, @motion_still_sec, @fall_candidate,
      @freefall_preceded, @peak_rotation_rad_s, @fall_decision,
      @fall_candidate_id, @fall_update_phase, @fall_prompt_outcome, @fall_prompt_response_sec,
      @hr_pre_mean_10s, @hr_at_impact, @hr_post_mean_30s, @hr_post_peak_30s,
      @hr_delta_mean, @hr_delta_peak, @raw_json
    )
  `);

  const updateFallCandidateState = db.prepare(`
    UPDATE vital_samples
    SET
      fall_update_phase = COALESCE(@fall_update_phase, fall_update_phase),
      fall_prompt_outcome = COALESCE(@fall_prompt_outcome, fall_prompt_outcome),
      fall_prompt_response_sec = COALESCE(@fall_prompt_response_sec, fall_prompt_response_sec),
      hr_post_mean_30s = COALESCE(@hr_post_mean_30s, hr_post_mean_30s),
      hr_post_peak_30s = COALESCE(@hr_post_peak_30s, hr_post_peak_30s),
      hr_delta_mean = COALESCE(@hr_delta_mean, hr_delta_mean),
      hr_delta_peak = COALESCE(@hr_delta_peak, hr_delta_peak),
      raw_json = CASE
        WHEN raw_json IS NULL OR raw_json = '' THEN @raw_json
        ELSE raw_json
      END
    WHERE fall_candidate_id = @fall_candidate_id AND fall_candidate = 1
  `);

  // 직급 오버라이드 upsert + 조회 — 관제 웹 입력용.
  const upsertWorkerProfile = db.prepare(`
    INSERT INTO worker_profile (worker_id, job_title, updated_at)
    VALUES (@worker_id, @job_title, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(worker_id) DO UPDATE SET
      job_title = excluded.job_title,
      updated_at = excluded.updated_at
  `);
  const listWorkerProfiles = db.prepare<[]>(
    "SELECT worker_id, job_title FROM worker_profile WHERE job_title IS NOT NULL AND job_title != ''",
  );

  // 알림 이력 — SOS/낙상. 중복(같은 worker/type/ts)은 무시.
  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO alerts (worker_id, worker_name, type, ts)
    VALUES (@worker_id, @worker_name, @type, @ts)
  `);
  const listAlerts = db.prepare(
    "SELECT * FROM alerts ORDER BY ts DESC, id DESC LIMIT @limit",
  );
  const ackAlert = db.prepare(`
    UPDATE alerts
    SET ack_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), ack_by = @ack_by
    WHERE id = @id AND ack_at IS NULL
  `);

  // AED NFC 점검 기록 — 현장 관리자 태깅 시 1행. items = 교체 항목 JSON(빈 배열 = 점검만).
  const insertAedInspection = db.prepare(`
    INSERT INTO aed_inspections (aed_id, loc, inspector, items, ts, source)
    VALUES (@aed_id, @loc, @inspector, @items, @ts, @source)
  `);
  const listAedInspectionsStmt = db.prepare(
    "SELECT * FROM aed_inspections ORDER BY ts DESC, id DESC LIMIT @limit",
  );

  // ── 낙상 ML(fall-ml) ──────────────────────────────────────────────────────
  // 후보 필터 — 신규 후보(fall_candidate=1) + 레거시 양성(fall_detected=1, candidateId 없는 구버전 행).
  // 새 프롬프트 흐름은 실제 낙상 알림을 별도 이벤트 행으로 적재하므로, candidateId 가 있는 경보행은
  // 후보 목록/학습셋에서 제외해 중복 샘플을 막는다. 충격G/정지초는 전용 컬럼이 비면 raw_json 백필.
  const FALL_WHERE =
    "(v.fall_candidate = 1 OR (v.fall_detected = 1 AND v.fall_candidate_id IS NULL))";
  const FALL_SELECT = `
    SELECT
      v.id, v.worker_id, v.worker_name, v.employee_id, v.ts, v.received_at,
      v.fall_detected, v.fall_candidate, v.fall_decision,
      COALESCE(v.accel_magnitude_g, json_extract(v.raw_json,'$.accelMagnitudeG')) AS accel_magnitude_g,
      COALESCE(v.motion_still_sec, json_extract(v.raw_json,'$.motionStillSec'))  AS motion_still_sec,
      v.freefall_preceded, v.peak_rotation_rad_s,
      v.fall_candidate_id, v.fall_update_phase,
      v.fall_prompt_outcome, v.fall_prompt_response_sec,
      v.hr_pre_mean_10s, v.hr_at_impact, v.hr_post_mean_30s, v.hr_post_peak_30s,
      v.hr_delta_mean, v.hr_delta_peak,
      v.heart_rate, v.spo2, v.battery_pct, v.latitude, v.longitude,
      fl.label AS ground_truth_label, fl.note AS label_note,
      fl.labeled_by, fl.labeled_at
    FROM vital_samples v
    LEFT JOIN fall_labels fl ON fl.sample_id = v.id
  `;
  const exportFallDataset = db.prepare(
    `${FALL_SELECT} WHERE ${FALL_WHERE} AND v.ts >= @from AND v.ts <= @to ORDER BY v.ts ASC`,
  );
  const listFallCandidates = db.prepare(
    `${FALL_SELECT} WHERE ${FALL_WHERE} ORDER BY v.ts DESC LIMIT @limit`,
  );
  const fallStats = db.prepare<[]>(`
    SELECT
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN v.fall_decision = 'fall'
            OR (v.fall_detected = 1 AND v.fall_candidate_id IS NULL)
          THEN 1
          ELSE 0
        END
      ) AS positives,
      SUM(
        CASE
          WHEN v.fall_candidate = 1 AND COALESCE(v.fall_decision, '') != 'fall'
          THEN 1
          ELSE 0
        END
      ) AS negatives,
      SUM(CASE WHEN fl.label IS NOT NULL AND fl.label != '' THEN 1 ELSE 0 END) AS labeled
    FROM vital_samples v
    LEFT JOIN fall_labels fl ON fl.sample_id = v.id
    WHERE ${FALL_WHERE}
  `);
  const setFallLabelStmt = db.prepare(`
    INSERT INTO fall_labels (sample_id, label, note, labeled_by, labeled_at)
    VALUES (@sample_id, @label, @note, @labeled_by, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(sample_id) DO UPDATE SET
      label = excluded.label,
      note = excluded.note,
      labeled_by = excluded.labeled_by,
      labeled_at = excluded.labeled_at
  `);

  const count = db.prepare<[]>("SELECT COUNT(*) AS n FROM vital_samples");

  // 관리자 내보내기 — 워커 목록 + 샘플 수 + 시계 범위 (드롭다운 채움용)
  const listWorkers = db.prepare<[]>(`
    SELECT
      worker_id,
      MAX(worker_name) AS worker_name,
      MAX(employee_id) AS employee_id,
      MAX(job_title) AS job_title,
      COUNT(*) AS sample_count,
      MIN(ts) AS first_ts,
      MAX(ts) AS last_ts
    FROM vital_samples
    GROUP BY worker_id
    ORDER BY worker_id
  `);

  // 전체 내보내기 (기간만 필터). workerId 별 내보내기는 exportFiltered 사용
  const exportAll = db.prepare(`
    SELECT * FROM vital_samples
    WHERE ts >= @from AND ts <= @to
    ORDER BY ts ASC
  `);

  const exportFiltered = db.prepare(`
    SELECT * FROM vital_samples
    WHERE worker_id = @worker_id AND ts >= @from AND ts <= @to
    ORDER BY ts ASC
  `);

  const insertWeather = db.prepare(`
    INSERT INTO weather_log (
      lat, lon, worker_count, weather_code, temperature_c, apparent_temp_c,
      humidity_pct, wind_kmh, precipitation_mm, uv_index, pm10, pm25, sunrise, sunset
    ) VALUES (
      @lat, @lon, @worker_count, @weather_code, @temperature_c, @apparent_temp_c,
      @humidity_pct, @wind_kmh, @precipitation_mm, @uv_index, @pm10, @pm25, @sunrise, @sunset
    )
  `);

  const exportWeather = db.prepare(`
    SELECT * FROM weather_log
    WHERE recorded_at >= @from AND recorded_at <= @to
    ORDER BY recorded_at ASC
  `);

  const upsertSiteInfoDaily = db.prepare(`
    INSERT INTO site_info_daily (
      snapshot_date, company_name, site_name, construction_type,
      address, start_date, completion_date, recorded_at
    ) VALUES (
      @snapshot_date, @company_name, @site_name, @construction_type,
      @address, @start_date, @completion_date,
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
    ON CONFLICT(snapshot_date) DO UPDATE SET
      company_name = excluded.company_name,
      site_name = excluded.site_name,
      construction_type = excluded.construction_type,
      address = excluded.address,
      start_date = excluded.start_date,
      completion_date = excluded.completion_date,
      recorded_at = excluded.recorded_at
  `);

  const getLatestSiteInfo = db.prepare<[]>(`
    SELECT * FROM site_info_daily
    ORDER BY snapshot_date DESC, recorded_at DESC
    LIMIT 1
  `);

  const exportSiteInfo = db.prepare(`
    SELECT * FROM site_info_daily
    WHERE snapshot_date >= @from_date AND snapshot_date <= @to_date
    ORDER BY snapshot_date ASC
  `);

  return {
    db,
    insert,
    count,
    listWorkers,
    exportAll,
    exportFiltered,
    insertWeather,
    exportWeather,
    upsertSiteInfoDaily,
    getLatestSiteInfo,
    exportSiteInfo,
    upsertWorkerProfile,
    listWorkerProfiles,
    insertAlert,
    listAlerts,
    ackAlert,
    insertAedInspection,
    listAedInspectionsStmt,
    exportFallDataset,
    listFallCandidates,
    fallStats,
    setFallLabelStmt,
    updateFallCandidateState,
  };
}

export function getDb(): DbBundle {
  // 캐시 가드는 가장 최근 추가된 statement 로 검사 — HMR 로 남은 옛 번들(신규 필드 없음)을 재초기화.
  if (!globalForDb.__safetyMonitorDb?.updateFallCandidateState) {
    globalForDb.__safetyMonitorDb = init();
  }
  return globalForDb.__safetyMonitorDb;
}

// 단건 insert — sample 은 zod 검증 통과한 정상 값
export function persistSample(sample: VitalSample): void {
  const { insert } = getDb();
  insert.run({
    worker_id: sample.workerId,
    worker_name: sample.workerName ?? null,
    employee_id: sample.employeeId ?? null,
    job_title: sample.jobTitle ?? null,
    guardian_name: sample.guardianName ?? null,
    guardian_phone: sample.guardianPhone ?? null,
    ts: sample.ts,
    heart_rate: sample.heartRate ?? null,
    spo2: sample.spo2 ?? null,
    skin_temp_c: sample.skinTempC ?? null,
    ambient_temp_c: sample.ambientTempC ?? null,
    battery_pct: sample.batteryPct ?? null,
    manual_sos: sample.manualSos === true ? 1 : sample.manualSos === false ? 0 : null,
    fall_detected:
      sample.fallDetected === true ? 1 : sample.fallDetected === false ? 0 : null,
    // 낙상 ML 활성화 요소 — 후보 샘플에만 채워지는 sparse 필드(일반 폴은 전부 null).
    accel_magnitude_g: sample.accelMagnitudeG ?? null,
    motion_still_sec: sample.motionStillSec ?? null,
    fall_candidate: sample.fallCandidate === true ? 1 : null,
    freefall_preceded:
      sample.freefallPreceded === true ? 1 : sample.freefallPreceded === false ? 0 : null,
    peak_rotation_rad_s: sample.peakRotationRadS ?? null,
    fall_decision: sample.fallDecision ?? null,
    fall_candidate_id: sample.fallCandidateId ?? null,
    fall_update_phase: sample.fallUpdatePhase ?? null,
    fall_prompt_outcome: sample.fallPromptOutcome ?? null,
    fall_prompt_response_sec: sample.fallPromptResponseSec ?? null,
    hr_pre_mean_10s: sample.hrPreMean10s ?? null,
    hr_at_impact: sample.hrAtImpact ?? null,
    hr_post_mean_30s: sample.hrPostMean30s ?? null,
    hr_post_peak_30s: sample.hrPostPeak30s ?? null,
    hr_delta_mean: sample.hrDeltaMean ?? null,
    hr_delta_peak: sample.hrDeltaPeak ?? null,
    latitude: sample.latitude ?? null,
    longitude: sample.longitude ?? null,
    hrv_sdnn_ms: sample.hrvSdnnMs ?? null,
    resting_heart_rate: sample.restingHeartRate ?? null,
    active_energy_kcal: sample.activeEnergyKcal ?? null,
    steps: sample.steps ?? null,
    walking_heart_rate: sample.walkingHeartRate ?? null,
    flights_climbed: sample.flightsClimbed ?? null,
    respiratory_rate: sample.respiratoryRate ?? null,
    raw_json: JSON.stringify(sample),
  });
}

export function updateFallCandidateState(sample: VitalSample): boolean {
  const info = getDb().updateFallCandidateState.run({
    fall_candidate_id: sample.fallCandidateId,
    fall_update_phase: sample.fallUpdatePhase ?? null,
    fall_prompt_outcome: sample.fallPromptOutcome ?? null,
    fall_prompt_response_sec: sample.fallPromptResponseSec ?? null,
    hr_post_mean_30s: sample.hrPostMean30s ?? null,
    hr_post_peak_30s: sample.hrPostPeak30s ?? null,
    hr_delta_mean: sample.hrDeltaMean ?? null,
    hr_delta_peak: sample.hrDeltaPeak ?? null,
    raw_json: JSON.stringify(sample),
  });
  return info.changes > 0;
}

export function totalPersisted(): number {
  const row = getDb().count.get() as { n: number };
  return row.n;
}

// 관리자 내보내기 — 워커 목록 + 카운트 + 시계 범위
export function listAllWorkers(): WorkerSummary[] {
  return getDb().listWorkers.all() as WorkerSummary[];
}

// ── 안전관리비 실집행(③) — 워치 출역 worker-day 집계 ──────────────────────
// VitAlGuard 핵심: 워치 생체·GPS 수신을 '그 작업자가 그날 현장에 있었다'는 출역 물증으로 본다.
// 같은 작업자가 하루에 수백 샘플을 보내도 1 worker-day. 직책(job_title)으로 안전관리 인력을 식별한다.
export type WorkerDayAudit = {
  totalWorkerDays: number; // 누적 출역 worker-day(= 고유 (작업자, 날짜) 쌍)
  safetyWorkerDays: number; // 안전관리 직책(안전관리자/신호수/감시인 등) worker-day
  distinctWorkers: number; // 고유 작업자 수
  days: number; // 데이터가 있는 일수
  byDay: { day: string; workers: number; safetyWorkers: number }[]; // 일자별 투입 인원
};

// 안전관리 직책 판별(휴리스틱) — 직급/직책 텍스트에 안전·신호·감시·관리자 포함 시.
function isSafetyRole(jobTitle: string | null): boolean {
  return !!jobTitle && /안전|신호|감시|관리자|보건/.test(jobTitle);
}

export function auditWorkerDays(opts: { from: string; to: string }): WorkerDayAudit {
  const { db } = getDb();
  // (작업자, 날짜) 단위로 접어 worker-day 산출. 테스트/예약 워커(reserved_/test_ 등)는 제외.
  const rows = db
    .prepare(
      `SELECT substr(ts, 1, 10) AS day, worker_id, MAX(job_title) AS job_title
       FROM vital_samples
       WHERE ts >= @from AND ts <= @to
         AND worker_id NOT LIKE 'reserved\\_%' ESCAPE '\\'
         AND worker_id NOT LIKE 'test\\_%' ESCAPE '\\'
         AND worker_id NOT LIKE 'smoke\\_%' ESCAPE '\\'
         AND worker_id NOT LIKE 'infra\\_%' ESCAPE '\\'
       GROUP BY day, worker_id`,
    )
    .all({ from: opts.from, to: opts.to }) as { day: string; worker_id: string; job_title: string | null }[];

  const byDayMap = new Map<string, { workers: number; safetyWorkers: number }>();
  const workerSet = new Set<string>();
  let safetyWorkerDays = 0;
  for (const r of rows) {
    workerSet.add(r.worker_id);
    const safety = isSafetyRole(r.job_title);
    if (safety) safetyWorkerDays += 1;
    const d = byDayMap.get(r.day) ?? { workers: 0, safetyWorkers: 0 };
    d.workers += 1;
    if (safety) d.safetyWorkers += 1;
    byDayMap.set(r.day, d);
  }
  const byDay = [...byDayMap.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    totalWorkerDays: rows.length,
    safetyWorkerDays,
    distinctWorkers: workerSet.size,
    days: byDayMap.size,
    byDay,
  };
}

// 직급/직책 관제 웹 오버라이드 저장 — workerId 키. 빈 문자열은 오버라이드 해제(폰 발신값으로 복귀).
export function setWorkerJobTitle(workerId: string, jobTitle: string): void {
  getDb().upsertWorkerProfile.run({
    worker_id: workerId,
    job_title: jobTitle.trim() || null,
  });
}

// 직급 오버라이드 맵(workerId → 직급) — GET 응답에 동봉, 대시보드가 폰 발신값보다 우선 적용.
export function getWorkerProfiles(): Record<string, string> {
  const rows = getDb().listWorkerProfiles.all() as {
    worker_id: string;
    job_title: string;
  }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.worker_id] = r.job_title;
  return out;
}

// ── 알림 이력(SOS/낙상/생체 위험) ──────────────────────────────────────────
export type AlertType = "sos" | "fall" | "vital";

export type AlertRow = {
  id: number;
  worker_id: string;
  worker_name: string | null;
  type: AlertType;
  ts: string;
  created_at: string;
  ack_at: string | null;
  ack_by: string | null;
};

// SOS/낙상 발생 기록 — 중복(worker/type/ts)은 무시. addSample 에서 호출.
export function recordAlert(input: {
  workerId: string;
  workerName?: string | null;
  type: AlertType;
  ts: string;
}): void {
  getDb().insertAlert.run({
    worker_id: input.workerId,
    worker_name: input.workerName ?? null,
    type: input.type,
    ts: input.ts,
  });
}

export function listAlerts(limit = 100): AlertRow[] {
  return getDb().listAlerts.all({ limit }) as AlertRow[];
}

// 대응 확인 — 미대응 알림만 ack(대응자·시각 기록). 변경 행 수 반환.
export function ackAlert(id: number, ackBy: string): number {
  const info = getDb().ackAlert.run({ id, ack_by: ackBy });
  return info.changes;
}

// ── AED NFC 점검 기록 ──────────────────────────────────────────────────────
export type AedInspectionRow = {
  id: number;
  aed_id: string;
  loc: string | null;
  inspector: string;
  items: string | null; // JSON 배열 문자열(["battery","pad"], 빈 = 점검만)
  ts: string;
  source: string | null;
  created_at: string;
};

// 현장 NFC 태깅 점검 1건 기록. items 는 교체 항목(빈 배열 = 점검만).
export function recordAedInspection(input: {
  aedId: string;
  loc?: string | null;
  inspector: string;
  items: string[];
  ts: string;
  source?: string;
}): void {
  getDb().insertAedInspection.run({
    aed_id: input.aedId,
    loc: input.loc ?? null,
    inspector: input.inspector,
    items: JSON.stringify(input.items ?? []),
    ts: input.ts,
    source: input.source ?? "nfc",
  });
}

export function listAedInspections(limit = 500): AedInspectionRow[] {
  return getDb().listAedInspectionsStmt.all({ limit }) as AedInspectionRow[];
}

// ── 낙상 ML 데이터 수집(fall-ml) ──────────────────────────────────────────────
// 후보 1행 = 낙상 디텍터가 해소한 충격(양성 발화 + 음성 거부). 활성화 요소 전부 + 정답 라벨.
export type FallDatasetRow = {
  id: number;
  worker_id: string;
  worker_name: string | null;
  employee_id: string | null;
  ts: string;
  received_at: string;
  fall_detected: number | null; // 1 = 알고리즘 양성(발화)
  fall_candidate: number | null; // 1 = 신규 후보 샘플
  fall_candidate_id: string | null;
  fall_decision: string | null; // fall / rejected_no_corroboration / rejected_timeout
  fall_update_phase: string | null; // candidate / post_impact_followup / prompt_result
  fall_prompt_outcome: string | null; // pending / dismissed / manual_sos / auto_escalated
  fall_prompt_response_sec: number | null;
  accel_magnitude_g: number | null;
  motion_still_sec: number | null;
  freefall_preceded: number | null;
  peak_rotation_rad_s: number | null;
  hr_pre_mean_10s: number | null;
  hr_at_impact: number | null;
  hr_post_mean_30s: number | null;
  hr_post_peak_30s: number | null;
  hr_delta_mean: number | null;
  hr_delta_peak: number | null;
  heart_rate: number | null;
  spo2: number | null;
  battery_pct: number | null;
  latitude: number | null;
  longitude: number | null;
  ground_truth_label: string | null; // 관제자 수기 라벨(true_fall/false_positive/unsure)
  label_note: string | null;
  labeled_by: string | null;
  labeled_at: string | null;
};

export type FallStats = {
  total: number;
  positives: number;
  negatives: number;
  labeled: number;
};

// 라벨링용 — 최근 후보 목록(기간 무관, 최신 우선). UI 가 라벨 입력 동선에 사용.
export function listFallCandidates(limit = 200): FallDatasetRow[] {
  return getDb().listFallCandidates.all({ limit }) as FallDatasetRow[];
}

// 내보내기용 — 기간 필터로 후보 전체(학습 데이터셋).
export function exportFallDataset(opts: { from: string; to: string }): FallDatasetRow[] {
  return getDb().exportFallDataset.all(opts) as FallDatasetRow[];
}

// 수집 통계 — 총 후보 / 양성 / 음성 / 라벨됨.
export function fallCollectionStats(): FallStats {
  const row = getDb().fallStats.get() as {
    total: number | null;
    positives: number | null;
    negatives: number | null;
    labeled: number | null;
  };
  return {
    total: row.total ?? 0,
    positives: row.positives ?? 0,
    negatives: row.negatives ?? 0,
    labeled: row.labeled ?? 0,
  };
}

// 정답 라벨 저장 — sample_id 단일행 upsert. 빈 라벨은 미지정으로 저장(해제).
export function setFallLabel(input: {
  sampleId: number;
  label: string;
  note?: string | null;
  labeledBy: string;
}): void {
  getDb().setFallLabelStmt.run({
    sample_id: input.sampleId,
    label: input.label.trim() || null,
    note: input.note?.trim() || null,
    labeled_by: input.labeledBy,
  });
}

// 관리자 내보내기 — 기간 (+ 선택적 workerId) 필터로 모든 컬럼 조회
export function exportSamples(opts: {
  workerId?: string;
  from: string;
  to: string;
}): ExportRow[] {
  const { workerId, from, to } = opts;
  const stmt = workerId ? getDb().exportFiltered : getDb().exportAll;
  return stmt.all(
    workerId ? { worker_id: workerId, from, to } : { from, to },
  ) as ExportRow[];
}

// 현장 환경 snapshot 저장 — weather API fresh fetch 시 (캐시 hit 제외) 1회 기록
export function persistWeather(input: {
  lat: number;
  lon: number;
  workerCount?: number;
  weatherCode?: number;
  temperatureC?: number;
  apparentTempC?: number;
  humidityPct?: number;
  windKmh?: number;
  precipitationMm?: number;
  uvIndex?: number;
  pm10?: number;
  pm25?: number;
  sunrise?: string;
  sunset?: string;
}): void {
  getDb().insertWeather.run({
    lat: input.lat,
    lon: input.lon,
    worker_count: input.workerCount ?? null,
    weather_code: input.weatherCode ?? null,
    temperature_c: input.temperatureC ?? null,
    apparent_temp_c: input.apparentTempC ?? null,
    humidity_pct: input.humidityPct ?? null,
    wind_kmh: input.windKmh ?? null,
    precipitation_mm: input.precipitationMm ?? null,
    uv_index: input.uvIndex ?? null,
    pm10: input.pm10 ?? null,
    pm25: input.pm25 ?? null,
    sunrise: input.sunrise ?? null,
    sunset: input.sunset ?? null,
  });
}

export function exportWeatherLogs(opts: { from: string; to: string }): WeatherLogRow[] {
  return getDb().exportWeather.all(opts) as WeatherLogRow[];
}

function ymdInKst(date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function isoToYmdInKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return ymdInKst(d);
}

export function persistSiteInfoDaily(input: SiteInfoInput): SiteInfoRow {
  const db = getDb();
  const snapshotDate = ymdInKst();
  db.upsertSiteInfoDaily.run({
    snapshot_date: snapshotDate,
    company_name: input.companyName || null,
    site_name: input.siteName || null,
    construction_type: input.constructionType || null,
    address: input.address || null,
    start_date: input.startDate || null,
    completion_date: input.completionDate || null,
  });
  const row = db.getLatestSiteInfo.get() as SiteInfoRow | undefined;
  if (!row) throw new Error("site_info upsert 직후 조회 실패");
  return row;
}

export function getLatestSiteInfo(): SiteInfoRow | null {
  return (getDb().getLatestSiteInfo.get() as SiteInfoRow | undefined) ?? null;
}

export function exportSiteInfoLogs(opts: { from: string; to: string }): SiteInfoRow[] {
  return getDb().exportSiteInfo.all({
    from_date: isoToYmdInKst(opts.from),
    to_date: isoToYmdInKst(opts.to),
  }) as SiteInfoRow[];
}

// ── 주간 검증 보고서(④ 종합) — 시공사 제출 입력 + 제출 이력 ──────────────────
// 세금계산서·계좌이체·근로자 대장·사진 집계 = 시공사(피검증자) 제출분(검증자 수정 불가).
// 워치 실측(auditWorkerDays)과 서버에서 대조해 4중 교차검증 보고서를 만든다.
export type ReportInputs = {
  supplier: string | null;
  supplierBno: string | null;
  claimedHeadcount: number | null;
  invoiceTotal: number | null;
  paidTotal: number | null;
  ledgerHeadcount: number | null;
  photoCount: number | null;
};

export function getReportInputs(contractId: string): ReportInputs | null {
  const row = getDb()
    .db.prepare("SELECT * FROM weekly_report_inputs WHERE contract_id = ?")
    .get(contractId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    supplier: str(row.supplier),
    supplierBno: str(row.supplier_bno),
    claimedHeadcount: num(row.claimed_headcount),
    invoiceTotal: num(row.invoice_total),
    paidTotal: num(row.paid_total),
    ledgerHeadcount: num(row.ledger_headcount),
    photoCount: num(row.photo_count),
  };
}

export function upsertReportInputs(contractId: string, input: Partial<ReportInputs>): void {
  // 부분 병합 — 제출 폼이 일부 필드만 보내도 기존 값 보존(input 우선, 없으면 현재값).
  const cur = getReportInputs(contractId);
  getDb()
    .db.prepare(
      `INSERT INTO weekly_report_inputs
         (contract_id, supplier, supplier_bno, claimed_headcount, invoice_total, paid_total, ledger_headcount, photo_count, updated_at)
       VALUES
         (@contract_id, @supplier, @supplier_bno, @claimed_headcount, @invoice_total, @paid_total, @ledger_headcount, @photo_count, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT(contract_id) DO UPDATE SET
         supplier=excluded.supplier, supplier_bno=excluded.supplier_bno,
         claimed_headcount=excluded.claimed_headcount, invoice_total=excluded.invoice_total,
         paid_total=excluded.paid_total, ledger_headcount=excluded.ledger_headcount,
         photo_count=excluded.photo_count, updated_at=excluded.updated_at`,
    )
    .run({
      contract_id: contractId,
      supplier: input.supplier ?? cur?.supplier ?? null,
      supplier_bno: input.supplierBno ?? cur?.supplierBno ?? null,
      claimed_headcount: input.claimedHeadcount ?? cur?.claimedHeadcount ?? null,
      invoice_total: input.invoiceTotal ?? cur?.invoiceTotal ?? null,
      paid_total: input.paidTotal ?? cur?.paidTotal ?? null,
      ledger_headcount: input.ledgerHeadcount ?? cur?.ledgerHeadcount ?? null,
      photo_count: input.photoCount ?? cur?.photoCount ?? null,
    });
}

export type ReportSubmission = {
  id: number;
  contract_id: string;
  period: string | null;
  verdict: string | null;
  suspect_count: number | null;
  submitted_at: string;
};

export function recordReportSubmission(input: {
  contractId: string;
  period?: string;
  verdict?: string;
  suspectCount?: number;
}): ReportSubmission {
  const db = getDb().db;
  const info = db
    .prepare(
      `INSERT INTO weekly_report_submissions (contract_id, period, verdict, suspect_count)
       VALUES (@contract_id, @period, @verdict, @suspect_count)`,
    )
    .run({
      contract_id: input.contractId,
      period: input.period ?? null,
      verdict: input.verdict ?? null,
      suspect_count: input.suspectCount ?? null,
    });
  return db
    .prepare("SELECT * FROM weekly_report_submissions WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as ReportSubmission;
}

export function listReportSubmissions(contractId?: string, limit = 20): ReportSubmission[] {
  const db = getDb().db;
  if (contractId) {
    return db
      .prepare(
        "SELECT * FROM weekly_report_submissions WHERE contract_id = ? ORDER BY submitted_at DESC, id DESC LIMIT ?",
      )
      .all(contractId, limit) as ReportSubmission[];
  }
  return db
    .prepare("SELECT * FROM weekly_report_submissions ORDER BY submitted_at DESC, id DESC LIMIT ?")
    .all(limit) as ReportSubmission[];
}
