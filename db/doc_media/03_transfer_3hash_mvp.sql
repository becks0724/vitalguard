-- =====================================================================
-- 03_transfer_3hash_mvp.sql — 파일 전송 3중(해시 3단) 검증 [MVP]
-- doc_media 고도화: ①OCR + ②메타데이터 무결성 + ③파일해시 3단 = 3중 통합 검증
--
-- ▸ 적용 범위 [MVP] = A1·A2 + C1 + B2 + E1·E3
--   A1 3단 해시(origin/received/stored) · A2 transfer_verdict 트리거
--   C1 통합 신뢰도 뷰(v_media_trust) · B2 프리사인 업로드 친화(앱 origin 해시 동봉)
--   E1 doc_media 독립 스키마 유지(메인·낙상과 FK 격리) · E3 멱등 마이그레이션
--
-- ▸ [로드맵 — 실제 진행 예정: 고신뢰 운영판으로 간다] ★
--   운영판:  C2 트리거 연동 강화 · C3 감사로그(media_audit) 추가
--   고신뢰:  D1 해시 HMAC/디지털 서명 · D2 TSA 시점증명 · D3 WORM/Object Lock · A3 멀티알고(crc32+sha256)
--   → 아래 컬럼/주석은 그 방향을 전제로 설계(확장 지점 표시).
--
-- ▸ 멱등 · 적용순서 로컬→스테이징→campus(운영은 팀/배포).
-- =====================================================================

