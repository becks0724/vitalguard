// PostgreSQL 영속 저장소 — vital sample 무한 축적 + CCTV·안전관리비 데이터 (산업재해 자료 제출 대비).
// 캠퍼스 Postgres(DATABASE_URL). better-sqlite3(동기) → pg(비동기) 전환 — GCP Cloud Run 대비.
// 모든 공개 함수는 async. 스키마는 첫 쿼리 시 멱등 생성(ensureSchema, CREATE TABLE IF NOT EXISTS).
import pg, { Pool } from "pg";
import type { VitalSample, CctvFallEvent } from "@safetymonitor/schemas";

// int8(BIGINT)·COUNT/SUM 결과를 문자열이 아니라 number 로 받는다(금액·집계가 string 으로 새는 것 방지).
// 원화 금액이 2^53 을 넘지 않으므로 parseInt 안전. (OID 20 = int8)
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

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
  __safetyMonitorPgPool?: Pool;
  __safetyMonitorSchemaReady?: Promise<void>;
};

// 단일 Pool(HMR/serverless 안전) — DATABASE_URL 의 sslmode=disable 를 pg 가 존중(캠퍼스 DB는 SSL 미지원).
function getPool(): Pool {
  if (!globalForDb.__safetyMonitorPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL 미설정 — apps/dashboard-web/.env.local 확인");
    }
    globalForDb.__safetyMonitorPgPool = new Pool({ connectionString, max: 8 });
  }
  return globalForDb.__safetyMonitorPgPool;
}

