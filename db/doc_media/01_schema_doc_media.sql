-- =====================================================================
-- 공사문서 OCR + 사진 하단 메타데이터 무결성 검증 + 2way 클라우드 동기화
-- 파일: 공사문서_OCR_무결성_스키마.sql   (확정본 · 격리 schema doc_media)
-- 근거: safetymonitor/docs/llm-media-features-plan.md(기능 #1) · ContractorSubmitForm · photo-store
--
-- ── 결정 로그 (A1~A4 순차 더블체크) ──────────────────────────────
-- A1 [2way]      = 양방향(up/down/both) + 해시 대조 충돌탐지. UNIQUE(asset_id,backend)
--                  로 백엔드별 1행 → 이중백엔드(GCS+R2 동시저장)도 동일 구조로 수용. ✓
-- A2 [무결성]    = ① 스탬프일시↔EXIF일시 ② 스탬프GPS↔EXIF GPS ③ 파일 sha256 불변
--                  + (추가) ④ 스탬프/EXIF GPS ↔ 등록 현장좌표 교차검증(조달 증빙 신뢰성)
--                  + 존재플래그(exif/stamp) + checks JSONB. 종이문서는 verdict=no_metadata. ✓
-- A3 [문서종류]  = 앱 실제 축 반영: 사진대지/현장사진/검측사진/안전점검(=지오태그 사진,무결성O)
--                  + 세금계산서/계좌이체/근로자대장(=종이문서,무결성N). has_geo_stamp 로 구분. ✓
-- A4 [클라우드]  = S3호환(gcs/r2/naver/local) 교체식, 기본 gcs(발표/MVP=GCS 서울). ✓
-- ─────────────────────────────────────────────────────────────────
--
-- 파이프라인:
--   촬영/OCR → ①media_asset(파일+EXIF+해시) → ②media_ocr(하단 스탬프 판독)
--            → ③media_integrity(스탬프↔EXIF↔해시↔현장 대조) → ④media_cloud_sync(2way)
--   캘린더 = v_calendar_media(촬영일시 capture_ts 기준 자동배치)
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS doc_media;

-- ⚠ 재적용 데이터 보호(fail-safe) — "확정본"이라도 무조건 DROP VIEW/TABLE 은 3중 검증이 보존해야 할
--   조달 증거 사진의 해시·OCR·무결성 판정을 전부 삭제한다. DROP 을 제거(신규 설치는 아래 CREATE 가
--   진행, 기존 테이블 있으면 안전 실패)하고 데이터가 존재하면 명시적으로 중단한다. 초기화는 수동 DROP.
DO $$
BEGIN
  IF to_regclass('doc_media.media_asset') IS NOT NULL
     AND EXISTS (SELECT 1 FROM doc_media.media_asset LIMIT 1) THEN
    RAISE EXCEPTION '설치 중단 — doc_media.media_asset 에 데이터가 존재합니다. 재적용이 조달 증거(해시·OCR·무결성)를 삭제하지 않도록 보호합니다(초기화 시 수동 DROP 후 재실행).';
  END IF;
END $$;

-- ① 미디어 자산 -------------------------------------------------------
CREATE TABLE doc_media.media_asset (
    asset_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    contract_id     TEXT,                          -- 현장/계약 식별
    site_id         BIGINT,                        -- 현장 id(선택)
    captured_by     TEXT,                          -- 촬영자/작업자
    -- A3: 문서종류 (지오태그 사진 = 무결성 대상 / 종이문서 = 대상 아님)
    doc_type        TEXT         NOT NULL DEFAULT 'site_photo'
                    CHECK (doc_type IN ('photo_board','site_photo','inspection_photo','safety_check',
                                        'tax_invoice','bank_transfer','worker_ledger','other')),
    has_geo_stamp   BOOLEAN      NOT NULL DEFAULT true,  -- 하단 지오태그 스탬프 有(무결성 검증 대상)
    original_name   TEXT,
    mime_type       TEXT,
    byte_size       BIGINT,
    file_sha256     CHAR(64),                      -- 원본 파일 해시 = 무결성 기준선
    capture_ts      TIMESTAMPTZ,                   -- EXIF 촬영시각(=캘린더 배치 키)
    captured_lat    NUMERIC(9,6),                  -- EXIF GPS(빠른조회용 복제)
    captured_lon    NUMERIC(9,6),
    status          TEXT         NOT NULL DEFAULT 'uploaded',  -- uploaded/ocr_done/verified/synced/failed
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_ma_capture  ON doc_media.media_asset (capture_ts);
CREATE INDEX idx_ma_contract ON doc_media.media_asset (contract_id);
CREATE INDEX idx_ma_sha      ON doc_media.media_asset (file_sha256);

-- ② OCR 판독 (하단 스탬프 + 전체 텍스트) ------------------------------
CREATE TABLE doc_media.media_ocr (
    ocr_id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id        BIGINT       NOT NULL REFERENCES doc_media.media_asset(asset_id) ON DELETE CASCADE,
    engine          TEXT,                          -- clova/vision/tesseract
    engine_version  TEXT,
    lang            TEXT         DEFAULT 'ko',
    full_text       TEXT,                          -- 전체 판독 텍스트
    stamp_datetime_text TEXT,
    stamp_datetime  TIMESTAMPTZ,                   -- 스탬프 일시
    stamp_lat       NUMERIC(9,6),                  -- 스탬프 GPS
    stamp_lon       NUMERIC(9,6),
    stamp_site      TEXT,                          -- 현장명
    stamp_address   TEXT,
    stamp_worker    TEXT,
    stamp_work_type TEXT,                          -- 공종
    confidence      NUMERIC(4,3),                  -- 평균 신뢰도 0~1
    raw_json        JSONB,                         -- 박스·신뢰도 원시
    ocr_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_mo_asset ON doc_media.media_ocr (asset_id);

-- ③ 메타데이터 무결성 검증 (A2) --------------------------------------
CREATE TABLE doc_media.media_integrity (
    check_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id        BIGINT       NOT NULL REFERENCES doc_media.media_asset(asset_id) ON DELETE CASCADE,
    -- EXIF 원본(기기 기록)
    exif_present    BOOLEAN,                       -- EXIF 메타 존재
    exif_datetime   TIMESTAMPTZ,
    exif_lat        NUMERIC(9,6),
    exif_lon        NUMERIC(9,6),
    exif_make       TEXT,
    exif_model      TEXT,
    stamp_present   BOOLEAN,                       -- 하단 스탬프 판독 성공
    file_sha256     CHAR(64),                      -- 검증 시점 해시
    -- 대조 결과 ①~④
    dt_match        BOOLEAN,                       -- ① 스탬프일시 ↔ EXIF일시
    dt_delta_sec    INTEGER,
    gps_match       BOOLEAN,                       -- ② 스탬프GPS ↔ EXIF GPS
    gps_distance_m  NUMERIC(8,1),
    hash_match      BOOLEAN,                       -- ③ asset.file_sha256 불변(미변조)
    site_lat        NUMERIC(9,6),                  -- ④ 등록 현장 좌표
    site_lon        NUMERIC(9,6),
    site_gps_match  BOOLEAN,                       -- ④ 스탬프/EXIF GPS ↔ 등록 현장(허용반경 내)
    site_distance_m NUMERIC(9,1),
    checks          JSONB,                         -- 개별 검사 결과·허용오차 모음
    verdict         TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (verdict IN ('verified','mismatch','tampered','no_metadata','pending')),
    reasons         JSONB,                         -- 불일치 근거 배열
    verified_by     TEXT,                          -- system / 사람
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_mi_asset   ON doc_media.media_integrity (asset_id);
CREATE INDEX idx_mi_verdict ON doc_media.media_integrity (verdict);

-- ④ 클라우드 2way(양방향) 동기화 (A1·A4) ----------------------------
CREATE TABLE doc_media.media_cloud_sync (
    sync_id         BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id        BIGINT       NOT NULL REFERENCES doc_media.media_asset(asset_id) ON DELETE CASCADE,
    backend         TEXT         NOT NULL DEFAULT 'gcs'          -- A4: S3호환 교체식
                    CHECK (backend IN ('gcs','r2','naver','local')),
    bucket          TEXT,
    object_key      TEXT,                          -- 클라우드 객체 경로
    cloud_etag      TEXT,
    cloud_version_id TEXT,
    cloud_sha256    CHAR(64),                      -- 클라우드 객체 해시
    local_sha256    CHAR(64),                      -- 로컬/DB 기준 해시(=asset.file_sha256)
    sync_direction  TEXT         NOT NULL DEFAULT 'both'         -- A1: 2way
                    CHECK (sync_direction IN ('up','down','both')),
    sync_state      TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (sync_state IN ('pending','synced','conflict','error')),
    conflict_reason TEXT,                          -- 양쪽 해시 다름 등
    last_pushed_at  TIMESTAMPTZ,                   -- 로컬→클라우드
    last_pulled_at  TIMESTAMPTZ,                   -- 클라우드→로컬
    last_synced_at  TIMESTAMPTZ,                   -- 최종 일치 확인
    signed_url      TEXT,
    signed_url_expires_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (asset_id, backend)                     -- 백엔드별 1행(2way·이중백엔드 모두 수용)
);
CREATE INDEX idx_mcs_asset ON doc_media.media_cloud_sync (asset_id);
CREATE INDEX idx_mcs_state ON doc_media.media_cloud_sync (sync_state);
CREATE INDEX idx_mcs_key   ON doc_media.media_cloud_sync (object_key);

-- 캘린더 표시용 뷰 (calendar_media 계획 형태로 평탄화) ----------------
CREATE VIEW doc_media.v_calendar_media AS
SELECT a.asset_id,
       a.capture_ts,                       -- 캘린더 배치 날짜/시각
       a.contract_id, a.site_id, a.captured_by, a.doc_type, a.has_geo_stamp,
       o.full_text        AS ocr_text,
       o.stamp_site, o.stamp_work_type,
       i.verdict          AS integrity_verdict,   -- verified 면 신뢰 가능
       s.backend, s.object_key, s.sync_state,
       s.signed_url, s.signed_url_expires_at
FROM doc_media.media_asset a
LEFT JOIN LATERAL (SELECT * FROM doc_media.media_ocr        WHERE asset_id=a.asset_id ORDER BY ocr_at      DESC LIMIT 1) o ON true
LEFT JOIN LATERAL (SELECT * FROM doc_media.media_integrity  WHERE asset_id=a.asset_id ORDER BY created_at DESC LIMIT 1) i ON true
LEFT JOIN LATERAL (SELECT * FROM doc_media.media_cloud_sync WHERE asset_id=a.asset_id ORDER BY updated_at DESC LIMIT 1) s ON true;

-- =====================================================================
-- TODO(2상) — 스키마 확정 후 구현
--  1) 무결성 자동검증 함수/트리거(스탬프 파싱 → dt/gps/hash/site 자동 채움 + verdict 전이)
--  2) 2way 동기화 워커(local_sha256 ↔ cloud_sha256 비교 → push/pull/conflict)
--  3) S3호환 업로드/서명URL 라우트(backend 설정 스위치)
--  4) v_calendar_media → 관제웹 캘린더 자동배치 연동
--  5) verdict=tampered 알림·감사로그(조달 증빙 신뢰성)
--  6) doc_type/backend 값 확장 필요 시 코드테이블화
-- =====================================================================

