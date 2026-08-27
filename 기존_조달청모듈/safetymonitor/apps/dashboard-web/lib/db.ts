// PostgreSQL 영속 저장소 — vital sample 무한 축적 + CCTV·안전관리비 데이터 (산업재해 자료 제출 대비).
// 캠퍼스 Postgres(DATABASE_URL). better-sqlite3(동기) → pg(비동기) 전환 — GCP Cloud Run 대비.
// 모든 공개 함수는 async. 스키마는 첫 쿼리 시 멱등 생성(ensureSchema, CREATE TABLE IF NOT EXISTS).
import pg, { Pool, type PoolClient } from "pg";
import { VitalSampleSchema, type VitalDataOrigin, type VitalSample, type CctvFallEvent } from "@safetymonitor/schemas";

import {
  calendarEventScopeClause,
  type CalendarEventScope,
} from "./calendar-event-scope";
import type { AlertType } from "./alert-type";
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
  __safetyMonitorPoolWarmer?: ReturnType<typeof setInterval>;
};

// ── 웜 바닥 유지 (2026-08-22) ─────────────────────────────────────────────
// ★ 실패는 **새 물리 접속에만** 붙는다. 실측 —
//   · 웜 재사용 22ms · 실패 0/104
//   · 새 접속은 간헐적으로 5초(connectionTimeoutMillis)를 넘겨 500
//   · ★ 지연 분포가 **0.5~4.9초 구간에서 0건**(웜 <50ms 80 · 50~500ms 24 · ≥4.9s 10)
//     ⟹ 그 경로는 느린 게 아니라 **멎는다**. 그래서 타임아웃 상향은 답이 아니다.
// 반증된 가설 = 버스트 동시성(17건 버스트 실패 0 · 6건 버스트 실패 1) · DNS 라운드로빈(A 1개) ·
//               Cloud NAT 포트 소진(오류 로그 활성인데 24h 0건) · 인스턴스 교체(전부 동일 인스턴스).
// 남은 원인 구간(캠퍼스 방화벽/MTU 계열)은 우리 통제면 밖이라, 여기서 할 수 있는 유일한 레버는
// **새 접속을 만드는 횟수를 줄이는 것**이다(idleTimeout 30→90s 가 그 절반을 했다 · 0.90→0.45/분).
//
// ⚠ 이건 원인 제거가 아니라 **노출 감소**다. 그리고 핵심은 횟수만이 아니라 **위치**다 —
//   접속 생성을 배경으로 옮기면 거기서 멎어도 **사용자 요청은 죽지 않는다**.
const WARM_FLOOR = 8; // 매분 버스트 동시 6~8 실측(aed 3종·gaspod·monitor/vital·calendar/media)
const WARM_INTERVAL_MS = 30_000; // 폴링 60초보다 짧게 — 버스트가 오기 전에 바닥이 차 있어야 한다

// 유휴가 있으면 그것을 잡고, 없으면 새로 만든다. 전부 붙잡고 있어야 실제로 생성이 일어난다
// (하나씩 잡았다 놓으면 같은 커넥션만 재사용되어 바닥이 안 찬다).
// ⚠ 순차로 만든다 — 동시에 여러 개를 열면 우리가 문제의 버스트를 재현하는 꼴이 된다.
//
// ★ 종료 조건은 **만진 수**(held.length)이지 **가진 수**(pool.totalCount)가 아니다 (2026-08-22 2차).
//   가진 수로 끊으면 바닥이 차 있는 동안 **기존 커넥션을 아무도 안 만져** 유휴 타이머가 리셋되지
//   않고, 그것들이 pg 자신의 idleTimeoutMillis(90초)에 걸려 죽는다. 그러면 다음 틱이 다시 만든다.
//   1차 배포(00311-nfk) 실측 — 열림 창 15분에 +3+2+2+2+2+2+1 = 14개 생성(0.93/분),
//   닫힘 창 15분에 9회 × 약 +7 = 4.2/분. 버스트가 만지면 +2, 아무도 안 만지면 +7 이었다.
//   전부 잡았다 놓으면 유휴 타이머가 전부 리셋되어 초기 채움 이후 생성이 0 에 수렴한다.
async function warmPool(pool: Pool): Promise<void> {
  // 실제 요청이 커넥션을 기다리는 중이면 물러난다 — 워머가 풀을 놓고 요청과 경쟁하면 안 된다.
  if (pool.waitingCount > 0) return;
  const held: PoolClient[] = [];
  const before = pool.totalCount;
  try {
    while (held.length < WARM_FLOOR) {
      held.push(await pool.connect());
    }
  } catch {
    // 멎거나 실패해도 삼킨다 — 요청 경로가 아니므로 사용자에게 전파되지 않는다.
    // (여기서 throw 하면 unhandled rejection 으로 프로세스가 죽는다.)
  } finally {
    for (const c of held) c.release();
  }
  const created = pool.totalCount - before;
  if (created > 0) {
    console.log(`[db] 웜 바닥 +${created} → total=${pool.totalCount} idle=${pool.idleCount}`);
  }
}

// ⚠ Cloud Run 은 요청 처리 중에만 CPU 를 준다(cpu-throttling 기본). 트래픽이 없으면 이 타이머는
//   거의 안 돈다 — 그래도 맞다. 트래픽이 없으면 버스트도 없기 때문이다.
function startPoolWarmer(pool: Pool): void {
  if (globalForDb.__safetyMonitorPoolWarmer) return;
  const timer = setInterval(() => {
    void warmPool(pool);
  }, WARM_INTERVAL_MS);
  timer.unref?.(); // 프로세스 종료를 붙잡지 않는다
  globalForDb.__safetyMonitorPoolWarmer = timer;
}

// 단일 Pool(HMR/serverless 안전) — SSL 여부는 DATABASE_URL 파라미터가 정한다(코드는 그대로 전달).
// ★ 현행(2026-08-13 전수 조사): 프로덕션 시크릿 v4 = `uselibpqcompat=true&sslmode=require`(아래 ②안)
//   → TLSv1.3 암호화 접속 실측. 서버 인증서 = 자체서명(CN=postgres·만료 2036-08). 서버는 TLS
//   비강제라 평문도 여전히 허용되며 로컬 .env.local(disable)은 평문으로 붙는다.
function getPool(): Pool {
  if (!globalForDb.__safetyMonitorPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL 미설정 — apps/dashboard-web/.env.local 확인");
    }
    // ⚠ DB SSL 전환 시 함정(2026-08-12 팀원 실측 — rlaxorhs77 의 DB 도메인 암호화 작업 중 발견).
    //   libpq 와 달리 node-postgres(pg 8.x)는 `sslmode=require` 를 사실상 verify-full 처럼 다룬다
    //   (Node TLS 기본 검증이 그대로 걸림) — 서버 인증서가 자체 서명이라 접속 자체가 거부된다(실측).
    //   "SSL 켜야지" 하고 DATABASE_URL 에 `sslmode=require` 만 붙이면 전 API 가 DB 접속 실패로 죽는다.
    //   (pg-connection-string 2.14 파서가 직접 경고: prefer/require/verify-ca 는 verify-full 별칭.)
    //   ★ 추가 함정(2026-08-13 실측 — 옆 세션): 현 서버 인증서는 SAN 이 없고 CN=postgres 라
    //     호스트명(project-db-campus.smhrd.com)과 영원히 불일치 → **CA 를 지정해도 verify-full 은
    //     구조적으로 불가**(자체 서명 여부와 별개). 검증 수준을 올리는 실제 선택지 =
    //     ⓐ 검증 없는 암호화(현행 ②안) ⓑ server.crt 확보 + checkServerIdentity 생략(CA 검증만)
    //     ⓒ 팀원이 SAN 포함 재발급 후 verify-full. 인증서 유효기간 = ~2036-08(갱신 부담 없음).
    //     → 08-13 확정: DB 서버 관리 주체(학원) 요청 경로 폐쇄로 ⓑ·ⓒ 도달 불가 —
    //       **이 DB 의 검증 상한 = ⓐ(검증 없는 암호화)** 로 종결. hostssl 강제도 없음(재론 불필요).
    //   올바른 전환 = ① 정석: 서버 CA 를 받아 ssl.ca(sslrootcert) 지정 — 단 위 SAN 함정으로
    //     호스트명 검증 생략(checkServerIdentity)이 동반돼야 접속된다
    //   ② libpq 호환: `uselibpqcompat=true&sslmode=require` — 검증 없이 암호화만이지만 같은 URL 이
    //     psql 등 다른 클라이언트에서도 동일하게 동작(URL 을 여러 곳에서 공유하면 이쪽이 사고가 적다)
    //     ★ 실측 검증됨(08-13) — 프로덕션 v4·로컬 .env.local 모두 이 형태로 pg_stat_ssl TLSv1.3 확인
    //   ③ 차선: `sslmode=no-verify` — ②와 보안 수준은 같으나 node-postgres 전용 확장이라 비호환.
    //   어느 쪽이든 env 는 시작 시 1회 resolve 라 새 리비전 배포가 동반돼야 한다(L-41 계열).
    const pool = new Pool({
      connectionString,
      // 2026-08-20 실측으로 8 → 16. 관제 화면이 매분 같은 초에 7건을 동시에 쏘는데(aed 3종·
      // gaspod·monitor/vital·calendar/media) 그중 하나가 5초 안에 커넥션을 못 얻어 500 이 났다.
      // 실패 라우트의 최대 지연이 정확히 5.01초 = 아래 connectionTimeoutMillis 였다.
      //   근거 = `Connection terminated due to connection timeout` 스택이 라우트 핸들러 안이고,
      //          같은 초 요청 로그에 7건이 함께 있다(요청 없는 백그라운드 타이머가 아니다).
      // ★ 서버 상한은 제약이 아니다 — max_connections 200 에 전 DB 합계 25 사용(여유 175).
      //   최악 상정 maxScale 4 × 16 = 64 로도 여유가 크다.
      // ⚠ 이건 증상 완화다. 근본은 요청당 DB 왕복 수이고 그쪽은 store.ts 폴링 캐시가 줄인다.
      max: 16,
      connectionTimeoutMillis: 5000, // 커넥션 획득 대기 상한(기본 0=무한 대기 방지)
      // 2026-08-21 실측으로 30초 → 90초. 대시보드 폴링이 60초 주기라 30초 정리는 매분
      // 커넥션을 전량 비웠고, 매분 같은 초의 버스트(동시 6~8)가 전부 새 물리 접속이 됐다.
      // 그 접속이 Cloud Run→캠퍼스 구간에서 가끔 5초(connectionTimeoutMillis)를 넘겨 500 —
      // 00304 는 대시보드가 열려 있던 38분 동안 매분 정확히 1건 실패했다(라우트는 돌아가며).
      // max 16 확대(08-20)로 안 잡힌 이유 = 풀 고갈이 아니라 물리 접속 지연이었다.
      // 90초면 60초 폴링 사이에 정리가 안 걸려 버스트가 웜 커넥션을 재사용한다.
      // ⚠ DB 서버 자체는 결백(동시 8 콜드 커넥트 35~48ms 실측) — 5초+ 구간은 미해명이고,
      //   이 값은 그 구간을 밟는 횟수를 줄이는 것이지 그 구간을 고치는 것이 아니다.
      idleTimeoutMillis: 90000,
      statement_timeout: 30000, // 세션 statement_timeout(ms) — 느린 쿼리의 풀 점유 방지
    });
    // 유휴 커넥션 error 를 잡아 프로세스 크래시 방지(핸들러 부재 시 미처리 'error'로 전체 다운).
    pool.on("error", (err) => {
      console.error("[db] PG 풀 유휴 커넥션 오류", err);
    });
    globalForDb.__safetyMonitorPgPool = pool;
    startPoolWarmer(pool);
  }
  return globalForDb.__safetyMonitorPgPool;
}

