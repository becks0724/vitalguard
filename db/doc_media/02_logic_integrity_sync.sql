-- =====================================================================
-- doc_media 2상 로직 — 무결성 자동검증 트리거 + 2way 동기화 트리거
-- 파일: 공사문서_OCR_무결성_2상로직.sql  (01_schema 적용 후 실행)
-- · PostGIS 미설치(vitalguard) → 거리 계산은 직접 haversine
-- · 허용오차: 시각 ±120s · 스탬프↔EXIF GPS ±50m · 등록현장 반경 200m
-- =====================================================================

-- 거리(m) — 두 위경도 사이 haversine -------------------------------
CREATE OR REPLACE FUNCTION doc_media.fn_haversine_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN NULL
    ELSE round((6371000 * 2 * asin(least(1, sqrt(
           power(sin(radians((lat2-lat1)/2)),2)
           + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians((lon2-lon1)/2)),2)
         ))))::numeric, 1)
  END;
$$;

-- 무결성 자동검증 — media_integrity INSERT/UPDATE 전 verdict 자동 채움 ---
CREATE OR REPLACE FUNCTION doc_media.fn_integrity_autofill() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c_dt_tol_s   int := 120;
  c_gps_tol_m  numeric := 50;
  c_site_rad_m numeric := 200;
  v_sdt timestamptz; v_slat numeric; v_slon numeric;   -- OCR 스탬프
  v_hash char(64); v_geo boolean;                       -- 자산
  r jsonb := '[]'::jsonb;
BEGIN
  SELECT stamp_datetime, stamp_lat, stamp_lon INTO v_sdt, v_slat, v_slon
    FROM doc_media.media_ocr WHERE asset_id = NEW.asset_id ORDER BY ocr_at DESC LIMIT 1;
  SELECT file_sha256, has_geo_stamp INTO v_hash, v_geo
    FROM doc_media.media_asset WHERE asset_id = NEW.asset_id;

  NEW.stamp_present := (v_sdt IS NOT NULL OR v_slat IS NOT NULL);
  NEW.exif_present  := (NEW.exif_datetime IS NOT NULL OR NEW.exif_lat IS NOT NULL);

  -- ① 스탬프일시 ↔ EXIF일시
  IF v_sdt IS NOT NULL AND NEW.exif_datetime IS NOT NULL THEN
    NEW.dt_delta_sec := abs(extract(epoch FROM (v_sdt - NEW.exif_datetime)))::int;
    NEW.dt_match := NEW.dt_delta_sec <= c_dt_tol_s;
    IF NOT NEW.dt_match THEN r := r || jsonb_build_object('dt_delta_sec', NEW.dt_delta_sec); END IF;
  END IF;
  -- ② 스탬프GPS ↔ EXIF GPS
  IF v_slat IS NOT NULL AND NEW.exif_lat IS NOT NULL THEN
    NEW.gps_distance_m := doc_media.fn_haversine_m(v_slat, v_slon, NEW.exif_lat, NEW.exif_lon);
    NEW.gps_match := NEW.gps_distance_m <= c_gps_tol_m;
    IF NOT NEW.gps_match THEN r := r || jsonb_build_object('gps_dist_m', NEW.gps_distance_m); END IF;
  END IF;
  -- ③ 파일 해시 불변(위변조)
  IF NEW.file_sha256 IS NOT NULL AND v_hash IS NOT NULL THEN
    NEW.hash_match := (NEW.file_sha256 = v_hash);
    IF NOT NEW.hash_match THEN r := r || jsonb_build_object('hash','changed'); END IF;
  END IF;
  -- ④ (EXIF/스탬프) GPS ↔ 등록 현장
  IF NEW.site_lat IS NOT NULL AND (NEW.exif_lat IS NOT NULL OR v_slat IS NOT NULL) THEN
    NEW.site_distance_m := doc_media.fn_haversine_m(
      COALESCE(NEW.exif_lat, v_slat), COALESCE(NEW.exif_lon, v_slon), NEW.site_lat, NEW.site_lon);
    NEW.site_gps_match := NEW.site_distance_m <= c_site_rad_m;
    IF NOT NEW.site_gps_match THEN r := r || jsonb_build_object('site_dist_m', NEW.site_distance_m); END IF;
  END IF;

  -- verdict 판정 (우선순위: 메타없음 → 위변조 → 정상 → 불일치)
  IF v_geo IS FALSE THEN                                   NEW.verdict := 'no_metadata';
  ELSIF NOT NEW.stamp_present AND NOT NEW.exif_present THEN NEW.verdict := 'no_metadata';
  ELSIF NEW.hash_match IS FALSE THEN                        NEW.verdict := 'tampered';
  ELSIF COALESCE(NEW.dt_match,true) AND COALESCE(NEW.gps_match,true)
        AND COALESCE(NEW.site_gps_match,true) THEN          NEW.verdict := 'verified';
  ELSE                                                       NEW.verdict := 'mismatch';
  END IF;

  NEW.reasons := CASE WHEN jsonb_array_length(r)=0 THEN NULL ELSE r END;
  NEW.checks  := jsonb_build_object('dt_tol_s',c_dt_tol_s,'gps_tol_m',c_gps_tol_m,'site_radius_m',c_site_rad_m,
                  'dt_match',NEW.dt_match,'gps_match',NEW.gps_match,'hash_match',NEW.hash_match,'site_gps_match',NEW.site_gps_match);
  IF NEW.verified_by IS NULL THEN NEW.verified_by := 'system'; END IF;
  NEW.verified_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_integrity_autofill ON doc_media.media_integrity;
