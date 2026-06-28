-- =====================================================================
-- db-audit-fixes.sql  —  VITALGUARD / SafeProcure DB audit remediation
-- Generated from 10-agent static audit + reconciliation. Apply in order.
-- =====================================================================
-- SAFETY HEADER (READ BEFORE APPLYING)
--  1. MANDATORY: take a full backup first.
--       pg_dump --format=custom "$DSN" -f vitalguard_preaudit_$(date +%F).dump
--     Verify it restores into a scratch instance before proceeding.
--  2. Apply on a TEST/STAGING copy first, then production.
--  3. Each fix is wrapped in its own BEGIN; ... COMMIT; so a single
--     failure does not abort unrelated fixes. You MAY wrap the whole
--     file in one outer transaction if you prefer all-or-nothing, but
--     note items marked [DOWNTIME] / VACUUM / CREATE EXTENSION cannot
--     run inside a single long transaction (see their notes).
--  4. [DOWNTIME] markers = ACCESS EXCLUSIVE lock / table rewrite /
--     server restart. Schedule for a low-traffic window.
--  5. ADD CONSTRAINT (CHECK/UNIQUE/FK) fails if existing rows violate it.
--     RUN the matching query in the DIAGNOSTIC section (bottom) and
--     confirm zero violations BEFORE applying that fix.
--  6. Encryption / RLS examples assume the app injects session vars
--     (app.company_idx, app.pii_key). The app connection layer MUST be
--     updated FIRST or those reads/writes break. Treat them as staged.
--  7. DELETE-based retention is irreversible — backup is the only rollback.
--  8. Priority labels: [P0]=Critical/High blast radius, [P1]=High/Medium,
--     [P2]=Medium/Low. Rollback snippets are inline where reversible.
-- =====================================================================


-- #####################################################################
-- [P0] PRIORITY 0 — CRITICAL / HIGHEST BLAST RADIUS
-- #####################################################################

-- ---------------------------------------------------------------------
-- [P0] PRIV-01 / SEC-PII-001 — Sensitive health/biometric data stored
--      in plaintext; no pgcrypto, no column encryption. STAGE 1 only:
--      install pgcrypto + add encrypted shadow columns. App must write
--      via pgp_sym_encrypt (key from external secret manager), then
--      backfill (STAGE 2), then DROP plaintext columns (STAGE 3).
-- Basis: db/integrated/vital_samples_galaxy.sql:39-49,
--        db/fall_ml/02_schema_fall_ml.sql:45-60 — pgcrypto/encrypt grep=0.
-- NOTE: [DOWNTIME] ADD COLUMN bytea is cheap; encryption rollout is the
--       slow part. CREATE EXTENSION may need superuser.
-- ---------------------------------------------------------------------
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Galaxy biometric table — encrypted shadow columns (app populates them).
ALTER TABLE vital_samples_galaxy ADD COLUMN IF NOT EXISTS heart_rate_enc bytea;
ALTER TABLE vital_samples_galaxy ADD COLUMN IF NOT EXISTS spo2_enc       bytea;
-- VITALGUARD worker PII — encrypted shadow column.
ALTER TABLE public.T_WORKER     ADD COLUMN IF NOT EXISTS worker_phone_enc bytea;
COMMIT;
-- STAGE 2 (run after app injects key into session app.pii_key):
--   UPDATE vital_samples_galaxy SET heart_rate_enc = pgp_sym_encrypt(heart_rate::text, current_setting('app.pii_key')) WHERE heart_rate_enc IS NULL;
--   UPDATE vital_samples_galaxy SET spo2_enc       = pgp_sym_encrypt(spo2::text,       current_setting('app.pii_key')) WHERE spo2_enc IS NULL;
--   UPDATE public.T_WORKER       SET worker_phone_enc = pgp_sym_encrypt(WORKER_PHONE,   current_setting('app.pii_key')) WHERE worker_phone_enc IS NULL;
-- STAGE 3 (after verification): ALTER TABLE ... DROP COLUMN <plaintext>;  (separate change)
-- ROLLBACK (stage 1):
--   BEGIN;
--   ALTER TABLE vital_samples_galaxy DROP COLUMN IF EXISTS heart_rate_enc;
--   ALTER TABLE vital_samples_galaxy DROP COLUMN IF EXISTS spo2_enc;
--   ALTER TABLE public.T_WORKER     DROP COLUMN IF EXISTS worker_phone_enc;
--   DROP EXTENSION IF EXISTS pgcrypto;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P0] SEC-RLS-001 — No row-level security anywhere; multitenant
--      isolation depends entirely on app code. Example for T_WORKER;
--      replicate the pattern to T_SITE / T_SAFEGUARD / T_SENSING(via
--      WORKER) / T_ALERT(via SENSING) / T_SAFETY_EXPENSE(via SITE).
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:34-208 — RLS grep=0.
-- PREREQ: app must SET app.company_idx per tenant session before this
--         is enforced, or queries return no rows.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_WORKER ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.T_WORKER FORCE  ROW LEVEL SECURITY;
CREATE POLICY p_worker_tenant ON public.T_WORKER
  USING (COMPANY_IDX = current_setting('app.company_idx', true)::bigint);
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   DROP POLICY IF EXISTS p_worker_tenant ON public.T_WORKER;
--   ALTER TABLE public.T_WORKER NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.T_WORKER DISABLE ROW LEVEL SECURITY;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P0] SEC-PWD-001 / PRIV-02 / DB7-001 — T_SAFEGUARD.SG_PWD allows
--      plaintext admin password. CONFLICT RESOLVED: use hash-prefix
--      regex (rejects 60-char plaintext), NOT length-only check.
--      'scrypt$' must be allowed (app uses scrypt self-describing fmt).
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:123-134.
-- PREREQ: re-hash any existing plaintext rows in the app FIRST; verify
--         zero violations via DIAGNOSTIC D-PWD before applying.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_SAFEGUARD
  ADD CONSTRAINT ck_sg_pwd_hashed
  CHECK (SG_PWD ~ '^(scrypt\$|\$argon2|\$2[aby]\$)');
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.T_SAFEGUARD DROP CONSTRAINT IF EXISTS ck_sg_pwd_hashed;
--   COMMIT;


-- #####################################################################
-- [P1] PRIORITY 1 — HIGH / MEDIUM
-- #####################################################################

