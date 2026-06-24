-- =====================================================================
--  Galaxy Watch 생체데이터 수신 테이블 (Android Health Connect 표준)
--  경로:  Galaxy Watch → Samsung Health → Android Health Connect
--         → worker-phone(Flutter health 패키지) → 서버
--
--  ※ Apple(vital_samples)과 분리 운영. Apple↔갤럭시는 지표·단위·이름이 달라
--    컬럼을 Health Connect 기준으로 재정의한다:
--      - HRV          = RMSSD(ms)            ← Apple 은 SDNN(ms). 다른 지표 → 별도 컬럼(hrv_rmssd_ms)
--      - 피부온도      = baseline 대비 delta   ← Apple 은 절대값. delta + baseline 동시 저장(절대=baseline+delta)
--      - SpO2         = 0~100 %               ← health 패키지가 0~1 분율로 주면 적재 전 *100
--      - 보행심박      = Health Connect 미지원  → 컬럼 없음
--      - 계단         = FloorsClimbed(count)  ← Apple 은 FLIGHTS_CLIMBED
--    낙상/가속도는 Health Connect 에 없음(Samsung Sensor SDK 영역) → 본 테이블 범위 밖.
--      └ 낙상감지는 별도 알고리즘 모듈로 분리 예정(가스포드 가스검출 알고리즘과 함께 모듈화).
--        상세 설명·각주: db/integrated/vital_samples_galaxy.md
--
--  실행(멱등):  psql "$DSN" -v ON_ERROR_STOP=1 -f db/integrated/vital_samples_galaxy.sql
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS vital_samples_galaxy (
  id                    BIGSERIAL    PRIMARY KEY,

  -- 작업자 식별
  worker_id             TEXT         NOT NULL,
  worker_name           TEXT,
  employee_id           TEXT,
  job_title             TEXT,

  -- 출처/기기
  source_platform       TEXT         NOT NULL DEFAULT 'health_connect',  -- 항상 health_connect (Apple=healthkit 과 구분)
  device_model          TEXT,                                            -- 예: 'Galaxy Watch7'
  hc_origin_package     TEXT,                                            -- Health Connect dataOrigin (예: com.sec.android.app.shealth)

  -- 측정/수집 시각 (ISO8601 문자열 — vital_samples 표기와 동일)
  ts                    TEXT         NOT NULL,

  -- 바이탈 (Health Connect 표준 단위)
  heart_rate            DOUBLE PRECISION,   -- bpm        HeartRateRecord
  resting_heart_rate    DOUBLE PRECISION,   -- bpm        RestingHeartRateRecord
  spo2                  DOUBLE PRECISION,   -- % 0~100    OxygenSaturationRecord
  respiratory_rate      DOUBLE PRECISION,   -- breaths/min RespiratoryRateRecord
  hrv_rmssd_ms          DOUBLE PRECISION,   -- ms RMSSD   HeartRateVariabilityRmssdRecord  (≠ Apple SDNN)

  -- 온도 (Health Connect 특성 반영)
  body_temp_c           DOUBLE PRECISION,   -- °C 절대값   BodyTemperatureRecord
  body_temp_location    TEXT,               -- 측정위치    BodyTemperatureRecord.measurementLocation
  skin_temp_delta_c     DOUBLE PRECISION,   -- °C delta    SkinTemperatureRecord.deltas (절대값 아님)
  skin_temp_baseline_c  DOUBLE PRECISION,   -- °C baseline (있으면 절대온도 = baseline + delta 복원)

  -- 활동/스트레스 입력
  steps                 INTEGER,            -- count       StepsRecord (interval 합)
  active_energy_kcal    DOUBLE PRECISION,   -- kcal        ActiveCaloriesBurnedRecord
  total_energy_kcal     DOUBLE PRECISION,   -- kcal        TotalCaloriesBurnedRecord
  floors_climbed        INTEGER,            -- count       FloorsClimbedRecord (Apple FLIGHTS_CLIMBED 대응)
  vo2_max               DOUBLE PRECISION,   -- mL/kg/min   Vo2MaxRecord (선택)

  -- 위치/기타 (선택)
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  battery_pct           INTEGER,
  manual_sos            INTEGER      NOT NULL DEFAULT 0,  -- 앱 SOS 버튼(Health Connect 아님 — 앱 레벨)

  -- 감사/원본
  received_at           TEXT,                              -- 서버 수신 시각
  raw_json              TEXT,                              -- 원본 Health Connect 레코드(재처리/디버그)

  CONSTRAINT ck_vsg_spo2     CHECK (spo2 IS NULL OR (spo2 >= 0 AND spo2 <= 100)),
  CONSTRAINT ck_vsg_hr       CHECK (heart_rate IS NULL OR (heart_rate >= 0 AND heart_rate <= 300)),
  CONSTRAINT ck_vsg_platform CHECK (source_platform = 'health_connect')
);

