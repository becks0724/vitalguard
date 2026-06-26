-- =====================================================================
-- 낙상 머신러닝 데이터셋 스키마 (애플워치) — 격리 보관용
-- 파일: 02_schema_fall_ml.sql   (01_schema.sql 리파인본)
-- 적용 위치: 로컬 DB vitalguard · 스키마 fall_ml (public 운영데이터와 분리)
--
-- 변경점(01 대비):
--   1) 격리 스키마 fall_ml — 운영 public(vital_samples 등)·cctv_fall_events 와 분리
--   2) phase 컬럼 추가 — PART1=1, 이후 2~N 데이터셋을 같은 테이블에 누적/비교
--   3) PK (phase, id) 복합키 — PART 별 id 공간 독립
--   4) loaded_at — 적재 시각 추적
--   5) 6축 IMU raw(fs/impact_index/axes JSONB) — imu_window 와 통일. 현 CSV 미수집 → NULL.
--   ※ 1상: 적재만 목적. enum/CHECK/검증쿼리는 2상 이후(01 TODO 유지).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS fall_ml;

DROP TABLE IF EXISTS fall_ml.fall_events;

CREATE TABLE fall_ml.fall_events (
    -- 데이터셋 버전(PART) ---------------------------------------------
    phase                     SMALLINT     NOT NULL DEFAULT 1,  -- PART1=1, 이후 2~N

    -- 식별/시간 -------------------------------------------------------
    id                        BIGINT       NOT NULL,            -- PART 내 일련번호
    ts                        TIMESTAMPTZ,                      -- 이벤트 발생 시각(워치)
    received_at               TIMESTAMPTZ,                      -- 서버 수신 시각

    -- 작업자 ---------------------------------------------------------
    worker_id                 TEXT         NOT NULL,            -- 예: WATCH_TEST
    worker_name               TEXT,
    employee_id               TEXT,

    -- 낙상 판정/라이프사이클 -----------------------------------------
    fall_decision             TEXT,                             -- FALL/NO_FALL/CANCELLED/PENDING (2상 enum)
    fall_candidate_id         BIGINT,                           -- 후보 이벤트 그룹 id
    fall_update_phase         TEXT,                             -- CANDIDATE/PROMPTING/CONFIRMED/RESOLVED (2상 enum)
    fall_prompt_outcome       TEXT,                             -- NO_RESPONSE/FALSE_ALARM/CONFIRMED_FALL/CANCELLED_BY_USER (2상 enum)
    fall_prompt_response_sec  NUMERIC(6,2),                     -- 프롬프트 응답 소요(초)
    algo_predicted_fall       BOOLEAN,                          -- 알고리즘 1차 예측 (현재 CSV 미수집)

    -- 센서 피처 (낙상 판정 입력) -------------------------------------
    accel_magnitude_g         NUMERIC(7,4),                     -- 충격 가속도 peak(g)
    motion_still_sec          NUMERIC(6,2),                     -- 충격 후 정지 시간(초)
    freefall_preceded         BOOLEAN,                          -- 자유낙하 선행 여부 (CSV 0/1)
    peak_rotation_rad_s       NUMERIC(8,4),                     -- 최대 회전 각속도(rad/s)

    -- 심박 피처 ------------------------------------------------------
    hr_pre_mean_10s           NUMERIC(5,1),                     -- 충격 전 10초 평균 HR
    hr_at_impact              NUMERIC(5,1),                     -- 충격 시점 HR
    hr_post_mean_30s          NUMERIC(5,1),                     -- 충격 후 30초 평균 HR
    hr_post_peak_30s          NUMERIC(5,1),                     -- 충격 후 30초 최대 HR
    hr_delta_mean             NUMERIC(5,1),                     -- 파생: post_mean_30s - pre_mean_10s
    hr_delta_peak             NUMERIC(5,1),                     -- 파생: post_peak_30s - pre_mean_10s

    -- 생체/디바이스 --------------------------------------------------
    heart_rate                NUMERIC(5,1),
    spo2                      NUMERIC(5,2),
    battery_pct               NUMERIC(5,2),
    latitude                  NUMERIC(9,6),
    longitude                 NUMERIC(9,6),

    -- 6축 IMU raw (imu_window 와 동일 표현 · 현재 CSV 미수집 → NULL = 측정 안 됨) ----
    fs                        INTEGER,                          -- 샘플링레이트(Hz), 미측정 NULL
    impact_index              INTEGER,                          -- 충격 샘플의 윈도 내 인덱스, 미측정 NULL
    axes                      JSONB,                            -- raw 시계열 [[ax,ay,az,gx,gy,gz],…], 미측정 NULL

    -- 정답 라벨링 ----------------------------------------------------
    ground_truth_label        TEXT,                             -- FALL/NO_FALL (2상 enum)
    label_note                TEXT,
    labeled_by                TEXT,
    labeled_at                TIMESTAMPTZ,

    -- 적재 추적 ------------------------------------------------------
    loaded_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),

    PRIMARY KEY (phase, id)
);

CREATE INDEX idx_fe_worker    ON fall_ml.fall_events (worker_id);
CREATE INDEX idx_fe_candidate ON fall_ml.fall_events (fall_candidate_id);
CREATE INDEX idx_fe_phase     ON fall_ml.fall_events (phase);

-- PART1 적재(psql, CSV 31컬럼 → phase/loaded_at 은 default):
--   \copy fall_ml.fall_events (id,ts,received_at,worker_id,worker_name,employee_id,
--     fall_decision,fall_candidate_id,fall_update_phase,fall_prompt_outcome,fall_prompt_response_sec,
--     algo_predicted_fall,accel_magnitude_g,motion_still_sec,freefall_preceded,peak_rotation_rad_s,
--     hr_pre_mean_10s,hr_at_impact,hr_post_mean_30s,hr_post_peak_30s,hr_delta_mean,hr_delta_peak,
--     heart_rate,spo2,battery_pct,latitude,longitude,ground_truth_label,label_note,labeled_by,labeled_at)
--     FROM '1stTestDBdata.csv' WITH (FORMAT csv, HEADER true, NULL '');