-- ---------------------------------------------------------------------
-- [P1] SEC-PRIV-001 — PUBLIC schema CREATE not revoked; no least-priv
--      grants. Replace 'vitalguard_app' with your real app role.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:31; REVOKE/GRANT grep=0.
-- ---------------------------------------------------------------------
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA doc_media, safeprocure, fall_ml, imu_collect FROM PUBLIC;
-- GRANT USAGE ON SCHEMA public, doc_media, safeprocure, fall_ml, imu_collect TO vitalguard_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vitalguard_app;
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   GRANT CREATE ON SCHEMA public TO PUBLIC;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PERF-01 / DB7-003 — VITALGUARD 6 FK child columns + (PERF-02)
--      T_SENSING time-series have no indexes. RESTRICT deletes and
--      every parent->child join become full scans.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:191-208 (FKs),
--        82-91 (T_SENSING). For large live tables run each CREATE INDEX
--        CONCURRENTLY OUTSIDE a transaction to avoid lock/downtime.
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO public;
CREATE INDEX IF NOT EXISTS idx_t_worker_company        ON T_WORKER (COMPANY_IDX);
CREATE INDEX IF NOT EXISTS idx_t_sensing_worker        ON T_SENSING (WORKER_IDX);
CREATE INDEX IF NOT EXISTS idx_t_site_company          ON T_SITE (COMPANY_IDX);
CREATE INDEX IF NOT EXISTS idx_t_safeguard_company     ON T_SAFEGUARD (COMPANY_IDX);
CREATE INDEX IF NOT EXISTS idx_t_alert_sensing         ON T_ALERT (SENSING_IDX);
CREATE INDEX IF NOT EXISTS idx_t_safety_expense_site   ON T_SAFETY_EXPENSE (SITE_IDX);
-- PERF-02: T_SENSING time-series access (worker latest / time range).
CREATE INDEX IF NOT EXISTS idx_t_sensing_worker_created ON T_SENSING (WORKER_IDX, CREATED_AT DESC);
CREATE INDEX IF NOT EXISTS idx_t_sensing_created        ON T_SENSING (CREATED_AT);
COMMIT;
-- ROLLBACK:
--   BEGIN; SET search_path TO public;
--   DROP INDEX IF EXISTS idx_t_worker_company, idx_t_sensing_worker, idx_t_site_company,
--     idx_t_safeguard_company, idx_t_alert_sensing, idx_t_safety_expense_site,
--     idx_t_sensing_worker_created, idx_t_sensing_created;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PERF-06 — alerts list orders by ts DESC,id DESC but only
--      created_at is indexed → full sort.
-- Basis: lib/db.ts:208-219 (alerts), 614-620 (listAlerts).
-- ---------------------------------------------------------------------
BEGIN;
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts (ts DESC, id DESC);
COMMIT;
-- ROLLBACK: BEGIN; DROP INDEX IF EXISTS idx_alerts_ts; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PERF-04 — auditWorkerDays groups by substr(ts,1,10); expression
--      index accelerates the day-grouping aggregate.
-- Basis: lib/db.ts:524-561.
-- ---------------------------------------------------------------------
BEGIN;
CREATE INDEX IF NOT EXISTS idx_vs_ts_date ON vital_samples (substr(ts,1,10), worker_id);
COMMIT;
-- ROLLBACK: BEGIN; DROP INDEX IF EXISTS idx_vs_ts_date; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PERF-05 — fall-candidate scan over vital_samples; partial index
--      on candidate predicate keeps it small and fast.
-- Basis: lib/db.ts:719-759 (FALL_WHERE/FALL_SELECT).
-- ---------------------------------------------------------------------
BEGIN;
CREATE INDEX IF NOT EXISTS idx_vs_fall_candidate
  ON vital_samples (ts DESC)
  WHERE fall_candidate = 1 OR (fall_detected = 1 AND fall_candidate_id IS NULL);