CREATE INDEX IF NOT EXISTS idx_vsg_worker_ts ON vital_samples_galaxy(worker_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_vsg_received  ON vital_samples_galaxy(received_at DESC);

COMMENT ON TABLE  vital_samples_galaxy                      IS 'Galaxy Watch 생체데이터(Android Health Connect 표준). Apple=vital_samples 와 분리.';
COMMENT ON COLUMN vital_samples_galaxy.hrv_rmssd_ms         IS 'HRV RMSSD(ms) — HeartRateVariabilityRmssdRecord. Apple SDNN 과 다른 지표이므로 혼용 금지.';
COMMENT ON COLUMN vital_samples_galaxy.spo2                 IS 'SpO2 %(0~100) — OxygenSaturationRecord. health 패키지가 0~1 로 주면 적재 전 *100.';
COMMENT ON COLUMN vital_samples_galaxy.skin_temp_delta_c    IS '피부온도 변화량(°C) — SkinTemperatureRecord.deltas(절대값 아님).';
COMMENT ON COLUMN vital_samples_galaxy.skin_temp_baseline_c IS '피부온도 baseline(°C) — 있으면 절대온도 = baseline + delta 복원.';
COMMENT ON COLUMN vital_samples_galaxy.body_temp_c          IS '체온 절대값(°C) — BodyTemperatureRecord.';
COMMENT ON COLUMN vital_samples_galaxy.floors_climbed       IS '오른 층수(count) — FloorsClimbedRecord. Apple FLIGHTS_CLIMBED 대응.';
COMMENT ON COLUMN vital_samples_galaxy.source_platform      IS '항상 health_connect — Apple(healthkit)과 구분.';
COMMENT ON COLUMN vital_samples_galaxy.hc_origin_package    IS 'Health Connect dataOrigin 패키지(예: com.sec.android.app.shealth).';

COMMIT;

-- =====================================================================
--  (선택) Apple + Galaxy 통합 조회 뷰 — 대시보드가 플랫폼 무관하게 읽도록.
--  분리 테이블 선택 시 권장. vital_samples / vital_samples_galaxy 둘 다 존재해야 함.
-- =====================================================================
CREATE OR REPLACE VIEW v_vital_samples_all AS
  SELECT 'apple'::text  AS platform, worker_id, worker_name, ts,
         heart_rate, resting_heart_rate, spo2, respiratory_rate,
         hrv_sdnn_ms,  NULL::double precision AS hrv_rmssd_ms,
         skin_temp_c,  NULL::double precision AS skin_temp_delta_c,
         steps, active_energy_kcal, flights_climbed AS floors_climbed
    FROM vital_samples
  UNION ALL
  SELECT 'galaxy'::text AS platform, worker_id, worker_name, ts,
         heart_rate, resting_heart_rate, spo2, respiratory_rate,
         NULL::double precision AS hrv_sdnn_ms, hrv_rmssd_ms,
         NULL::double precision AS skin_temp_c, skin_temp_delta_c,
         steps, active_energy_kcal, floors_climbed
    FROM vital_samples_galaxy;