// Postgres 의 UTC ISO8601(밀리초) 문자열 — SQLite strftime('%Y-%m-%dT%H:%M:%fZ','now') 동일 포맷.
const NOW_ISO =
  `to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// 스키마 멱등 생성 — 첫 쿼리 시 1회(메모이즈). 실패 시 캐시 해제해 다음 호출이 재시도.
async function ensureSchema(): Promise<void> {
  if (!globalForDb.__safetyMonitorSchemaReady) {
    globalForDb.__safetyMonitorSchemaReady = initSchema().catch((e) => {
      globalForDb.__safetyMonitorSchemaReady = undefined;
      throw e;
    });
  }
  return globalForDb.__safetyMonitorSchemaReady;
}

async function initSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vital_samples (
      id SERIAL PRIMARY KEY,
      worker_id TEXT NOT NULL,
      worker_name TEXT,
      employee_id TEXT,
      job_title TEXT,
      guardian_name TEXT,
      guardian_phone TEXT,
      ts TEXT NOT NULL,
      heart_rate DOUBLE PRECISION,
      spo2 DOUBLE PRECISION,
      skin_temp_c DOUBLE PRECISION,
      ambient_temp_c DOUBLE PRECISION,
      battery_pct INTEGER,
      manual_sos INTEGER,
      fall_detected INTEGER,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      hrv_sdnn_ms DOUBLE PRECISION,
      resting_heart_rate DOUBLE PRECISION,
      active_energy_kcal DOUBLE PRECISION,
      steps INTEGER,
      walking_heart_rate DOUBLE PRECISION,
      flights_climbed INTEGER,
      respiratory_rate DOUBLE PRECISION,
      accel_magnitude_g DOUBLE PRECISION,
      motion_still_sec DOUBLE PRECISION,
      fall_candidate INTEGER,
      freefall_preceded INTEGER,
      peak_rotation_rad_s DOUBLE PRECISION,
      fall_decision TEXT,
      fall_candidate_id TEXT,
      fall_update_phase TEXT,
      fall_prompt_outcome TEXT,
      fall_prompt_response_sec DOUBLE PRECISION,
      hr_pre_mean_10s DOUBLE PRECISION,
      hr_at_impact DOUBLE PRECISION,
      hr_post_mean_30s DOUBLE PRECISION,
      hr_post_peak_30s DOUBLE PRECISION,
      hr_delta_mean DOUBLE PRECISION,
      hr_delta_peak DOUBLE PRECISION,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vs_worker_ts ON vital_samples(worker_id, ts);
    CREATE INDEX IF NOT EXISTS idx_vs_ts ON vital_samples(ts);

    CREATE TABLE IF NOT EXISTS weather_log (
      id SERIAL PRIMARY KEY,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      worker_count INTEGER,
      weather_code INTEGER,
      temperature_c DOUBLE PRECISION,
      apparent_temp_c DOUBLE PRECISION,
      humidity_pct DOUBLE PRECISION,
      wind_kmh DOUBLE PRECISION,
      precipitation_mm DOUBLE PRECISION,
      uv_index DOUBLE PRECISION,
      pm10 DOUBLE PRECISION,
      pm25 DOUBLE PRECISION,
      sunrise TEXT,
      sunset TEXT,
      recorded_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_wl_recorded ON weather_log(recorded_at);

    CREATE TABLE IF NOT EXISTS site_info_daily (
      id SERIAL PRIMARY KEY,
      snapshot_date TEXT NOT NULL UNIQUE,
      company_name TEXT,
      site_name TEXT,
      construction_type TEXT,
      address TEXT,
      start_date TEXT,
      completion_date TEXT,
      recorded_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_sid_snapshot ON site_info_daily(snapshot_date);

    -- SOS/낙상 알림 이력 — 발생/대응(ack) 시각·대응자 보존(산업재해 자료 "알림→대응 시각" 첨부).
    -- (worker_id, type, ts) UNIQUE 로 폰 재전송·backlog flush 시 중복 방지.
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      worker_id TEXT NOT NULL,
      worker_name TEXT,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      ack_at TEXT,
      ack_by TEXT,
      UNIQUE(worker_id, type, ts)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

    CREATE TABLE IF NOT EXISTS aed_inspections (
      id SERIAL PRIMARY KEY,
      aed_id TEXT NOT NULL,
      loc TEXT,
      inspector TEXT NOT NULL,
      items TEXT,
      ts TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_aed_insp ON aed_inspections(aed_id, ts);

    -- 주간 검증 보고서(④ 종합) — 시공사 제출 입력(세금계산서·계좌·대장·사진 집계).
    -- contract_id 단일행 upsert. 금액은 BIGINT(원화 큰 금액 대비).
    CREATE TABLE IF NOT EXISTS weekly_report_inputs (
      contract_id TEXT PRIMARY KEY,
      supplier TEXT,
      supplier_bno TEXT,
      claimed_headcount INTEGER,
      invoice_total BIGINT,
      paid_total BIGINT,
      ledger_headcount INTEGER,
      photo_count INTEGER,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 주간보고서 제출 이력 — 감독관 발송 시 1행(감사 추적).
    CREATE TABLE IF NOT EXISTS weekly_report_submissions (
      id SERIAL PRIMARY KEY,
      contract_id TEXT NOT NULL,
      period TEXT,
      verdict TEXT,
      suspect_count INTEGER,
      submitted_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_wrs_submitted ON weekly_report_submissions(submitted_at);

    -- 직급/직책 관제 웹 오버라이드 — workerId 키 단일행 upsert. 폰 발신값보다 우선.
    CREATE TABLE IF NOT EXISTS worker_profile (
      worker_id TEXT PRIMARY KEY,
      job_title TEXT,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 낙상 ML 정답 라벨 — 관제자가 각 후보 샘플에 실제 낙상 여부를 수기 라벨링(지도학습 정답).
    CREATE TABLE IF NOT EXISTS fall_labels (
      sample_id INTEGER PRIMARY KEY,
      label TEXT,
      note TEXT,
      labeled_by TEXT,
      labeled_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 영상(CCTV YOLOv8-pose) 낙상 이벤트 — 폴링 어댑터/푸시 수신분. worker_id 없음(카메라/존 단위).
    CREATE TABLE IF NOT EXISTS cctv_fall_events (
      id SERIAL PRIMARY KEY,
      camera_id TEXT NOT NULL,
      zone TEXT,
      ts TEXT NOT NULL,
      status TEXT NOT NULL,
      fallen_count INTEGER,
      total INTEGER,
      confidence DOUBLE PRECISION,
      source TEXT,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cfe_camera_ts ON cctv_fall_events(camera_id, ts);
    CREATE INDEX IF NOT EXISTS idx_cfe_ts ON cctv_fall_events(ts);

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT,
      company TEXT,
      phone TEXT,
      carrier TEXT,
      email TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT false,
      password_hash TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'password',
      google_sub TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      approved_at TEXT,
      approved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    -- 기존 설치 호환 — 회원가입 추가 항목(회사·연락처·이메일) + Google 연동 컬럼 보강(앱 레벨 필수 검증).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS company TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS carrier TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

    -- 클라우드 브릿지 — 앱 OCR 미디어(이미지/영상)를 날짜에 매칭해 캘린더에 표시.
    -- 스토리지 비종속: media_url(표시용)만 채워도 동작, provider/key는 Phase 2(오브젝트 스토리지) 보강.
    CREATE TABLE IF NOT EXISTS calendar_media (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      captured_at TEXT,
      media_type TEXT NOT NULL DEFAULT 'image',
      title TEXT,
      storage_provider TEXT,
      storage_key TEXT,
      media_url TEXT,
      thumbnail_url TEXT,
      ocr_text TEXT,
      description TEXT,
      site_id TEXT,
      uploader TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS title TEXT;
    CREATE INDEX IF NOT EXISTS idx_calmedia_date ON calendar_media(date_key);

    -- 미디어 댓글(작성자 이름·식별자·시각) — 관리자/작업자 코멘트 스레드.
    CREATE TABLE IF NOT EXISTS calendar_media_comment (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      author_name TEXT,
      author_id TEXT,
      author_role TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calmedia_comment_media ON calendar_media_comment(media_id);
  `);
}