COMMIT;
-- ROLLBACK: BEGIN; DROP INDEX IF EXISTS idx_vs_fall_candidate; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PERF-07 — doc_media LATERAL "latest 1" views sort per-asset for
--      lack of (asset_id, sortkey DESC) composite indexes.
-- Basis: db/doc_media/01_schema_doc_media.sql:144-156,
--        db/doc_media/03_transfer_3hash_mvp.sql:62-77.
-- ORDER DEPENDENCY: this MUST run before PERF-08 (drop of single-col idx).
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO doc_media;
CREATE INDEX IF NOT EXISTS idx_mo_asset_ocr      ON media_ocr        (asset_id, ocr_at DESC);
CREATE INDEX IF NOT EXISTS idx_mi_asset_created  ON media_integrity  (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcs_asset_updated ON media_cloud_sync (asset_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_asset_created  ON media_transfer   (asset_id, created_at DESC);
COMMIT;
-- ROLLBACK:
--   BEGIN; SET search_path TO doc_media;
--   DROP INDEX IF EXISTS idx_mo_asset_ocr, idx_mi_asset_created, idx_mcs_asset_updated, idx_mt_asset_created;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DB7-005 / APP-03 / SCHEMA-007 — calendar_media_comment.media_id
--      has no FK; orphan comments survive parent deletion. Idempotent
--      cleanup + CASCADE FK (guarded by pg_constraint existence check).
-- Basis: lib/db.ts:348-360; db/calendar_media/01_fk_orphan_fix.sql.
-- ---------------------------------------------------------------------
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_cmc_media'
       AND conrelid = 'public.calendar_media_comment'::regclass
  ) THEN
    DELETE FROM public.calendar_media_comment c
     WHERE NOT EXISTS (SELECT 1 FROM public.calendar_media m WHERE m.id = c.media_id);
    ALTER TABLE public.calendar_media_comment
      ADD CONSTRAINT fk_cmc_media
      FOREIGN KEY (media_id) REFERENCES public.calendar_media(id) ON DELETE CASCADE;
  END IF;
END $$;
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.calendar_media_comment DROP CONSTRAINT IF EXISTS fk_cmc_media;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-05 / DB7-002 — fall_ml domain CHECKs absent (health/GPS
--      ranges). CONFLICT RESOLVED: keep 1st/2nd tables split, apply
--      symmetric CHECKs to both. Verify zero violations via D-FALLML.
-- Basis: db/fall_ml/02_schema_fall_ml.sql:19-77, 03_schema_fall_2nd.sql:20-62.
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO fall_ml;
ALTER TABLE fall_events
  ADD CONSTRAINT ck_fe_spo2 CHECK (spo2 IS NULL OR spo2 BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_fe_hr   CHECK (heart_rate IS NULL OR heart_rate BETWEEN 0 AND 300),
  ADD CONSTRAINT ck_fe_batt CHECK (battery_pct IS NULL OR battery_pct BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_fe_lat  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  ADD CONSTRAINT ck_fe_lon  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE fall_events_2nd
  ADD CONSTRAINT ck_f2_spo2 CHECK (spo2 IS NULL OR spo2 BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_f2_hr   CHECK (heart_rate IS NULL OR heart_rate BETWEEN 0 AND 300),
  ADD CONSTRAINT ck_f2_lat  CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  ADD CONSTRAINT ck_f2_lon  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
COMMIT;
-- ROLLBACK:
--   BEGIN; SET search_path TO fall_ml;
--   ALTER TABLE fall_events     DROP CONSTRAINT IF EXISTS ck_fe_spo2, DROP CONSTRAINT IF EXISTS ck_fe_hr, DROP CONSTRAINT IF EXISTS ck_fe_batt, DROP CONSTRAINT IF EXISTS ck_fe_lat, DROP CONSTRAINT IF EXISTS ck_fe_lon;
--   ALTER TABLE fall_events_2nd DROP CONSTRAINT IF EXISTS ck_f2_spo2, DROP CONSTRAINT IF EXISTS ck_f2_hr, DROP CONSTRAINT IF EXISTS ck_f2_lat, DROP CONSTRAINT IF EXISTS ck_f2_lon;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-01 — T_SAFEGUARD.SG_ID has no UNIQUE → duplicate logins.
--      CONFLICT RESOLVED: multitenant goal favors (COMPANY_IDX, SG_ID)
--      composite. Verify zero dups via D-SGID before applying. If
--      single-tenant policy, swap for the global-unique variant below.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:118-129.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_SAFEGUARD ADD CONSTRAINT uq_safeguard_company_sgid UNIQUE (COMPANY_IDX, SG_ID);
-- Single-tenant alternative (use instead of the line above):
-- ALTER TABLE public.T_SAFEGUARD ADD CONSTRAINT uq_safeguard_sgid UNIQUE (SG_ID);
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.T_SAFEGUARD DROP CONSTRAINT IF EXISTS uq_safeguard_company_sgid;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-02 — T_COMPANY.COMPANY_BNO no UNIQUE / format CHECK.
--      Policy = digits-only 10. Verify via D-BNO before applying.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:40.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_COMPANY ADD CONSTRAINT ck_company_bno_fmt CHECK (COMPANY_BNO ~ '^[0-9]{10}$');
ALTER TABLE public.T_COMPANY ADD CONSTRAINT uq_company_bno UNIQUE (COMPANY_BNO);
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.T_COMPANY DROP CONSTRAINT IF EXISTS ck_company_bno_fmt;
--   ALTER TABLE public.T_COMPANY DROP CONSTRAINT IF EXISTS uq_company_bno;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-03 / SCHEMA-004 — VITALGUARD code columns lack domain CHECKs.
--      Allowed sets are EXAMPLES — confirm real code inventory via
--      D-CODEVALS and edit before applying.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:86,145,168,173.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_ALERT
  ADD CONSTRAINT ck_alert_type CHECK (ALERT_TYPE IN ('SOS','FALL','HR','SPO2','TEMP'));
ALTER TABLE public.T_SAFETY_EXPENSE
  ADD CONSTRAINT ck_expense_transfer CHECK (TRANSFER_STATUS IN ('PENDING','DONE','FAILED'));
ALTER TABLE public.T_SENSING
  ADD CONSTRAINT ck_sensing_type CHECK (SENSING_TYPE IN ('heart_rate','spo2','skin_temp_c','resting_heart_rate','respiratory_rate'));
ALTER TABLE public.T_SENSING
  ADD CONSTRAINT ck_sensing_val CHECK (SENSING_VAL >= 0);
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.T_ALERT          DROP CONSTRAINT IF EXISTS ck_alert_type;
--   ALTER TABLE public.T_SAFETY_EXPENSE DROP CONSTRAINT IF EXISTS ck_expense_transfer;
--   ALTER TABLE public.T_SENSING        DROP CONSTRAINT IF EXISTS ck_sensing_type, DROP CONSTRAINT IF EXISTS ck_sensing_val;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-04 / SCHEMA-012 / MAINT-02 — ts/received_at stored as TEXT.
--      CONFLICT RESOLVED into staged path. STAGE 1 (non-breaking,
--      no downtime): enforce ISO8601(+tz) format. STAGE 2 (timestamptz
--      column) is deferred and bundled with partitioning (see P2 below).
-- Basis: db/integrated/vital_samples_galaxy.sql:36,65.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE vital_samples_galaxy
  ADD CONSTRAINT ck_vsg_ts_iso
  CHECK (ts ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$');
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE vital_samples_galaxy DROP CONSTRAINT IF EXISTS ck_vsg_ts_iso;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-07 — worker contact/email/bloodtype format CHECKs.
--      Verify via D-WORKERFMT before applying.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:65,66,126.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_WORKER
  ADD CONSTRAINT ck_worker_bloodtype CHECK (WORKER_BLOODTYPE IN ('A+','A-','B+','B-','O+','O-','AB+','AB-'));
ALTER TABLE public.T_WORKER
  ADD CONSTRAINT ck_worker_phone_fmt CHECK (WORKER_PHONE ~ '^[0-9+()\- ]{7,20}$');
ALTER TABLE public.T_SAFEGUARD
  ADD CONSTRAINT ck_safeguard_email_fmt CHECK (SG_EMAIL ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$');
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE public.T_WORKER    DROP CONSTRAINT IF EXISTS ck_worker_bloodtype, DROP CONSTRAINT IF EXISTS ck_worker_phone_fmt;
--   ALTER TABLE public.T_SAFEGUARD DROP CONSTRAINT IF EXISTS ck_safeguard_email_fmt;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] DI-08 — doc_media sha256/confidence/GPS range CHECKs.
--      Verify via D-SHA before applying.
-- Basis: db/doc_media/01_schema_doc_media.sql:45,47-48,73.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE doc_media.media_asset
  ADD CONSTRAINT ck_ma_sha_hex CHECK (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE doc_media.media_ocr
  ADD CONSTRAINT ck_mo_conf CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
ALTER TABLE doc_media.media_asset
  ADD CONSTRAINT ck_ma_lat CHECK (captured_lat IS NULL OR captured_lat BETWEEN -90 AND 90),
  ADD CONSTRAINT ck_ma_lon CHECK (captured_lon IS NULL OR captured_lon BETWEEN -180 AND 180);
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE doc_media.media_asset DROP CONSTRAINT IF EXISTS ck_ma_sha_hex, DROP CONSTRAINT IF EXISTS ck_ma_lat, DROP CONSTRAINT IF EXISTS ck_ma_lon;
--   ALTER TABLE doc_media.media_ocr   DROP CONSTRAINT IF EXISTS ck_mo_conf;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PRIV-03 / OBS-002 — no access/audit logging. Minimal trigger-
--      based change-audit table (SELECT reads need pgaudit; see P2).
-- Basis: db/ pgaudit grep=0.
-- ---------------------------------------------------------------------
BEGIN;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE TABLE IF NOT EXISTS audit.access_log (
  id          BIGSERIAL PRIMARY KEY,
  db_user     TEXT NOT NULL DEFAULT current_user,
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_pk      TEXT,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
-- ROLLBACK:
--   BEGIN; DROP TABLE IF EXISTS audit.access_log; DROP SCHEMA IF EXISTS audit; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PRIV-04 / DB7-009 / SCHEMA-005 retention metadata — add
--      retain_until so a purge job can target expired sensitive rows.
-- Basis: db/integrated/vital_samples_galaxy.sql; retention grep=0.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE vital_samples_galaxy ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ;
COMMIT;
-- Purge job example (run on schedule): DELETE FROM vital_samples_galaxy WHERE retain_until < now();
-- ROLLBACK:
--   BEGIN; ALTER TABLE vital_samples_galaxy DROP COLUMN IF EXISTS retain_until; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PRIV-09 — no consent record structure for sensitive-data processing.
-- Basis: db/ consent grep=0; CLAUDE.md mandates consent + withdrawal.
-- ---------------------------------------------------------------------
BEGIN;
CREATE TABLE IF NOT EXISTS consent_record (
  id              BIGSERIAL PRIMARY KEY,
  worker_id       TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  sensitive       BOOLEAN NOT NULL DEFAULT true,
  consented_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at    TIMESTAMPTZ,
  CONSTRAINT ck_consent_purpose CHECK (length(purpose) > 0)
);
CREATE INDEX IF NOT EXISTS idx_consent_worker ON consent_record(worker_id);
COMMIT;
-- ROLLBACK: BEGIN; DROP TABLE IF EXISTS consent_record; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] MAINT-03 — autovacuum/analyze too lazy for high-volume append
--      tables; tighten thresholds (absolute-row based).
-- Basis: lib/db.ts:126-289; ALTER TABLE autovacuum_* grep=0.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE vital_samples        SET (autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 5000);
ALTER TABLE vital_samples        SET (autovacuum_vacuum_scale_factor  = 0.0, autovacuum_vacuum_threshold  = 5000);
ALTER TABLE vital_samples_galaxy SET (autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 5000);
ALTER TABLE cctv_fall_events     SET (autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 5000);
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE vital_samples        RESET (autovacuum_analyze_scale_factor, autovacuum_analyze_threshold, autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);
--   ALTER TABLE vital_samples_galaxy RESET (autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   ALTER TABLE cctv_fall_events     RESET (autovacuum_analyze_scale_factor, autovacuum_analyze_threshold);
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PRIV-05 — OCR full_text may ingest national-id/account numbers;
--      add masking-state flag (app must mask before storing).
-- Basis: db/doc_media/01_schema_doc_media.sql:64.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE doc_media.media_ocr ADD COLUMN IF NOT EXISTS pii_masked BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN doc_media.media_ocr.pii_masked IS '주민번호/계좌 등 고유식별정보 마스킹 처리 여부(앱단 마스킹 후 true).';
COMMIT;
-- ROLLBACK:
--   BEGIN; ALTER TABLE doc_media.media_ocr DROP COLUMN IF EXISTS pii_masked; COMMIT;

-- ---------------------------------------------------------------------
-- [P1] PRIV-08 — fall_ml ML dataset has no pseudonym; add column so
--      direct identifiers can be moved to an isolated mapping table.
-- Basis: db/fall_ml/02_schema_fall_ml.sql:29-31, 03_schema_fall_2nd.sql:25-27.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE fall_ml.fall_events     ADD COLUMN IF NOT EXISTS subject_pseudonym TEXT;
ALTER TABLE fall_ml.fall_events_2nd ADD COLUMN IF NOT EXISTS subject_pseudonym TEXT;
COMMENT ON COLUMN fall_ml.fall_events.subject_pseudonym     IS '가명 식별자(원본 worker_name/employee_id 대체). 매핑은 격리 보관.';
COMMENT ON COLUMN fall_ml.fall_events_2nd.subject_pseudonym IS '가명 식별자(원본 worker_name/employee_id 대체). 매핑은 격리 보관.';
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE fall_ml.fall_events     DROP COLUMN IF EXISTS subject_pseudonym;
--   ALTER TABLE fall_ml.fall_events_2nd DROP COLUMN IF EXISTS subject_pseudonym;
--   COMMIT;


-- #####################################################################
-- [P2] PRIORITY 2 — MEDIUM / LOW
-- #####################################################################

-- ---------------------------------------------------------------------
-- [P2] SEC-FN-001 — pin search_path on doc_media trigger functions.
-- Basis: db/doc_media/02_logic_integrity_sync.sql:9,21,85; 03:40.
-- ---------------------------------------------------------------------
BEGIN;
ALTER FUNCTION doc_media.fn_haversine_m(numeric,numeric,numeric,numeric) SET search_path = doc_media, pg_catalog;
ALTER FUNCTION doc_media.fn_integrity_autofill() SET search_path = doc_media, pg_catalog;
ALTER FUNCTION doc_media.fn_sync_resolve()       SET search_path = doc_media, pg_catalog;
ALTER FUNCTION doc_media.fn_transfer_verify()    SET search_path = doc_media, pg_catalog;
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER FUNCTION doc_media.fn_haversine_m(numeric,numeric,numeric,numeric) RESET search_path;
--   ALTER FUNCTION doc_media.fn_integrity_autofill() RESET search_path;
--   ALTER FUNCTION doc_media.fn_sync_resolve()       RESET search_path;
--   ALTER FUNCTION doc_media.fn_transfer_verify()    RESET search_path;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P2] SEC-PII-002 — invalidate expired presigned URLs (run on schedule).
-- Basis: db/doc_media/01_schema_doc_media.sql:133-134.
-- ---------------------------------------------------------------------
BEGIN;
UPDATE doc_media.media_cloud_sync
   SET signed_url = NULL
 WHERE signed_url IS NOT NULL
   AND signed_url_expires_at IS NOT NULL
   AND signed_url_expires_at < now();
COMMIT;
-- ROLLBACK: not reversible (URLs are regenerable on demand).

-- ---------------------------------------------------------------------
-- [P2] PERF-08 — drop redundant single-column asset_id indexes now
--      covered by PERF-07 composites. MUST run AFTER PERF-07.
-- Basis: db/doc_media/01:77,110,139; 03:36.
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO doc_media;
DROP INDEX IF EXISTS idx_mo_asset, idx_mi_asset, idx_mcs_asset, idx_mt_asset;
COMMIT;
-- ROLLBACK:
--   BEGIN; SET search_path TO doc_media;
--   CREATE INDEX IF NOT EXISTS idx_mo_asset  ON media_ocr        (asset_id);
--   CREATE INDEX IF NOT EXISTS idx_mi_asset  ON media_integrity  (asset_id);
--   CREATE INDEX IF NOT EXISTS idx_mcs_asset ON media_cloud_sync (asset_id);
--   CREATE INDEX IF NOT EXISTS idx_mt_asset  ON media_transfer   (asset_id);
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P2] PERF-09 — fall_events_2nd missing worker_id index (v_fall_all).
-- Basis: db/fall_ml/03_schema_fall_2nd.sql:63-64.
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO fall_ml;
CREATE INDEX IF NOT EXISTS idx_f2_worker ON fall_events_2nd (worker_id);
COMMIT;
-- ROLLBACK: BEGIN; SET search_path TO fall_ml; DROP INDEX IF EXISTS idx_f2_worker; COMMIT;

-- ---------------------------------------------------------------------
-- [P2] DB7-008 — risk_tag duplicate (notice_id, tag) rows; dedupe + UNIQUE.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:294-307.
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO safeprocure;
DELETE FROM risk_tag a USING risk_tag b
 WHERE a.notice_id = b.notice_id AND a.tag = b.tag AND a.tag_id > b.tag_id;
ALTER TABLE risk_tag ADD CONSTRAINT uq_risk_tag_notice_tag UNIQUE (notice_id, tag);
COMMIT;
-- ROLLBACK:
--   BEGIN; SET search_path TO safeprocure;
--   ALTER TABLE risk_tag DROP CONSTRAINT IF EXISTS uq_risk_tag_notice_tag;
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P2] SCHEMA-008 — single source of truth for construction-type codes.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:253-262;
--        db/safeprocure/01_rate_migration_2026-06-27.sql:40-42.
-- ---------------------------------------------------------------------
BEGIN;
CREATE TABLE IF NOT EXISTS safeprocure.construction_type_code (
  code VARCHAR(40) PRIMARY KEY
);
INSERT INTO safeprocure.construction_type_code(code) VALUES
  ('건축공사'),('토목공사'),('중건설공사'),('특수건설공사')
  ON CONFLICT DO NOTHING;
-- After validating data: add FK from safety_cost_rate.construction_type.
COMMIT;
-- ROLLBACK:
--   BEGIN; DROP TABLE IF EXISTS safeprocure.construction_type_code; COMMIT;

-- ---------------------------------------------------------------------
-- [P2] DI-06 — T_SAFETY_EXPENSE.QTY INTEGER -> BIGINT (matches header
--      comment). [DOWNTIME] possible table rewrite once data is large.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:171 vs :16.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_SAFETY_EXPENSE ALTER COLUMN QTY TYPE BIGINT;
COMMIT;
-- ROLLBACK (only if values within INT range):
--   BEGIN; ALTER TABLE public.T_SAFETY_EXPENSE ALTER COLUMN QTY TYPE INTEGER; COMMIT;

-- ---------------------------------------------------------------------
-- [P2] DI-09 / SCHEMA-011 — T_SAFEGUARD.SG_IDX INT -> BIGINT for PK
--      type consistency (IDENTITY preserved). [DOWNTIME] possible rewrite.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:120.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE public.T_SAFEGUARD ALTER COLUMN SG_IDX TYPE BIGINT;
COMMIT;
-- ROLLBACK (only if values within INT range):
--   BEGIN; ALTER TABLE public.T_SAFEGUARD ALTER COLUMN SG_IDX TYPE INTEGER; COMMIT;

-- ---------------------------------------------------------------------
-- [P2] DOC-001 — fall_events (public) sensitive-table/column comments.
-- Basis: db/fall_ml/01_schema.sql:11-56.
-- ---------------------------------------------------------------------
BEGIN;
COMMENT ON TABLE fall_events IS '낙상 ML 1차 원시 적재 테이블(public 스키마). 민감정보(건강·위치) 포함 — 2상에서 fall_ml.fall_events 로 격리 예정. CSV 31컬럼.';
COMMENT ON COLUMN fall_events.worker_id          IS '작업자 식별자(예: WATCH_TEST).';
COMMENT ON COLUMN fall_events.fall_decision      IS '낙상 판정 결과(2상 enum: FALL/NO_FALL/CANCELLED/PENDING).';
COMMENT ON COLUMN fall_events.accel_magnitude_g  IS '충격 가속도 peak(g) — 낙상 판정 입력.';
COMMENT ON COLUMN fall_events.motion_still_sec   IS '충격 후 정지 시간(초).';
COMMENT ON COLUMN fall_events.freefall_preceded  IS '자유낙하 선행 여부(CSV 0/1).';
COMMENT ON COLUMN fall_events.peak_rotation_rad_s IS '최대 회전 각속도(rad/s).';
COMMENT ON COLUMN fall_events.heart_rate         IS '[민감정보] 심박(bpm).';
COMMENT ON COLUMN fall_events.spo2               IS '[민감정보] 산소포화도(%).';
COMMENT ON COLUMN fall_events.latitude           IS '[민감정보] 위도(이벤트 위치).';
COMMENT ON COLUMN fall_events.longitude          IS '[민감정보] 경도(이벤트 위치).';
COMMENT ON COLUMN fall_events.ground_truth_label IS '정답 라벨(2상 enum: FALL/NO_FALL).';
COMMIT;
-- ROLLBACK: set each COMMENT ... IS NULL.

-- ---------------------------------------------------------------------
-- [P2] DOC-002 — safeprocure table/column comments.
-- Basis: db/integrated/vitalguard_safeprocure_full.sql:243-324.
-- ---------------------------------------------------------------------
BEGIN;
SET search_path TO safeprocure, public;
COMMENT ON TABLE safety_cost_rate IS '안전관리비 요율 기준표(정적 참조). 고용노동부 고시 제2025-11호 별표1 신 4공종. 기초액 단위 원.';
COMMENT ON COLUMN safety_cost_rate.construction_type IS '공종(건축/토목/중건설/특수건설공사).';
COMMENT ON COLUMN safety_cost_rate.bracket           IS '대상액 구간(under5/mid/over50).';
COMMENT ON COLUMN safety_cost_rate.rate              IS '요율(소수). 안전관리비 = 대상액*rate + base_added.';
COMMENT ON COLUMN safety_cost_rate.base_added        IS '기초액(원, mid 구간만 가산).';
COMMENT ON COLUMN notice.target_amount        IS '안전관리비 대상액(원).';
COMMENT ON COLUMN notice.declared_safety_cost IS '공고/계약 명시 안전관리비(원).';
COMMENT ON COLUMN notice.win_rate             IS '낙찰률(%).';
COMMENT ON COLUMN notice.source               IS '데이터 출처(live/mock).';
COMMENT ON COLUMN safety_cost_check.required_cost IS '산정 기준 안전관리비(원).';
COMMENT ON COLUMN safety_cost_check.verdict       IS '판정(정상/과소계상_의심/검토필요).';
COMMENT ON COLUMN risk_tag.severity   IS '위험도(1경미 2중간 3높음).';
COMMENT ON COLUMN risk_profile.score  IS '종합 위험도(0~100).';
SET search_path TO public;
COMMIT;
-- ROLLBACK: set each COMMENT ... IS NULL.

-- ---------------------------------------------------------------------
-- [P2] DOC-003 — vital_samples_galaxy column + view comments.
-- Basis: db/integrated/vital_samples_galaxy.sql.
-- ---------------------------------------------------------------------
BEGIN;
COMMENT ON COLUMN vital_samples_galaxy.worker_id          IS '작업자 식별자.';
COMMENT ON COLUMN vital_samples_galaxy.ts                 IS '측정/수집 시각(ISO8601 문자열 — vital_samples 표기와 동일).';
COMMENT ON COLUMN vital_samples_galaxy.heart_rate         IS '심박(bpm) — HeartRateRecord.';
COMMENT ON COLUMN vital_samples_galaxy.resting_heart_rate IS '안정 시 심박(bpm) — RestingHeartRateRecord.';
COMMENT ON COLUMN vital_samples_galaxy.respiratory_rate   IS '호흡수(breaths/min) — RespiratoryRateRecord.';
COMMENT ON COLUMN vital_samples_galaxy.body_temp_location IS '체온 측정 위치 — BodyTemperatureRecord.measurementLocation.';
COMMENT ON COLUMN vital_samples_galaxy.steps              IS '걸음 수(count) — StepsRecord interval 합.';
COMMENT ON COLUMN vital_samples_galaxy.active_energy_kcal IS '활동 소모 칼로리(kcal) — ActiveCaloriesBurnedRecord.';
COMMENT ON COLUMN vital_samples_galaxy.total_energy_kcal  IS '총 소모 칼로리(kcal) — TotalCaloriesBurnedRecord.';
COMMENT ON COLUMN vital_samples_galaxy.vo2_max            IS '최대 산소 섭취량(mL/kg/min) — Vo2MaxRecord(선택).';
COMMENT ON COLUMN vital_samples_galaxy.manual_sos         IS '앱 SOS 버튼(Health Connect 아님 — 앱 레벨). 0/1.';
COMMENT ON COLUMN vital_samples_galaxy.received_at        IS '서버 수신 시각.';
COMMENT ON COLUMN vital_samples_galaxy.raw_json           IS '원본 Health Connect 레코드(재처리/디버그).';
COMMENT ON VIEW v_vital_samples_all IS 'Apple(vital_samples)+Galaxy(vital_samples_galaxy) 통합 조회 뷰. platform 컬럼으로 구분, 비대응 지표는 NULL 매핑.';
COMMIT;
-- ROLLBACK: set each COMMENT ... IS NULL.

-- ---------------------------------------------------------------------
-- [P2] DOC-004 — schema-level comments for isolated schemas.
-- Basis: CREATE SCHEMA safeprocure/doc_media/fall_ml; COMMENT ON SCHEMA grep=1 (imu only).
-- ---------------------------------------------------------------------
BEGIN;
COMMENT ON SCHEMA safeprocure IS '조달 안전관리비 위험검증 도메인(나라장터 공고→과소계상 검증→종합 위험도). public(VITALGUARD)과 FK 없이 격리.';
COMMENT ON SCHEMA doc_media   IS '공사문서 OCR+사진 메타데이터 무결성+클라우드 동기화 도메인. 메인·낙상과 FK 격리.';
COMMENT ON SCHEMA fall_ml     IS '낙상 ML 데이터셋(민감 건강정보) 격리 보관 — 운영 public 과 분리.';
COMMIT;
-- ROLLBACK: set each COMMENT ON SCHEMA ... IS NULL.

-- ---------------------------------------------------------------------
-- [P2] DOC-005 — fall_ml sensitive column comments (note label-system
--      divergence between 1st and 2nd tables).
-- Basis: db/fall_ml/02_schema_fall_ml.sql, 03_schema_fall_2nd.sql.
-- ---------------------------------------------------------------------
BEGIN;
COMMENT ON COLUMN fall_ml.fall_events.heart_rate  IS '[민감정보] 심박(bpm).';
COMMENT ON COLUMN fall_ml.fall_events.spo2        IS '[민감정보] 산소포화도(%).';
COMMENT ON COLUMN fall_ml.fall_events.latitude    IS '[민감정보] 위도.';
COMMENT ON COLUMN fall_ml.fall_events.longitude   IS '[민감정보] 경도.';
COMMENT ON COLUMN fall_ml.fall_events.ground_truth_label IS '정답 라벨(2상 enum: FALL/NO_FALL). 2차 테이블과 값 체계 다름.';
COMMENT ON COLUMN fall_ml.fall_events_2nd.heart_rate IS '[민감정보] 심박(bpm).';
COMMENT ON COLUMN fall_ml.fall_events_2nd.spo2       IS '[민감정보] 산소포화도(%).';
COMMENT ON COLUMN fall_ml.fall_events_2nd.latitude   IS '[민감정보] 위도.';
COMMENT ON COLUMN fall_ml.fall_events_2nd.longitude  IS '[민감정보] 경도.';
COMMENT ON COLUMN fall_ml.fall_events_2nd.ground_truth_label IS '정답 라벨(CHECK: true_fall/false_positive). 1차(FALL/NO_FALL)와 값 체계 다름 — v_fall_all 통합 시 주의.';
COMMIT;
-- ROLLBACK: set each COMMENT ... IS NULL.

-- ---------------------------------------------------------------------
-- [P2][DOWNTIME] OBS-001 — pg_stat_statements. CREATE EXTENSION alone
--      does NOT collect; requires shared_preload_libraries +
--      SERVER RESTART. Run this AFTER editing postgresql.conf:
--        shared_preload_libraries = 'pg_stat_statements'
-- ---------------------------------------------------------------------
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
COMMIT;
-- ROLLBACK: BEGIN; DROP EXTENSION IF EXISTS pg_stat_statements; COMMIT;

-- ---------------------------------------------------------------------
-- [P2][DOWNTIME] OBS-002 — pgaudit. Same caveat: needs
--      shared_preload_libraries='pgaudit' + RESTART, then
--      pgaudit.log policy. Scope to sensitive schemas to limit volume.
-- ---------------------------------------------------------------------
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgaudit;
COMMIT;
-- ROLLBACK: BEGIN; DROP EXTENSION IF EXISTS pgaudit; COMMIT;

-- ---------------------------------------------------------------------
-- [P2] SCHEMA-002 — fall_ml hr_delta_* derived columns -> GENERATED
--      STORED (DB-enforced). [DOWNTIME] drops+recreates columns; safe
--      on 1-phase small data only. Verify via D-FALLDELTA first.
-- Basis: db/fall_ml/02_schema_fall_ml.sql:52-53.
-- ---------------------------------------------------------------------
BEGIN;
ALTER TABLE fall_ml.fall_events DROP COLUMN hr_delta_mean;
ALTER TABLE fall_ml.fall_events DROP COLUMN hr_delta_peak;
ALTER TABLE fall_ml.fall_events
  ADD COLUMN hr_delta_mean NUMERIC(5,1) GENERATED ALWAYS AS (hr_post_mean_30s - hr_pre_mean_10s) STORED,
  ADD COLUMN hr_delta_peak NUMERIC(5,1) GENERATED ALWAYS AS (hr_post_peak_30s - hr_pre_mean_10s) STORED;
COMMIT;
-- ROLLBACK:
--   BEGIN;
--   ALTER TABLE fall_ml.fall_events DROP COLUMN hr_delta_mean;
--   ALTER TABLE fall_ml.fall_events DROP COLUMN hr_delta_peak;
--   ALTER TABLE fall_ml.fall_events ADD COLUMN hr_delta_mean NUMERIC(5,1);
--   ALTER TABLE fall_ml.fall_events ADD COLUMN hr_delta_peak NUMERIC(5,1);
--   COMMIT;

-- ---------------------------------------------------------------------
-- [P2] MAINT-01 / DB7-004 — retention purge for vital_samples (ts is
--      TEXT ISO8601; string comparison). IRREVERSIBLE — backup first.
--      Confirm cast-safety via D-TSCAST. Retention period (90d here)
--      must be reconciled with KOSHA 산업재해 자료 보존 의무 before use.
--      VACUUM must run OUTSIDE this transaction (see note).
-- Basis: lib/db.ts:126-171.
-- ---------------------------------------------------------------------
BEGIN;
DELETE FROM vital_samples
 WHERE ts < to_char(now() - interval '90 days', 'YYYY-MM-DD"T"HH24:MI:SS');
COMMIT;
-- After COMMIT, run separately (cannot be inside a transaction):
--   VACUUM (ANALYZE, VERBOSE) vital_samples;
-- ROLLBACK: none — restore from pre-audit pg_dump.


-- #####################################################################
-- DIAGNOSTIC (read-only) — LIVE-DB-ONLY checks. Run these against the
-- live database. Several are PRECONDITIONS for ADD CONSTRAINT fixes
-- above (must return zero violations before applying). None modify data.
-- #####################################################################

-- ===== Preconditions for constraint fixes =====

-- [D-PWD] (gate for SEC-PWD-001) plaintext/weak-hash admin passwords.
SELECT count(*) AS total,
       count(*) FILTER (WHERE SG_PWD !~ '^(scrypt\$|\$argon2|\$2[aby]\$)') AS not_hashed
FROM public.T_SAFEGUARD;

-- [D-SGID] (gate for DI-01) duplicate (company, login id).
SELECT COMPANY_IDX, SG_ID, COUNT(*) AS dup_cnt
FROM public.T_SAFEGUARD GROUP BY COMPANY_IDX, SG_ID HAVING COUNT(*) > 1 ORDER BY dup_cnt DESC;

-- [D-BNO] (gate for DI-02) duplicate / malformed business numbers.
SELECT COMPANY_BNO, COUNT(*) FROM public.T_COMPANY GROUP BY COMPANY_BNO HAVING COUNT(*) > 1;
SELECT COMPANY_IDX, COMPANY_BNO FROM public.T_COMPANY WHERE COMPANY_BNO !~ '^[0-9]{10}$';

-- [D-CODEVALS] (gate for DI-03) actual code-column value inventory.
SELECT 'ALERT_TYPE' col, ALERT_TYPE val, COUNT(*) FROM T_ALERT GROUP BY ALERT_TYPE
UNION ALL SELECT 'SENSING_TYPE', SENSING_TYPE, COUNT(*) FROM T_SENSING GROUP BY SENSING_TYPE
UNION ALL SELECT 'TRANSFER_STATUS', TRANSFER_STATUS, COUNT(*) FROM T_SAFETY_EXPENSE GROUP BY TRANSFER_STATUS
UNION ALL SELECT 'CATEGORY', CATEGORY, COUNT(*) FROM T_SAFETY_EXPENSE GROUP BY CATEGORY
ORDER BY 1, 3 DESC;

-- [D-WORKERFMT] (gate for DI-07) bloodtype/phone/email format violations.
SELECT WORKER_IDX FROM public.T_WORKER
 WHERE WORKER_BLOODTYPE NOT IN ('A+','A-','B+','B-','O+','O-','AB+','AB-')
    OR WORKER_PHONE !~ '^[0-9+()\- ]{7,20}$';

-- [D-SHA] (gate for DI-08) non-hex sha256.
SELECT asset_id, file_sha256 FROM doc_media.media_asset
 WHERE file_sha256 IS NOT NULL AND file_sha256 !~ '^[0-9a-f]{64}$';

-- [D-FALLML] (gate for DI-05/DB7-002) out-of-range fall_ml vitals/GPS.
SELECT count(*) FILTER (WHERE spo2 < 0 OR spo2 > 100) AS bad_spo2,
       count(*) FILTER (WHERE heart_rate < 0 OR heart_rate > 300) AS bad_hr,
       count(*) FILTER (WHERE latitude < -90 OR latitude > 90 OR longitude < -180 OR longitude > 180) AS bad_gps
FROM fall_ml.fall_events;

-- [D-FALLDELTA] (gate for SCHEMA-002) derived hr_delta mismatch.
SELECT count(*) AS mismatched_delta FROM fall_ml.fall_events
 WHERE hr_delta_mean IS DISTINCT FROM (hr_post_mean_30s - hr_pre_mean_10s)
    OR hr_delta_peak IS DISTINCT FROM (hr_post_peak_30s - hr_pre_mean_10s);

-- [D-TSCAST] (gate for MAINT-01 retention / ts normalization) uncastable ts.
SELECT count(*) AS uncastable_ts FROM vital_samples
 WHERE ts IS NOT NULL AND ts !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}';

-- ===== Security posture (no static proof possible) =====

-- RLS enabled/forced + policy counts per table.
SELECT n.nspname schema, c.relname tbl, c.relrowsecurity rls_enabled, c.relforcerowsecurity rls_forced,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect') ORDER BY 1,2;

-- PUBLIC schema CREATE/USAGE privileges (least-privilege check).
SELECT nspname schema, has_schema_privilege('public', nspname, 'CREATE') public_can_create,
       has_schema_privilege('public', nspname, 'USAGE') public_can_use
FROM pg_namespace WHERE nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect') ORDER BY 1;

-- Per-table grants (who has what).
SELECT table_schema, table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) privs
FROM information_schema.role_table_grants
WHERE table_schema IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
GROUP BY 1,2,3 ORDER BY 1,2,3;

-- SECURITY DEFINER functions + search_path settings.
SELECT n.nspname schema, p.proname function, p.prosecdef security_definer, p.proconfig settings
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','doc_media','safeprocure','fall_ml','imu_collect') ORDER BY p.prosecdef DESC, 1, 2;

-- Superuser / role attributes / bypassrls.
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls, rolvaliduntil
FROM pg_authid ORDER BY rolsuper DESC, rolname;

-- SSL on current session + server enforcement.
SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();
SHOW ssl;

-- pg_hba auth methods (trust/password detection).
SELECT type, database, user_name, address, auth_method FROM pg_hba_file_rules
WHERE auth_method NOT IN ('scram-sha-256','cert','reject') ORDER BY line_number;

-- Crypto/audit extensions installed.
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgcrypto','pgaudit','pg_stat_statements','pg_cron','pgstattuple') ORDER BY extname;

-- pgaudit / connection logging config.
SELECT name, setting FROM pg_settings
WHERE name IN ('shared_preload_libraries','pgaudit.log','log_statement','log_connections','log_destination');

-- ===== Performance / maintenance (runtime stats) =====

-- Index usage (find unused/redundant indexes; validates PERF-08).
SELECT schemaname, relname tbl, indexrelname idx, idx_scan, idx_tup_read, idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) index_size
FROM pg_stat_user_indexes ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;

-- Seq-scan vs index-scan ratios + size (validates PERF-01/02 impact).
SELECT schemaname, relname tbl, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
       n_live_tup, n_dead_tup, pg_size_pretty(pg_total_relation_size(relid)) total_size
FROM pg_stat_user_tables ORDER BY seq_tup_read DESC NULLS LAST;

-- FK child columns lacking a leading index (validates PERF-01/DB7-003).
SELECT c.conname, c.conrelid::regclass child_table, a.attname fk_column,
       EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND a.attnum=ANY(i.indkey) AND i.indkey[0]=a.attnum) has_leading_index
