// PostgreSQL 영속 저장소 — vital sample 무한 축적 + CCTV·안전관리비 데이터 (산업재해 자료 제출 대비).
// 캠퍼스 Postgres(DATABASE_URL). better-sqlite3(동기) → pg(비동기) 전환 — GCP Cloud Run 대비.
// 모든 공개 함수는 async. 스키마는 첫 쿼리 시 멱등 생성(ensureSchema, CREATE TABLE IF NOT EXISTS).
import pg, { Pool } from "pg";
import { VitalSampleSchema, type VitalDataOrigin, type VitalSample, type CctvFallEvent } from "@safetymonitor/schemas";

import {
  calendarEventScopeClause,
  type CalendarEventScope,
} from "./calendar-event-scope";
import { commentScopeClause, type CommentScope } from "./comment-scope";
import { defaultEmployeeId } from "./employee-id";
import { mediaScopeClause, type MediaScope } from "./media-scope";
import { notifyAlertTelegram } from "./telegram";

export type { CalendarEventScope, CommentScope, MediaScope };

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
  wind_gust_kmh: number | null;
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

// 모바일 단말의 갱신 토큰은 평문을 저장하지 않는다. 이 테이블은 사용자별 기기 세션 폐기와
// 회전(refresh-token rotation)을 위해서만 사용하며, PostgreSQL 접속정보는 여전히 서버에만 있다.
export type MobileAppSessionRow = {
  session_id: string;
  username: string;
  role: string;
  name: string | null;
  worker_id: string | null;
  refresh_token_hash: string;
  device_name: string | null;
  platform: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
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
    const pool = new Pool({
      connectionString,
      max: 8,
      connectionTimeoutMillis: 5000, // 커넥션 획득 대기 상한(기본 0=무한 대기 방지)
      idleTimeoutMillis: 30000, // 유휴 커넥션 30초 후 정리(끊긴 커넥션 오래 안 붙잡게)
      statement_timeout: 30000, // 세션 statement_timeout(ms) — 느린 쿼리의 풀 점유 방지
    });
    // 유휴 커넥션 error 를 잡아 프로세스 크래시 방지(핸들러 부재 시 미처리 'error'로 전체 다운).
    pool.on("error", (err) => {
      console.error("[db] PG 풀 유휴 커넥션 오류", err);
    });
    globalForDb.__safetyMonitorPgPool = pool;
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
    CREATE INDEX IF NOT EXISTS idx_vs_ts_id ON vital_samples(ts, id);
    -- 멱등 적재 키 — (worker_id, ts) UNIQUE 로 재전송·backlog flush 중복 방지(alerts 와 동일 패턴, 감사 BE-IDEM-01).
    -- 라이브 DB 엔 운영 마이그레이션으로 이미 존재(uq_vs_worker_ts, 2026-06-29 수동 생성·중복 0건 실측) → 즉시 skip.
    -- 빈/신규 환경만 여기서 보장. 대량 중복 dedup 은 initSchema 가 아니라 운영 마이그레이션에서 수행(라이브 락 방지).
    CREATE UNIQUE INDEX IF NOT EXISTS uq_vs_worker_ts ON vital_samples(worker_id, ts);
    -- 수신 출처는 원본 실측 테이블에 명시한다. 과거 행은 출처를 추정하지 않고 legacy 로 보존한다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS data_origin TEXT NOT NULL DEFAULT 'legacy_unclassified_vitalguard';
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS source TEXT;
    -- 값의 '측정 시각' — ts(전송 시각)와 다르다. 이게 없으면 "5초마다 실측"과
    -- "직전 값을 5초마다 복사"를 서버가 구분할 방법이 없다(2026-07-30 조사).
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS heart_rate_measured_at TEXT;
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS spo2_measured_at TEXT;
    -- 백그라운드 하트비트 = 새 심박 없이 최신 스냅샷을 재전송한 행(심박이 복사본).
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS heartbeat INTEGER;
    -- 착용 기기 — 혈중산소 센서 유무(Series 6+/Ultra)를 가려 SpO2 결측 원인을 확정한다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS watch_device_model TEXT;
    CREATE INDEX IF NOT EXISTS idx_vs_data_origin_ts ON vital_samples(data_origin, ts DESC);

    -- 목업은 vital_samples 에 절대 적재하지 않는다. iPhone·Watch 목업도 각각 명시해 혼합 집계를 막는다.
    CREATE TABLE IF NOT EXISTS data_mockup (
      id SERIAL PRIMARY KEY,
      data_origin TEXT NOT NULL CHECK (data_origin IN ('mockup_ios_data_vitalguard', 'mockup_watchos_data_vitalguard')),
      source TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      worker_name TEXT,
      employee_id TEXT,
      ts TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_data_mockup_origin_ts ON data_mockup(data_origin, ts DESC);

    -- TablePlus 무료 버전에서도 한 번의 조회로 출처별 건수·워커·최신 시각을 검증할 수 있는 읽기 전용 요약.
    CREATE OR REPLACE VIEW vital_data_origin_summary AS
      SELECT data_origin, COUNT(*)::bigint AS sample_count, COUNT(DISTINCT worker_id)::bigint AS worker_count, MAX(ts) AS latest_ts
      FROM vital_samples
      GROUP BY data_origin
      UNION ALL
      SELECT data_origin, COUNT(*)::bigint AS sample_count, COUNT(DISTINCT worker_id)::bigint AS worker_count, MAX(ts) AS latest_ts
      FROM data_mockup
      GROUP BY data_origin;

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
      wind_gust_kmh DOUBLE PRECISION,
      precipitation_mm DOUBLE PRECISION,
      uv_index DOUBLE PRECISION,
      pm10 DOUBLE PRECISION,
      pm25 DOUBLE PRECISION,
      sunrise TEXT,
      sunset TEXT,
      recorded_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_wl_recorded ON weather_log(recorded_at);
    -- 기존 설치 호환 — 순간풍속(돌풍) 컬럼 보강(크레인/고소 중지 판정 = 순간풍속 기준).
    ALTER TABLE weather_log ADD COLUMN IF NOT EXISTS wind_gust_kmh DOUBLE PRECISION;

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

    -- 현장 좌표 일별 캐시 — 작업자 GPS 평균(현장 좌표)을 하루 1행 보관.
    -- 하루 최초 라이브 좌표를 자동 캡처 → 연결 끊겨도 이 좌표로 기상 유지, 수동 새로고침 시 재캡처.
    CREATE TABLE IF NOT EXISTS site_coord_daily (
      id SERIAL PRIMARY KEY,
      snapshot_date TEXT NOT NULL UNIQUE,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      worker_count INTEGER,
      recorded_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_scd_snapshot ON site_coord_daily(snapshot_date);

    -- 현장 기상 일별 대표 snapshot — 하루 1행 upsert(당일 마지막 fresh fetch 값). weather_log(상세 이력)와 별도 보관.
    CREATE TABLE IF NOT EXISTS weather_daily (
      id SERIAL PRIMARY KEY,
      snapshot_date TEXT NOT NULL UNIQUE,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      worker_count INTEGER,
      weather_code INTEGER,
      temperature_c DOUBLE PRECISION,
      apparent_temp_c DOUBLE PRECISION,
      humidity_pct DOUBLE PRECISION,
      wind_kmh DOUBLE PRECISION,
      wind_gust_kmh DOUBLE PRECISION,
      precipitation_mm DOUBLE PRECISION,
      uv_index DOUBLE PRECISION,
      pm10 DOUBLE PRECISION,
      pm25 DOUBLE PRECISION,
      sunrise TEXT,
      sunset TEXT,
      recorded_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_wd_snapshot ON weather_daily(snapshot_date);
    -- 기존 설치 호환 — 순간풍속(돌풍) 컬럼 보강(구 행 null = 평균풍속 폴백 판정).
    ALTER TABLE weather_daily ADD COLUMN IF NOT EXISTS wind_gust_kmh DOUBLE PRECISION;

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

    -- 현장환경(날씨/특보) 자동 텔레그램 알림 억제 상태 — item_key 별 마지막 발송 severity.
    -- 악화 전이(정상→주의/위험)일 때만 재발송, 정상 복귀 시 리셋. 사람이 누른 ack(env_alert_ack)와 별개.
    CREATE TABLE IF NOT EXISTS env_alert_state (
      item_key TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 위험구역(진입 금지 존) — 지도에서 관리자가 등록(중심+반경), 작업자 진입 시 경보.
    CREATE TABLE IF NOT EXISTS danger_zone (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lon DOUBLE PRECISION NOT NULL,
      radius_m INTEGER NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

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

    -- AED(제세동기 알림) 장비 관제 웹 오버라이드 — aed_id 키. 설치위치·관리책임자·비고를 레지스트리 기본값보다 우선.
    CREATE TABLE IF NOT EXISTS aed_config (
      aed_id TEXT PRIMARY KEY,
      loc TEXT,
      manager TEXT,
      product TEXT,
      note TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    ALTER TABLE aed_config ADD COLUMN IF NOT EXISTS product TEXT;

    -- 가스 누출 감지기 관제 웹 오버라이드 — row_key(실기기 gaspod 가스 행·데모 행) 키. 설치위치·가스종류 라벨을 기본값보다 우선.
    CREATE TABLE IF NOT EXISTS gaspod_config (
      row_key TEXT PRIMARY KEY,
      loc TEXT,
      gas TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 가스포드(ESP32) 텔레메트리 영속 — 실기기 실시간 수집을 DB에 누적 저장(메모리 링버퍼 대체·인스턴스 재시작/멀티인스턴스 무관).
    CREATE TABLE IF NOT EXISTS gaspod_telemetry (
      id SERIAL PRIMARY KEY,
      device_id TEXT NOT NULL,
      o2 REAL,
      temp REAL,
      humidity REAL,
      pressure REAL,
      mq7_raw INTEGER,
      mq136_raw INTEGER,
      vbat REAL,
      state TEXT NOT NULL,
      acked BOOLEAN NOT NULL DEFAULT FALSE,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_gaspod_recv ON gaspod_telemetry(received_at);

    -- 세금계산서 수신 — 시공사 경리시스템(스마트경리 데모)/전자세금계산서 연동이 쏘는 매입 계산서.
    -- ④증액 검증의 청구 내역 데이터원. 승인번호 UNIQUE = 재전송 멱등(중복 수신 방지).
    CREATE TABLE IF NOT EXISTS tax_invoice (
      id SERIAL PRIMARY KEY,
      site_id TEXT NOT NULL,
      approval_no TEXT NOT NULL UNIQUE,
      write_date TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      supplier_bno TEXT NOT NULL,
      buyer_name TEXT NOT NULL,
      buyer_bno TEXT NOT NULL,
      supply_amount BIGINT NOT NULL,
      tax_amount BIGINT NOT NULL,
      items_json TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_taxinv_site ON tax_invoice(site_id);

    -- 산업안전보건관리비 사용계획서 수신 — 경리시스템(스마트경리 데모)이 제출하는 현장별 계획.
    -- ④증액 검증의 '계획액 대비 증액 청구' 판정 기준. 현장당 1건 upsert(재제출 = 갱신).
    CREATE TABLE IF NOT EXISTS use_plan (
      site_id TEXT PRIMARY KEY,
      target_amount BIGINT NOT NULL,
      appropriated BIGINT NOT NULL,
      items_json TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- AED 실 연동 장비 등록 — 관리자가 등록한 실제 장비(RPi가 aed_id로 알림 레벨 폴링). 데모 프리셋(AED_DEVICES)과 별개.
    -- 이 테이블 행만 '실 연동', 코드 프리셋은 '데모(발표용)'. 단말 배터리·교환주기는 등록 입력값.
    CREATE TABLE IF NOT EXISTS aed_registered_device (
      aed_id TEXT PRIMARY KEY,
      loc TEXT NOT NULL,
      product TEXT,
      manager TEXT NOT NULL,
      dev_batt INTEGER NOT NULL DEFAULT 100,
      batt_cycle_months INTEGER NOT NULL DEFAULT 48,
      pad_cycle_months INTEGER NOT NULL DEFAULT 24,
      last_swap_ts TEXT,
      registered_by TEXT,
      registered_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 작업자 ID 병합 별칭 — secondary(별칭) → primary(주 ID). 수신 시 정규화해 같은 사람을 1카드로 합친다.
    CREATE TABLE IF NOT EXISTS worker_alias (
      secondary_worker_id TEXT PRIMARY KEY,
      primary_worker_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

    -- 현장 과업지시서(배치 어시스턴트) — PDF 업로드 전용(텍스트 직접 입력은 위변조 우려로 미수용).
    -- 원본 파일명·SHA-256 을 함께 기록해 감사 시 업로드 원본과 대조 가능. 최신 1행이 유효본.
    CREATE TABLE IF NOT EXISTS site_task_doc (
      id SERIAL PRIMARY KEY,
      task_text TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    ALTER TABLE site_task_doc ADD COLUMN IF NOT EXISTS src_name TEXT;
    ALTER TABLE site_task_doc ADD COLUMN IF NOT EXISTS src_sha256 TEXT;

    -- 현장 환경 경보 확인/조치 기록 — 관리자가 환경 경보 팝업을 '확인'/'조치완료' 할 때 1건 적재(감사 이력).
    CREATE TABLE IF NOT EXISTS env_alert_ack (
      id SERIAL PRIMARY KEY,
      item_key TEXT NOT NULL,
      item_label TEXT NOT NULL,
      value TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      ack_by TEXT NOT NULL,
      ack_at TEXT NOT NULL DEFAULT (${NOW_ISO})
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

    -- 로그인 시도 잠금 — 인스턴스 간 공유. 잠금 카운터가 프로세스 메모리에만 있으면 Cloud Run 이
    -- 1~4 인스턴스로 뜨는 동안 인스턴스마다 따로 세어 실효 한도가 인스턴스 수만큼 늘어난다.
    -- 다른 테이블과 달리 ts 를 TEXT 가 아닌 timestamptz 로 둔다 — 잠금 판정이 '남은 시간' 계산이라
    -- 문자열 비교로는 못 하고 interval 연산이 필요하다.
    CREATE TABLE IF NOT EXISTS login_attempt (
      lock_key TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

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
    -- 부서/직책/사원번호(본인 편집, 표시용) + 관리자메뉴 접근 권한(owner만 부여, 자가취득 불가).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT;
    -- 사번 백필 — 이 컬럼이 비어 있으면 사진·생체의 worker_id 와 대조할 값이 없어
    -- **본인이 올린 사진도 못 지운다**(2026-07-27 제보, 9명 중 8명이 null 이었다).
    -- 값은 앱이 이미 쓰고 있는 규칙과 동일한 'EMP-'||username 이라 기존 데이터와 즉시 맞물린다.
    -- 이미 값이 있는 계정은 건드리지 않는다 — 실제 사번 우선.
    -- 빈 문자열도 함께 잡는다: NULL 만 보면 공백 값이 남아 로그인 토큰의 workerId 가 빈 문자열로
    -- 발급되고, 수집 라우트가 그것을 falsy 로 잡아 401 을 낸다.
    -- 앱은 토큰을 정상 전송하는데도 거부되어 원인이 드러나지 않는다(2026-07-29).
    -- 멱등이라 재기동마다 돌아도 두 번째부터는 0행이다.
    UPDATE users SET employee_id = 'EMP-' || username WHERE employee_id IS NULL OR trim(employee_id) = '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_access BOOLEAN NOT NULL DEFAULT false;
    -- 보호자 연락처(본인 편집) — SOS/낙상 알람에서 사번(employee_id) 매칭으로 본인 보호자 표출.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
    -- 생년월일(가입 필수) — 비밀번호에 생년월일을 못 넣게 막는 판정 입력이기도 하다.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date TEXT;
    -- 가입 유형 — VitAlGuard 소속 관리자('vitalguard') vs 회원사 관리자('member').
    -- ★ role 을 늘리지 않고 이 컬럼으로 나눈다. 배포된 iOS 앱이 role 을 owner/admin/worker 셋만
    -- 해석해서(modeForServerRole), 새 role 값을 주면 앱 로그인이 실패한다. 기존 행은 'member' 가 되고
    -- VitAlGuard 소속은 별도 백필로 올린다.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS org_type TEXT NOT NULL DEFAULT 'member';

    -- 모바일 refresh token 세션. 토큰 원문은 Keychain/Android Keystore와 요청 본문에만 존재하고
    -- DB에는 SHA-256 해시만 보관한다. 로그아웃·사용자 비활성화 시 해당 행을 폐기할 수 있다.
    CREATE TABLE IF NOT EXISTS mobile_app_session (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT,
      worker_id TEXT,
      refresh_token_hash TEXT UNIQUE NOT NULL,
      device_name TEXT,
      platform TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_app_session_user ON mobile_app_session(username);
    CREATE INDEX IF NOT EXISTS idx_mobile_app_session_active ON mobile_app_session(expires_at) WHERE revoked_at IS NULL;
    ALTER TABLE mobile_app_session ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker';
    ALTER TABLE mobile_app_session ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE mobile_app_session ADD COLUMN IF NOT EXISTS worker_id TEXT;

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
      worker_id TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      road_address TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS worker_id TEXT;
    ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS road_address TEXT;
    CREATE INDEX IF NOT EXISTS idx_calmedia_date ON calendar_media(date_key);

    -- 미디어 댓글(작성자 이름·식별자·시각) — 관리자/작업자 코멘트 스레드.
    CREATE TABLE IF NOT EXISTS calendar_media_comment (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      author_name TEXT,
      author_id TEXT,
      author_role TEXT,
      author_title TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT
    );
    ALTER TABLE calendar_media_comment ADD COLUMN IF NOT EXISTS author_title TEXT;
    CREATE INDEX IF NOT EXISTS idx_calmedia_comment_media ON calendar_media_comment(media_id);

    -- 일정 캘린더 일정/라벨 — 브라우저 localStorage 영속을 서버로 승격(관리자 간 공유·기기 무관).
    -- date_key/start_time/end_time 은 클라(KST) 기준 문자열 — 서버는 저장·범위비교만.
    CREATE TABLE IF NOT EXISTS calendar_event (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      title TEXT NOT NULL,
      label_id TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      updated_at TEXT
    );
    ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS hazard_type TEXT;
    CREATE INDEX IF NOT EXISTS idx_calevent_date ON calendar_event(date_key);

    CREATE TABLE IF NOT EXISTS calendar_label (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    -- 작업자 모니터링 슬롯 등록(공유 관제 1벌) — 단일행(id=1)에 슬롯 배열 JSON 보존.
    -- 기존 브라우저 localStorage 영속을 서버로 승격: 어느 기기·브라우저로 접속해도 등록 유지.
    CREATE TABLE IF NOT EXISTS monitor_slot_config (
      id INTEGER PRIMARY KEY,
      slots TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
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
  if (
    sample.dataOrigin !== "ios_data_vitalguard" &&
    sample.dataOrigin !== "watchos_data_vitalguard"
  ) {
    throw new Error("실데이터 테이블에는 iPhone 또는 Watch 실측 출처만 저장할 수 있습니다");
  }
  const cols: Record<string, unknown> = {
    data_origin: sample.dataOrigin,
    source: sample.source ?? null,
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
    // 확정 낙상은 워치가 fallDecision='fall' 후보행으로 보냄(fallDetected 미설정 — 폰 Health API 는
    // 낙상 미노출). 코드 전반이 'fall_decision=fall OR fall_detected=1'을 양성 표준으로 쓰므로
    // fallDecision='fall' 도 fall_detected=1 로 파생해 일관화. 둘 다 없으면 null(평상 폴) 보존.
    fall_detected:
      sample.fallDetected === true || sample.fallDecision === "fall"
        ? 1
        : sample.fallDetected === false
          ? 0
          : null,
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
    // 측정 시각·복사 표식 — ts 하나로는 실측인지 직전 값 복사인지 못 가린다.
    heart_rate_measured_at: sample.heartRateMeasuredAt ?? null,
    spo2_measured_at: sample.spo2MeasuredAt ?? null,
    heartbeat: sample.heartbeat === true ? 1 : sample.heartbeat === false ? 0 : null,
    watch_device_model: sample.watchDeviceModel ?? null,
    raw_json: JSON.stringify(sample),
  };
  const { text, values } = buildInsert("vital_samples", cols);
  // 멱등 적재 — 같은 (worker_id, ts) 재전송/backlog flush 는 중복 무시(감사 BE-IDEM-01).
  // 종전엔 유니크 위반이 23505 예외로 터져 호출측 catch 에서 실제 장애와 같은 신호가 됐다(DB-POOL-02).
  await q(text + " ON CONFLICT (worker_id, ts) DO NOTHING", values);
}

// 목업은 실데이터와 구조적으로 분리된 data_mockup 으로만 저장한다.
export async function persistDataMockup(sample: VitalSample): Promise<void> {
  if (
    sample.dataOrigin !== "mockup_ios_data_vitalguard" &&
    sample.dataOrigin !== "mockup_watchos_data_vitalguard"
  ) {
    throw new Error("data_mockup에는 목업 출처만 저장할 수 있습니다");
  }
  const { text, values } = buildInsert("data_mockup", {
    data_origin: sample.dataOrigin,
    source: sample.source ?? "VitAlGuard-Mock",
    worker_id: sample.workerId,
    worker_name: sample.workerName ?? null,
    employee_id: sample.employeeId ?? null,
    ts: sample.ts,
    raw_json: JSON.stringify(sample),
  });
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

export async function totalDataMockupPersisted(): Promise<number> {
  const { rows } = await q<{ n: number }>("SELECT COUNT(*) AS n FROM data_mockup");
  return rows[0]?.n ?? 0;
}

// 대시보드의 data_mockup 전용 섹션용. 파싱 실패한 과거/손상 목업은 실데이터 화면으로 새지 않게 제외한다.
export async function recentDataMockupSamples(limit = 40): Promise<VitalSample[]> {
  const { rows } = await q<{ raw_json: string; data_origin: VitalDataOrigin }>(
    "SELECT raw_json, data_origin FROM data_mockup ORDER BY ts DESC, id DESC LIMIT $1",
    [Math.min(Math.max(limit, 1), 100)],
  );
  const samples: VitalSample[] = [];
  for (const row of rows) {
    try {
      const parsed = VitalSampleSchema.safeParse(JSON.parse(row.raw_json));
      if (parsed.success) samples.push({ ...parsed.data, dataOrigin: row.data_origin });
    } catch {
      // 목업 원문 손상은 해당 목업 행만 건너뛰며 운영 실측 스트림에는 영향을 주지 않는다.
    }
  }
  return samples;
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
  // 출역 집계일을 KST 달력일로 통일 — ts 는 UTC ISO 라 substr(ts,1,10)(UTC일)로 버킷팅하면 KST
  // 00:00~08:59 샘플이 전날로 빠져 site/weather 의 KST일 산출물과 어긋난다(안전관리비 교차검증 오류).
  // ts::timestamptz AT TIME ZONE 'Asia/Seoul' 로 KST 달력일을 뽑아 WHERE·GROUP BY 모두 KST일 기준으로.
  const { rows } = await q<{ day: string; worker_id: string; job_title: string | null }>(
    `SELECT to_char(ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
            worker_id, MAX(job_title) AS job_title
       FROM vital_samples
       WHERE to_char(ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') >= $1
         AND to_char(ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') <= $2
         AND worker_id !~ '^(reserved|test|smoke|infra)_'
       GROUP BY to_char(ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), worker_id`,
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

// ── AED(제세동기 알림) 장비 관제 웹 오버라이드 ─────────────────────────────
export type AedConfigOverride = {
  loc: string | null;
  manager: string | null;
  product: string | null;
  note: string | null;
};

// aedId → 오버라이드(설치위치·관리책임자·제품명·비고). 대시보드 표·알림 엔드포인트가 레지스트리 기본값보다 우선 적용.
export async function getAedConfigs(): Promise<Record<string, AedConfigOverride>> {
  const { rows } = await q<{
    aed_id: string;
    loc: string | null;
    manager: string | null;
    product: string | null;
    note: string | null;
  }>("SELECT aed_id, loc, manager, product, note FROM aed_config");
  const out: Record<string, AedConfigOverride> = {};
  for (const r of rows) out[r.aed_id] = { loc: r.loc, manager: r.manager, product: r.product, note: r.note };
  return out;
}

// AED 오버라이드 upsert — 빈 문자열은 null(해제 → 레지스트리 기본값 복귀). 권한 계정만(라우트에서 강제).
export async function setAedConfig(
  aedId: string,
  fields: { loc?: string; manager?: string; product?: string; note?: string },
  updatedBy: string,
): Promise<void> {
  const clip = (v: string | undefined, max: number) => {
    const t = (v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  await q(
    `INSERT INTO aed_config (aed_id, loc, manager, product, note, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${NOW_ISO})
       ON CONFLICT (aed_id) DO UPDATE SET
         loc = excluded.loc,
         manager = excluded.manager,
         product = excluded.product,
         note = excluded.note,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    [
      aedId,
      clip(fields.loc, 40),
      clip(fields.manager, 30),
      clip(fields.product, 40),
      clip(fields.note, 200),
      updatedBy.slice(0, 40) || null,
    ],
  );
}

// ── 가스 누출 감지기 관제 웹 오버라이드(설치위치·가스종류 라벨) ─────────────
export type GaspodConfigOverride = { loc: string | null; gas: string | null };

// row_key → 오버라이드(설치위치·가스종류). 실기기 가스 행·데모 행 공통. 표가 기본값보다 우선 적용.
export async function getGaspodConfigs(): Promise<Record<string, GaspodConfigOverride>> {
  const { rows } = await q<{ row_key: string; loc: string | null; gas: string | null }>(
    "SELECT row_key, loc, gas FROM gaspod_config",
  );
  const out: Record<string, GaspodConfigOverride> = {};
  for (const r of rows) out[r.row_key] = { loc: r.loc, gas: r.gas };
  return out;
}

// 가스 오버라이드 upsert — 빈 문자열은 null(해제 → 기본값 복귀). 권한 계정만(라우트에서 강제).
export async function setGaspodConfig(
  rowKey: string,
  fields: { loc?: string; gas?: string },
  updatedBy: string,
): Promise<void> {
  const clip = (v: string | undefined, max: number) => {
    const t = (v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  await q(
    `INSERT INTO gaspod_config (row_key, loc, gas, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, ${NOW_ISO})
       ON CONFLICT (row_key) DO UPDATE SET
         loc = excluded.loc,
         gas = excluded.gas,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    [rowKey.slice(0, 60), clip(fields.loc, 40), clip(fields.gas, 30), updatedBy.slice(0, 40) || null],
  );
}

// ── 가스포드 텔레메트리 영속(실기기 실시간 수집 DB) ─────────────────────────
export type GaspodTelemetryRow = {
  device_id: string;
  o2: number;
  temp: number;
  humidity: number;
  pressure: number;
  mq7_raw: number;
  mq136_raw: number;
  vbat: number;
  state: string;
  acked: boolean;
  received_at: string;
};

// 수신 텔레메트리 1건 DB 적재(POST). 수신 시각은 서버 UTC ISO 기본값.
export async function insertGaspodTelemetry(input: {
  device_id: string;
  o2: number;
  temp: number;
  humidity: number;
  pressure: number;
  mq7_raw: number;
  mq136_raw: number;
  vbat: number;
  state: string;
  acked: boolean;
}): Promise<void> {
  await q(
    `INSERT INTO gaspod_telemetry
       (device_id, o2, temp, humidity, pressure, mq7_raw, mq136_raw, vbat, state, acked, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${NOW_ISO})`,
    [
      input.device_id.slice(0, 40),
      input.o2,
      input.temp,
      input.humidity,
      input.pressure,
      Math.round(input.mq7_raw),
      Math.round(input.mq136_raw),
      input.vbat,
      input.state.slice(0, 16),
      input.acked,
    ],
  );
}

// 최근 텔레메트리 N건(최신 먼저). 대시보드/검증용.
export async function listGaspodTelemetry(limit = 20): Promise<GaspodTelemetryRow[]> {
  const lim = Math.min(720, Math.max(1, Math.floor(limit)));
  const { rows } = await q<GaspodTelemetryRow>(
    `SELECT device_id, o2, temp, humidity, pressure, mq7_raw, mq136_raw, vbat, state, acked, received_at
       FROM gaspod_telemetry ORDER BY received_at DESC, id DESC LIMIT $1`,
    [lim],
  );
  return rows;
}

// 누적 수집 건수(DB 영속 총계).
export async function countGaspodTelemetry(): Promise<number> {
  const { rows } = await q<{ n: number }>("SELECT COUNT(*) AS n FROM gaspod_telemetry");
  return rows[0]?.n ?? 0;
}

// ── 현장 과업지시서(site_task_doc) — 배치 어시스턴트의 태깅 소스(PDF 업로드 전용·최신 1행 유효) ──
export type SiteTaskDocRow = {
  task_text: string;
  tags_json: string; // RiskTag[] 직렬화(태그·심각도·근거 문장)
  updated_by: string;
  updated_at: string;
  src_name: string | null; // 업로드 원본 파일명
  src_sha256: string | null; // 업로드 원본 SHA-256(위변조 감사 대조용)
};

export async function setSiteTaskDoc(input: {
  taskText: string;
  tagsJson: string;
  updatedBy: string;
  srcName: string;
  srcSha256: string;
}): Promise<void> {
  await q(
    `INSERT INTO site_task_doc (task_text, tags_json, updated_by, src_name, src_sha256)
       VALUES ($1, $2, $3, $4, $5)`,
    [
      input.taskText.slice(0, 20_000),
      input.tagsJson,
      input.updatedBy.slice(0, 60),
      input.srcName.slice(0, 200),
      input.srcSha256.slice(0, 64),
    ],
  );
}

export async function getLatestSiteTaskDoc(): Promise<SiteTaskDocRow | null> {
  const { rows } = await q<SiteTaskDocRow>(
    `SELECT task_text, tags_json, updated_by, updated_at, src_name, src_sha256
       FROM site_task_doc ORDER BY id DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

// ── 세금계산서 수신(④증액 검증 데이터원 — 경리시스템 데모/전자세금계산서 연동) ──
export type TaxInvoiceRow = {
  site_id: string;
  approval_no: string;
  write_date: string;
  supplier_name: string;
  supplier_bno: string;
  buyer_name: string;
  buyer_bno: string;
  supply_amount: number;
  tax_amount: number;
  items_json: string; // [{name,spec,qty,unit,supply,tax}]
  received_at: string;
};

// 승인번호 충돌(재전송)은 무시 — 멱등 수신.
export async function insertTaxInvoice(input: Omit<TaxInvoiceRow, "received_at">): Promise<void> {
  await q(
    `INSERT INTO tax_invoice
       (site_id, approval_no, write_date, supplier_name, supplier_bno, buyer_name, buyer_bno, supply_amount, tax_amount, items_json, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${NOW_ISO})
       ON CONFLICT (approval_no) DO NOTHING`,
    [
      input.site_id.slice(0, 60),
      input.approval_no.slice(0, 40),
      input.write_date.slice(0, 10),
      input.supplier_name.slice(0, 80),
      input.supplier_bno.slice(0, 20),
      input.buyer_name.slice(0, 80),
      input.buyer_bno.slice(0, 20),
      Math.round(input.supply_amount),
      Math.round(input.tax_amount),
      input.items_json,
    ],
  );
}

// ── 사용계획서 수신(④증액 검증의 계획액 기준 — 경리시스템 데모 제출) ──
export type UsePlanRow = {
  site_id: string;
  target_amount: number;
  appropriated: number;
  items_json: string; // [{name, amount}] — 법정 9항목
  received_at: string;
};

export async function upsertUsePlan(input: Omit<UsePlanRow, "received_at">): Promise<void> {
  await q(
    `INSERT INTO use_plan (site_id, target_amount, appropriated, items_json, received_at)
       VALUES ($1, $2, $3, $4, ${NOW_ISO})
       ON CONFLICT (site_id) DO UPDATE SET
         target_amount = EXCLUDED.target_amount,
         appropriated = EXCLUDED.appropriated,
         items_json = EXCLUDED.items_json,
         received_at = EXCLUDED.received_at`,
    [input.site_id.slice(0, 60), Math.round(input.target_amount), Math.round(input.appropriated), input.items_json],
  );
}

export async function getUsePlan(siteId: string): Promise<UsePlanRow | null> {
  const { rows } = await q<UsePlanRow>(
    `SELECT site_id, target_amount, appropriated, items_json, received_at FROM use_plan WHERE site_id = $1`,
    [siteId],
  );
  return rows[0] ?? null;
}

// 현장별 수신 계산서(최신 먼저). siteId 생략 시 전체 최근 N건(ERP 전송상태 표시용).
export async function listTaxInvoices(siteId: string | null, limit = 50): Promise<TaxInvoiceRow[]> {
  const lim = Math.min(200, Math.max(1, Math.floor(limit)));
  const { rows } = siteId
    ? await q<TaxInvoiceRow>(
        `SELECT site_id, approval_no, write_date, supplier_name, supplier_bno, buyer_name, buyer_bno,
                supply_amount, tax_amount, items_json, received_at
           FROM tax_invoice WHERE site_id = $1 ORDER BY received_at DESC, id DESC LIMIT $2`,
        [siteId, lim],
      )
    : await q<TaxInvoiceRow>(
        `SELECT site_id, approval_no, write_date, supplier_name, supplier_bno, buyer_name, buyer_bno,
                supply_amount, tax_amount, items_json, received_at
           FROM tax_invoice ORDER BY received_at DESC, id DESC LIMIT $1`,
        [lim],
      );
  return rows;
}

// ── AED 실 연동 장비 등록(데모 프리셋과 별개 — RPi가 aed_id로 알림 레벨을 폴링하는 실제 장비) ──
export type RegisteredAedDevice = {
  aedId: string;
  loc: string;
  product: string | null;
  manager: string;
  devBatt: number;
  battCycleMonths: number;
  padCycleMonths: number;
  lastSwapTs: string | null; // 최근 배터리·패드 교환일(ISO). null이면 등록일 기준(신품).
  registeredAt: string;
};

// 등록된 실 연동 장비 목록(등록 순). 알림 엔드포인트·관제 표가 공유.
export async function listRegisteredAedDevices(): Promise<RegisteredAedDevice[]> {
  const { rows } = await q<{
    aed_id: string;
    loc: string;
    product: string | null;
    manager: string;
    dev_batt: number;
    batt_cycle_months: number;
    pad_cycle_months: number;
    last_swap_ts: string | null;
    registered_at: string;
  }>(
    `SELECT aed_id, loc, product, manager, dev_batt, batt_cycle_months, pad_cycle_months, last_swap_ts, registered_at
       FROM aed_registered_device ORDER BY registered_at ASC, aed_id ASC`,
  );
  return rows.map((r) => ({
    aedId: r.aed_id,
    loc: r.loc,
    product: r.product,
    manager: r.manager,
    devBatt: r.dev_batt,
    battCycleMonths: r.batt_cycle_months,
    padCycleMonths: r.pad_cycle_months,
    lastSwapTs: r.last_swap_ts,
    registeredAt: r.registered_at,
  }));
}

// 실 장비 등록/수정 upsert — 관리자만(라우트에서 강제). 숫자는 안전 범위로 클램프.
export async function registerAedDevice(
  device: {
    aedId: string;
    loc: string;
    product?: string;
    manager: string;
    devBatt?: number;
    battCycleMonths?: number;
    padCycleMonths?: number;
    lastSwapTs?: string | null;
  },
  by: string,
): Promise<void> {
  const clip = (v: string | undefined, max: number) => {
    const t = (v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  const num = (v: number | undefined, def: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : def;
  await q(
    `INSERT INTO aed_registered_device
       (aed_id, loc, product, manager, dev_batt, batt_cycle_months, pad_cycle_months, last_swap_ts, registered_by, registered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${NOW_ISO})
       ON CONFLICT (aed_id) DO UPDATE SET
         loc = excluded.loc,
         product = excluded.product,
         manager = excluded.manager,
         dev_batt = excluded.dev_batt,
         batt_cycle_months = excluded.batt_cycle_months,
         pad_cycle_months = excluded.pad_cycle_months,
         last_swap_ts = excluded.last_swap_ts,
         registered_by = excluded.registered_by`,
    [
      device.aedId.trim().slice(0, 40),
      clip(device.loc, 40) ?? "",
      clip(device.product, 40),
      clip(device.manager, 30) ?? "",
      num(device.devBatt, 100, 0, 100),
      num(device.battCycleMonths, 48, 1, 120),
      num(device.padCycleMonths, 24, 1, 120),
      device.lastSwapTs ? device.lastSwapTs.slice(0, 40) : null,
      by.slice(0, 40) || null,
    ],
  );
}

// 실 장비 등록 해제(삭제). 존재하면 true.
export async function removeRegisteredAedDevice(aedId: string): Promise<boolean> {
  const { rowCount } = await q("DELETE FROM aed_registered_device WHERE aed_id = $1", [aedId.trim()]);
  return rowCount > 0;
}

// ── 작업자 ID 병합 별칭(secondary → primary) ───────────────────────────────
export type WorkerAliasRow = {
  secondary_worker_id: string;
  primary_worker_id: string;
  updated_at: string;
};

// 별칭 등록 — secondary(별칭) → primary(주 ID) upsert. self/유효성은 호출부에서 검증.
export async function setWorkerAlias(secondaryId: string, primaryId: string): Promise<void> {
  await q(
    `INSERT INTO worker_alias (secondary_worker_id, primary_worker_id, updated_at)
       VALUES ($1, $2, ${NOW_ISO})
       ON CONFLICT (secondary_worker_id) DO UPDATE SET
         primary_worker_id = excluded.primary_worker_id,
         updated_at = excluded.updated_at`,
    [secondaryId, primaryId],
  );
}

// 별칭 해제.
export async function deleteWorkerAlias(secondaryId: string): Promise<void> {
  await q(`DELETE FROM worker_alias WHERE secondary_worker_id = $1`, [secondaryId]);
}

// 별칭 맵(secondary → primary) — 수신 정규화·GET 동봉용.
export async function getWorkerAliasMap(): Promise<Record<string, string>> {
  const { rows } = await q<{ secondary_worker_id: string; primary_worker_id: string }>(
    "SELECT secondary_worker_id, primary_worker_id FROM worker_alias",
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.secondary_worker_id] = r.primary_worker_id;
  return out;
}

// 별칭 목록(관리 UI 표시용).
export async function listWorkerAliases(): Promise<WorkerAliasRow[]> {
  const { rows } = await q<WorkerAliasRow>(
    "SELECT secondary_worker_id, primary_worker_id, updated_at FROM worker_alias ORDER BY updated_at DESC",
  );
  return rows;
}

// ── 작업자 이동 경로(트랙) ──────────────────────────────────────────────────
export type TrackRow = { ts: string; latitude: number | null; longitude: number | null };

// 지도 트레일용 좌표 시계열 — 좌표 보유 행만 ts 오름차순(ts 는 ISO-UTC TEXT 라 문자열 비교 = 시간 비교).
export async function listWorkerTrack(
  workerIds: string[],
  sinceIso: string,
  limit = 2000,
): Promise<TrackRow[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<TrackRow>(
    `SELECT ts, latitude, longitude FROM vital_samples
      WHERE worker_id = ANY($1) AND ts >= $2
        AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY ts ASC LIMIT $3`,
    [workerIds, sinceIso, limit],
  );
  return rows;
}

// ── 위험구역(진입 금지 존) ─────────────────────────────────────────────────
export type DangerZoneRow = {
  id: number;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  created_by: string | null;
  created_at: string;
};

export async function listDangerZones(): Promise<DangerZoneRow[]> {
  const { rows } = await q<DangerZoneRow>(
    "SELECT id, name, lat, lon, radius_m, created_by, created_at FROM danger_zone ORDER BY id ASC",
  );
  return rows;
}

export async function createDangerZone(input: {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
  createdBy?: string | null;
}): Promise<DangerZoneRow> {
  const { rows } = await q<DangerZoneRow>(
    `INSERT INTO danger_zone (name, lat, lon, radius_m, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, lat, lon, radius_m, created_by, created_at`,
    [input.name, input.lat, input.lon, input.radiusM, input.createdBy ?? null],
  );
  return rows[0]!;
}

export async function deleteDangerZone(id: number): Promise<boolean> {
  const { rowCount } = await q("DELETE FROM danger_zone WHERE id = $1", [id]);
  return rowCount > 0;
}

// ── 알림 이력(SOS/낙상/생체 위험/구획 이탈/위험구역 진입) ───────────────────
export type AlertType = "sos" | "fall" | "vital" | "geofence" | "danger_zone";

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
// 신규 삽입(중복 아님)일 때만 텔레그램 알림 발신 — dedup 통과분만 1회 통지.
export async function recordAlert(input: {
  workerId: string;
  workerName?: string | null;
  type: AlertType;
  ts: string;
}): Promise<void> {
  let rowCount: number;
  try {
    ({ rowCount } = await q(
      `INSERT INTO alerts (worker_id, worker_name, type, ts)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (worker_id, type, ts) DO NOTHING`,
      [input.workerId, input.workerName ?? null, input.type, input.ts],
    ));
  } catch (error) {
    // DB 장애가 통지까지 삼키면 안 된다(감사 DB-POOL-02 — 2026-06-30 실발생: DB 비번 사고 구간의
    // SOS·낙상 텔레그램 무음 유실). 기록은 잃어도 통지는 보낸다. dedup(rowCount) 판정이 불가한
    // 상태라 재전송분 중복 통지 가능성은 감수한다. 원래 에러는 다시 던져 호출측 실패 표현을 보존.
    await notifyAlertTelegram(input);
    throw error;
  }
  if (rowCount > 0) {
    // notifyAlertTelegram 은 미설정 시 no-op·실패 삼킴이라 여기서 await 해도 기록·수집을 막지 않는다.
    await notifyAlertTelegram(input);
  }
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

// 자연키(작업자·종류)로 대응 확인 — 알림 팝업의 '확인' 버튼용(팝업은 alert id 를 모름).
// 해당 작업자·종류의 가장 최근 미대응 알림 1건을 ack(ts 정확 매칭 취약성 회피). 변경 행 수 반환.
export async function ackAlertByKey(
  workerId: string,
  type: AlertType,
  ackBy: string,
): Promise<number> {
  const { rowCount } = await q(
    `UPDATE alerts SET ack_at = ${NOW_ISO}, ack_by = $1
       WHERE id = (
         SELECT id FROM alerts
          WHERE worker_id = $2 AND type = $3 AND ack_at IS NULL
          ORDER BY ts DESC, id DESC
          LIMIT 1
       )`,
    [ackBy, workerId, type],
  );
  return rowCount;
}

// ── 현장 환경 경보 확인/조치 기록 ──────────────────────────────────────────
export type EnvAlertAckRow = {
  id: number;
  item_key: string;
  item_label: string;
  value: string | null;
  severity: string;
  status: string; // '확인' | '조치완료'
  note: string | null;
  ack_by: string;
  ack_at: string;
};

// 환경 경보 확인/조치 1건 기록(감사 이력) — 매 확인/조치마다 신규 행(append-only).
export async function recordEnvAlertAck(input: {
  itemKey: string;
  itemLabel: string;
  value?: string | null;
  severity: string;
  status: string;
  note?: string | null;
  ackBy: string;
}): Promise<void> {
  await q(
    `INSERT INTO env_alert_ack (item_key, item_label, value, severity, status, note, ack_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.itemKey,
      input.itemLabel,
      input.value ?? null,
      input.severity,
      input.status,
      input.note ?? null,
      input.ackBy,
    ],
  );
}

export async function listEnvAlertAck(limit = 100): Promise<EnvAlertAckRow[]> {
  const { rows } = await q<EnvAlertAckRow>(
    "SELECT * FROM env_alert_ack ORDER BY ack_at DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
}

// 현장환경 자동 알림 억제 — item_key 를 새 severity 로 원자적 upsert 하고 "이전" severity 를 반환.
// WITH prev 가 upsert 전 스냅샷을 읽어 이전값을 돌려주므로, 발송 여부(악화 전이)는 호출측이 rank 비교로 결정.
export async function upsertEnvAlertState(
  itemKey: string,
  severity: string,
): Promise<string | null> {
  const { rows } = await q<{ prev_severity: string | null }>(
    `WITH prev AS (SELECT severity AS old FROM env_alert_state WHERE item_key = $1)
     INSERT INTO env_alert_state (item_key, severity, updated_at)
       VALUES ($1, $2, ${NOW_ISO})
       ON CONFLICT (item_key) DO UPDATE SET severity = EXCLUDED.severity, updated_at = ${NOW_ISO}
     RETURNING (SELECT old FROM prev) AS prev_severity`,
    [itemKey, severity],
  );
  return rows[0]?.prev_severity ?? null;
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

// ── A3 raw 6축 IMU 임시 수집 버퍼 (독립 스키마 imu_collect.imu_window) ──
// ⚠️ 임시 버퍼. 본 파이프라인(public.vital_samples 등)과 별도 스키마로 격리 · FK·뷰·트리거 없음.
//    수집→export(NDJSON)→DROP. 전역 ensureSchema 밖 지연 생성. 정리: DROP SCHEMA imu_collect CASCADE.
export type ImuWindowRow = {
  worker_id: string;
  family: string | null;
  fs: number | null;
  impact_index: number | null;
  axes: number[][];
};

// 없으면 생성(독립 스키마 imu_collect + 하드닝: CHECK·DEFAULT·INDEX). insert/export 전에 보장.
// db/imu_collect/imu_window.sql 과 한 글자도 다르지 않게 동기화할 것.
export async function ensureImuWindowTable(): Promise<void> {
  await q(`CREATE SCHEMA IF NOT EXISTS imu_collect`);
  await q(`CREATE TABLE IF NOT EXISTS imu_collect.imu_window (
    id            BIGSERIAL    PRIMARY KEY,
    worker_id     TEXT         NOT NULL DEFAULT 'UNSET',
    family        TEXT,
    fs            INTEGER,
    impact_index  INTEGER,
    axes          JSONB        NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_imu_family CHECK (family IS NULL OR family IN ('fall','hammer','pound','throw','walk','sit')),
    CONSTRAINT chk_imu_axes   CHECK (jsonb_typeof(axes) = 'array' AND jsonb_array_length(axes) >= 1),
    CONSTRAINT chk_imu_fs     CHECK (fs IS NULL OR fs BETWEEN 1 AND 1000),
    CONSTRAINT chk_imu_impact CHECK (impact_index IS NULL OR impact_index >= 0)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_imu_worker ON imu_collect.imu_window (worker_id, id)`);
}

// 워치 윈도 1건 INSERT. axes 는 ::jsonb 캐스트로 명시 직렬화(배열 오해석 방지).
export async function insertImuWindow(rec: ImuWindowRow): Promise<void> {
  await ensureImuWindowTable();
  await q(
    `INSERT INTO imu_collect.imu_window (worker_id, family, fs, impact_index, axes)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [rec.worker_id, rec.family, rec.fs, rec.impact_index, JSON.stringify(rec.axes)],
  );
}

// 전체 회수(워커별·이벤트순). export route 가 NDJSON 으로 내보낸다.
export async function exportImuWindows(): Promise<ImuWindowRow[]> {
  await ensureImuWindowTable();
  const { rows } = await q<ImuWindowRow>(
    `SELECT worker_id, family, fs, impact_index, axes
       FROM imu_collect.imu_window
      ORDER BY worker_id, id`,
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

// 내보내기 조회 컬럼 — ExportRow 와 1:1. SELECT * 금지: raw_json(행당 1~2KB 감사 사본)은 내보내기
// 세 소비처(미리보기/CSV/XLSX) 모두 미사용인데 전 행 로드 시 메모리를 지배해 OOM(503)을 유발했다.
const EXPORT_COLUMNS = [
  "id",
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
  "hrv_sdnn_ms",
  "resting_heart_rate",
  "active_energy_kcal",
  "steps",
  "walking_heart_rate",
  "flights_climbed",
  "respiratory_rate",
  "received_at",
].join(", ");

// 관리자 내보내기 — 기간 (+ 선택적 workerId) 필터로 ExportRow 컬럼 조회
export async function exportSamples(opts: {
  workerId?: string;
  from: string;
  to: string;
}): Promise<ExportRow[]> {
  const { workerId, from, to } = opts;
  if (workerId) {
    const { rows } = await q<ExportRow>(
      `SELECT ${EXPORT_COLUMNS} FROM vital_samples WHERE worker_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts ASC`,
      [workerId, from, to],
    );
    return rows;
  }
  const { rows } = await q<ExportRow>(
    `SELECT ${EXPORT_COLUMNS} FROM vital_samples WHERE ts >= $1 AND ts <= $2 ORDER BY ts ASC`,
    [from, to],
  );
  return rows;
}

// 미리보기 — 기간 내 최근 N건만 DB 에서 잘라 조회(전체 로드 금지). 응답 규약과 동일한 최근순(DESC).
export async function previewRecentSamples(opts: {
  workerId?: string;
  from: string;
  to: string;
  limit: number;
}): Promise<ExportRow[]> {
  const { workerId, from, to, limit } = opts;
  if (workerId) {
    const { rows } = await q<ExportRow>(
      `SELECT ${EXPORT_COLUMNS} FROM vital_samples
        WHERE worker_id = $1 AND ts >= $2 AND ts <= $3
        ORDER BY ts DESC, id DESC LIMIT $4`,
      [workerId, from, to, limit],
    );
    return rows;
  }
  const { rows } = await q<ExportRow>(
    `SELECT ${EXPORT_COLUMNS} FROM vital_samples
      WHERE ts >= $1 AND ts <= $2
      ORDER BY ts DESC, id DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

// 심각도 집계용 임계 파라미터 — lib/severity SEVERITY_SQL_PARAMS 와 구조 일치(값은 호출부가 주입).
export type SeverityCountParams = {
  hrDangerHigh: number;
  hrDangerLow: number;
  hrCautionHigh: number;
  hrCautionLow: number;
  spo2Danger: number;
  spo2Caution: number;
  tempOffset: number;
  tempDanger: number;
  tempCaution: number;
};

// 기간 일치 전체/위험/주의 건수 — overallStatus(worst-of + SOS/낙상 즉시 danger)를 SQL 로 동일 재현.
// 임계값은 파라미터 바인딩(하드코딩 금지 — 단일 소스는 lib/severity). caution 은 "danger 아님" 전제.
export async function countSamplesBySeverity(
  opts: { workerId?: string; from: string; to: string },
  p: SeverityCountParams,
): Promise<{ total: number; danger: number; caution: number }> {
  const { workerId, from, to } = opts;
  // 주의: SQL 3치 논리 — fall/sos 가 NULL 이면 `= 1` 이 false 아닌 NULL 이 되고,
  // `NOT (… OR NULL)` 도 NULL 이라 caution FILTER 가 전부 탈락한다(실 DB 실측으로 적발).
  // COALESCE 로 NULL→0 강제해 조건 전체가 항상 확정 boolean 이 되게 한다.
  const dangerCond = `(
    COALESCE(fall_detected, 0) = 1 OR COALESCE(manual_sos, 0) = 1
    OR (heart_rate IS NOT NULL AND (heart_rate >= $3 OR heart_rate <= $4))
    OR (spo2 IS NOT NULL AND spo2 < $5)
    OR (skin_temp_c IS NOT NULL AND skin_temp_c + $6 >= $7)
  )`;
  const cautionCond = `(
    (heart_rate IS NOT NULL AND (heart_rate >= $8 OR heart_rate <= $9))
    OR (spo2 IS NOT NULL AND spo2 < $10)
    OR (skin_temp_c IS NOT NULL AND skin_temp_c + $6 >= $11)
  )`;
  const params: unknown[] = [
    from,
    to,
    p.hrDangerHigh,
    p.hrDangerLow,
    p.spo2Danger,
    p.tempOffset,
    p.tempDanger,
    p.hrCautionHigh,
    p.hrCautionLow,
    p.spo2Caution,
    p.tempCaution,
  ];
  let where = "ts >= $1 AND ts <= $2";
  if (workerId) {
    params.push(workerId);
    where += ` AND worker_id = $${params.length}`;
  }
  const { rows } = await q<{ total: number; danger: number; caution: number }>(
    `SELECT
       COUNT(*)::bigint AS total,
       COUNT(*) FILTER (WHERE ${dangerCond})::bigint AS danger,
       COUNT(*) FILTER (WHERE NOT ${dangerCond} AND ${cautionCond})::bigint AS caution
     FROM vital_samples WHERE ${where}`,
    params,
  );
  return {
    total: rows[0]?.total ?? 0,
    danger: rows[0]?.danger ?? 0,
    caution: rows[0]?.caution ?? 0,
  };
}

// 기간 일치 총 건수 — 스트리밍 CSV 의 x-row-count 헤더·XLSX 상한 안내용 경량 COUNT.
export async function countExportRows(opts: {
  workerId?: string;
  from: string;
  to: string;
}): Promise<number> {
  const { workerId, from, to } = opts;
  if (workerId) {
    const { rows } = await q<{ n: number }>(
      "SELECT COUNT(*)::bigint AS n FROM vital_samples WHERE worker_id = $1 AND ts >= $2 AND ts <= $3",
      [workerId, from, to],
    );
    return rows[0]?.n ?? 0;
  }
  const { rows } = await q<{ n: number }>(
    "SELECT COUNT(*)::bigint AS n FROM vital_samples WHERE ts >= $1 AND ts <= $2",
    [from, to],
  );
  return rows[0]?.n ?? 0;
}

// CSV 스트리밍용 키셋 페이지네이션 — (ts, id) 커서로 batch 행씩 순회. 메모리 상주 = 1배치.
// OFFSET 대신 키셋: 후반 페이지 비용 증가·순회 중 삽입에 의한 중복/누락이 없다(idx_vs_ts_id 사용).
export async function* iterateExportRows(opts: {
  workerId?: string;
  from: string;
  to: string;
  batchSize?: number;
}): AsyncGenerator<ExportRow[]> {
  const { workerId, from, to } = opts;
  const batch = opts.batchSize ?? 5000;
  let cursor: { ts: string; id: number } | null = null;
  for (;;) {
    const params: unknown[] = workerId ? [workerId, from, to] : [from, to];
    let where = workerId
      ? "worker_id = $1 AND ts >= $2 AND ts <= $3"
      : "ts >= $1 AND ts <= $2";
    if (cursor) {
      params.push(cursor.ts, cursor.id);
      where += ` AND (ts, id) > ($${params.length - 1}, $${params.length}::int)`;
    }
    const { rows } = await q<ExportRow>(
      `SELECT ${EXPORT_COLUMNS} FROM vital_samples
        WHERE ${where} ORDER BY ts ASC, id ASC LIMIT ${batch}`,
      params,
    );
    if (rows.length === 0) return;
    yield rows;
    const last = rows[rows.length - 1];
    if (!last) return;
    cursor = { ts: last.ts, id: last.id };
  }
}

// XLSX 상한 조회 — 기간 내 최근 limit 건을 시간 오름차순으로(시트 표시 규약 유지).
export async function exportSamplesCapped(opts: {
  workerId?: string;
  from: string;
  to: string;
  limit: number;
}): Promise<ExportRow[]> {
  const rows = await previewRecentSamples(opts);
  return rows.reverse();
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
  windGustKmh?: number;
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
    wind_gust_kmh: input.windGustKmh ?? null,
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

// ── 현장 좌표 일별 캐시(site_coord_daily) ─────────────────────────────────────
export type SiteCoordRow = {
  id: number;
  snapshot_date: string;
  lat: number;
  lon: number;
  worker_count: number | null;
  recorded_at: string;
};

// 최신 캐시 좌표 — 오늘 것 있으면 오늘, 없으면 직전 날짜(다음날 최초 연결 전까지 안정 유지).
export async function getLatestSiteCoord(): Promise<SiteCoordRow | null> {
  const { rows } = await q<SiteCoordRow>(
    "SELECT * FROM site_coord_daily ORDER BY snapshot_date DESC, recorded_at DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

// 일별 대표 기상 행(weather_daily) — Open-Meteo 업스트림 장애 시 폴백 소스로 사용.
export type WeatherDailyRow = {
  snapshot_date: string;
  lat: number;
  lon: number;
  weather_code: number | null;
  temperature_c: number | null;
  apparent_temp_c: number | null;
  humidity_pct: number | null;
  wind_kmh: number | null;
  wind_gust_kmh: number | null;
  precipitation_mm: number | null;
  uv_index: number | null;
  pm10: number | null;
  pm25: number | null;
  sunrise: string | null;
  sunset: string | null;
  recorded_at: string;
};

// 마지막으로 저장된 일별 대표 기상 — 업스트림(Open-Meteo 예보) 장애+인메모리 캐시 소멸(재배포) 시 폴백.
export async function getLatestWeatherDaily(): Promise<WeatherDailyRow | null> {
  const { rows } = await q<WeatherDailyRow>(
    "SELECT * FROM weather_daily ORDER BY snapshot_date DESC, recorded_at DESC LIMIT 1",
  );
  return rows[0] ?? null;
}

// 현장 좌표를 그날(KST) 1행으로 캡처.
// force=false(자동): 그날 행 없을 때만 INSERT = 하루 최초 캡처(이후 라이브 변동으로 덮지 않음).
// force=true(수동 새로고침): 그날 행을 현재 좌표로 UPDATE(재캡처). 반환 = 그날 유효 행.
export async function captureSiteCoordDaily(input: {
  lat: number;
  lon: number;
  workerCount?: number;
  force?: boolean;
}): Promise<SiteCoordRow> {
  const snapshotDate = ymdInKst();
  const conflict = input.force
    ? `DO UPDATE SET lat = excluded.lat, lon = excluded.lon,
         worker_count = excluded.worker_count, recorded_at = excluded.recorded_at`
    : "DO NOTHING";
  await q(
    `INSERT INTO site_coord_daily (snapshot_date, lat, lon, worker_count, recorded_at)
     VALUES ($1, $2, $3, $4, ${NOW_ISO})
     ON CONFLICT (snapshot_date) ${conflict}`,
    [snapshotDate, input.lat, input.lon, input.workerCount ?? null],
  );
  // DO NOTHING 이면 RETURNING 이 비므로 그날 행을 별도 조회.
  const { rows } = await q<SiteCoordRow>(
    "SELECT * FROM site_coord_daily WHERE snapshot_date = $1",
    [snapshotDate],
  );
  const row = rows[0];
  if (!row) throw new Error("site_coord 캡처 직후 조회 실패");
  return row;
}

// 현장 기상 일별 대표 snapshot upsert — 당일 마지막 fresh fetch 값이 그날 대표로 유지. weather_log 상세 이력과 별도 보관.
export async function persistWeatherDaily(input: {
  lat: number;
  lon: number;
  workerCount?: number;
  weatherCode?: number;
  temperatureC?: number;
  apparentTempC?: number;
  humidityPct?: number;
  windKmh?: number;
  windGustKmh?: number;
  precipitationMm?: number;
  uvIndex?: number;
  pm10?: number;
  pm25?: number;
  sunrise?: string;
  sunset?: string;
}): Promise<void> {
  const snapshotDate = ymdInKst();
  await q(
    `INSERT INTO weather_daily (
       snapshot_date, lat, lon, worker_count, weather_code, temperature_c,
       apparent_temp_c, humidity_pct, wind_kmh, wind_gust_kmh, precipitation_mm, uv_index,
       pm10, pm25, sunrise, sunset, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, ${NOW_ISO})
     ON CONFLICT (snapshot_date) DO UPDATE SET
       lat = excluded.lat, lon = excluded.lon, worker_count = excluded.worker_count,
       weather_code = excluded.weather_code, temperature_c = excluded.temperature_c,
       apparent_temp_c = excluded.apparent_temp_c, humidity_pct = excluded.humidity_pct,
       wind_kmh = excluded.wind_kmh, wind_gust_kmh = excluded.wind_gust_kmh,
       precipitation_mm = excluded.precipitation_mm,
       uv_index = excluded.uv_index, pm10 = excluded.pm10, pm25 = excluded.pm25,
       sunrise = excluded.sunrise, sunset = excluded.sunset, recorded_at = excluded.recorded_at`,
    [
      snapshotDate,
      input.lat,
      input.lon,
      input.workerCount ?? null,
      input.weatherCode ?? null,
      input.temperatureC ?? null,
      input.apparentTempC ?? null,
      input.humidityPct ?? null,
      input.windKmh ?? null,
      input.windGustKmh ?? null,
      input.precipitationMm ?? null,
      input.uvIndex ?? null,
      input.pm10 ?? null,
      input.pm25 ?? null,
      input.sunrise ?? null,
      input.sunset ?? null,
    ],
  );
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
  org_type: string; // 'vitalguard'(VitAlGuard 관리자) | 'member'(회원사 관리자)
  status: string; // pending | approved | rejected
  birth_date: string | null; // YYYY-MM-DD
  department: string | null;
  job_title: string | null;
  employee_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  admin_access: boolean;
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
  birthDate: string | null;
  orgType: string; // 'vitalguard' | 'member'
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
    birth_date: input.birthDate,
    org_type: input.orgType,
    // 가입 시점에 사번 기본값을 넣는다 — null 로 두면 그 계정만 사진 소유권 대조가
    // 불가능해져 "본인 사진을 못 지우는" 상태로 태어난다. 실제 사번은 프로필에서 덮어쓴다.
    employee_id: defaultEmployeeId(input.username),
  });
  const { rows } = await q<UserRow>(
    `${text} ON CONFLICT (username) DO NOTHING RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

// 근로자 로그인 계정 생성(owner) — role=worker·즉시 승인·사번(employee_id) 매칭. 앱 로그인용.
export async function createWorkerAccount(input: {
  username: string;
  name: string | null;
  employeeId: string | null;
  passwordHash: string;
  approvedBy: string;
}): Promise<UserRow | null> {
  const { text, values } = buildInsert("users", {
    username: input.username,
    name: input.name,
    password_hash: input.passwordHash,
    auth_provider: "password",
    role: "worker",
    status: "approved",
    employee_id: input.employeeId,
    approved_by: input.approvedBy,
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

// ── 로그인 시도 잠금(인스턴스 공유) ─────────────────────────────────────────
// 정책(임계·잠금시간)은 lib/login-attempts 가 갖고, 여기는 저장만 한다.

/** 남은 잠금 시간(ms). 기록이 없거나 이미 풀렸으면 0. */
export async function readLoginLockMs(lockKey: string): Promise<number> {
  const { rows } = await q<{ ms: number }>(
    `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - now())) * 1000))::bigint AS ms
       FROM login_attempt WHERE lock_key = $1 AND locked_until IS NOT NULL`,
    [lockKey],
  );
  return rows[0]?.ms ?? 0;
}

// 실패 1회 누적. 임계에 닿으면 잠금을 걸고 카운터를 0 으로 되돌린다(인메모리 구현과 같은 규칙).
// 읽고-쓰기를 나누면 두 인스턴스가 동시에 실패했을 때 한쪽 증가분이 사라지므로 한 문장으로 처리한다.
export async function recordLoginFailure(
  lockKey: string,
  maxFails: number,
  lockoutMs: number,
): Promise<void> {
  await q(
    `INSERT INTO login_attempt AS a (lock_key, fails, locked_until, updated_at)
     VALUES ($1, 1, NULL, now())
     ON CONFLICT (lock_key) DO UPDATE SET
       fails = CASE WHEN a.fails + 1 >= $2 THEN 0 ELSE a.fails + 1 END,
       locked_until = CASE WHEN a.fails + 1 >= $2
                           THEN now() + make_interval(secs => $3::double precision / 1000)
                           ELSE a.locked_until END,
       updated_at = now()`,
    [lockKey, maxFails, lockoutMs],
  );
}

/** 로그인 성공 — 해당 키의 실패 기록 제거. */
export async function clearLoginAttempts(lockKey: string): Promise<void> {
  await q("DELETE FROM login_attempt WHERE lock_key = $1", [lockKey]);
}

export async function createMobileAppSession(input: {
  sessionId: string;
  username: string;
  role: string;
  name: string | null;
  workerId: string | null;
  refreshTokenHash: string;
  deviceName: string | null;
  platform: string | null;
  expiresAt: string;
}): Promise<void> {
  await q(
    `INSERT INTO mobile_app_session
      (session_id, username, role, name, worker_id, refresh_token_hash, device_name, platform, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      input.sessionId,
      input.username,
      input.role,
      input.name,
      input.workerId,
      input.refreshTokenHash,
      input.deviceName,
      input.platform,
      input.expiresAt,
    ],
  );
}

export async function findActiveMobileAppSession(
  refreshTokenHash: string,
): Promise<MobileAppSessionRow | null> {
  const { rows } = await q<MobileAppSessionRow>(
    `SELECT * FROM mobile_app_session
      WHERE refresh_token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > ${NOW_ISO}
      LIMIT 1`,
    [refreshTokenHash],
  );
  return rows[0] ?? null;
}

// Refresh 토큰은 매 사용 시 교체한다. 이미 회전된 토큰을 다시 쓰면 행이 없으므로 재로그인이 필요하다.
export async function rotateMobileAppSession(input: {
  sessionId: string;
  previousRefreshTokenHash: string;
  nextRefreshTokenHash: string;
  expiresAt: string;
}): Promise<boolean> {
  const { rowCount } = await q(
    `UPDATE mobile_app_session
        SET refresh_token_hash = $3,
            expires_at = $4,
            updated_at = ${NOW_ISO}
      WHERE session_id = $1
        AND refresh_token_hash = $2
        AND revoked_at IS NULL
        AND expires_at > ${NOW_ISO}`,
    [input.sessionId, input.previousRefreshTokenHash, input.nextRefreshTokenHash, input.expiresAt],
  );
  return rowCount === 1;
}

export async function revokeMobileAppSession(sessionId: string): Promise<void> {
  await q(
    `UPDATE mobile_app_session
        SET revoked_at = COALESCE(revoked_at, ${NOW_ISO}),
            updated_at = ${NOW_ISO}
      WHERE session_id = $1`,
    [sessionId],
  );
}

// 사번(employee_id)이 다른 사용자에게 이미 쓰이는지 — 자가 프로필 수정 시 타인 사번 도용(귀속 위조) 차단용.
export async function employeeIdTakenByOther(
  employeeId: string,
  username: string,
): Promise<boolean> {
  const { rows } = await q<{ one: number }>(
    "SELECT 1 AS one FROM users WHERE employee_id = $1 AND username <> $2 LIMIT 1",
    [employeeId, username],
  );
  return rows.length > 0;
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

// 등록 계정의 이름 ↔ 사번 목록(챗봇 이름 조회용).
// vital_samples 집계(listAllWorkers)는 "생체를 보낸 적 있는 사람"만 담는다. 그래서 계정은 있으나
// 아직 워치 데이터가 없는 작업자는 이름으로 못 찾고, 챗봇이 직전 작업자로 잘못 답했다.
// 여기서는 판정에 필요한 두 열만 읽는다(비밀번호 해시 등은 이 경로로 끌어오지 않는다).
export async function listApprovedWorkerNames(): Promise<
  { workerId: string; name: string }[]
> {
  const { rows } = await q<{ employee_id: string; name: string }>(
    `SELECT employee_id, name
       FROM users
      WHERE status = 'approved'
        AND employee_id IS NOT NULL AND employee_id <> ''
        AND name IS NOT NULL AND name <> ''`,
  );
  return rows.map((r) => ({ workerId: r.employee_id.trim(), name: r.name.trim() }));
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
    department: string | null;
    jobTitle: string | null;
    employeeId: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
    passwordHash?: string;
  },
): Promise<UserRow | null> {
  if (input.passwordHash !== undefined) {
    const { rows } = await q<UserRow>(
      `UPDATE users SET name = $1, company = $2, phone = $3, carrier = $4,
         department = $5, job_title = $6, employee_id = $7,
         guardian_name = $8, guardian_phone = $9, password_hash = $10
       WHERE username = $11 RETURNING *`,
      [input.name, input.company, input.phone, input.carrier, input.department, input.jobTitle, input.employeeId, input.guardianName, input.guardianPhone, input.passwordHash, username],
    );
    return rows[0] ?? null;
  }
  const { rows } = await q<UserRow>(
    `UPDATE users SET name = $1, company = $2, phone = $3, carrier = $4, department = $5, job_title = $6, employee_id = $7,
       guardian_name = $8, guardian_phone = $9
     WHERE username = $10 RETURNING *`,
    [input.name, input.company, input.phone, input.carrier, input.department, input.jobTitle, input.employeeId, input.guardianName, input.guardianPhone, username],
  );
  return rows[0] ?? null;
}

// 관리자 메뉴 접근 권한 부여/회수 — owner 전용(자가취득 불가).
export async function setUserAdminAccess(
  id: number,
  value: boolean,
): Promise<UserRow | null> {
  const { rows } = await q<UserRow>(
    "UPDATE users SET admin_access = $1 WHERE id = $2 RETURNING *",
    [value, id],
  );
  return rows[0] ?? null;
}

// 부서/직책 직접 수정 — owner 가 사용자 관리에서 각 사용자 값을 편집(id 기준). 본인 자가입력과 별개.
export async function setUserProfileFields(
  id: number,
  department: string | null,
  jobTitle: string | null,
): Promise<UserRow | null> {
  const { rows } = await q<UserRow>(
    "UPDATE users SET department = $1, job_title = $2 WHERE id = $3 RETURNING *",
    [department, jobTitle, id],
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
  orgType: string; // 'vitalguard' | 'member'
}): Promise<UserRow | null> {
  const { text, values } = buildInsert("users", {
    username: input.email,
    name: input.name,
    company: input.company,
    phone: input.phone,
    email: input.email,
    org_type: input.orgType,
    auth_provider: "google",
    google_sub: input.googleSub,
    // 구글 가입도 동일 — username 이 이메일이라 사번은 'EMP-<이메일>' 이 된다.
    // 앱이 만드는 값과 같은 규칙이라 나중에 그 계정으로 앱을 써도 그대로 맞물린다.
    employee_id: defaultEmployeeId(input.email),
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
  worker_id: string | null;
  latitude: number | null;
  longitude: number | null;
  road_address: string | null;
  created_at: string;
};

export type CalendarMediaCommentRow = {
  id: string;
  media_id: string;
  author_name: string | null;
  author_id: string | null;
  author_role: string | null;
  author_title: string | null;
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

// 단건 조회 — 다운로드 URL 발급 등에서 storage_key 등을 얻기 위해.
export async function getCalendarMediaById(id: string): Promise<CalendarMediaRow | null> {
  const { rows } = await q<CalendarMediaRow>(
    "SELECT * FROM calendar_media WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
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
  workerId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  roadAddress?: string | null;
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
      worker_id: input.workerId ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      road_address: input.roadAddress ?? null,
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
  authorTitle?: string | null;
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
      author_title: input.authorTitle ?? null,
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
  scope: CommentScope,
): Promise<boolean> {
  const params: unknown[] = [id, body];
  const clause = commentScopeClause(scope, params);
  const { rowCount } = await q(
    `UPDATE calendar_media_comment SET body = $2, updated_at = ${NOW_ISO} WHERE id = $1${clause}`,
    params,
  );
  return rowCount > 0;
}

export async function deleteCalendarMediaComment(
  id: string,
  scope: CommentScope,
): Promise<boolean> {
  const params: unknown[] = [id];
  const clause = commentScopeClause(scope, params);
  const { rowCount } = await q(
    `DELETE FROM calendar_media_comment WHERE id = $1${clause}`,
    params,
  );
  return rowCount > 0;
}

// 설명 메모 수정 — 삭제와 같은 소유권 규칙(올린 작업자 본인 또는 owner).
export async function updateCalendarMediaDescription(
  id: string,
  description: string,
  scope: MediaScope,
): Promise<boolean> {
  const params: unknown[] = [id, description];
  const clause = mediaScopeClause(scope, params);
  const { rowCount } = await q(
    `UPDATE calendar_media SET description = $2 WHERE id = $1${clause}`,
    params,
  );
  return rowCount > 0;
}

export async function deleteCalendarMedia(
  id: string,
  scope: MediaScope,
): Promise<boolean> {
  const params: unknown[] = [id];
  const clause = mediaScopeClause(scope, params);
  const { rowCount } = await q(
    `DELETE FROM calendar_media WHERE id = $1${clause}`,
    params,
  );
  return rowCount > 0;
}

// ── 일정 캘린더 일정/라벨(서버 영속 — localStorage 승격) ──────────────────────
export type CalendarEventRow = {
  id: string;
  date_key: string;
  title: string;
  label_id: string;
  start_time: string | null;
  end_time: string | null;
  hazard_type: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type CalendarLabelRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

// 날짜 범위(YYYY-MM-DD, 포함) 일정 조회 — 캘린더 월(±주간 패딩) 단위 표시용.
export async function listCalendarEvents(
  fromKey: string,
  toKey: string,
): Promise<CalendarEventRow[]> {
  const { rows } = await q<CalendarEventRow>(
    `SELECT * FROM calendar_event
       WHERE date_key >= $1 AND date_key <= $2
       ORDER BY date_key ASC, start_time ASC NULLS LAST, created_at ASC`,
    [fromKey, toKey],
  );
  return rows;
}

// 일정 업서트 — id 충돌 시 내용 갱신(클라 마이그레이션 재전송에도 멱등).
//
// 갱신 분기에만 소유권 조건을 건다. id 를 클라가 만들어 보내므로(멱등 마이그레이션 요건),
// 조건이 없으면 "신규 등록"으로 위장해 남의 일정을 덮어쓸 수 있다. 신규 INSERT 는 충돌이
// 없으니 조건과 무관하다. 남의 일정이면 DO UPDATE 가 걸러져 **반환 행이 없다** → null.
//
// created_by 는 SET 목록에 넣지 않는다 — 수정해도 최초 등록자가 보존돼야 한다.
export async function upsertCalendarEvent(
  input: {
    id: string;
    dateKey: string;
    title: string;
    labelId: string;
    startTime?: string | null;
    endTime?: string | null;
    hazardType?: string | null;
    createdBy?: string | null;
  },
  scope: CalendarEventScope,
): Promise<CalendarEventRow | null> {
  const params: unknown[] = [
    input.id,
    input.dateKey,
    input.title,
    input.labelId,
    input.startTime ?? null,
    input.endTime ?? null,
    input.hazardType ?? null,
    input.createdBy ?? null,
  ];
  const clause = calendarEventScopeClause(scope, params);
  const { rows } = await q<CalendarEventRow>(
    `INSERT INTO calendar_event (id, date_key, title, label_id, start_time, end_time, hazard_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         date_key = EXCLUDED.date_key,
         title = EXCLUDED.title,
         label_id = EXCLUDED.label_id,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         hazard_type = EXCLUDED.hazard_type,
         updated_at = ${NOW_ISO}
       WHERE TRUE${clause}
       RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

// 남의 일정이면 rowCount 0 → 호출부가 403 으로 응답한다.
export async function deleteCalendarEvent(
  id: string,
  scope: CalendarEventScope,
): Promise<boolean> {
  const params: unknown[] = [id];
  const clause = calendarEventScopeClause(scope, params);
  const { rowCount } = await q(
    `DELETE FROM calendar_event WHERE id = $1${clause}`,
    params,
  );
  return rowCount > 0;
}

export async function listCalendarLabels(): Promise<CalendarLabelRow[]> {
  const { rows } = await q<CalendarLabelRow>(
    "SELECT * FROM calendar_label ORDER BY sort_order ASC, id ASC",
  );
  return rows;
}

// 라벨 전체 교체 — 클라가 항상 전체 배열을 보내는 semantics(삭제 포함) 그대로 반영.
export async function replaceCalendarLabels(
  labels: { id: string; name: string; color: string }[],
): Promise<void> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM calendar_label");
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i]!;
      await client.query(
        "INSERT INTO calendar_label (id, name, color, sort_order) VALUES ($1, $2, $3, $4)",
        [l.id, l.name, l.color, i],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── 작업자 모니터링 슬롯 등록(공유 관제 1벌, 단일행 id=1) ─────────────────────
// 슬롯 배열((string|null)[])을 JSON 으로 통째 보존 — localStorage 와 동일 포맷. 없으면 null.
export async function getMonitorSlots(): Promise<(string | null)[] | null> {
  const { rows } = await q<{ slots: string }>(
    "SELECT slots FROM monitor_slot_config WHERE id = 1",
  );
  if (!rows[0]) return null;
  try {
    const parsed = JSON.parse(rows[0].slots);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 슬롯 배열 통째 저장(replace) — 단일행 upsert.
export async function saveMonitorSlots(slots: (string | null)[]): Promise<void> {
  await q(
    `INSERT INTO monitor_slot_config (id, slots, updated_at)
       VALUES (1, $1, ${NOW_ISO})
       ON CONFLICT (id) DO UPDATE SET slots = excluded.slots, updated_at = excluded.updated_at`,
    [JSON.stringify(slots)],
  );
}

// ── 작업자 컨디션 신호 집계(배치 권고용) ──────────────────────────────────────
// 최근 창(sinceIso~) 생체 이력 + 경보 이력을 lib/worker-condition.ts 가 소비하는
// ConditionSignals 형태로 집계한다. workerIds 는 별칭 병합을 감안해 복수 수용.
// 임계 파라미터는 호출부(severity/analyzers 단일 source)에서 주입 — 여기 매직넘버 금지.
export async function workerConditionSignals(input: {
  workerIds: string[];
  sinceIso: string;
  spo2CautionPct: number;
  spo2DangerPct: number;
  hrHeavyBpm: number;
  hrOverloadBpm: number;
  hrCollapseBpm: number;
}): Promise<{
  sampleCount: number;
  firstTs: string | null;
  latestTs: string | null;
  spo2CautionCount: number;
  spo2DangerCount: number;
  hrCautionCount: number;
  hrDangerCount: number;
  fallAlerts: number;
  sosAlerts: number;
  vitalAlerts: number;
  unackedAlerts: number;
}> {
  const ids = input.workerIds.length > 0 ? input.workerIds : ["__none__"];
  const idPh = ids.map((_, i) => `$${i + 1}`).join(", ");
  const base = ids.length;

  const vitals = await q<{
    sample_count: number;
    first_ts: string | null;
    latest_ts: string | null;
    spo2_caution: number;
    spo2_danger: number;
    hr_caution: number;
    hr_danger: number;
  }>(
    `SELECT
       COUNT(*)::int AS sample_count,
       MIN(ts) AS first_ts,
       MAX(ts) AS latest_ts,
       COUNT(*) FILTER (WHERE spo2 IS NOT NULL AND spo2 < $${base + 2})::int AS spo2_caution,
       COUNT(*) FILTER (WHERE spo2 IS NOT NULL AND spo2 < $${base + 3})::int AS spo2_danger,
       COUNT(*) FILTER (
         WHERE heart_rate IS NOT NULL AND heart_rate >= $${base + 4} AND heart_rate < $${base + 5}
       )::int AS hr_caution,
       COUNT(*) FILTER (
         WHERE heart_rate IS NOT NULL AND (heart_rate >= $${base + 5} OR heart_rate <= $${base + 6})
       )::int AS hr_danger
     FROM vital_samples
     WHERE worker_id IN (${idPh}) AND ts >= $${base + 1}`,
    [
      ...ids,
      input.sinceIso,
      input.spo2CautionPct,
      input.spo2DangerPct,
      input.hrHeavyBpm,
      input.hrOverloadBpm,
      input.hrCollapseBpm,
    ],
  );

  const alerts = await q<{
    fall_n: number;
    sos_n: number;
    vital_n: number;
    unacked_n: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE type = 'fall')::int AS fall_n,
       COUNT(*) FILTER (WHERE type = 'sos')::int AS sos_n,
       COUNT(*) FILTER (WHERE type = 'vital')::int AS vital_n,
       COUNT(*) FILTER (WHERE ack_at IS NULL)::int AS unacked_n
     FROM alerts
     WHERE worker_id IN (${idPh}) AND ts >= $${base + 1}`,
    [...ids, input.sinceIso],
  );

  const v = vitals.rows[0];
  const a = alerts.rows[0];
  return {
    sampleCount: v?.sample_count ?? 0,
    firstTs: v?.first_ts ?? null,
    latestTs: v?.latest_ts ?? null,
    spo2CautionCount: v?.spo2_caution ?? 0,
    spo2DangerCount: v?.spo2_danger ?? 0,
    hrCautionCount: v?.hr_caution ?? 0,
    hrDangerCount: v?.hr_danger ?? 0,
    fallAlerts: a?.fall_n ?? 0,
    sosAlerts: a?.sos_n ?? 0,
    vitalAlerts: a?.vital_n ?? 0,
    unackedAlerts: a?.unacked_n ?? 0,
  };
}