// 쿼리 헬퍼 — 스키마 보장 후 실행. rows + rowCount 반환.
async function q<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> {
  await ensureSchema();
  const res = await getPool().query(text, params as unknown[] | undefined);
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}

// 동적 INSERT 빌더 — 컬럼 수 많은 insert(miscount 방지).
function buildInsert(
  table: string,
  cols: Record<string, unknown>,
  returning?: string,
): { text: string; values: unknown[] } {
  const keys = Object.keys(cols);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const text = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})${
    returning ? ` RETURNING ${returning}` : ""
  }`;
  return { text, values: keys.map((k) => cols[k]) };
}

// 단건 insert — sample 은 zod 검증 통과한 정상 값
export async function persistSample(sample: VitalSample): Promise<void> {
  const cols: Record<string, unknown> = {
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
    latitude: sample.latitude ?? null,
    longitude: sample.longitude ?? null,
    hrv_sdnn_ms: sample.hrvSdnnMs ?? null,
    resting_heart_rate: sample.restingHeartRate ?? null,
    active_energy_kcal: sample.activeEnergyKcal ?? null,
    steps: sample.steps ?? null,
    walking_heart_rate: sample.walkingHeartRate ?? null,
    flights_climbed: sample.flightsClimbed ?? null,
    respiratory_rate: sample.respiratoryRate ?? null,
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
    raw_json: JSON.stringify(sample),
  };
  const { text, values } = buildInsert("vital_samples", cols);
  await q(text, values);
}

export async function updateFallCandidateState(sample: VitalSample): Promise<boolean> {
  const { rowCount } = await q(
    `UPDATE vital_samples
       SET
         fall_update_phase = COALESCE($2, fall_update_phase),
         fall_prompt_outcome = COALESCE($3, fall_prompt_outcome),
         fall_prompt_response_sec = COALESCE($4, fall_prompt_response_sec),
         hr_post_mean_30s = COALESCE($5, hr_post_mean_30s),
         hr_post_peak_30s = COALESCE($6, hr_post_peak_30s),
         hr_delta_mean = COALESCE($7, hr_delta_mean),
         hr_delta_peak = COALESCE($8, hr_delta_peak),
         raw_json = CASE
           WHEN raw_json IS NULL OR raw_json = '' THEN $9
           ELSE raw_json
         END
       WHERE fall_candidate_id = $1 AND fall_candidate = 1`,
    [
      sample.fallCandidateId,
      sample.fallUpdatePhase ?? null,
      sample.fallPromptOutcome ?? null,
      sample.fallPromptResponseSec ?? null,
      sample.hrPostMean30s ?? null,
      sample.hrPostPeak30s ?? null,
      sample.hrDeltaMean ?? null,
      sample.hrDeltaPeak ?? null,
      JSON.stringify(sample),
    ],
  );
  return rowCount > 0;
}

export async function totalPersisted(): Promise<number> {
  const { rows } = await q<{ n: number }>("SELECT COUNT(*) AS n FROM vital_samples");
  return rows[0]?.n ?? 0;
}

// 관리자 내보내기 — 워커 목록 + 카운트 + 시계 범위
export async function listAllWorkers(): Promise<WorkerSummary[]> {
  const { rows } = await q<WorkerSummary>(`
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
  return rows;
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