-- A1·A2: 전송 3단 해시 검증 레코드 (전송/재시도 1건 = 1행, 이력 보존) ----
CREATE TABLE IF NOT EXISTS doc_media.media_transfer (
    transfer_id      BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id         BIGINT       NOT NULL REFERENCES doc_media.media_asset(asset_id) ON DELETE CASCADE,
    backend          TEXT         CHECK (backend IS NULL OR backend IN ('gcs','r2','naver','local')),
    hash_algo        TEXT         NOT NULL DEFAULT 'sha256',
    hash_origin      CHAR(64),                          -- ① 앱 촬영/생성 직후(원본)
    hash_received    CHAR(64),                          -- ② 서버 수신 바이트 재계산
    hash_stored      CHAR(64),                          -- ③ 클라우드 저장 후 객체 해시
    origin_match     BOOLEAN,                           -- received == origin (전송 무손상)
    stored_match     BOOLEAN,                           -- stored == received (저장 무결)
    transfer_verdict TEXT         NOT NULL DEFAULT 'pending'
                     CHECK (transfer_verdict IN ('pending','ok','altered_in_transit','altered_at_rest')),
    bytes            BIGINT,
    note             TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    verified_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mt_asset   ON doc_media.media_transfer (asset_id);
CREATE INDEX IF NOT EXISTS idx_mt_verdict ON doc_media.media_transfer (transfer_verdict);

-- A2: 3단 해시 대조 → transfer_verdict 자동판정 트리거 ------------------
CREATE OR REPLACE FUNCTION doc_media.fn_transfer_verify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hash_received IS NOT NULL AND NEW.hash_origin IS NOT NULL THEN
    NEW.origin_match := (NEW.hash_received = NEW.hash_origin);
  END IF;
  IF NEW.hash_stored IS NOT NULL AND COALESCE(NEW.hash_received, NEW.hash_origin) IS NOT NULL THEN
    NEW.stored_match := (NEW.hash_stored = COALESCE(NEW.hash_received, NEW.hash_origin));
  END IF;
  -- 우선순위: 전송변조 → 저장변조 → ok(전 단계 일치) → pending(미완)
  IF NEW.origin_match IS FALSE THEN                         NEW.transfer_verdict := 'altered_in_transit';
  ELSIF NEW.stored_match IS FALSE THEN                      NEW.transfer_verdict := 'altered_at_rest';
  ELSIF NEW.origin_match IS TRUE AND NEW.stored_match IS TRUE THEN NEW.transfer_verdict := 'ok';
  ELSE                                                      NEW.transfer_verdict := 'pending';
  END IF;
  IF NEW.transfer_verdict = 'ok' THEN NEW.verified_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_transfer_verify ON doc_media.media_transfer;
CREATE TRIGGER trg_transfer_verify BEFORE INSERT OR UPDATE ON doc_media.media_transfer
  FOR EACH ROW EXECUTE FUNCTION doc_media.fn_transfer_verify();

-- C1: 3중 통합 신뢰도 뷰 (①OCR ②메타데이터 ③전송해시 → overall_trust) ---
CREATE OR REPLACE VIEW doc_media.v_media_trust AS
SELECT a.asset_id, a.contract_id, a.doc_type, a.has_geo_stamp, a.capture_ts,
       (o.ocr_id IS NOT NULL)        AS ocr_present,        -- ① OCR
       i.verdict                     AS metadata_verdict,   -- ② 메타데이터 무결성
       t.transfer_verdict            AS transfer_verdict,   -- ③ 파일 해시 3단
       CASE
         WHEN i.verdict = 'tampered'
              OR t.transfer_verdict IN ('altered_in_transit','altered_at_rest') THEN 'tampered'
         WHEN i.verdict = 'verified' AND t.transfer_verdict = 'ok' AND o.ocr_id IS NOT NULL THEN 'verified'
         WHEN i.verdict IS NULL OR t.transfer_verdict IS NULL OR t.transfer_verdict = 'pending' THEN 'pending'
         ELSE 'suspect'
       END AS overall_trust
FROM doc_media.media_asset a
LEFT JOIN LATERAL (SELECT * FROM doc_media.media_ocr       WHERE asset_id=a.asset_id ORDER BY ocr_at      DESC LIMIT 1) o ON true
LEFT JOIN LATERAL (SELECT * FROM doc_media.media_integrity WHERE asset_id=a.asset_id ORDER BY created_at DESC LIMIT 1) i ON true
LEFT JOIN LATERAL (SELECT * FROM doc_media.media_transfer  WHERE asset_id=a.asset_id ORDER BY created_at DESC LIMIT 1) t ON true;

-- ③기능 + ④의도 + 로드맵 주석 -----------------------------------------
COMMENT ON TABLE  doc_media.media_transfer IS '파일 전송 3단 해시 검증(MVP A1·A2): 앱→서버→클라우드 무결성. 전송/재시도 1건=1행. [로드맵→고신뢰 운영판 진행예정] 운영판: 감사로그(media_audit)·트리거연동 / 고신뢰: HMAC서명(D1)·TSA(D2)·WORM(D3)·멀티알고(A3).';
COMMENT ON COLUMN doc_media.media_transfer.hash_origin      IS '① 앱 촬영/생성 직후 원본 해시. [고신뢰 로드맵 D1] HMAC/디지털 서명 동봉 예정.';
COMMENT ON COLUMN doc_media.media_transfer.hash_received    IS '② 서버 수신 바이트 재계산. origin≠received → altered_in_transit(전송 중 변조/손상).';
COMMENT ON COLUMN doc_media.media_transfer.hash_stored      IS '③ 클라우드 저장 후 객체 해시. received≠stored → altered_at_rest. 주기 재검증=2way conflict 연동.';
COMMENT ON COLUMN doc_media.media_transfer.transfer_verdict IS 'pending/ok/altered_in_transit/altered_at_rest — 트리거 fn_transfer_verify 자동판정.';
COMMENT ON COLUMN doc_media.media_transfer.hash_algo        IS '기본 sha256. [고신뢰 로드맵 A3] crc32(빠른 1차)+sha256 멀티알고 확장 예정.';
COMMENT ON COLUMN doc_media.media_transfer.backend          IS '저장 백엔드(gcs/r2/naver/local). B2 프리사인 업로드 시 media_cloud_sync 와 연동.';
COMMENT ON VIEW   doc_media.v_media_trust  IS '3중 통합 신뢰도 — ①OCR ②메타데이터 verdict ③전송해시 verdict → overall_trust(verified/suspect/tampered/pending). [로드맵] 운영판에서 컬럼 영속화 + media_audit 감사로그 연동 예정.';

-- 롤백(필요 시):
--   DROP VIEW IF EXISTS doc_media.v_media_trust;
--   DROP TABLE IF EXISTS doc_media.media_transfer;   -- (트리거·함수 동반 제거)
--   DROP FUNCTION IF EXISTS doc_media.fn_transfer_verify();
