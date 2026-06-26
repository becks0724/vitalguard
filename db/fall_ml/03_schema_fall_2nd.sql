-- =====================================================================
-- 낙상 ML 데이터셋 — 2차(Hammer) 라벨링 검증 세트  [1차와 별개 테이블]
-- 파일: 03_schema_fall_2nd.sql  · 격리 schema fall_ml · 테이블 fall_events_2nd
--
-- 의도: 알고리즘 정교화 — ground_truth_label(true_fall/false_positive) 채워진
--        라벨 세트로 임계/피처 튜닝 + id 시간열(이벤트 순서)로 검증.
--
-- 1차(fall_ml.fall_events) 대비:
--   · 별개 테이블(요청). 단 구조 동일 + phase=2 → v_fall_all 뷰로 1차↔2차 비교 가능.
--   · ground_truth_label = 'true_fall' / 'false_positive' (CHECK) — 1차는 비었음.
--   · 낙상후보 라벨 = TP(true_fall) / FP(false_positive) 두 값(후보 테이블이라 TN/FN 없음).
--   · 6축 IMU raw(fs/impact_index/axes) 추가 — imu_window 와 통일, CSV 미수집분 NULL. v_fall_all 도 노출.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS fall_ml;

DROP VIEW  IF EXISTS fall_ml.v_fall_all;
DROP TABLE IF EXISTS fall_ml.fall_events_2nd;

CREATE TABLE fall_ml.fall_events_2nd (
    phase                     SMALLINT     NOT NULL DEFAULT 2,   -- 2차 = 2
    id                        BIGINT       NOT NULL,             -- 이벤트 순서(시간열 키)
    ts                        TIMESTAMPTZ,                       -- (현재 미수집) 실제 시각
    received_at               TIMESTAMPTZ,
    worker_id                 TEXT         NOT NULL,
    worker_name               TEXT,
    employee_id               TEXT,
    fall_decision             TEXT,
    fall_candidate_id         BIGINT,
    fall_update_phase         TEXT,
    fall_prompt_outcome       TEXT,
    fall_prompt_response_sec  NUMERIC(6,2),
    algo_predicted_fall       BOOLEAN,
    -- 센서 피처(낙상 판정 입력) — 2차 실측
    accel_magnitude_g         NUMERIC(7,4),                      -- 충격 가속도 peak(g)
    motion_still_sec          NUMERIC(6,2),                      -- 충격 후 정지(초)
    freefall_preceded         BOOLEAN,                           -- 자유낙하 선행(0/1)
    peak_rotation_rad_s       NUMERIC(8,4),                      -- 최대 회전 각속도
    -- 심박 피처 (2차도 미수집)
    hr_pre_mean_10s           NUMERIC(5,1),
    hr_at_impact              NUMERIC(5,1),
    hr_post_mean_30s          NUMERIC(5,1),
    hr_post_peak_30s          NUMERIC(5,1),
    hr_delta_mean             NUMERIC(5,1),
    hr_delta_peak             NUMERIC(5,1),
    heart_rate                NUMERIC(5,1),
    spo2                      NUMERIC(5,2),
    battery_pct               NUMERIC(5,2),
    latitude                  NUMERIC(9,6),
    longitude                 NUMERIC(9,6),
    -- 6축 IMU raw (imu_window 와 동일 표현 · 현재 CSV 미수집 → NULL = 측정 안 됨)
    fs                        INTEGER,                           -- 샘플링레이트(Hz), 미측정 NULL
    impact_index              INTEGER,                           -- 충격 샘플의 윈도 내 인덱스, 미측정 NULL
    axes                      JSONB,                             -- raw 시계열 [[ax,ay,az,gx,gy,gz],…], 미측정 NULL
    -- ★ 2차 핵심: 정답 라벨(채워짐) — 알고리즘 정교화 기준
    ground_truth_label        TEXT         CHECK (ground_truth_label IN ('true_fall','false_positive')),
    label_note                TEXT,
    labeled_by                TEXT,
    labeled_at                TIMESTAMPTZ,
    loaded_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (phase, id)
);
CREATE INDEX idx_f2_label ON fall_ml.fall_events_2nd (ground_truth_label);
CREATE INDEX idx_f2_seq   ON fall_ml.fall_events_2nd (id);     -- 시간열(이벤트 순서)

-- 1차 + 2차 비교 뷰 (테이블은 별개 유지, 조회만 통합) ------------------
CREATE VIEW fall_ml.v_fall_all AS
    SELECT phase, id, worker_id, accel_magnitude_g, motion_still_sec,
           freefall_preceded, peak_rotation_rad_s, ground_truth_label,
           fs, impact_index, axes
    FROM fall_ml.fall_events
    UNION ALL
    SELECT phase, id, worker_id, accel_magnitude_g, motion_still_sec,
           freefall_preceded, peak_rotation_rad_s, ground_truth_label,
           fs, impact_index, axes
    FROM fall_ml.fall_events_2nd;

-- 적재(psql, CSV 31컬럼 → phase/loaded_at default):
--   \copy fall_ml.fall_events_2nd (id,ts,received_at,worker_id,worker_name,employee_id,
--     fall_decision,fall_candidate_id,fall_update_phase,fall_prompt_outcome,fall_prompt_response_sec,
--     algo_predicted_fall,accel_magnitude_g,motion_still_sec,freefall_preceded,peak_rotation_rad_s,
--     hr_pre_mean_10s,hr_at_impact,hr_post_mean_30s,hr_post_peak_30s,hr_delta_mean,hr_delta_peak,
--     heart_rate,spo2,battery_pct,latitude,longitude,ground_truth_label,label_note,labeled_by,labeled_at)
--     FROM '2ndHammer1personTest.csv' WITH (FORMAT csv, HEADER true, NULL '');
-- =====================================================================