export async function auditWorkerDays(opts: {
  from: string;
  to: string;
}): Promise<WorkerDayAudit> {
  // (작업자, 날짜) 단위로 접어 worker-day 산출. 테스트/예약 워커(reserved_/test_ 등)는 제외.
  const { rows } = await q<{ day: string; worker_id: string; job_title: string | null }>(
    `SELECT substr(ts, 1, 10) AS day, worker_id, MAX(job_title) AS job_title
       FROM vital_samples
       WHERE ts >= $1 AND ts <= $2
         AND worker_id !~ '^(reserved|test|smoke|infra)_'
       GROUP BY substr(ts, 1, 10), worker_id`,
    [opts.from, opts.to],
  );

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
export async function setWorkerJobTitle(workerId: string, jobTitle: string): Promise<void> {
  await q(
    `INSERT INTO worker_profile (worker_id, job_title, updated_at)
       VALUES ($1, $2, ${NOW_ISO})
       ON CONFLICT (worker_id) DO UPDATE SET
         job_title = excluded.job_title,
         updated_at = excluded.updated_at`,
    [workerId, jobTitle.trim() || null],
  );
}

// 직급 오버라이드 맵(workerId → 직급) — GET 응답에 동봉, 대시보드가 폰 발신값보다 우선 적용.
export async function getWorkerProfiles(): Promise<Record<string, string>> {
  const { rows } = await q<{ worker_id: string; job_title: string }>(
    "SELECT worker_id, job_title FROM worker_profile WHERE job_title IS NOT NULL AND job_title <> ''",
  );
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
export async function recordAlert(input: {
  workerId: string;
  workerName?: string | null;
  type: AlertType;
  ts: string;
}): Promise<void> {
  await q(
    `INSERT INTO alerts (worker_id, worker_name, type, ts)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (worker_id, type, ts) DO NOTHING`,
    [input.workerId, input.workerName ?? null, input.type, input.ts],
  );
}

export async function listAlerts(limit = 100): Promise<AlertRow[]> {
  const { rows } = await q<AlertRow>(
    "SELECT * FROM alerts ORDER BY ts DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
}

// 대응 확인 — 미대응 알림만 ack(대응자·시각 기록). 변경 행 수 반환.
export async function ackAlert(id: number, ackBy: string): Promise<number> {
  const { rowCount } = await q(
    `UPDATE alerts SET ack_at = ${NOW_ISO}, ack_by = $1 WHERE id = $2 AND ack_at IS NULL`,
    [ackBy, id],
  );
  return rowCount;
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
export async function recordAedInspection(input: {
  aedId: string;
  loc?: string | null;
  inspector: string;
  items: string[];
  ts: string;
  source?: string;
}): Promise<void> {
  await q(
    `INSERT INTO aed_inspections (aed_id, loc, inspector, items, ts, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.aedId,
      input.loc ?? null,
      input.inspector,
      JSON.stringify(input.items ?? []),
      input.ts,
      input.source ?? "nfc",
    ],
  );
}

export async function listAedInspections(limit = 500): Promise<AedInspectionRow[]> {
  const { rows } = await q<AedInspectionRow>(
    "SELECT * FROM aed_inspections ORDER BY ts DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
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

// 후보 필터 — 신규 후보(fall_candidate=1) + 레거시 양성(fall_detected=1, candidateId 없는 구버전 행).
const FALL_WHERE =
  "(v.fall_candidate = 1 OR (v.fall_detected = 1 AND v.fall_candidate_id IS NULL))";
// 충격G/정지초는 전용 컬럼이 비면 raw_json(jsonb) 백필.
const FALL_SELECT = `
  SELECT
    v.id, v.worker_id, v.worker_name, v.employee_id, v.ts, v.received_at,
    v.fall_detected, v.fall_candidate, v.fall_decision,
    COALESCE(v.accel_magnitude_g, (v.raw_json::jsonb ->> 'accelMagnitudeG')::double precision) AS accel_magnitude_g,
    COALESCE(v.motion_still_sec, (v.raw_json::jsonb ->> 'motionStillSec')::double precision)  AS motion_still_sec,
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

// 라벨링용 — 최근 후보 목록(기간 무관, 최신 우선). UI 가 라벨 입력 동선에 사용.
export async function listFallCandidates(limit = 200): Promise<FallDatasetRow[]> {
  const { rows } = await q<FallDatasetRow>(
    `${FALL_SELECT} WHERE ${FALL_WHERE} ORDER BY v.ts DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// 내보내기용 — 기간 필터로 후보 전체(학습 데이터셋).
export async function exportFallDataset(opts: {
  from: string;
  to: string;
}): Promise<FallDatasetRow[]> {
  const { rows } = await q<FallDatasetRow>(
    `${FALL_SELECT} WHERE ${FALL_WHERE} AND v.ts >= $1 AND v.ts <= $2 ORDER BY v.ts ASC`,
    [opts.from, opts.to],
  );
  return rows;
}

// 수집 통계 — 총 후보 / 양성 / 음성 / 라벨됨.
export async function fallCollectionStats(): Promise<FallStats> {
  const { rows } = await q<{
    total: number | null;
    positives: number | null;
    negatives: number | null;
    labeled: number | null;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN v.fall_decision = 'fall'
            OR (v.fall_detected = 1 AND v.fall_candidate_id IS NULL)
          THEN 1 ELSE 0
        END
      ) AS positives,
      SUM(
        CASE
          WHEN v.fall_candidate = 1 AND COALESCE(v.fall_decision, '') <> 'fall'
          THEN 1 ELSE 0
        END
      ) AS negatives,
      SUM(CASE WHEN fl.label IS NOT NULL AND fl.label <> '' THEN 1 ELSE 0 END) AS labeled
    FROM vital_samples v
    LEFT JOIN fall_labels fl ON fl.sample_id = v.id
    WHERE ${FALL_WHERE}
  `);
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    positives: row?.positives ?? 0,
    negatives: row?.negatives ?? 0,
    labeled: row?.labeled ?? 0,
  };
}

// 정답 라벨 저장 — sample_id 단일행 upsert. 빈 라벨은 미지정으로 저장(해제).
export async function setFallLabel(input: {
  sampleId: number;
  label: string;
  note?: string | null;
  labeledBy: string;
}): Promise<void> {
  await q(
    `INSERT INTO fall_labels (sample_id, label, note, labeled_by, labeled_at)
       VALUES ($1, $2, $3, $4, ${NOW_ISO})
       ON CONFLICT (sample_id) DO UPDATE SET
         label = excluded.label,
         note = excluded.note,
         labeled_by = excluded.labeled_by,
         labeled_at = excluded.labeled_at`,
    [input.sampleId, input.label.trim() || null, input.note?.trim() || null, input.labeledBy],
  );
}

// 관리자 내보내기 — 기간 (+ 선택적 workerId) 필터로 모든 컬럼 조회
export async function exportSamples(opts: {
  workerId?: string;
  from: string;
  to: string;
}): Promise<ExportRow[]> {
  const { workerId, from, to } = opts;
  if (workerId) {
    const { rows } = await q<ExportRow>(
      "SELECT * FROM vital_samples WHERE worker_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC",
      [workerId, from, to],
    );
    return rows;
  }
  const { rows } = await q<ExportRow>(
    "SELECT * FROM vital_samples WHERE ts >= $1 AND ts <= $2 ORDER BY ts ASC",
    [from, to],
  );
  return rows;
}

// 현장 환경 snapshot 저장 — weather API fresh fetch 시 (캐시 hit 제외) 1회 기록
export async function persistWeather(input: {
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
}): Promise<void> {
  const cols: Record<string, unknown> = {
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
  };
  const { text, values } = buildInsert("weather_log", cols);
  await q(text, values);
}

export async function exportWeatherLogs(opts: {
  from: string;
  to: string;
}): Promise<WeatherLogRow[]> {
  const { rows } = await q<WeatherLogRow>(
    "SELECT * FROM weather_log WHERE recorded_at >= $1 AND recorded_at <= $2 ORDER BY recorded_at ASC",
    [opts.from, opts.to],
  );
  return rows;
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

export async function persistSiteInfoDaily(input: SiteInfoInput): Promise<SiteInfoRow> {
  const snapshotDate = ymdInKst();
  const { rows } = await q<SiteInfoRow>(
    `INSERT INTO site_info_daily (
       snapshot_date, company_name, site_name, construction_type,
       address, start_date, completion_date, recorded_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, ${NOW_ISO})
     ON CONFLICT (snapshot_date) DO UPDATE SET
       company_name = excluded.company_name,
       site_name = excluded.site_name,
       construction_type = excluded.construction_type,
       address = excluded.address,
       start_date = excluded.start_date,
       completion_date = excluded.completion_date,
       recorded_at = excluded.recorded_at
     RETURNING *`,
    [
      snapshotDate,
      input.companyName || null,
      input.siteName || null,
      input.constructionType || null,
      input.address || null,
      input.startDate || null,
      input.completionDate || null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("site_info upsert 직후 조회 실패");
  return row;
}

export async function getLatestSiteInfo(): Promise<SiteInfoRow | null> {
  const { rows } = await q<SiteInfoRow>(
    "SELECT * FROM site_info_daily ORDER BY snapshot_date DESC, recorded_at DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

export async function exportSiteInfoLogs(opts: {
  from: string;
  to: string;
}): Promise<SiteInfoRow[]> {
  const { rows } = await q<SiteInfoRow>(
    "SELECT * FROM site_info_daily WHERE snapshot_date >= $1 AND snapshot_date <= $2 ORDER BY snapshot_date ASC",
    [isoToYmdInKst(opts.from), isoToYmdInKst(opts.to)],
  );
  return rows;
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

export async function getReportInputs(contractId: string): Promise<ReportInputs | null> {
  const { rows } = await q<Record<string, unknown>>(
    "SELECT * FROM weekly_report_inputs WHERE contract_id = $1",
    [contractId],
  );
  const row = rows[0];
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

export async function upsertReportInputs(
  contractId: string,
  input: Partial<ReportInputs>,
): Promise<void> {
  // 부분 병합 — 제출 폼이 일부 필드만 보내도 기존 값 보존(input 우선, 없으면 현재값).
  const cur = await getReportInputs(contractId);
  await q(
    `INSERT INTO weekly_report_inputs
       (contract_id, supplier, supplier_bno, claimed_headcount, invoice_total, paid_total, ledger_headcount, photo_count, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ${NOW_ISO})
     ON CONFLICT (contract_id) DO UPDATE SET
       supplier = excluded.supplier, supplier_bno = excluded.supplier_bno,
       claimed_headcount = excluded.claimed_headcount, invoice_total = excluded.invoice_total,
       paid_total = excluded.paid_total, ledger_headcount = excluded.ledger_headcount,
       photo_count = excluded.photo_count, updated_at = excluded.updated_at`,
    [
      contractId,
      input.supplier ?? cur?.supplier ?? null,
      input.supplierBno ?? cur?.supplierBno ?? null,
      input.claimedHeadcount ?? cur?.claimedHeadcount ?? null,
      input.invoiceTotal ?? cur?.invoiceTotal ?? null,
      input.paidTotal ?? cur?.paidTotal ?? null,
      input.ledgerHeadcount ?? cur?.ledgerHeadcount ?? null,
      input.photoCount ?? cur?.photoCount ?? null,
    ],
  );
}

export type ReportSubmission = {
  id: number;
  contract_id: string;
  period: string | null;
  verdict: string | null;
  suspect_count: number | null;
  submitted_at: string;
};

export async function recordReportSubmission(input: {
  contractId: string;
  period?: string;
  verdict?: string;
  suspectCount?: number;
}): Promise<ReportSubmission> {
  const { rows } = await q<ReportSubmission>(
    `INSERT INTO weekly_report_submissions (contract_id, period, verdict, suspect_count)
       VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.contractId, input.period ?? null, input.verdict ?? null, input.suspectCount ?? null],
  );
  return rows[0]!;
}

export async function listReportSubmissions(
  contractId?: string,
  limit = 20,
): Promise<ReportSubmission[]> {
  if (contractId) {
    const { rows } = await q<ReportSubmission>(
      "SELECT * FROM weekly_report_submissions WHERE contract_id = $1 ORDER BY submitted_at DESC, id DESC LIMIT $2",
      [contractId, limit],
    );
    return rows;
  }
  const { rows } = await q<ReportSubmission>(
    "SELECT * FROM weekly_report_submissions ORDER BY submitted_at DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
}

// ── 영상(CCTV) 낙상 이벤트 — 폴링 어댑터/푸시 수신분(fusion 영상 입력 + 감사 이력) ──────────
export type CctvFallEventRow = {
  id: number;
  camera_id: string;
  zone: string | null;
  ts: string;
  status: string;
  fallen_count: number | null;
  total: number | null;
  confidence: number | null;
  source: string | null;
  received_at: string;
  raw_json: string;
};

// 영상 이벤트 1건 적재 — event 는 zod 검증 통과한 정상 값.
export async function persistCctvEvent(event: CctvFallEvent): Promise<void> {
  await q(
    `INSERT INTO cctv_fall_events (camera_id, zone, ts, status, fallen_count, total, confidence, source, raw_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      event.cameraId,
      event.zone ?? null,
      event.ts,
      event.status,
      event.fallenCount ?? null,
      event.total ?? null,
      event.confidence ?? null,
      event.source ?? null,
      JSON.stringify(event),
    ],
  );
}

export async function recentCctvEvents(limit = 200): Promise<CctvFallEventRow[]> {
  const { rows } = await q<CctvFallEventRow>(
    "SELECT * FROM cctv_fall_events ORDER BY ts DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
}

// ── 관리자 계정(회원가입·승인제) ──────────────────────────────────────────────
export type UserRow = {
  id: number;
  username: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  carrier: string | null;
  email: string | null;
  email_verified: boolean;
  password_hash: string | null; // Google 전용 계정은 null
  auth_provider: string; // 'password' | 'google'
  google_sub: string | null;
  role: string;
  status: string; // pending | approved | rejected
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
};

// 신규 관리자 가입 — status=pending(기본값)으로 저장. username 중복 시 null(UNIQUE 위반 → 호출부 409).
export async function createUser(input: {
  username: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  carrier: string | null;
  email: string | null;
  emailVerified: boolean;
  passwordHash: string;
}): Promise<UserRow | null> {
  const { text, values } = buildInsert("users", {
    username: input.username,
    name: input.name,
    company: input.company,
    phone: input.phone,
    carrier: input.carrier,
    email: input.email,
    email_verified: input.emailVerified,
    password_hash: input.passwordHash,
  });
  const { rows } = await q<UserRow>(
    `${text} ON CONFLICT (username) DO NOTHING RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await q<UserRow>("SELECT * FROM users WHERE username = $1", [
    username,
  ]);
  return rows[0] ?? null;
}

// 사용자 관리 목록(owner UI) — 대기 → 승인 → 거절 순, 최신 가입 우선.
export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await q<UserRow>(
    `SELECT * FROM users
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
              created_at DESC`,
  );
  return rows;
}

export async function setUserStatus(
  id: number,
  status: "approved" | "rejected",
  approvedBy: string,
): Promise<UserRow | null> {
  const { rows } = await q<UserRow>(
    `UPDATE users SET status = $1, approved_at = ${NOW_ISO}, approved_by = $2
     WHERE id = $3 RETURNING *`,
    [status, approvedBy, id],
  );
  return rows[0] ?? null;
}

// 회원 본인 정보 수정 — 로그인한 사용자가 자기 가입 정보를 갱신(username 기준). passwordHash 는 제공 시에만 변경.
export async function updateUserProfile(
  username: string,
  input: {
    name: string | null;
    company: string | null;
    phone: string | null;
    carrier: string | null;
    passwordHash?: string;
  },
): Promise<UserRow | null> {
  if (input.passwordHash !== undefined) {
    const { rows } = await q<UserRow>(
      `UPDATE users SET name = $1, company = $2, phone = $3, carrier = $4, password_hash = $5
       WHERE username = $6 RETURNING *`,
      [input.name, input.company, input.phone, input.carrier, input.passwordHash, username],
    );
    return rows[0] ?? null;
  }
  const { rows } = await q<UserRow>(
    `UPDATE users SET name = $1, company = $2, phone = $3, carrier = $4
     WHERE username = $5 RETURNING *`,
    [input.name, input.company, input.phone, input.carrier, username],
  );
  return rows[0] ?? null;
}

// 사용자 탈퇴(하드 삭제) — owner UI 에서 계정 제거. 삭제된 행이 있으면 true.
export async function deleteUser(id: number): Promise<boolean> {
  const { rows } = await q<{ id: number }>(
    "DELETE FROM users WHERE id = $1 RETURNING id",
    [id],
  );
  return rows.length > 0;
}

// Google 연동 계정 조회(google_sub 기준).
export async function findUserByGoogleSub(sub: string): Promise<UserRow | null> {
  const { rows } = await q<UserRow>("SELECT * FROM users WHERE google_sub = $1", [sub]);
  return rows[0] ?? null;
}

// Google 가입 — 추가정보(회사·연락처) 입력 후 호출. username=email, provider=google, status=pending.
export async function createGoogleUser(input: {
  googleSub: string;
  email: string;
  name: string | null;
  company: string;
  phone: string;
}): Promise<UserRow | null> {
  const { text, values } = buildInsert("users", {
    username: input.email,
    name: input.name,
    company: input.company,
    phone: input.phone,
    email: input.email,
    auth_provider: "google",
    google_sub: input.googleSub,
  });
  const { rows } = await q<UserRow>(
    `${text} ON CONFLICT DO NOTHING RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

// ─── 클라우드 브릿지: 캘린더 미디어(앱 OCR 이미지/영상) ───
export type CalendarMediaRow = {
  id: string;
  date_key: string;
  captured_at: string | null;
  media_type: string;
  title: string | null;
  storage_provider: string | null;
  storage_key: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  ocr_text: string | null;
  description: string | null;
  site_id: string | null;
  uploader: string | null;
  created_at: string;
};

export type CalendarMediaCommentRow = {
  id: string;
  media_id: string;
  author_name: string | null;
  author_id: string | null;
  author_role: string | null;
  body: string;
  created_at: string;
  updated_at: string | null;
};

// 날짜 범위(YYYY-MM-DD, 포함)로 미디어 조회 — 캘린더 월 단위 표시용.
export async function listCalendarMedia(
  fromKey: string,
  toKey: string,
): Promise<CalendarMediaRow[]> {
  const { rows } = await q<CalendarMediaRow>(
    `SELECT * FROM calendar_media
       WHERE date_key >= $1 AND date_key <= $2
       ORDER BY date_key ASC, captured_at ASC NULLS LAST, created_at ASC`,
    [fromKey, toKey],
  );
  return rows;
}

export async function insertCalendarMedia(input: {
  id: string;
  dateKey: string;
  capturedAt?: string | null;
  mediaType?: string;
  title?: string | null;
  storageProvider?: string | null;
  storageKey?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  ocrText?: string | null;
  description?: string | null;
  siteId?: string | null;
  uploader?: string | null;
}): Promise<CalendarMediaRow> {
  const { text, values } = buildInsert(
    "calendar_media",
    {
      id: input.id,
      date_key: input.dateKey,
      captured_at: input.capturedAt ?? null,
      media_type: input.mediaType ?? "image",
      title: input.title ?? null,
      storage_provider: input.storageProvider ?? null,
      storage_key: input.storageKey ?? null,
      media_url: input.mediaUrl ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      ocr_text: input.ocrText ?? null,
      description: input.description ?? null,
      site_id: input.siteId ?? null,
      uploader: input.uploader ?? null,
    },
    "*",
  );
  const { rows } = await q<CalendarMediaRow>(text, values);
  return rows[0]!;
}

// 여러 미디어의 댓글을 한 번에 — GET 응답에 묶어서 내려줌.
export async function listCommentsForMedia(
  mediaIds: string[],
): Promise<CalendarMediaCommentRow[]> {
  if (mediaIds.length === 0) return [];
  const { rows } = await q<CalendarMediaCommentRow>(
    `SELECT * FROM calendar_media_comment
       WHERE media_id = ANY($1)
       ORDER BY created_at ASC`,
    [mediaIds],
  );
  return rows;
}

export async function insertCalendarMediaComment(input: {
  id: string;
  mediaId: string;
  authorName?: string | null;
  authorId?: string | null;
  authorRole?: string | null;
  body: string;
}): Promise<CalendarMediaCommentRow> {
  const { text, values } = buildInsert(
    "calendar_media_comment",
    {
      id: input.id,
      media_id: input.mediaId,
      author_name: input.authorName ?? null,
      author_id: input.authorId ?? null,
      author_role: input.authorRole ?? null,
      body: input.body,
    },
    "*",
  );
  const { rows } = await q<CalendarMediaCommentRow>(text, values);
  return rows[0]!;
}

export async function updateCalendarMediaComment(
  id: string,
  body: string,
): Promise<boolean> {
  const { rowCount } = await q(
    `UPDATE calendar_media_comment SET body = $2, updated_at = ${NOW_ISO} WHERE id = $1`,
    [id, body],
  );
  return rowCount > 0;
}

export async function deleteCalendarMediaComment(id: string): Promise<boolean> {
  const { rowCount } = await q(
    "DELETE FROM calendar_media_comment WHERE id = $1",
    [id],
  );
  return rowCount > 0;
}

// 관리자 설명 메모 수정.
export async function updateCalendarMediaDescription(
  id: string,
  description: string,
): Promise<boolean> {
  const { rowCount } = await q(
    "UPDATE calendar_media SET description = $2 WHERE id = $1",
    [id, description],
  );
  return rowCount > 0;
}

export async function deleteCalendarMedia(id: string): Promise<boolean> {
  const { rowCount } = await q("DELETE FROM calendar_media WHERE id = $1", [id]);
  return rowCount > 0;
}
