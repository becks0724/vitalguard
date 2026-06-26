-- =====================================================================
-- imu_window — A3 raw 6축 IMU 임시 수집 버퍼 (정본 DDL · 하드닝 적용)
-- ⚠️ 임시 버퍼. 본 파이프라인(fall_events / vital_samples)과 미연결 — FK·뷰·트리거 없음.
--    수집 → /api/admin/imu-export(NDJSON) 회수 → 학습 → DROP.
--
-- 진실원: apps/dashboard-web/lib/db.ts 의 ensureImuWindowTable() 가 첫 INSERT 시 자동 생성.
--         이 파일은 수동 생성/문서용 — 아래 CREATE TABLE·INDEX 블록은 ensureImuWindowTable()
--         과 한 글자도 다르지 않게 동기화한다(표현 정합).
-- =====================================================================

CREATE TABLE IF NOT EXISTS imu_window (
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
);
CREATE INDEX IF NOT EXISTS idx_imu_worker ON imu_window (worker_id, id);

-- 기능 설명 주석(문서용 · 구조 아님) -----------------------------------
COMMENT ON TABLE  imu_window               IS 'A3 임시 수집 버퍼 — 워치 raw 6축 IMU 윈도. 본 파이프라인 미연결, 수집→export→DROP.';
COMMENT ON COLUMN imu_window.id            IS 'PK(BIGSERIAL). export ORDER BY 의 2차 정렬키.';
COMMENT ON COLUMN imu_window.worker_id     IS 'DB 등록 아이디(LOSO subject). 라우트 폴백 미입력 시 ''UNSET''.';
COMMENT ON COLUMN imu_window.family        IS '동작 라벨: fall/hammer/pound/throw/walk/sit (미니앱 6종). NULL 허용. recovery 빌드 추가 시 chk_imu_family 갱신.';
COMMENT ON COLUMN imu_window.fs            IS '샘플레이트(Hz, 기대 50). NULL 허용.';
COMMENT ON COLUMN imu_window.impact_index  IS '윈도 내 충격 샘플 위치(0-base 인덱스). NULL 허용.';
COMMENT ON COLUMN imu_window.axes          IS '6축 IMU 시계열 [[ax,ay,az,gx,gy,gz], …]. NOT NULL, 비어있지 않은 배열(행 6축은 수신 라우트가 검증).';
COMMENT ON COLUMN imu_window.created_at    IS '서버 수신 시각(버퍼 관리/DROP 판단). export NDJSON 에는 미포함.';

-- 수집·회수가 끝난 뒤 정리:
--   DROP TABLE imu_window;
