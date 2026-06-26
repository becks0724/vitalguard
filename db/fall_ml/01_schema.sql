-- =====================================================================
-- 낙상 감지 로직 검증 DB 스키마  (1상 / PostgreSQL 기준)
-- 파일: 01_schema.sql
-- 출처 CSV: 1stTestDBdata.csv (31개 컬럼)
--
-- ※ 1상 단계: 테이블 적재만 목적. 검증/제약은 보완예정(아래 TODO 참조).
-- =====================================================================

DROP TABLE IF EXISTS fall_events;

CREATE TABLE fall_events (
    -- 식별/시간 -------------------------------------------------------
    id                        BIGINT       PRIMARY KEY,
    ts                        TIMESTAMPTZ,                 -- 이벤트 발생 시각(워치)
    received_at               TIMESTAMPTZ,                 -- 서버 수신 시각

    -- 작업자 ---------------------------------------------------------
    worker_id                 TEXT         NOT NULL,       -- 예: WATCH_TEST
    worker_name               TEXT,
    employee_id               TEXT,

    -- 낙상 판정/라이프사이클 -----------------------------------------
    fall_decision             TEXT,                        -- TODO(보완): enum 확정 FALL/NO_FALL/CANCELLED/PENDING
    fall_candidate_id         BIGINT,                      -- 후보 이벤트 그룹 id
    fall_update_phase         TEXT,                        -- TODO(보완): enum 확정 CANDIDATE/PROMPTING/CONFIRMED/RESOLVED
    fall_prompt_outcome       TEXT,                        -- TODO(보완): enum 확정 NO_RESPONSE/FALSE_ALARM/CONFIRMED_FALL/CANCELLED_BY_USER
    fall_prompt_response_sec  NUMERIC(6,2),                -- 프롬프트 응답 소요(초)
    algo_predicted_fall       BOOLEAN,                     -- 알고리즘 1차 예측 (현재 CSV 미수집)

    -- 센서 피처 (낙상 판정 입력) -------------------------------------
    accel_magnitude_g         NUMERIC(7,4),                -- 충격 가속도 peak(g)
    motion_still_sec          NUMERIC(6,2),                -- 충격 후 정지 시간(초)
    freefall_preceded         BOOLEAN,                     -- 자유낙하 선행 여부 (CSV 0/1)
    peak_rotation_rad_s       NUMERIC(8,4),                -- 최대 회전 각속도(rad/s)

    -- 심박 피처 ------------------------------------------------------
    hr_pre_mean_10s           NUMERIC(5,1),                -- 충격 전 10초 평균 HR
    hr_at_impact              NUMERIC(5,1),                -- 충격 시점 HR
    hr_post_mean_30s          NUMERIC(5,1),                -- 충격 후 30초 평균 HR
    hr_post_peak_30s          NUMERIC(5,1),                -- 충격 후 30초 최대 HR
    hr_delta_mean             NUMERIC(5,1),                -- 파생: post_mean_30s - pre_mean_10s
    hr_delta_peak             NUMERIC(5,1),                -- 파생: post_peak_30s - pre_mean_10s

    -- 생체/디바이스 --------------------------------------------------
    heart_rate                NUMERIC(5,1),
    spo2                      NUMERIC(5,2),
    battery_pct               NUMERIC(5,2),
    latitude                  NUMERIC(9,6),
    longitude                 NUMERIC(9,6),

    -- 정답 라벨링 ----------------------------------------------------
    ground_truth_label        TEXT,                        -- TODO(보완): enum 확정 FALL/NO_FALL
    label_note                TEXT,
    labeled_by                TEXT,
    labeled_at                TIMESTAMPTZ
);

-- 기본 인덱스
CREATE INDEX idx_fe_worker    ON fall_events (worker_id);
CREATE INDEX idx_fe_candidate ON fall_events (fall_candidate_id);

-- CSV 적재 (psql)
--   \copy fall_events FROM '1stTestDBdata.csv' WITH (FORMAT csv, HEADER true, NULL '');

-- =====================================================================
-- TODO(보완예정 / 2상 이후)
--  1) 판정 임계값 파라미터 테이블(fall_algo_params: accel/still/rotation/무응답시간)
--     - 실제 펌웨어 알고리즘 값 확정 후 추가, 검증 기준 1곳 관리
--  2) enum 값 확정 → fall_decision / fall_update_phase / fall_prompt_outcome /
--     ground_truth_label 에 CHECK 제약 또는 ENUM 타입 적용
--  3) 도메인 무결성 CHECK 추가
--     - spo2 0~100, battery_pct 0~100, heart_rate 0~300
--     - latitude -90~90, longitude -180~180
--     - accel/still/rotation >= 0, received_at >= ts
--  4) 정합성 검증 쿼리(C0~C6) 재작성
--     - 심박 파생값 일치(delta = post-pre), 예측 vs 규칙 재계산,
--       fall_decision vs (예측+프롬프트), 혼동행렬/지표(accuracy·recall 등)
--     ※ 선행조건: algo_predicted_fall 와 ground_truth_label 데이터 채워야 실행 가능
--  5) 현재 CSV는 31컬럼 중 27컬럼 미수집(센서 4개만 존재) → 수집 범위 확장 필요
-- =====================================================================