FROM pg_constraint c
JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
WHERE c.contype='f' ORDER BY child_table, c.conname;

-- Top cost queries (pg_stat_statements; validates PERF-04/05/06).
SELECT query, calls, total_exec_time, mean_exec_time, rows,
       100.0*shared_blks_hit/NULLIF(shared_blks_hit+shared_blks_read,0) hit_pct
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 30;

-- Bloat / last (auto)vacuum-analyze freshness.
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       round(100.0*n_dead_tup/NULLIF(n_live_tup+n_dead_tup,0),1) dead_pct,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC NULLS LAST;

-- Table/index sizes + est rows (partitioning/retention decisions).
SELECT n.nspname schema, c.relname tbl, c.reltuples::bigint est_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) total_size,
       pg_size_pretty(pg_indexes_size(c.oid)) indexes_size
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
ORDER BY pg_total_relation_size(c.oid) DESC;

-- Transaction-ID wraparound risk.
SELECT n.nspname schema, c.relname tbl, age(c.relfrozenxid) xid_age,
       pg_size_pretty(pg_total_relation_size(c.oid)) size
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
ORDER BY age(c.relfrozenxid) DESC LIMIT 20;

-- Connection pool / idle session health (validates APP-02).
SELECT state, count(*) sessions, max(now() - state_change) longest_in_state, max(now() - query_start) longest_query
FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY sessions DESC;