-- ─── ③ 기능 설명 주석 + ④ 추가 의도 (COMMENT ON, \d+ 로 노출) ───────────
COMMENT ON TABLE  doc_media.media_asset IS '① 미디어 자산 — 파일+EXIF+해시. 무결성 검증 기준선. 캘린더 배치(capture_ts)의 소스.';
COMMENT ON COLUMN doc_media.media_asset.doc_type      IS 'A3 문서종류 CHECK: 사진대지/현장사진/검측사진/안전점검(지오태그·무결성O) · 세금계산서/계좌이체/근로자대장(종이·무결성N).';
COMMENT ON COLUMN doc_media.media_asset.has_geo_stamp IS 'A3 하단 지오태그 스탬프 有 여부 → 무결성 검증 대상 구분(false=종이문서, verdict=no_metadata).';
COMMENT ON COLUMN doc_media.media_asset.file_sha256   IS '원본 파일 sha256 = 무결성 기준선(변조 탐지의 비교 대상).';
COMMENT ON COLUMN doc_media.media_asset.capture_ts    IS 'EXIF 촬영시각 = v_calendar_media 캘린더 배치 키.';
COMMENT ON COLUMN doc_media.media_asset.status        IS '라이프사이클: uploaded/ocr_done/verified/synced/failed.';
COMMENT ON TABLE  doc_media.media_ocr IS '② OCR 판독 — 사진 하단 스탬프(일시·GPS·현장·공종) + 전체 텍스트. 엔진 clova/vision/tesseract.';
COMMENT ON COLUMN doc_media.media_ocr.stamp_datetime IS '하단 스탬프 판독 일시 → media_integrity 가 EXIF 일시와 대조(①).';
COMMENT ON COLUMN doc_media.media_ocr.stamp_lat      IS '하단 스탬프 GPS 위도 → EXIF/등록현장과 대조(②④).';
COMMENT ON COLUMN doc_media.media_ocr.stamp_lon      IS '하단 스탬프 GPS 경도 → EXIF/등록현장과 대조(②④).';
COMMENT ON TABLE  doc_media.media_integrity IS '③ 메타데이터 무결성 검증(A2) — 스탬프↔EXIF↔해시↔현장 4대조. verdict 는 트리거 fn_integrity_autofill 자동판정.';
COMMENT ON COLUMN doc_media.media_integrity.verdict        IS 'A2 판정 CHECK(verified/mismatch/tampered/no_metadata/pending). 트리거 자동: 메타없음→변조(hash≠)→정상→불일치 우선순위.';
COMMENT ON COLUMN doc_media.media_integrity.dt_match       IS '① 스탬프일시 ↔ EXIF일시 일치(허용 ±120s).';
COMMENT ON COLUMN doc_media.media_integrity.gps_match      IS '② 스탬프GPS ↔ EXIF GPS 일치(허용 ±50m, haversine).';
COMMENT ON COLUMN doc_media.media_integrity.hash_match     IS '③ asset.file_sha256 불변(변조 탐지).';
COMMENT ON COLUMN doc_media.media_integrity.site_gps_match IS '④ 스탬프/EXIF GPS ↔ 등록 현장좌표 교차검증(반경 200m, 조달 증빙 신뢰성).';
COMMENT ON COLUMN doc_media.media_integrity.checks         IS '개별 검사 결과·허용오차 JSONB.';
COMMENT ON COLUMN doc_media.media_integrity.reasons        IS '불일치 근거 배열 JSONB(verdict≠verified 일 때).';
COMMENT ON TABLE  doc_media.media_cloud_sync IS '④ 클라우드 2way(양방향) 동기화(A1·A4) — 해시 대조 충돌탐지. sync_state 는 트리거 fn_sync_resolve 자동전이.';
COMMENT ON COLUMN doc_media.media_cloud_sync.backend        IS 'A4 S3호환 교체식 CHECK(gcs/r2/naver/local), 기본 gcs. UNIQUE(asset_id,backend)로 백엔드별 1행.';
COMMENT ON COLUMN doc_media.media_cloud_sync.sync_direction IS 'A1 2way CHECK(up/down/both).';
COMMENT ON COLUMN doc_media.media_cloud_sync.sync_state     IS 'CHECK(pending/synced/conflict/error). 트리거가 local↔cloud sha256 비교로 자동전이(같으면 synced, 다르면 conflict).';
COMMENT ON COLUMN doc_media.media_cloud_sync.local_sha256   IS '로컬/DB 기준 해시(=asset.file_sha256). cloud_sha256 과 비교.';
COMMENT ON COLUMN doc_media.media_cloud_sync.cloud_sha256   IS '클라우드 객체 해시. local 과 다르면 conflict.';
COMMENT ON COLUMN doc_media.media_cloud_sync.conflict_reason IS '양쪽 해시 다름 등 충돌 사유.';
COMMENT ON VIEW doc_media.v_calendar_media IS '관제웹 캘린더용 평탄화 뷰 — capture_ts 기준 자산 + 최신 OCR/무결성/동기화 LATERAL 조인.';