CREATE TRIGGER trg_integrity_autofill BEFORE INSERT OR UPDATE ON doc_media.media_integrity
  FOR EACH ROW EXECUTE FUNCTION doc_media.fn_integrity_autofill();

-- 2way 동기화 상태 — media_cloud_sync INSERT/UPDATE 전 sync_state 결정 ---
CREATE OR REPLACE FUNCTION doc_media.fn_sync_resolve() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.local_sha256 IS NOT NULL AND NEW.cloud_sha256 IS NOT NULL THEN
    IF NEW.local_sha256 = NEW.cloud_sha256 THEN
      NEW.sync_state := 'synced'; NEW.last_synced_at := now(); NEW.conflict_reason := NULL;
    ELSE
      NEW.sync_state := 'conflict'; NEW.conflict_reason := 'local/cloud sha256 differ';
    END IF;
  ELSIF NEW.local_sha256 IS NOT NULL OR NEW.cloud_sha256 IS NOT NULL THEN
    IF NEW.sync_state <> 'error' THEN NEW.sync_state := 'pending'; END IF;   -- 한쪽만 = 전송 대기
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_resolve ON doc_media.media_cloud_sync;
CREATE TRIGGER trg_sync_resolve BEFORE INSERT OR UPDATE ON doc_media.media_cloud_sync
  FOR EACH ROW EXECUTE FUNCTION doc_media.fn_sync_resolve();

-- =====================================================================
-- (앱 워커 연계) 2way 동기화 루프 의사코드:
--   주기적으로 media_cloud_sync 를 스캔:
--     · sync_state='pending' & local만 있음 → 클라우드 PUT(up) → cloud_sha256/etag 기록
--     · sync_state='pending' & cloud만 있음 → 클라우드 GET(down) → local 반영
--     · sync_state='conflict' → 정책(최신 우선/수동) 후 한쪽 덮어쓰기 → 재평가
--   트리거가 상태전이를 보장하므로 워커는 'I/O + 해시 기록'만 담당.
-- =====================================================================

-- ─── ③ 기능 설명 주석 (함수·트리거, \df+ / \d+ 로 노출) ─────────────────
COMMENT ON FUNCTION doc_media.fn_haversine_m(numeric,numeric,numeric,numeric) IS 'PostGIS 없는 환경용 haversine 거리(m). GPS 대조(②④)에 사용.';
COMMENT ON FUNCTION doc_media.fn_integrity_autofill()  IS '트리거 함수 — media_integrity BEFORE INSERT/UPDATE. dt/gps/hash/site 대조 후 verdict·reasons·checks 자동 채움.';
COMMENT ON FUNCTION doc_media.fn_sync_resolve()        IS '트리거 함수 — media_cloud_sync BEFORE INSERT/UPDATE. local↔cloud sha256 비교로 sync_state 자동전이.';