-- ===== Backup / recovery (BR-*) =====

-- WAL archiving status (PITR readiness).
SELECT archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal, last_failed_time, stats_reset FROM pg_stat_archiver;

-- Archive/WAL settings.
SELECT name, setting FROM pg_settings WHERE name IN ('archive_mode','archive_command','wal_level','archive_timeout','wal_keep_size','max_wal_size');

-- Replication / standbys.
SELECT client_addr, state, sync_state, write_lag, flush_lag, replay_lag,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) replay_bytes FROM pg_stat_replication;

-- Last checkpoint (PITR base reference).
SELECT (pg_control_checkpoint()).checkpoint_time last_checkpoint_time, (pg_control_checkpoint()).redo_lsn redo_lsn;

-- Data/log directory paths (backup targets).
SELECT name, setting FROM pg_settings WHERE name IN ('data_directory','log_directory','log_destination','hba_file','config_file');

-- ===== Config baseline (DB7 tuning) =====
SHOW shared_buffers; SHOW effective_cache_size; SHOW work_mem; SHOW maintenance_work_mem; SHOW max_connections;
SHOW autovacuum; SHOW autovacuum_vacuum_scale_factor; SHOW autovacuum_analyze_scale_factor;
SHOW log_min_duration_statement; SHOW statement_timeout; SHOW lock_timeout; SHOW idle_in_transaction_session_timeout;
SHOW password_encryption;

-- ===== Live verification of app-integration fixes =====

-- calendar_media_comment FK present + orphan count (validates DB7-005/APP-03).
SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='fk_cmc_media' AND conrelid='public.calendar_media_comment'::regclass) fk_exists;
SELECT count(*) orphan_comments FROM public.calendar_media_comment c
 WHERE NOT EXISTS (SELECT 1 FROM public.calendar_media m WHERE m.id=c.media_id);

-- DB rate table vs app TS constant drift (validates APP-04).
SELECT construction_type, bracket, rate, base_added FROM safeprocure.safety_cost_rate ORDER BY construction_type, bracket;

-- COMMENT coverage (validates DOC-* after apply).
SELECT n.nspname schema, c.relname tbl, count(*) FILTER (WHERE col_description(c.oid,a.attnum) IS NULL) missing, count(*) total
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE c.relkind='r' AND n.nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
GROUP BY 1,2 HAVING count(*) FILTER (WHERE col_description(c.oid,a.attnum) IS NULL)>0 ORDER BY missing DESC;