// Postgres 의 UTC ISO8601(밀리초) 문자열 — SQLite strftime('%Y-%m-%dT%H:%M:%fZ','now') 동일 포맷.
const NOW_ISO =
  `to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// 스키마 초기화 DDL 의 잠금 대기 상한 — 다른 세션의 긴 조회가 ACCESS EXCLUSIVE 를 막고 있어도
// 여기서 끊는다. 이 대기를 안 끊으면 대기 중인 DDL 뒤로 모든 조회가 FIFO 로 줄서서 API 전체가 죽는다
// (2026-07-30 실제 장애 — 58분짜리 조회 하나가 관제웹 전 라우트를 500 으로 만들었다).
const SCHEMA_LOCK_TIMEOUT = "3s";
// 초기화 실패 후 재시도 유예 — 유예가 없으면 잠금이 풀릴 때까지 매 요청이 lock_timeout 만큼 지연된다.
const SCHEMA_RETRY_BACKOFF_MS = 60_000;
let schemaRetryAfter = 0;

// 스키마 멱등 생성 — 첫 쿼리 시 1회(메모이즈).
// 실패는 치명적으로 다루지 않는다 — 운영 DB 에는 이미 스키마가 있으므로 조회는 계속 되어야 한다.
// 정말 테이블이 없으면 이어지는 쿼리가 자기 오류로 실패하므로 문제가 가려지지도 않는다.
async function ensureSchema(): Promise<void> {
  if (!globalForDb.__safetyMonitorSchemaReady) {
    if (Date.now() < schemaRetryAfter) return; // 유예 중 — 기존 스키마로 진행
    globalForDb.__safetyMonitorSchemaReady = initSchema().catch((e) => {
      globalForDb.__safetyMonitorSchemaReady = undefined;
      schemaRetryAfter = Date.now() + SCHEMA_RETRY_BACKOFF_MS;
      console.error(
        "[db] 스키마 초기화 실패 — 기존 스키마로 계속 진행(60초 후 재시도)",
        e,
      );
    });
  }
  return globalForDb.__safetyMonitorSchemaReady;
}

async function initSchema(): Promise<void> {
  // 전용 커넥션 — lock_timeout 은 세션 설정이라 풀 공유 커넥션에 남으면 일반 쿼리까지 영향받는다.
  const client = await getPool().connect();
  try {
    await client.query(`SET lock_timeout = '${SCHEMA_LOCK_TIMEOUT}'`);
    await client.query(`
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
    -- ⚠ idx_vs_worker_ts(worker_id, ts) 를 여기서 제거했다(2026-08-15). 아래 uq_vs_worker_ts 가
    --   **같은 컬럼 조합**의 UNIQUE 인덱스라 구조적으로 중복이고, UNIQUE 쪽이 같은 질의를 전부
    --   커버한다. 순서상 이 줄이 먼저 있었고 나중에 멱등 적재용 UNIQUE 가 추가되며 쓸모가
    --   사라졌는데 아무도 안 지웠다.
    --   ★ 지운 이유가 용량만은 아니다 — 이 줄이 남아 있으면 **DROP 해도 배포마다 부활한다.**
    --     실제로 08-15 19:30 에 DROP 해서 49MB 를 회수했는데 20:0x 배포의 ensureSchema 가
    --     21MB 로 되살렸다(약 30분 만에 무효화). DB 객체 삭제는 코드에서 지워야 유지된다.
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
    -- 폰 수신 시각(2026-08-18 · watch-delivery-lag E-2). 세 시각을 셋 다 남긴다 —
    -- 측정 · **폰 수신** · 서버 도착(received_at). ts 계약이 측정 시각으로 바뀌면
    -- ts − heart_rate_measured_at 이 항상 0 이 되어 워치→폰 지연을 못 재게 되는데,
    -- 그 지표가 08-18 시험 B(거리 가설 확정)를 포함한 이 트랙 전체의 근거였다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS phone_received_at TEXT;
    -- 워치 세션 계측(2026-08-19 · vital-absence-triage §4-7). session_started_at 이 바뀌는
    -- 지점이 곧 HKWorkoutSession 재시작이고, session_auto_resumed 가 그 주체를 가른다.
    -- ⚠ 자동 재개(f67442f) 설치 후에도 20.9분·12.9시간 공백이 났는데 원인 셋을 DB 로 못 갈랐다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_started_at TEXT;
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_auto_resumed INTEGER;
    -- 세션 종료 계측(2026-08-20 · docs/watch-auto-resume). 위 둘로는 session_auto_resumed = 0
    -- 이 "자동 재개가 시도조차 안 됐다" 인지 "사람이 [시작] 을 눌렀다" 인지 못 가른다(실측 9세션 전부 0).
    -- ⚠ 이 블록은 템플릿 리터럴 안이다 — 주석에 백틱을 쓰면 문자열이 그 자리에서 끊긴다.
    -- 워치 os_log 는 회수 경로가 없어 디스크에 적어 다음 세션 첫 배치에 실어 보낸다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_end_seen_at TEXT;
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_end_by_user INTEGER;
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_resume_tried_at TEXT;
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_resume_tries SMALLINT;
    -- 오류 종료의 도메인#코드(2026-08-22 · 예 com.apple.healthkit#12). 읽는 곳 = 수사 절차의
    -- 지문 조회(docs/watch-auto-resume/checklist.md SQL). 판정·경보·화면 유입 금지(가드 고정).
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS session_end_error TEXT;
    -- 배터리 충전카운터(µAh) — 퍼센트(battery_pct)보다 약 100배 촘촘한 잔량. 두 표본의 차이가
    -- 곧 그 사이 소모량이라 짧은 구간의 소모율을 계단 없이 잴 수 있다(2026-08-26 · 워치 A안).
    -- BIGINT 인 이유 = 폰 배터리(수천 mAh = 수천만 µAh)도 같은 열을 쓴다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS battery_charge_uah BIGINT;
    -- 모션 변동폭(2026-08-19) — 1Hz 60초 창 |userAcceleration| 표준편차 밀리g.
    -- ⚠ 판정·경보·화면 미사용. 착용 판별 후보 축의 재료일 뿐이고 분포가 안 갈리면 폐기한다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS motion_var_mg SMALLINT;
    -- 백그라운드 하트비트 = 새 심박 없이 최신 스냅샷을 재전송한 행(심박이 복사본).
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS heartbeat INTEGER;
    -- 착용 기기 — 혈중산소 센서 유무(Series 6+/Ultra)를 가려 SpO2 결측 원인을 확정한다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS watch_device_model TEXT;
    -- 온열 환경·강도 입력(2026-08-14) — ACGIH/ISO 7243 이 요구하는 표준 입력.
    -- physical_effort_met = 절대적 운동 강도(MET). 체중 정규화라 작업자 간 비교가 성립한다.
    -- time_in_daylight_min = 일광 노출(분·구간 합). WBGT 실외/실내 공식 분기를 작업자별로 가른다.
    -- 판정 미주입 — 값 도착을 관찰한 뒤 WBGT·TLV 설계로 넘어간다(HRV 교훈: API 존재 ≠ 도착).
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS physical_effort_met DOUBLE PRECISION;
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS time_in_daylight_min DOUBLE PRECISION;
    -- location_accuracy_m = 좌표의 수평 정확도(m·CLLocation.horizontalAccuracy).
    -- 이게 없으면 latitude/longitude 가 ±5m 인지 ±1,500m 인지 구분할 수 없다. 구 앱이 이미
    -- 보내고 있었는데 스키마에 없어 전량 무음 폐기됐다(BND-CONTRACT-01 계열).
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS location_accuracy_m DOUBLE PRECISION;
    -- location_timestamp = 좌표를 **측위한** 시각(ts 는 전송 시각이라 다르다).
    -- 서버가 좌표 없는 샘플에 직전 좌표를 이어 붙이므로(store.ts sticky merge), 이 값이 없으면
    -- 심박이 5초 전이어도 좌표는 40분 전 것일 수 있다는 사실을 **이력에서는 알 수 없다**.
    -- ts 와 같은 ISO-UTC TEXT — 두 값의 차가 곧 그 좌표의 나이다.
    ALTER TABLE vital_samples ADD COLUMN IF NOT EXISTS location_timestamp TEXT;
    CREATE INDEX IF NOT EXISTS idx_vs_data_origin_ts ON vital_samples(data_origin, ts DESC);

    -- ts 는 TEXT 라 ORDER BY·범위비교·MAX 가 전부 문자열 비교로 돈다. 고정폭 ISO-UTC 는
    -- 사전순 = 시간순이 보장되지만 밀리초 없는 '…46Z' 가 섞이면 깨진다('.' 0x2E < 'Z' 0x5A
    -- 라 '…46.500Z' 가 앞으로 정렬돼 시간이 거꾸로 간다). 스키마 정규화(canonicalIsoMs)로
    -- 새 행은 막고, 여기서 DB 가 거부하게 해 다른 경로로도 못 들어오게 굳힌다.
    -- NOT VALID = 기존 행 재검사 생략(백필 후 VALIDATE CONSTRAINT 로 승격). 신규 INSERT 는 즉시 적용된다.
    -- 정규식에 백슬래시를 쓰지 않는다 — 이 SQL 은 템플릿 리터럴이라 숫자 클래스 축약형이
    -- JS 단계에서 백슬래시를 잃고 평문 문자로 죽어 제약이 조용히 무력화된다
    -- (lint no-useless-escape 가 실제로 잡았다). [0-9]·[.] 로 표현한다.
    DO $ts_fmt$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_vital_ts_iso_ms'
      ) THEN
        ALTER TABLE vital_samples ADD CONSTRAINT chk_vital_ts_iso_ms
          CHECK (ts ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$') NOT VALID;
      END IF;
    END $ts_fmt$;

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

    -- 사고(산업재해) 등록 원장 — 사고 조사 뷰의 앵커 + 보존 마킹(2026-08-13 사용자 결정).
    -- ★ 보존 정책: 등록된 사고의 구간(occurred_at ± 조사 창 이상, 최소 ±24h)은 **3년 보존**(KOSHA 축).
    --   생체 원시 데이터(vital_samples 등)에 리텐션(자동 삭제)을 도입하는 사람은 반드시 이 테이블을
    --   선조회해 해당 구간을 삭제 대상에서 제외해야 한다. 현재는 전체가 무삭제라 지울 코드가 없다.
    -- 사고 행 삭제 API 는 의도적으로 없다(감사 자료 — 오등록 정정은 별도 결정 사항).
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      worker_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_worker ON incidents(worker_id, occurred_at);

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

    -- 조달 공고 안전관리비 **담당관 확정** — 검증 판정이 쓰는 유일한 확정값.
    -- ★ 왜 따로 두나 — 값의 출처가 셋인데 신뢰도가 다르다.
    --   ⓐ 조달 API = 안 준다(2026-08-27 실측: 공고 143·계약 43 필드에 안전관리비 없음)
    --   ⓑ 첨부 내역서 파싱 = **초안**이다. 공란 내역서·구형 .xls·PDF 가 흔하고 오독도 난다.
    --   ⓒ 시공사 자기신고 = 피검증자가 판정 기준을 적는 것이라 검증이 성립하지 않는다.
    --   그래서 확정은 근거 문서를 **본** 담당관만 한다(2026-08-27 사용자 설계 결정).
    -- ⚠ append-only — UPDATE·DELETE 를 만들지 않는다. 수정은 새 행이고 최신은 id DESC 한 건이다.
    --   확정값이 조용히 바뀌면 "그때 무엇을 보고 그렇게 판정했나"를 재구성할 수 없다.
    -- ⚠ draft_json 은 **확정 당시의 파싱 초안**이다. 파서를 고치면 오늘의 초안은 달라지므로
    --   담당관이 실제로 마주했던 화면을 남기려면 그때 값을 그대로 얼려 둬야 한다.
    CREATE TABLE IF NOT EXISTS procure_cost_confirm (
      id SERIAL PRIMARY KEY,
      notice_id TEXT NOT NULL,
      target_amount BIGINT,
      declared_cost BIGINT,
      construction_type TEXT,
      evidence_file TEXT,
      evidence_url TEXT,
      evidence_locus TEXT,
      draft_json TEXT,
      note TEXT,
      confirmed_by TEXT NOT NULL,
      confirmed_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );
    CREATE INDEX IF NOT EXISTS idx_pcc_notice ON procure_cost_confirm(notice_id, id DESC);

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
    -- 현장 담당관(안전관리비 확정 권한) — owner 가 사용자 관리에서 부여(자가취득 불가).
    -- ⚠ job_title(직책)에 권한을 걸지 않는다 — 그 컬럼은 본인 편집이라 글자만 바꾸면 자가승격이 된다.
    --   admin_access 와 같은 패턴: 표기는 직책이 하되 권한은 이 비트가 결정한다(2026-08-27 사용자 결정).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS site_officer BOOLEAN NOT NULL DEFAULT false;
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
    -- 임시 비밀번호 만료(ISO) — owner 가 재설정을 승인하면 채워지고, 본인이 비번을 바꾸면 NULL 로 돌아간다.
    -- 이 컬럼 하나가 "임시 비번 상태인가"와 "언제까지인가"를 함께 표현한다(플래그 컬럼을 따로 두지 않는 이유).
    -- 만료가 지나면 로그인 자체를 거부한다 — 클라이언트 '변경 강제' 화면은 우회되므로 만료가 실질 방어다.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires_at TEXT;

    -- 비밀번호 재설정 요청(승인제) — 사용자가 신청하고 owner 가 사용자 관리 화면에서 처리한다.
    -- 이메일 발송 경로가 막혀 있어(EMAIL_FROM 미설정 → Resend 계정 본인 메일로만 배달) 사람이 승인한다.
    -- 도메인 확보 후 메일 링크로 전환하더라도 이 테이블은 그대로 쓴다(승인 주체만 사람→토큰으로 바뀜).
    CREATE TABLE IF NOT EXISTS password_reset_request (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
      resolved_at TEXT,
      resolved_by TEXT
    );
    -- 한 계정당 미처리 요청은 하나 — 애플리케이션 검사만 두면 동시 요청 2건이 통과한다(다중 인스턴스).
    -- 처리된 행은 제약 밖이라 이력이 쌓이고 재신청도 가능하다.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prr_pending
      ON password_reset_request(user_id) WHERE status = 'pending';

    -- env 관리자(owner)의 내 정보 — 자격이 환경변수(ADMIN_ID/ADMIN_PASSWORD)라 users 행이 없다.
    -- users 에 행을 만들면 '사용자 관리' 목록에 승인/거절 대상으로 뜨는데, 거절해도 로그인은
    -- env 로 계속 되므로 화면과 실제가 어긋난다 → 프로필만 담는 별도 단일행 테이블로 분리한다.
    -- 비밀번호는 여기 두지 않는다(자격은 env 가 단일 소스).
    CREATE TABLE IF NOT EXISTS owner_profile (
      username TEXT PRIMARY KEY,
      name TEXT,
      company TEXT,
      phone TEXT,
      carrier TEXT,
      department TEXT,
      job_title TEXT,
      employee_id TEXT,
      guardian_name TEXT,
      guardian_phone TEXT,
      updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
    );

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
    -- 여러 날에 걸친 일정(2026-08-20). NULL 이면 하루짜리 — 기존 행이 전부 그렇다.
    -- ★ 시작은 date_key 를 그대로 쓴다. 컬럼을 둘로 늘리면 기존 조회·인덱스가 전부 바뀐다.
    ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS end_date_key TEXT;
    -- 일정 메모(2026-08-20). 지금까지 일정에 상세를 적을 자리가 없었다.
    -- ⚠ calendar_media.description 과 이름을 겹치지 않게 note 로 둔다 — 그쪽은 댓글로 이관됐다.
    ALTER TABLE calendar_event ADD COLUMN IF NOT EXISTS note TEXT;
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
  } finally {
    // 커넥션을 풀에 돌려주기 전 세션 설정 복구 — 남기면 일반 쿼리도 3초에 잠금 포기하게 된다.
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
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

// DB 헬스 왕복(/api/health/db 전용) — 데이터 접근 없는 SELECT 1. q 는 비공개를 유지한다
// (범용 쿼리 함수를 export 하면 라우트들이 db.ts 의 함수 계약을 우회해 임의 SQL 을 뿌리게 된다).
export async function dbPing(): Promise<void> {
  await q("SELECT 1");
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

/**
 * `vital_samples`(실데이터 테이블)에 들어갈 수 있는 출처.
 *
 * 목업(`mockup_*`)은 `data_mockup` 으로 따로 가므로 여기 넣지 않는다 — 이 집합의 존재
 * 이유가 그 격리다. **실기기 종류가 늘면 여기에 더한다.**
 */
const REAL_DEVICE_ORIGINS: ReadonlySet<string> = new Set([
  "ios_data_vitalguard",
  "watchos_data_vitalguard",
  "wearos_data_vitalguard",
]);

// 단건 insert — sample 은 zod 검증 통과한 정상 값
export async function persistSample(sample: VitalSample): Promise<void> {
  // ★ 이 관문의 목적은 **목업 격리**다 — 실데이터 테이블에 mockup_* 이 섞이는 것을 막는다.
  //   실기기 출처가 늘어나면 여기도 함께 늘려야 한다. 08-25 에 갤럭시(`wearos_…`)를 추가하며
  //   store.ts·스키마·컬럼만 보고 여기를 빠뜨려, 실기에서 store 는 accepted 인데 persist 가
  //   throw 하는 상태가 됐다(워치 롤백으로 복구). 관문은 넷이다 — 스키마·분류·**여기**·컬럼.
  // dataOrigin 은 스키마상 optional 이라 undefined 가 올 수 있다 — 그때도 거부다(종전 동작 유지).
  if (sample.dataOrigin === undefined || !REAL_DEVICE_ORIGINS.has(sample.dataOrigin)) {
    throw new Error(
      `실데이터 테이블에는 실기기 출처만 저장할 수 있습니다(받은 값 ${sample.dataOrigin}). ` +
        `허용: ${[...REAL_DEVICE_ORIGINS].join(", ")}`,
    );
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
    battery_charge_uah: sample.batteryChargeUah ?? null,
    session_started_at: sample.sessionStartedAt ?? null,
    motion_var_mg: sample.motionVariabilityMg ?? null,
    session_auto_resumed:
      sample.sessionAutoResumed === true ? 1 : sample.sessionAutoResumed === false ? 0 : null,
    session_end_seen_at: sample.sessionEndSeenAt ?? null,
    // ⚠ `?? null` 로 접으면 false 가 null 이 된다 — "사람이 안 눌렀다"(false)와 "모른다"(null)는
    //   정반대 판정이라 섞이면 안 된다. session_auto_resumed 와 같은 3분기를 쓴다.
    session_end_by_user:
      sample.sessionEndByUser === true ? 1 : sample.sessionEndByUser === false ? 0 : null,
    session_resume_tried_at: sample.sessionResumeTriedAt ?? null,
    session_resume_tries: sample.sessionResumeTries ?? null,
    session_end_error: sample.sessionEndError ?? null,
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
    // 좌표 품질 — 없으면 위 두 값이 얼마나 믿을 만한지 판정할 근거가 사라진다.
    location_accuracy_m: sample.locationAccuracyMeters ?? null,
    // 좌표 나이 — ts 와의 차가 "이 좌표가 언제 것인가". 이어 붙인 좌표를 이력에서 가른다.
    location_timestamp: sample.locationTimestamp ?? null,
    hrv_sdnn_ms: sample.hrvSdnnMs ?? null,
    resting_heart_rate: sample.restingHeartRate ?? null,
    active_energy_kcal: sample.activeEnergyKcal ?? null,
    steps: sample.steps ?? null,
    walking_heart_rate: sample.walkingHeartRate ?? null,
    flights_climbed: sample.flightsClimbed ?? null,
    respiratory_rate: sample.respiratoryRate ?? null,
    // 온열 환경·강도 입력 — 워치 앵커드 쿼리라 측정이 있을 때만 실린다(sparse).
    physical_effort_met: sample.physicalEffortMet ?? null,
    time_in_daylight_min: sample.timeInDaylightMin ?? null,
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
    // 폰 수신 시각 — 앱이 아직 안 보내는 동안은 ts 가 곧 폰 수신 시각이라 그것으로 폴백한다.
    // ⚠ ts 계약을 측정 시각으로 옮기는 앱 변경은 phoneReceivedAt 전송을 **반드시** 동반해야 한다.
    //   안 그러면 이 폴백이 측정 시각을 여기 넣어 워치→폰 지연이 조용히 0 으로 굳는다.
    phone_received_at: sample.phoneReceivedAt ?? sample.ts,
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
// 구간 심박 버킷 평균 — 추세 차트 실데이터(심박·심부체온 추정 궤적)용. 별칭 확장은 호출부가
// ID 배열로 넘긴다(과거 이력이 secondary ID 로 저장돼 있어 primary 하나로는 비어 보인다).
/**
 * ★ 시간 기준 = **측정 시각**(2026-08-18 · A-1). 버킷·집계는 `heart_rate_measured_at`,
 * 조회 범위(WHERE)는 `ts` 다. 둘을 나눈 이유가 각각 있다.
 *
 * **왜 버킷을 옮겼나.** `ts` 는 폰이 워치에서 받은 시각이라, 전달이 끊겼다 복구되면 그 사이 측정이
 * **전부 복구 순간의 한 분에 뭉친다**. 08-18 시험 B 실측 — 워치는 20분 내내 12건/분을 쟀는데
 * `ts` 기준 커버는 **15분**이고 측정 기준은 **21분**이었다. 사라진 5분이 10:57 한 분에 73건으로
 * 몰렸다. 화면은 그것을 "5분 미수집"으로 그렸지만 **수집은 끊긴 적이 없다** — 전달만 끊겼다.
 *
 * **왜 WHERE 는 `ts` 로 두나.** 인덱스가 전부 `ts` 에 있고(`uq_vs_worker_ts` 등) 측정 시각에는
 * 없다. WHERE 를 옮기면 인덱스를 못 탄다. EXPLAIN 실측 — 두 방식 모두 같은
 * `Bitmap Index Scan on uq_vs_worker_ts` 를 타고 실행 시간 117.9ms vs 119.8ms(+1.6%)로
 * 사실상 동일하며, 버킷 수만 496 → 501 로 늘었다(= 되살아난 5분).
 *
 * ⚠ **경계 효과** — 창 안에서 측정됐지만 창이 끝난 뒤 도착한 표본은 빠진다. 지연이 창 경계를
 * 넘을 때만 생기고 일 단위 창에서는 분 단위 효과라 감수한다. 없애려면 WHERE 를 지연 최댓값만큼
 * 넓혀야 하는데 그만큼 스캔이 늘어 이득에 비해 비싸다.
 *
 * ⚠ **라이브 '연결끊김' 표시는 이 변경 대상이 아니다.** 그 순간 데이터가 실제로 없었으므로 그
 * 표시는 정확하다. 여기서 고치는 것은 **지나고 나서 그리는 기록**이다.
 *
 * ⚠ **`firstDataDay` 는 `ts` 기준으로 남겨 뒀다(의도).** 기준이 갈리면 "측정 기준으로는 수집된 날인데
 * 최초 수집일보다 이전" 인 하루가 생길 수 있는데, **클라이언트가 이미 그 경우를 흡수한다** —
 * `buildCoverageCells` 가 `minutes > 0` 이면 무조건 covered 로 그린다("실제 데이터가 이긴다").
 * 반면 옮기면 `MIN(ts)` 의 Index Only Scan 이 Bitmap Heap Scan 으로 바뀌어 버퍼가 2.8배가 된다
 * (실측 4,054 → 11,494 · 21ms → 59ms). **화면에 보이는 차이 0 에 비용만 드는 변경이라 하지 않았다.**
 */
export async function heartRateBucketAverages(
  workerIds: string[],
  fromMs: number,
  toMs: number,
  bucketSec: number,
): Promise<{ bucket_start_sec: number; bpm: number }[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<{ bucket_start_sec: number; bpm: number }>(
    `SELECT (floor(extract(epoch from COALESCE(heart_rate_measured_at, ts)::timestamptz) / $4) * $4)::bigint AS bucket_start_sec,
            avg(heart_rate) AS bpm
       FROM vital_samples
      WHERE worker_id = ANY($1)
        AND heart_rate IS NOT NULL
        AND ts::timestamptz >= to_timestamp($2)
        AND ts::timestamptz < to_timestamp($3)
      GROUP BY 1
      ORDER BY 1`,
    [workerIds, Math.floor(fromMs / 1000), Math.ceil(toMs / 1000), bucketSec],
  );
  return rows;
}

/**
 * 구간 **실측 피부온** 버킷 평균 — 추세 차트의 '체온(실측)' 시리즈.
 *
 * ★ 왜 심박 추정과 따로 두나. 추정 궤적(`estimateCoreTempSeries`)은 심박에서 만든 **파생값**이고
 * 이것은 워치 온도 센서가 실제로 잰 값이다. 둘을 한 시리즈로 섞으면 센서가 죽은 구간을 추정이
 * 메워 "측정이 있었다"로 보인다 — 이 레포가 반복해 고쳐 온 false-OK 형태다([[L-115]] 계열).
 *
 * ⚠ **시간 기준은 `ts` 다** — 심박(`heart_rate_measured_at`)·SpO₂(`spo2_measured_at`)와 달리
 * 피부온에는 측정 시각 컬럼이 **없다**(스키마 확인 2026-08-26). 따라서 전달이 끊겼다 복구되면
 * 그 구간 측정이 복구 순간에 뭉치는 경계 효과가 심박보다 크게 남는다. 컬럼을 추가하기 전에는
 * 이 한계가 구조적이므로, 없는 정확도를 있는 척하지 않고 여기 적어 둔다.
 */
export async function skinTempBucketAverages(
  workerIds: string[],
  fromMs: number,
  toMs: number,
  bucketSec: number,
): Promise<{ bucket_start_sec: number; temp_c: number }[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<{ bucket_start_sec: number; temp_c: number }>(
    `SELECT (floor(extract(epoch from ts::timestamptz) / $4) * $4)::bigint AS bucket_start_sec,
            avg(skin_temp_c) AS temp_c
       FROM vital_samples
      WHERE worker_id = ANY($1)
        AND skin_temp_c IS NOT NULL
        AND ts::timestamptz >= to_timestamp($2)
        AND ts::timestamptz < to_timestamp($3)
      GROUP BY 1
      ORDER BY 1`,
    [workerIds, Math.floor(fromMs / 1000), Math.ceil(toMs / 1000), bucketSec],
  );
  return rows;
}

/**
 * KST 달력일별 **수집된 분** (0~1440) — 커버리지 히트맵의 칸 값.
 *
 * 왜 시간이 아니라 분인가. `COUNT(DISTINCT hour)` 로 재면 **한 시간에 샘플 하나만 와도 그 시간이
 * 꽉 찬 것으로** 계산된다 — 정체·버스트가 잦은 우리 데이터에서 커버리지를 크게 과대평가한다.
 * 워치는 분당 12건을 보내므로 "그 분에 샘플이 하나라도 있었다"는 실제로 수집된 분이라 볼 수 있다.
 *
 * ⚠ 값이 0 인 날은 **행이 나오지 않는다**(GROUP BY 라 없는 날은 없는 행이다). 호출부가 그 부재를
 *   "미수신"과 "운영 이전"으로 갈라야 한다 — 둘을 같은 칸으로 그리면 없는 사고를 수백 건 그린다.
 */
export async function dailyCoverageMinutes(
  workerIds: string[],
  fromMs: number,
  toMs: number,
): Promise<{ day: string; minutes: number }[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<{ day: string; minutes: number }>(
    `SELECT to_char((COALESCE(heart_rate_measured_at, ts)::timestamptz AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT date_trunc('minute', COALESCE(heart_rate_measured_at, ts)::timestamptz AT TIME ZONE 'Asia/Seoul')) AS minutes
       FROM vital_samples
      WHERE worker_id = ANY($1)
        AND ts::timestamptz >= to_timestamp($2)
        AND ts::timestamptz < to_timestamp($3)
      GROUP BY 1
      ORDER BY 1`,
    [workerIds, Math.floor(fromMs / 1000), Math.ceil(toMs / 1000)],
  );
  return rows.map((r) => ({ day: r.day, minutes: Number(r.minutes) }));
}

/**
 * 그 워커의 **최초 수집일**(KST, `YYYY-MM-DD`). 없으면 null.
 *
 * 히트맵에서 "운영 이전"과 "미수신"을 가르는 유일한 기준이다. 조회 창이 아니라 **전 기간**을 본다 —
 * 창 안에 첫날이 없으면 창 전체가 운영 이전일 수도, 전부 미수신일 수도 있어 창만으로는 못 가른다.
 */
export async function firstDataDay(workerIds: string[]): Promise<string | null> {
  if (workerIds.length === 0) return null;
  const { rows } = await q<{ day: string | null }>(
    `SELECT to_char(MIN((ts::timestamptz AT TIME ZONE 'Asia/Seoul')::date), 'YYYY-MM-DD') AS day
       FROM vital_samples WHERE worker_id = ANY($1)`,
    [workerIds],
  );
  return rows[0]?.day ?? null;
}

// 최근 심박 시계열 — 심부체온 추정(심박 기반 칼만필터)의 입력. 워커 구분 없이 창 전체를 받아
// 호출부(store)가 별칭 접기 후 워커별로 나눈다. 표시 전용 경로라 실패해도 수집·판정과 무관.
export async function recentHeartRates(
  windowMinutes: number,
): Promise<{ worker_id: string; ts: string; heart_rate: number }[]> {
  const { rows } = await q<{ worker_id: string; ts: string; heart_rate: number }>(
    `SELECT worker_id, ts, heart_rate FROM vital_samples
      WHERE heart_rate IS NOT NULL
        AND ts::timestamptz > (now() - $1::interval)
      ORDER BY ts`,
    [`${windowMinutes} minutes`],
  );
  return rows;
}

// 최근 심박+활동에너지 시계열 — 저활동·고심박 패턴(온열 ②·표시 주석 전용)의 입력.
// 창(15분)보다 긴 구간을 받는 이유 = 에너지 파이프라인 존재 확인(15분 내내 쉬면 증분 0 이
// 정상이라, 구간 전체에 ae 가 한 건도 없어야 "미수집 워커"로 구분된다). 실패해도 표시만 생략.
export async function recentHrEnergy(
  windowMinutes: number,
): Promise<{ worker_id: string; ts: string; heart_rate: number | null; active_energy_kcal: number | null }[]> {
  const { rows } = await q<{
    worker_id: string;
    ts: string;
    heart_rate: number | null;
    active_energy_kcal: number | null;
  }>(
    `SELECT worker_id, ts, heart_rate, active_energy_kcal FROM vital_samples
      WHERE (heart_rate IS NOT NULL OR active_energy_kcal IS NOT NULL)
        AND ts::timestamptz > (now() - $1::interval)
      ORDER BY ts`,
    [`${windowMinutes} minutes`],
  );
  return rows;
}

// 구간 SpO₂ 실측 행 — 추세 차트용(측정 1건 = 점 1개). 기회 측정이라 행 수가 적다(하루 수 건).
export async function spo2MeasurementsBetween(
  workerIds: string[],
  fromMs: number,
  toMs: number,
): Promise<{ ts: string; spo2: number; spo2_measured_at: string | null }[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<{ ts: string; spo2: number; spo2_measured_at: string | null }>(
    `SELECT ts, spo2, spo2_measured_at FROM vital_samples
      WHERE worker_id = ANY($1)
        AND spo2 IS NOT NULL
        AND ts::timestamptz >= to_timestamp($2)
        AND ts::timestamptz < to_timestamp($3)
      ORDER BY COALESCE(spo2_measured_at, ts)`,
    [workerIds, Math.floor(fromMs / 1000), Math.ceil(toMs / 1000)],
  );
  return rows;
}

// 워커별 DB 의 마지막 SpO₂ 행 — 표시 겹침(lib/spo2-overlay)용. spo2 는 기회 측정이라 단독 행
// 1건으로 오고, 인스턴스 메모리 병합만으로는 다른 인스턴스 응답에서 값이 빈다(2026-08-12 실측).
// 창(window)을 신선 한도보다 넉넉히 잡고, 신선 판정 자체는 겹침 쪽에서 측정 시각으로 한다.
/**
 * 워커 몇 명의 최근 원본 샘플 — **인스턴스 메모리를 거치지 않는다**(폰 본인 조회용).
 *
 * ★ `latestByWorker` 는 그 프로세스가 받은 POST 만 담은 메모리 링이라, `maxScale=4` 에서
 * 폰이 자기 샘플을 받은 적 없는 인스턴스에 붙으면 **영영 빈 값**이 온다(2026-08-18 실측:
 * 최근 1시간 인스턴스 2개). 관제 화면은 여러 워커를 한꺼번에 보므로 덜 드러나지만,
 * 한 사람만 보는 폰에서는 그 사람 값이 통째로 사라진다.
 *
 * `raw_json` 을 스키마로 되살려 돌려주므로 호출부가 `mergeLatestByWorker` 를 그대로 쓸 수 있다
 * — 관제 화면과 **같은 병합 규칙**(활동 필드 TTL 포함)을 공유해 값이 갈리지 않는다.
 * 오래된 순서로 돌려준다(병합이 뒤 샘플로 덮는 계약).
 */
export async function recentSamplesForWorkers(
  workerIds: string[],
  windowMinutes = 30,
  limit = 400,
): Promise<VitalSample[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<{ raw_json: unknown }>(
    `SELECT raw_json FROM vital_samples
      WHERE worker_id = ANY($1::text[])
        AND ts::timestamptz > (now() - $2::interval)
      ORDER BY ts DESC, id DESC LIMIT $3`,
    [workerIds, `${windowMinutes} minutes`, Math.min(Math.max(limit, 1), 1000)],
  );
  const samples: VitalSample[] = [];
  for (const row of rows) {
    try {
      const raw = typeof row.raw_json === "string" ? JSON.parse(row.raw_json) : row.raw_json;
      const parsed = VitalSampleSchema.safeParse(raw);
      if (parsed.success) samples.push(parsed.data);
    } catch {
      // 원문 손상 행은 건너뛴다 — 한 행 때문에 조회 전체를 잃지 않는다.
    }
  }
  return samples.reverse();
}

/**
 * 최근 안정 심박 — **기준값(baseline)이라 창을 길게 잡는다.**
 *
 * 애플이 하루 단위로 산출하는 값이라 며칠 전 값도 그 사람의 기준으로 유효하다. 반면
 * HRV·호흡수는 그 순간의 상태 지표라 같은 취급을 하면 안 된다(며칠 전 HRV 로 "지금 스트레스"
 * 를 말하게 된다) — 그래서 이 함수는 안정 심박만 본다.
 *
 * 필요한 이유 = PSI 의 기준 심박(HR0). 없으면 문헌 기본값 60 으로 떨어져 개인화가 풀린다.
 * 2026-08-18 실측에서 이 워커의 마지막 안정 심박은 하루 전이었고, 관제 화면은 인스턴스 메모리가
 * 그 값을 계속 들고 있어 개인화된 값을 쓰고 있었다 — 창이 짧으면 폰만 값이 갈린다.
 */
export async function latestRestingHeartRate(
  workerIds: string[],
  days = 7,
): Promise<{ bpm: number; ts: string } | null> {
  if (workerIds.length === 0) return null;
  const { rows } = await q<{ resting_heart_rate: number; ts: string }>(
    `SELECT resting_heart_rate, ts FROM vital_samples
      WHERE worker_id = ANY($1::text[])
        AND resting_heart_rate IS NOT NULL
        AND ts::timestamptz > (now() - $2::interval)
      ORDER BY ts DESC LIMIT 1`,
    [workerIds, `${days} days`],
  );
  const row = rows[0];
  return row ? { bpm: row.resting_heart_rate, ts: row.ts } : null;
}

export async function latestSpo2ByWorker(
  windowMinutes = 40,
): Promise<{ worker_id: string; spo2: number; spo2_measured_at: string | null; ts: string }[]> {
  const { rows } = await q<{ worker_id: string; spo2: number; spo2_measured_at: string | null; ts: string }>(
    `SELECT DISTINCT ON (worker_id) worker_id, spo2, spo2_measured_at, ts
       FROM vital_samples
      WHERE spo2 IS NOT NULL
        AND ts::timestamptz > (now() - $1::interval)
      ORDER BY worker_id, ts DESC`,
    [`${windowMinutes} minutes`],
  );
  return rows;
}

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
  //
  // 인원 산정 규칙 두 가지 — 안전관리비 판정(청구수량 ÷ 실측인원)이 인원 수에 직결되므로 필수다.
  // ① 별칭 폴딩: 한 사람이 폰·워치에서 다른 ID 로 들어오면(EMP-7276/WORKER7276/worker7276 …)
  //    worker_alias 로 주 ID 에 접는다. 안 접으면 1명이 여러 명으로 세어져 인원이 부풀고,
  //    청구수량 ÷ 인원 비율이 낮아져 과다 산정이 탐지되지 않는다(적발 실패 방향의 오차).
  // ② 승인 계정 한정: 출역으로 인정하려면 users 의 승인된 근로자 계정이어야 한다. 장비 계정
  //    (AED-08), 시뮬레이터·데모·디버그 단말은 사람이 아니므로 출역이 아니다. 이름 규칙으로
  //    거르면 새 이름이 생길 때마다 뚫리므로, 신원 대장(users)을 단일 기준으로 삼는다.
  const { rows } = await q<{ day: string; worker_id: string; job_title: string | null }>(
    `WITH folded AS (
       SELECT to_char(v.ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
              COALESCE(a.primary_worker_id, v.worker_id) AS worker_id,
              MAX(v.job_title) AS job_title
         FROM vital_samples v
         LEFT JOIN worker_alias a ON a.secondary_worker_id = v.worker_id
        WHERE to_char(v.ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') >= $1
          AND to_char(v.ts::timestamptz AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') <= $2
          AND v.worker_id !~ '^(reserved|test|smoke|infra)_'
        GROUP BY 1, 2
     )
     SELECT f.day, f.worker_id, f.job_title
       FROM folded f
      WHERE EXISTS (
        SELECT 1 FROM users u
         WHERE u.employee_id = f.worker_id AND u.status = 'approved'
      )`,
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

// ── 조달 공고 안전관리비 담당관 확정(append-only) ──
// ⚠ 갱신 함수를 만들지 않는다. 값을 고치려면 새 행을 넣고, 최신 한 건이 현행이다.
//   판정에 쓰이는 값이라 "언제 누가 무엇을 보고 그렇게 정했나"가 남아야 한다.
export type ProcureCostConfirmRow = {
  id: number;
  notice_id: string;
  target_amount: number | null;
  declared_cost: number | null;
  construction_type: string | null;
  evidence_file: string | null;
  evidence_url: string | null;
  evidence_locus: string | null;
  draft_json: string | null;
  note: string | null;
  confirmed_by: string;
  confirmed_at: string;
};

const PCC_COLS = `id, notice_id, target_amount, declared_cost, construction_type,
                  evidence_file, evidence_url, evidence_locus, draft_json, note,
                  confirmed_by, confirmed_at`;

export async function insertProcureCostConfirm(
  input: Omit<ProcureCostConfirmRow, "id" | "confirmed_at">,
): Promise<ProcureCostConfirmRow> {
  const { rows } = await q<ProcureCostConfirmRow>(
    `INSERT INTO procure_cost_confirm
       (notice_id, target_amount, declared_cost, construction_type,
        evidence_file, evidence_url, evidence_locus, draft_json, note, confirmed_by, confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, ${NOW_ISO})
     RETURNING ${PCC_COLS}`,
    [
      input.notice_id.slice(0, 60),
      input.target_amount == null ? null : Math.round(input.target_amount),
      input.declared_cost == null ? null : Math.round(input.declared_cost),
      input.construction_type?.slice(0, 20) ?? null,
      input.evidence_file?.slice(0, 300) ?? null,
      input.evidence_url?.slice(0, 1000) ?? null,
      input.evidence_locus?.slice(0, 200) ?? null,
      input.draft_json?.slice(0, 20000) ?? null,
      input.note?.slice(0, 1000) ?? null,
      input.confirmed_by.slice(0, 60),
    ],
  );
  // RETURNING 이 있는 INSERT 라 행은 반드시 하나다 — 없으면 저장이 안 된 것이니 조용히 넘기지 않는다.
  const row = rows[0];
  if (!row) throw new Error("procure_cost_confirm INSERT 가 행을 반환하지 않았습니다");
  return row;
}

/** 현행 확정값 — 최신 한 건. 없으면 null(= 아직 확정 전이고, 판정은 '검토필요'로 남는다). */
export async function latestProcureCostConfirm(noticeId: string): Promise<ProcureCostConfirmRow | null> {
  const { rows } = await q<ProcureCostConfirmRow>(
    `SELECT ${PCC_COLS} FROM procure_cost_confirm WHERE notice_id = $1 ORDER BY id DESC LIMIT 1`,
    [noticeId],
  );
  return rows[0] ?? null;
}

/** 확정 이력(최신 먼저) — 화면에서 "누가 언제 무엇을 바꿨나"를 보여 준다. */
export async function listProcureCostConfirms(noticeId: string, limit = 20): Promise<ProcureCostConfirmRow[]> {
  const lim = Math.min(100, Math.max(1, Math.floor(limit)));
  const { rows } = await q<ProcureCostConfirmRow>(
    `SELECT ${PCC_COLS} FROM procure_cost_confirm WHERE notice_id = $1 ORDER BY id DESC LIMIT $2`,
    [noticeId, lim],
  );
  return rows;
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
export type TrackRow = {
  ts: string;
  latitude: number | null;
  longitude: number | null;
  /** 측위 시각(ISO-UTC). `ts` 와의 차가 그 좌표의 나이다. null = 이 컬럼 도입 이전 행. */
  location_timestamp: string | null;
  /** 수평 정확도(m). null = 미보고. */
  location_accuracy_m: number | null;
};

// 지도 트레일용 좌표 시계열 — 좌표 보유 행만 ts 오름차순(ts 는 ISO-UTC TEXT 라 문자열 비교 = 시간 비교).
export async function listWorkerTrack(
  workerIds: string[],
  sinceIso: string,
  limit = 2000,
): Promise<TrackRow[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<TrackRow>(
    `SELECT ts, latitude, longitude, location_timestamp, location_accuracy_m FROM vital_samples
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

// ── 알림 이력(SOS/낙상/생체 위험/구획 이탈/위험구역 진입/감시 공백) ─────────
// AlertType 은 ./alert-type 에 있다 — telegram 과의 순환을 끊으려고 뗀 것이다(2026-08-22).

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
/**
 * 알림을 원장에 남기고 통지한다. **새로 적혔을 때만 true** — 자연키 충돌(재전송분)이면 false.
 *
 * `notify: false` 는 통지 문구를 호출측이 직접 만들 때만 쓴다(감시 공백 — 경과 시간·사후 판정이
 * 들어가야 해서 공용 포맷으로 표현되지 않는다). ⚠ 그 경우에도 **원장 기록은 건너뛰지 않는다** —
 * 온열 알림이 이 관문을 우회해 발동 이력을 아무도 못 본 전례가 있다.
 */
export async function recordAlert(
  input: {
    workerId: string;
    workerName?: string | null;
    type: AlertType;
    ts: string;
  },
  options?: { notify?: boolean },
): Promise<boolean> {
  const notify = options?.notify ?? true;
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
    if (notify) await notifyAlertTelegram(input);
    throw error;
  }
  if (rowCount > 0 && notify) {
    // notifyAlertTelegram 은 미설정 시 no-op·실패 삼킴이라 여기서 await 해도 기록·수집을 막지 않는다.
    await notifyAlertTelegram(input);
  }
  return rowCount > 0;
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

// ── 감시 공백(absence) 조회 — 크론이 쓰는 세 가지 ─────────────────────────
// 판정 규칙 자체는 `lib/absence-watch.ts`(순수·테스트됨)에 있고 여기는 재료만 낸다.

/**
 * **배정된** 작업자별 마지막 수신 시각. 별칭은 주 ID 로 접는다.
 *
 * ★ 명부는 `monitor_slot_config.slots`(관제 화면이 그리는 그 명부)다.
 *   종전에는 `vital_samples` 를 명부처럼 써서 **화면과 알림이 서로 다른 명부**를 봤다 —
 *   ① 배정 안 된 시험 기기가 붙었다 끊기면 알림이 나가고
 *   ② 배정됐는데 오래 꺼진 작업자는 대상에서조차 빠진다(2026-08-19 실측 — 배정 4명 중 2명).
 *
 * ★ **별칭을 접지 않으면 한 사람이 여럿으로 갈린다.** `EMP-admin7276` 은 별칭이 4개라
 *   최대 5명으로 세어지고, 그중 옛 ID 하나만 오래되면 **본인은 정상 수신 중인데 부재 알림이 난다**.
 *   관제 누적 집계가 같은 자리에서 이미 한 번 당했다(`db.ts` 별칭 접힘 주석 참조).
 *
 * @param maxGapHours **공백 상한**이다 — "누가 대상인가" 가 아니다.
 *   이보다 오래 끊긴 기기는 사건이 아니라 상태라서 알리지 않는다(41일 꺼진 기기를 매일 밀면
 *   하루면 무시된다). 그런 작업자는 관제 신호등이 `대기` 로 집계해 화면에 남는다.
 */
export async function lastSeenByWorker(
  maxGapHours = 24,
): Promise<{ worker_id: string; worker_name: string | null; last_ts: string }[]> {
  const { rows } = await q<{ worker_id: string; worker_name: string | null; last_ts: string }>(
    `WITH roster AS (
       SELECT jsonb_array_elements_text(slots::jsonb) AS wid
         FROM monitor_slot_config WHERE id = 1
     ),
     ids AS (
       -- 배정 ID 자신 + 그 ID 를 주 ID 로 삼는 별칭 전부
       SELECT wid AS canon, wid FROM roster WHERE wid IS NOT NULL
       UNION
       SELECT a.primary_worker_id, a.secondary_worker_id
         FROM worker_alias a
         JOIN roster r ON r.wid = a.primary_worker_id
     )
     SELECT i.canon AS worker_id,
            MAX(v.ts) AS last_ts,
            -- ★ **최빈 라벨**이지 최근 라벨이 아니다. 권위 있는 이름 테이블이 없어
            --   (worker_profile 은 직급만 · t_worker 는 비어 있다) 샘플이 실어 보낸 문자열이
            --   유일한 출처인데, 워커 하나에 시기별로 여러 라벨이 섞여 있다.
            --   최근값을 쓰면 마지막 세션이 폴백 라벨이었던 경우 사람 이름 대신 그것을 부른다 —
            --   ⚠ 아래 예시에 백틱을 쓰지 말 것 — 이 SQL 은 JS 템플릿 리터럴 안이라 문자열이 끊긴다.
            --   실측 EMP-admin7276 은 최근 '워치PoC' / 최빈 '양지후'(=실제 인물),
            --   EMP-admin0740 은 최근 '관리자 EMP-admin0740' / 최빈 '김수영'.
            --   ⚠ 개명하면 옛 이름이 이길 수 있다. 그래도 사번은 항상 맞으므로 식별은 유지된다.
            MODE() WITHIN GROUP (ORDER BY v.worker_name) AS worker_name
       FROM ids i
       JOIN vital_samples v ON v.worker_id = i.wid
      WHERE v.ts::timestamptz > (now() - $1::interval)
      GROUP BY i.canon`,
    [`${maxGapHours} hours`],
  );
  return rows;
}

/** 명부 워커 이름 캐시 — 이름은 거의 안 바뀌고 질의가 비싸다(아래 주석). */
const ROSTER_NAME_TTL_MS = 600_000;
let rosterNameCache: { at: number; map: Record<string, string> } | null = null;

/**
 * 관제 화면이 쓸 **명부 워커 이름 맵**. `worker_id → 최빈 이름`.
 *
 * ★ **왜 필요한가.** 화면은 이름을 최근 500샘플 링(12건/분 ≈ 41.7분)의 `sample` 에서만 읽어서,
 *   그보다 오래 끊긴 작업자는 이름·사번이 통째로 사라지고 **사번이 이름 자리에 뜬다**
 *   (2026-08-19 실측 — 배정 4명 중 3명). 그런데 같은 순간 부재 알림은 `김○곤` 이라 부른다.
 *   **화면과 알림이 같은 사람을 다르게 부르는 것**이 이 함수가 막는 것이다.
 *
 * ★ **규칙은 `lastSeenByWorker` 와 같아야 한다** — 명부(`monitor_slot_config.slots`) 기준 ·
 *   `worker_alias` 접힘 · **`MODE()` 최빈 라벨**(최근 라벨이 아니다). 둘이 갈리면 화면과 알림이
 *   또 다른 이름을 부른다. 가드가 두 질의를 함께 검사한다.
 *   ⚠ 다른 점은 **시간 창이 없다**는 것뿐이다 — 41일 꺼진 작업자도 화면에는 이름이 떠야 한다.
 *
 * ⚠ **캐시가 필수다** — 시간 창이 없어 `vital_samples` Seq Scan 이고 실측 **1,086ms / 381,326행**
 *   이다. 관제 폴링마다 돌리면 안 된다. 이름은 거의 안 바뀌므로 10분이면 충분하다.
 *   ⚠ 인스턴스별 캐시라 갈릴 수 있으나 **같은 값**이라 무해하다(SpO₂ 때 문제였던 "워커별 최신값"과
 *   다르다 — 그건 인스턴스마다 다른 값이라 DB 를 봐야 했다).
 *
 * ⚠ **판정에 쓰지 않는다** — 표시 전용이다. 이름이 떴다고 수신 중인 것이 아니므로
 *   신호등·`stale`·부재 판정은 이 값을 보지 않는다(가드 고정).
 */
export async function rosterWorkerNames(): Promise<Record<string, string>> {
  const now = Date.now();
  if (rosterNameCache && now - rosterNameCache.at < ROSTER_NAME_TTL_MS) return rosterNameCache.map;
  const { rows } = await q<{ worker_id: string; worker_name: string | null }>(
    `WITH roster AS (
       SELECT jsonb_array_elements_text(slots::jsonb) AS wid
         FROM monitor_slot_config WHERE id = 1
     ),
     ids AS (
       SELECT wid AS canon, wid FROM roster WHERE wid IS NOT NULL
       UNION
       SELECT a.primary_worker_id, a.secondary_worker_id
         FROM worker_alias a
         JOIN roster r ON r.wid = a.primary_worker_id
     )
     SELECT i.canon AS worker_id,
            MODE() WITHIN GROUP (ORDER BY v.worker_name) AS worker_name
       FROM ids i
       JOIN vital_samples v ON v.worker_id = i.wid
      WHERE v.worker_name IS NOT NULL
      GROUP BY i.canon`,
  );
  const map: Record<string, string> = {};
  for (const r of rows) {
    const n = r.worker_name?.trim();
    if (n) map[r.worker_id] = n;
  }
  rosterNameCache = { at: now, map };
  return map;
}

/** 배정된 슬롯 수. 0 이면 명부가 비었다는 뜻이라 부재 판정이 조용히 무의미해진다. */
export async function rosterSize(): Promise<number> {
  const { rows } = await q<{ n: string }>(
    `SELECT count(*) AS n
       FROM monitor_slot_config,
            LATERAL jsonb_array_elements_text(slots::jsonb) AS s(wid)
      WHERE id = 1 AND s.wid IS NOT NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** 아직 안 닫힌 감시 공백. 해제는 `ackAlert(id, ...)` 로 한다(대응 확인과 같은 자리). */
export async function listOpenAbsenceAlerts(): Promise<
  { id: number; worker_id: string; worker_name: string | null; ts: string }[]
> {
  const { rows } = await q<{ id: number; worker_id: string; worker_name: string | null; ts: string }>(
    `SELECT id, worker_id, worker_name, ts
       FROM alerts
      WHERE type = 'absence' AND ack_at IS NULL
      ORDER BY ts ASC`,
  );
  return rows;
}

/**
 * 공백 종료 직후 창의 **최대 측정 지연**(초). 복귀 원인을 사후에 가르는 유일한 재료다.
 *
 * 밀린 것이 몰려 오면 `ts` 는 지금인데 `heart_rate_measured_at` 은 한참 전이라 값이 크게 뜬다.
 * ⚠ 도착 시각 기준(`received_at − ts`)으로는 안 갈린다 — 전 구간 0~4초다(2026-08-19 실측).
 * 복귀 자체가 없으면(=아직 공백 중) null, 복귀했는데 그 창에 심박이 없어도 null 이다.
 */
export async function maxMeasuredLagSecAfter(
  workerId: string,
  gapStartIso: string,
  windowSeconds = 60,
): Promise<{ resumedAtIso: string; maxLagSec: number | null } | null> {
  const { rows } = await q<{ resumed_at: string; max_lag: string | null }>(
    `WITH resumed AS (
       SELECT ts FROM vital_samples
        WHERE worker_id = $1 AND ts::timestamptz > $2::timestamptz
        ORDER BY ts ASC LIMIT 1
     )
     SELECT r.ts AS resumed_at,
            (SELECT MAX(EXTRACT(EPOCH FROM (s.ts::timestamptz - s.heart_rate_measured_at::timestamptz)))
               FROM vital_samples s
              WHERE s.worker_id = $1
                AND s.ts::timestamptz >= r.ts::timestamptz
                AND s.ts::timestamptz < r.ts::timestamptz + $3::interval) AS max_lag
       FROM resumed r`,
    [workerId, gapStartIso, `${windowSeconds} seconds`],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    resumedAtIso: row.resumed_at,
    maxLagSec: row.max_lag === null ? null : Math.round(Number(row.max_lag)),
  };
}

// ── 사고(산업재해) 등록 원장 — 조사 뷰 앵커 + 3년 보존 마킹 ────────────────
export type IncidentRow = {
  id: number;
  worker_id: string;
  occurred_at: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

// 사고 등록 — append-only(삭제 함수 없음·감사 자료). occurred_at 은 canonical ISO ms 로 저장.
export async function insertIncident(input: {
  workerId: string;
  occurredAt: string;
  note?: string | null;
  createdBy?: string | null;
}): Promise<IncidentRow> {
  const { rows } = await q<IncidentRow>(
    `INSERT INTO incidents (worker_id, occurred_at, note, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
    [input.workerId, input.occurredAt, input.note ?? null, input.createdBy ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("incidents INSERT 가 행을 반환하지 않음");
  return row;
}

export async function listIncidents(limit = 200): Promise<IncidentRow[]> {
  const { rows } = await q<IncidentRow>(
    "SELECT * FROM incidents ORDER BY occurred_at DESC, id DESC LIMIT $1",
    [limit],
  );
  return rows;
}

// 구간 알림(SOS·낙상) — 사고 조사 창의 이벤트 타임라인용. ack(대응) 시각·대응자 포함.
export async function alertsBetween(
  workerIds: string[],
  fromMs: number,
  toMs: number,
): Promise<AlertRow[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<AlertRow>(
    `SELECT * FROM alerts
      WHERE worker_id = ANY($1)
        AND ts::timestamptz >= to_timestamp($2)
        AND ts::timestamptz < to_timestamp($3)
      ORDER BY ts`,
    [workerIds, Math.floor(fromMs / 1000), Math.ceil(toMs / 1000)],
  );
  return rows;
}

// 구간 활동 에너지 버킷 합 — 사고 조사 창의 활동 축(작업 강도 재구성)용.
// 행 값은 5초 구간 증분(kcal)이라 SUM 이 곧 그 버킷의 소모량이다.
export async function activeEnergyBucketSums(
  workerIds: string[],
  fromMs: number,
  toMs: number,
  bucketSec: number,
): Promise<{ bucket_start_sec: number; kcal: number }[]> {
  if (workerIds.length === 0) return [];
  const { rows } = await q<{ bucket_start_sec: number; kcal: number }>(
    `SELECT (floor(extract(epoch from COALESCE(heart_rate_measured_at, ts)::timestamptz) / $4) * $4)::bigint AS bucket_start_sec,
            sum(active_energy_kcal) AS kcal
       FROM vital_samples
      WHERE worker_id = ANY($1)
        AND active_energy_kcal IS NOT NULL
        AND ts::timestamptz >= to_timestamp($2)
        AND ts::timestamptz < to_timestamp($3)
      GROUP BY 1
      ORDER BY 1`,
    [workerIds, Math.floor(fromMs / 1000), Math.ceil(toMs / 1000), bucketSec],
  );
  return rows;
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

// 발효가 끝난 기상특보 상태를 normal 로 되돌린다 — **해제 신호가 없는 소스의 필수 대응**.
//
// ★ 왜 필요한가(2026-08-27 실측). `kma-warning` 라우트는 **발효 중인 특보만** `notifyEnvAlerts`
//   에 넘긴다. 해제되면 그 항목이 목록에서 사라질 뿐이라 `env_alert_state` 행이 마지막 심각도로
//   **영원히 굳는다.** 그리고 `shouldSendEnv` 는 악화 전이(next > prev)에서만 발송하므로,
//   굳은 항목은 **다시 발효돼도 알림이 영영 안 간다.**
//     실측  kma:폭염중대경보 = danger (08-07 이후 20일째 갱신 없음) → 재발효돼도 무음
//           kma:폭염주의보   = caution (08-20)                      → 같은 등급 재발효 시 무음
//   재난문자 경로는 이 함정을 이미 겪고 "화이트리스트 전 유형을 매번 normal 로 반환" 으로 풀었다
//   (`disaster-msg.ts` — "빠뜨리면 유형당 알림이 딱 한 번만 가고 영영 안 간다").
//   특보는 유형이 열려 있어 화이트리스트를 못 쓰므로, **지금 발효 중이 아닌 것을 되돌리는** 쪽으로 푼다.
//
// ⚠ 지우지 않고 normal 로 둔다 — 행을 지우면 다음 발효 때 prev=null 이라 같은 결과지만,
//   "언제 해제됐나" 를 잃는다. updated_at 이 해제 시각이 된다.
// ⚠ 호출측이 **live + 인증된** 경로에서만 부를 것. 목업·무인증 조회로 부르면 실제 특보 상태를 지운다.
export async function clearLiftedKmaAlertStates(activeItemKeys: string[]): Promise<string[]> {
  const { rows } = await q<{ item_key: string }>(
    `UPDATE env_alert_state
        SET severity = 'normal', updated_at = ${NOW_ISO}
      WHERE item_key LIKE 'kma:%'
        AND severity <> 'normal'
        AND NOT (item_key = ANY($1::text[]))
      RETURNING item_key`,
    [activeItemKeys],
  );
  return rows.map((r) => r.item_key);
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

// 구획 이탈 서버 판정용 — 최근 창의 GPS 동반 표본을 작업자별 시간순으로 낸다.
//
// ⚠ `ts` 가 text 라 비교를 캐스트 없이 **문자열로** 한다. 이 컬럼은 ISO-8601 UTC(`Z`)라
//   글자 순서 = 시간 순서이고, 캐스트를 붙이면 행마다 함수가 걸려 인덱스를 못 탄다
//   (`lastSeenByWorker` 가 그 이유로 41만 행을 훑어 5분 크론을 300초까지 끌었다).
export async function recentGpsFixes(
  sinceIso: string,
  limit = 5000,
): Promise<{ workerId: string; workerName: string | null; ts: string; lat: number; lon: number }[]> {
  const { rows } = await q<{
    worker_id: string;
    worker_name: string | null;
    ts: string;
    latitude: number;
    longitude: number;
  }>(
    `SELECT worker_id, worker_name, ts, latitude, longitude
       FROM vital_samples
      WHERE ts > $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY worker_id, ts
      LIMIT $2`,
    [sinceIso, limit],
  );
  return rows.map((r) => ({
    workerId: r.worker_id,
    workerName: r.worker_name,
    ts: r.ts,
    lat: Number(r.latitude),
    lon: Number(r.longitude),
  }));
}

// 작업자별 마지막 구획 이탈 알림 시각 — 같은 이탈 구간을 두 경로(화면·크론)가 각자
// 다른 표본 ts 로 기록해 **중복 통지**가 되는 것을 막는다. 자연키 dedup 은 ts 가 정확히
// 같을 때만 듣는데, 화면과 서버가 본 표본 열이 다르면 ts 가 갈릴 수 있다.
export async function lastGeofenceAlertTsByWorker(
  sinceIso: string,
): Promise<Record<string, string>> {
  const { rows } = await q<{ worker_id: string; last_ts: string }>(
    `SELECT worker_id, max(ts) AS last_ts
       FROM alerts
      WHERE type = 'geofence' AND ts > $1
      GROUP BY worker_id`,
    [sinceIso],
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.worker_id] = r.last_ts;
  return out;
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
  site_officer: boolean; // 현장 담당관(안전관리비 확정 권한) — owner 부여, 자가취득 불가
  temp_password_expires_at: string | null; // 임시 비밀번호 상태가 아니면 null
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

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await q<UserRow>("SELECT * FROM users WHERE username = $1", [
    username,
  ]);
  return rows[0] ?? null;
}

// ── 계정 찾기(아이디 찾기·비밀번호 재설정) ──────────────────────────────────
// 이메일 발송이 막혀 있어(EMAIL_FROM 미설정) 재설정은 owner 승인으로 처리한다.
// 근거·대안은 docs/account-recovery/context-notes.md.

/**
 * 아이디 찾기 — 이름 + 이메일이 모두 일치하는 계정.
 *
 * `email` 에 UNIQUE 제약이 없어 복수 행이 정상이다(회사 대표메일 공유 등). 전부 돌려준다.
 * 이메일은 대소문자를 구분하지 않고 비교한다 — 사용자는 자기 메일을 어느 쪽으로든 입력한다.
 * 작업자(role=worker)는 관제 웹 대상이 아니라 제외한다 — 찾아줘도 로그인할 수 없다.
 */
export async function findUsernamesByNameEmail(
  name: string,
  email: string,
): Promise<{ username: string; created_at: string; status: string }[]> {
  const { rows } = await q<{ username: string; created_at: string; status: string }>(
    `SELECT username, created_at, status FROM users
      WHERE name = $1 AND lower(email) = lower($2) AND role <> 'worker'
      ORDER BY created_at`,
    [name, email],
  );
  return rows;
}

export type PasswordResetRow = {
  id: number;
  user_id: number;
  username: string;
  status: string; // pending | done | rejected
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

/**
 * 재설정 요청 생성. 이미 미처리 요청이 있으면 null(부분 유니크 인덱스가 막는다 → 호출부 409).
 * 중복을 조용히 성공으로 처리하지 않는다 — 사용자가 "신청이 두 번 갔나" 헷갈리게 하지 않기 위해서다.
 */
export async function createPasswordResetRequest(
  userId: number,
  username: string,
): Promise<PasswordResetRow | null> {
  const { rows } = await q<PasswordResetRow>(
    `INSERT INTO password_reset_request (user_id, username) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING *`,
    [userId, username],
  );
  return rows[0] ?? null;
}

/** 재설정 요청 목록 — 미처리를 위로, 그 안에서 오래된 순(먼저 신청한 사람이 먼저 처리되게). */
export async function listPasswordResetRequests(
  limit = 100,
): Promise<PasswordResetRow[]> {
  const { rows } = await q<PasswordResetRow>(
    `SELECT * FROM password_reset_request
      ORDER BY (status = 'pending') DESC, requested_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * 요청 승인 — 임시 비밀번호 해시와 만료를 계정에 쓰고 요청을 done 으로 닫는다.
 *
 * 두 UPDATE 를 한 트랜잭션으로 묶는다. 나뉘면 "비번은 바뀌었는데 요청은 열린 채"(owner 가 다시 발급해
 * 앞의 임시 비번이 죽는다) 또는 "요청은 닫혔는데 비번은 그대로"(사용자가 못 들어온다)가 된다.
 * `status='pending'` 조건을 UPDATE 에 걸어 두 owner 가 동시에 승인해도 하나만 통과한다.
 * 평문 비번은 인자로만 받고 저장하지 않는다 — 호출부가 응답에서 1회 노출한다.
 */
export async function approvePasswordReset(
  requestId: number,
  passwordHash: string,
  expiresAt: string,
  resolvedBy: string,
): Promise<PasswordResetRow | null> {
  // client.query 는 q() 를 우회하므로 스키마 보장을 여기서 직접 한다(기존 트랜잭션 함수와 동일).
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<PasswordResetRow>(
      `UPDATE password_reset_request
          SET status = 'done', resolved_at = ${NOW_ISO}, resolved_by = $2
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [requestId, resolvedBy],
    );
    const req = rows[0];
    if (!req) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      "UPDATE users SET password_hash = $1, temp_password_expires_at = $2 WHERE id = $3",
      [passwordHash, expiresAt, req.user_id],
    );
    await client.query("COMMIT");
    return req;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 요청 거절 — 계정은 건드리지 않는다(비번 그대로). 이미 처리된 요청이면 null. */
export async function rejectPasswordReset(
  requestId: number,
  resolvedBy: string,
): Promise<PasswordResetRow | null> {
  const { rows } = await q<PasswordResetRow>(
    `UPDATE password_reset_request
        SET status = 'rejected', resolved_at = ${NOW_ISO}, resolved_by = $2
      WHERE id = $1 AND status = 'pending' RETURNING *`,
    [requestId, resolvedBy],
  );
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
// owner_profile 도 함께 본다 — env 관리자도 사번을 갖게 되어(2026-08-04), 한쪽만 보면 두 계정이
// 같은 사번을 갖고 생체·알람 귀속이 갈린다.
export async function employeeIdTakenByOther(
  employeeId: string,
  username: string,
): Promise<boolean> {
  const { rows } = await q<{ one: number }>(
    `SELECT 1 AS one FROM users WHERE employee_id = $1 AND username <> $2
     UNION ALL
     SELECT 1 AS one FROM owner_profile WHERE employee_id = $1 AND username <> $2
     LIMIT 1`,
    [employeeId, username],
  );
  return rows.length > 0;
}

// ── env 관리자(owner) 내 정보 ───────────────────────────────────────────────
// users 행이 없는 계정이라 프로필만 따로 담는다. 자격(아이디·비밀번호)은 env 가 단일 소스.
export type OwnerProfileRow = {
  username: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  carrier: string | null;
  department: string | null;
  job_title: string | null;
  employee_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
};

export type OwnerProfilePatch = Omit<OwnerProfileRow, "username">;

// 한 번도 저장하지 않았으면 행이 없다 — null 을 그대로 돌려주고 호출부가 빈 값으로 채운다.
export async function getOwnerProfile(username: string): Promise<OwnerProfileRow | null> {
  const { rows } = await q<OwnerProfileRow>(
    `SELECT username, name, company, phone, carrier, department, job_title,
            employee_id, guardian_name, guardian_phone
       FROM owner_profile WHERE username = $1`,
    [username],
  );
  return rows[0] ?? null;
}

export async function upsertOwnerProfile(
  username: string,
  p: OwnerProfilePatch,
): Promise<OwnerProfileRow | null> {
  const { rows } = await q<OwnerProfileRow>(
    `INSERT INTO owner_profile
       (username, name, company, phone, carrier, department, job_title,
        employee_id, guardian_name, guardian_phone, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${NOW_ISO})
     ON CONFLICT (username) DO UPDATE SET
       name = excluded.name,
       company = excluded.company,
       phone = excluded.phone,
       carrier = excluded.carrier,
       department = excluded.department,
       job_title = excluded.job_title,
       employee_id = excluded.employee_id,
       guardian_name = excluded.guardian_name,
       guardian_phone = excluded.guardian_phone,
       updated_at = excluded.updated_at
     RETURNING username, name, company, phone, carrier, department, job_title,
               employee_id, guardian_name, guardian_phone`,
    [
      username,
      p.name,
      p.company,
      p.phone,
      p.carrier,
      p.department,
      p.job_title,
      p.employee_id,
      p.guardian_name,
      p.guardian_phone,
    ],
  );
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
    // 비번을 실제로 바꾸면 임시 비번 만료를 해제한다 — 여기 한 곳에서 처리해야
    // 변경 경로가 늘어도(관리자 대행 등) 빠뜨리지 않는다. 안 풀면 본인이 바꾼 비번인데도
    // 24시간 뒤 로그인이 거부된다.
    const { rows } = await q<UserRow>(
      `UPDATE users SET name = $1, company = $2, phone = $3, carrier = $4,
         department = $5, job_title = $6, employee_id = $7,
         guardian_name = $8, guardian_phone = $9, password_hash = $10,
         temp_password_expires_at = NULL
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

// 현장 담당관(안전관리비 확정 권한) 부여/회수 — admin_access 와 같은 패턴(owner 부여, 자가취득 불가).
// ⚠ 시공사(org_type=contractor)에게는 부여하지 않는다 — 피검증자가 확정 권한을 갖는 순간
//   검증이 성립하지 않는다. 라우트가 막지만 여기서도 한 번 더 거른다(경로가 늘어도 안 뚫리게).
export async function setUserSiteOfficer(
  id: number,
  value: boolean,
): Promise<UserRow | null> {
  const { rows } = await q<UserRow>(
    `UPDATE users SET site_officer = $1 WHERE id = $2 AND ($1 = false OR org_type <> 'contractor') RETURNING *`,
    [value, id],
  );
  return rows[0] ?? null;
}

// 회사(상호)/부서/직책 직접 수정 — 관리 권한자가 사용자 관리에서 각 사용자 값을 편집(id 기준). 본인 자가입력과 별개.
export async function setUserProfileFields(
  id: number,
  company: string | null,
  department: string | null,
  jobTitle: string | null,
): Promise<UserRow | null> {
  const { rows } = await q<UserRow>(
    "UPDATE users SET company = $1, department = $2, job_title = $3 WHERE id = $4 RETURNING *",
    [company, department, jobTitle, id],
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
  /**
   * 각인 좌표와 **같은 시각 생체 좌표**의 거리(m). null = 대조할 생체 좌표가 없다.
   *
   * ★ 왜 필요한가(2026-08-21). 각인 좌표가 실제와 크게 어긋나는 일이 실측됐다 —
   *   08-19 **5,239m** · 08-20 336m. 원인은 앱 각인 경로에 정확도 게이트가 없어
   *   `latestFix` 에 들어가지도 못한 저품질 fix 를 각인이 그대로 쓴 것이다.
   *   각인은 이미지에 구워져 못 고치지만, **서버는 그 시각 더 정확한 좌표를 알고 있다** —
   *   같은 작업자의 생체 샘플이 정확도 10m 짜리를 들고 있었다.
   * ⚠ 각인 값을 덮어쓰지 않는다. 사진과 DB 가 갈리면 그것대로 혼란이다 —
   *   **격차를 보여 사람이 판단하게** 한다. 조회 시점 계산이라 과거분에도 소급 적용된다.
   */
  coord_gap_m: number | null;
  /** 대조에 쓴 생체 좌표의 수평 정확도(m). null = 미보고(컬럼 도입 이전 행). */
  coord_ref_accuracy_m: number | null;
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
  // 각인 좌표 ↔ 같은 시각 생체 좌표 대조를 **조회 시점에** 붙인다(§ CalendarMediaRow.coord_gap_m).
  // ⚠ `ts` 는 ISO-UTC TEXT 라 문자열 비교 = 시간 비교다. 그래서 경계를 **ts 와 같은 형식**
  //   (밀리초 포함)으로 만들어 문자열 범위로 훑는다 — `::timestamptz` 로 캐스팅하면
  //   `uq_vs_worker_ts` 인덱스를 못 쓰고 39만 행을 미디어마다 훑게 된다.
  //   `captured_at` 은 밀리초가 없어 두 형식이 다르다는 점도 여기서 흡수된다.
  //   실측 = Index Scan · 미디어 7건 × 34행 · 총 1.9ms.
  const { rows } = await q<CalendarMediaRow>(
    `SELECT m.*, r.gap_m AS coord_gap_m, r.ref_acc AS coord_ref_accuracy_m
       FROM calendar_media m
       LEFT JOIN LATERAL (
         SELECT v.location_accuracy_m AS ref_acc,
                round(6371000 * 2 * asin(sqrt(
                  power(sin(radians(v.latitude - m.latitude) / 2), 2)
                  + cos(radians(m.latitude)) * cos(radians(v.latitude))
                    * power(sin(radians(v.longitude - m.longitude) / 2), 2))))::int AS gap_m
           FROM vital_samples v
          WHERE v.worker_id = m.worker_id
            AND v.latitude IS NOT NULL
            AND v.ts >= to_char((m.captured_at::timestamptz - interval '3 minutes')
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            AND v.ts <= to_char((m.captured_at::timestamptz + interval '3 minutes')
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ORDER BY abs(extract(epoch from (v.ts::timestamptz - m.captured_at::timestamptz)))
          LIMIT 1
       ) r ON TRUE
      WHERE m.date_key >= $1 AND m.date_key <= $2
      ORDER BY m.date_key ASC, m.captured_at ASC NULLS LAST, m.created_at ASC`,
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

// 삭제된 행의 저장 키를 함께 돌려준다 — 호출부가 버킷 객체까지 지우기 위한 것이다.
// ★ `RETURNING` 이라 **권한을 통과해 실제로 지워진 경우에만** 키가 나온다. 별도 조회로 키를
//   먼저 얻으면 남의 사진 키를 읽어 지우는 경로가 열린다.
// 못 지웠으면(없음·남의 것) `null` — 호출부는 그때 아무 파일도 건드리지 않는다.
export async function deleteCalendarMedia(
  id: string,
  scope: MediaScope,
): Promise<{ storageProvider: string | null; storageKey: string | null } | null> {
  const params: unknown[] = [id];
  const clause = mediaScopeClause(scope, params);
  const { rows } = await q<{ storage_provider: string | null; storage_key: string | null }>(
    `DELETE FROM calendar_media WHERE id = $1${clause}
       RETURNING storage_provider, storage_key`,
    params,
  );
  const row = rows[0];
  if (!row) return null;
  return { storageProvider: row.storage_provider, storageKey: row.storage_key };
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
    // 종료 날짜(YYYY-MM-DD). 없으면 하루짜리다.
    endDateKey?: string | null;
    /** 일정 메모(자유 텍스트). */
    note?: string | null;
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
    input.endDateKey ?? null,
    input.note ?? null,
    input.hazardType ?? null,
    input.createdBy ?? null,
  ];
  const clause = calendarEventScopeClause(scope, params);
  const { rows } = await q<CalendarEventRow>(
    `INSERT INTO calendar_event (id, date_key, title, label_id, start_time, end_time, end_date_key, note, hazard_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         date_key = EXCLUDED.date_key,
         title = EXCLUDED.title,
         label_id = EXCLUDED.label_id,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         end_date_key = EXCLUDED.end_date_key,
         note = EXCLUDED.note,
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
