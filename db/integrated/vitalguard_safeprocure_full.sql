-- =====================================================================
--  VITALGUARD(완성본) + SafeProcure  통합 풀스키마  (PostgreSQL 14+)
-- ---------------------------------------------------------------------
--  두 도메인을 하나의 PostgreSQL DB에 공존시키는 단일 설치 스크립트.
--    ① VITALGUARD  — 작업자 생체·안전 모니터링  → 스키마 public
--       (aquerytool 모델링 "완성본" 7테이블 원본 DDL, 관계순 정렬·한 번에 실행 가능)
--    ② SafeProcure — 조달 안전관리비 위험검증     → 스키마 safeprocure (격리)
--
--  · 두 도메인 간 FK 없음(독립). 테이블명 충돌 0 (캠퍼스 PG 라이브 검증 완료).
--  · public ∩ safeprocure 동명 테이블 0. 별도 schema 격리로 이중 안전.
--  · 신규(빈) DB 설치 기준. 기존 테이블이 있으면 CREATE 단계에서 안전하게 실패
--    (전체가 단일 트랜잭션 → 부분 적용/데이터 손상 없음).
--
--  ⚠ 본 파일의 ① 파트 = aquerytool "완성본" + 운영안전 DDL 교정 적용:
--     · FK 컬럼 6개 BIGINT (self-증가 BIGSERIAL 제거 — 참조 무결성 보호)
--     · AMOUNT/QTY BIGINT + CHECK(≥0) · T_ALERT.RECEIVED_AT nullable + 수신 일관성 CHECK · IS_RECEIVED CHECK
--     → 빈 DB뿐 아니라 실 데이터 적재에도 안전. (PK는 BIGSERIAL 유지)
--     배포본(V2, safetymonitor backend/db/schema.sql)은 추가로 T_DEVICE·애플워치 v2·5초집계(T_SENSING_SUMMARY_5S 등) 보유.
--  ⚠ SafeProcure 5테이블 단독본은 db/schema.sql. 요율값은 현행 공개자료(고시 제2025-11호
--     시행 2025.2.12 / 제2024-53호 기준)와 15/15 일치 확인(2026-06-23) — 공식 별표1 첨부 최종 대조 권장.
--
--  실행:  psql "$DSN" -v ON_ERROR_STOP=1 -f db/integrated/vitalguard_safeprocure_full.sql
-- =====================================================================
BEGIN;

-- =====================================================================
--  ① VITALGUARD — 작업자 생체·안전 모니터링  (public)
--  출처: aquerytool 모델링 완성본. 테이블 순서는 관계를 고려해 한 번에 실행해도
--        에러가 없도록 정렬됨(FK는 테이블 생성 뒤 ALTER 로 부여).
-- =====================================================================
SET search_path TO public;

-- T_COMPANY ─ 회사정보
CREATE TABLE T_COMPANY
(
    COMPANY_IDX      BIGSERIAL       NOT NULL,
    COMPANY_NAME     VARCHAR(100)    NOT NULL,
    COMPANY_ADDR     VARCHAR(255)    NOT NULL,
    COMPANY_OWNER    VARCHAR(50)     NOT NULL,
    COMPANY_BNO      VARCHAR(12)     NOT NULL,
    COMPANY_URL      VARCHAR(255)    NOT NULL,
    STARTED_AT       DATE            NOT NULL,
    CHIEF_ITEM       VARCHAR(255)    NOT NULL,
    CREATED_AT       TIMESTAMPTZ     NOT NULL,
     PRIMARY KEY (COMPANY_IDX)
);
COMMENT ON TABLE  T_COMPANY               IS '회사정보';
COMMENT ON COLUMN T_COMPANY.COMPANY_IDX   IS '회사 식별자';
COMMENT ON COLUMN T_COMPANY.COMPANY_NAME  IS '회사 명';
COMMENT ON COLUMN T_COMPANY.COMPANY_ADDR  IS '회사 주소';
COMMENT ON COLUMN T_COMPANY.COMPANY_OWNER IS '회사 대표자';
COMMENT ON COLUMN T_COMPANY.COMPANY_BNO   IS '회사 사업자번호';
COMMENT ON COLUMN T_COMPANY.COMPANY_URL   IS '회사 홈페이지';
COMMENT ON COLUMN T_COMPANY.STARTED_AT    IS '사업 개시일';
COMMENT ON COLUMN T_COMPANY.CHIEF_ITEM    IS '주요 품목';
COMMENT ON COLUMN T_COMPANY.CREATED_AT    IS '등록 일자';

-- T_WORKER ─ 작업자
CREATE TABLE T_WORKER
(
    WORKER_IDX          BIGSERIAL      NOT NULL,
    COMPANY_IDX         BIGINT         NOT NULL,
    DEPT                VARCHAR(50)    NOT NULL,
    WORKER_NAME         VARCHAR(50)    NOT NULL,
    WORKER_PHONE        VARCHAR(20)    NOT NULL,
    WORKER_BLOODTYPE    VARCHAR(5)     NOT NULL,
    CHARGE              VARCHAR(50)    NOT NULL,
    CREATED_AT          TIMESTAMPTZ    NOT NULL,
     PRIMARY KEY (WORKER_IDX)
);
COMMENT ON TABLE  T_WORKER                  IS '작업자';
COMMENT ON COLUMN T_WORKER.WORKER_IDX       IS '작업자 식별자';
COMMENT ON COLUMN T_WORKER.COMPANY_IDX      IS '회사 식별자';
COMMENT ON COLUMN T_WORKER.DEPT             IS '부서 명';
COMMENT ON COLUMN T_WORKER.WORKER_NAME      IS '작업자 성명';
COMMENT ON COLUMN T_WORKER.WORKER_PHONE     IS '작업자 연락처';
COMMENT ON COLUMN T_WORKER.WORKER_BLOODTYPE IS '작업자 혈액형';
COMMENT ON COLUMN T_WORKER.CHARGE           IS '담당 업무';
COMMENT ON COLUMN T_WORKER.CREATED_AT       IS '등록 일자';

-- T_SENSING ─ 생체 신호 정보
CREATE TABLE T_SENSING
(
    SENSING_IDX     BIGSERIAL         NOT NULL,
    WORKER_IDX      BIGINT            NOT NULL,
    SENSING_TYPE    VARCHAR(50)       NOT NULL,
    SENSING_VAL     NUMERIC(12, 1)    NOT NULL,
    LOCC            POINT             NOT NULL,
    CREATED_AT      TIMESTAMPTZ       NOT NULL,
     PRIMARY KEY (SENSING_IDX)
);
COMMENT ON TABLE  T_SENSING              IS '생체 신호 정보';
COMMENT ON COLUMN T_SENSING.SENSING_IDX  IS '센싱 식별자';
COMMENT ON COLUMN T_SENSING.WORKER_IDX   IS '작업자 식별자';
COMMENT ON COLUMN T_SENSING.SENSING_TYPE IS '센서 구분';
COMMENT ON COLUMN T_SENSING.SENSING_VAL  IS '센서 값';
COMMENT ON COLUMN T_SENSING.LOCC         IS '위도/경도';
COMMENT ON COLUMN T_SENSING.CREATED_AT   IS '등록 일자';

-- T_SITE ─ 현장 정보
CREATE TABLE T_SITE
(
    SITE_IDX        BIGSERIAL       NOT NULL,
    COMPANY_IDX     BIGINT          NOT NULL,
    PROJECT_NAME    VARCHAR(255)    NOT NULL,
    PROJECT_LOC     VARCHAR(255)    NOT NULL,
    CREATED_AT      TIMESTAMPTZ     NOT NULL,
     PRIMARY KEY (SITE_IDX)
);
COMMENT ON TABLE  T_SITE              IS '현장 정보';
COMMENT ON COLUMN T_SITE.SITE_IDX     IS '현장 식별자';
COMMENT ON COLUMN T_SITE.COMPANY_IDX  IS '회사 식별자';
COMMENT ON COLUMN T_SITE.PROJECT_NAME IS '공사 명';
COMMENT ON COLUMN T_SITE.PROJECT_LOC  IS '현장 소재지';
COMMENT ON COLUMN T_SITE.CREATED_AT   IS '등록 일자';

-- T_SAFEGUARD ─ 안전 관리자
CREATE TABLE T_SAFEGUARD
(
    SG_IDX         INT             GENERATED BY DEFAULT AS IDENTITY NOT NULL,
    COMPANY_IDX    BIGINT          NOT NULL,
    SG_ID          VARCHAR(50)     NOT NULL,
    SG_PWD         VARCHAR(255)    NOT NULL,
    DEPT           VARCHAR(50)     NOT NULL,
    SG_PHONE       VARCHAR(20)     NOT NULL,
    SG_EMAIL       VARCHAR(50)     NOT NULL,
    CREATED_AT     TIMESTAMPTZ     NOT NULL,
     PRIMARY KEY (SG_IDX)
);
COMMENT ON TABLE  T_SAFEGUARD             IS '안전 관리자';
COMMENT ON COLUMN T_SAFEGUARD.SG_IDX      IS '관리자 식별자';
COMMENT ON COLUMN T_SAFEGUARD.COMPANY_IDX IS '회사 식별자';
COMMENT ON COLUMN T_SAFEGUARD.SG_ID       IS '관리자 아이디';
COMMENT ON COLUMN T_SAFEGUARD.SG_PWD      IS '관리자 비밀번호';
COMMENT ON COLUMN T_SAFEGUARD.DEPT        IS '부서 명';
COMMENT ON COLUMN T_SAFEGUARD.SG_PHONE    IS '관리자 연락처';
COMMENT ON COLUMN T_SAFEGUARD.SG_EMAIL    IS '관리자 이메일';
COMMENT ON COLUMN T_SAFEGUARD.CREATED_AT  IS '등록 일자';

-- T_ALERT ─ 알림
CREATE TABLE T_ALERT
(
    ALERT_IDX      BIGSERIAL      NOT NULL,
    SENSING_IDX    BIGINT         NOT NULL,
    ALERT_TYPE     VARCHAR(20)    NOT NULL,
    ALERT_MSG      TEXT           NOT NULL,
    ALERTED_AT     TIMESTAMPTZ    NOT NULL,
    IS_RECEIVED    CHAR(1)        NOT NULL,
    RECEIVED_AT    TIMESTAMPTZ,             -- nullable(미수신 시 NULL)
     CONSTRAINT ck_alert_received  CHECK (IS_RECEIVED IN ('Y','N')),
     CONSTRAINT ck_alert_recv_time CHECK (IS_RECEIVED = 'N' OR RECEIVED_AT IS NOT NULL),
     PRIMARY KEY (ALERT_IDX)
);
COMMENT ON TABLE  T_ALERT             IS '알림';
COMMENT ON COLUMN T_ALERT.ALERT_IDX   IS '알림 식별자';
COMMENT ON COLUMN T_ALERT.SENSING_IDX IS '센싱 식별자';
COMMENT ON COLUMN T_ALERT.ALERT_TYPE  IS '알림 구분';
COMMENT ON COLUMN T_ALERT.ALERT_MSG   IS '알림 메시지';
COMMENT ON COLUMN T_ALERT.ALERTED_AT  IS '알림 시간';
COMMENT ON COLUMN T_ALERT.IS_RECEIVED IS '수신 여부';
COMMENT ON COLUMN T_ALERT.RECEIVED_AT IS '수신 시간';

-- T_SAFETY_EXPENSE ─ 안전관리비 사용내역
CREATE TABLE T_SAFETY_EXPENSE
(
    EXPENSE_IDX        BIGSERIAL       NOT NULL,
    SITE_IDX           BIGINT          NOT NULL,
    CATEGORY           VARCHAR(50)     NOT NULL,
    ITEM_NAME          VARCHAR(100)    NOT NULL,
    INVOICE_NO         VARCHAR(50)     NOT NULL,
    QTY                INTEGER         NOT NULL,
    AMOUNT             BIGINT          NOT NULL,
    TRANSFER_STATUS    VARCHAR(20)     NOT NULL,
    CREATED_AT         TIMESTAMPTZ     NOT NULL,
     CONSTRAINT ck_expense_qty    CHECK (QTY >= 0),
     CONSTRAINT ck_expense_amount CHECK (AMOUNT >= 0),
     PRIMARY KEY (EXPENSE_IDX)
);
COMMENT ON TABLE  T_SAFETY_EXPENSE                 IS '안전관리비 사용내역';
COMMENT ON COLUMN T_SAFETY_EXPENSE.EXPENSE_IDX     IS '지출 식별자';
COMMENT ON COLUMN T_SAFETY_EXPENSE.SITE_IDX        IS '현장 식별자';
COMMENT ON COLUMN T_SAFETY_EXPENSE.CATEGORY        IS '항목 분류';
COMMENT ON COLUMN T_SAFETY_EXPENSE.ITEM_NAME       IS '품목 명';
COMMENT ON COLUMN T_SAFETY_EXPENSE.INVOICE_NO      IS '세금계산서 번호';
COMMENT ON COLUMN T_SAFETY_EXPENSE.QTY             IS '수량';
COMMENT ON COLUMN T_SAFETY_EXPENSE.AMOUNT          IS '금액';
COMMENT ON COLUMN T_SAFETY_EXPENSE.TRANSFER_STATUS IS '이체 상태';
COMMENT ON COLUMN T_SAFETY_EXPENSE.CREATED_AT      IS '등록 일자';

-- ── VITALGUARD Foreign Keys (ON DELETE/UPDATE RESTRICT) ──────────────
ALTER TABLE T_WORKER
    ADD CONSTRAINT FK_T_WORKER_COMPANY_IDX_T_COMPANY_COMPANY_IDX FOREIGN KEY (COMPANY_IDX)
        REFERENCES T_COMPANY (COMPANY_IDX) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE T_SENSING
    ADD CONSTRAINT FK_T_SENSING_WORKER_IDX_T_WORKER_WORKER_IDX FOREIGN KEY (WORKER_IDX)
        REFERENCES T_WORKER (WORKER_IDX) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE T_SITE
    ADD CONSTRAINT FK_T_SITE_COMPANY_IDX_T_COMPANY_COMPANY_IDX FOREIGN KEY (COMPANY_IDX)
        REFERENCES T_COMPANY (COMPANY_IDX) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE T_SAFEGUARD
    ADD CONSTRAINT FK_T_SAFEGUARD_COMPANY_IDX_T_COMPANY_COMPANY_IDX FOREIGN KEY (COMPANY_IDX)
        REFERENCES T_COMPANY (COMPANY_IDX) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE T_ALERT
    ADD CONSTRAINT FK_T_ALERT_SENSING_IDX_T_SENSING_SENSING_IDX FOREIGN KEY (SENSING_IDX)
        REFERENCES T_SENSING (SENSING_IDX) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE T_SAFETY_EXPENSE
    ADD CONSTRAINT FK_T_SAFETY_EXPENSE_SITE_IDX_T_SITE_SITE_IDX FOREIGN KEY (SITE_IDX)
        REFERENCES T_SITE (SITE_IDX) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- =====================================================================
--  ② SafeProcure — 조달 안전관리비 위험검증  (safeprocure 스키마로 격리)
--  나라장터(G2B) 공사 공고 → 안전관리비 과소계상 검증 + 위험작업 태깅 → 종합 위험도(0~100)
--  ①과 FK 없이 독립. 코드성 컬럼 = CHECK 제약.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS safeprocure;
SET search_path TO safeprocure, public;

DROP TABLE IF EXISTS risk_profile, risk_tag, safety_cost_check,
                     safety_cost_rate, notice CASCADE;

-- ── 공고/계약 (G2B 나라장터) — 자연키(조달청 공고번호) PK ──────────────
CREATE TABLE notice (
  notice_id            VARCHAR(50)   PRIMARY KEY,                 -- 조달청 공고번호(bidNtceNo)
  title                VARCHAR(500)  NOT NULL,                    -- 공고명/공사명
  kind                 VARCHAR(20)   NOT NULL DEFAULT '공사',     -- 공사/용역/물품
  agency               VARCHAR(200)  NOT NULL,                    -- 수요기관(발주처)
  region               VARCHAR(100),                              -- 지역
  estimated_price      BIGINT,                                    -- 추정가격(원)
  start_date           DATE,                                      -- 공시일/착공예정
  end_date             DATE,                                      -- 마감일/준공예정
  licenses             TEXT[]        NOT NULL DEFAULT '{}',       -- 필요 면허/공종
  task_text            TEXT,                                      -- 공고 과업 전문(태깅 근거)
  contract_amount      BIGINT,                                    -- 계약금액(원)
  win_rate             NUMERIC(5,2),                              -- 낙찰률(%)
  target_amount        BIGINT,                                    -- 안전관리비 대상액(원)
  declared_safety_cost BIGINT,                                    -- 공고/계약 명시 안전관리비(원)
  source               VARCHAR(10)   NOT NULL DEFAULT 'mock',     -- live/mock
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  cached_until         TIMESTAMPTZ,                               -- 캐시 만료(30분 TTL)
  CONSTRAINT ck_notice_kind   CHECK (kind   IN ('공사','용역','물품')),
  CONSTRAINT ck_notice_source CHECK (source IN ('live','mock'))
);
COMMENT ON TABLE notice IS 'G2B 나라장터 공사 공고/계약';
CREATE INDEX idx_notice_region  ON notice(region);
CREATE INDEX idx_notice_kind    ON notice(kind);
CREATE INDEX idx_notice_created ON notice(created_at DESC);

-- ── 안전관리비 요율 기준표 (정적 참조) ───────────────────────────────
-- ⚠ 요율 출처: 고용노동부 고시 별표1. 현행 공개자료(고시 제2025-11호 시행 2025.2.12)와 15/15 일치 확인(2026-06-23) — 공식 별표1 HWP 최종 대조 권장.
--   엔진 로직은 수치와 독립 — 값만 갱신하면 됨.
CREATE TABLE safety_cost_rate (
  construction_type VARCHAR(40)   NOT NULL,
  bracket           VARCHAR(10)   NOT NULL,
  rate              NUMERIC(10,6) NOT NULL,          -- 요율(소수)
  base_added        BIGINT        NOT NULL DEFAULT 0,-- 기초액(원, mid 구간만)
  PRIMARY KEY (construction_type, bracket),
  CONSTRAINT ck_rate_ctype   CHECK (construction_type IN
    ('일반건설공사(갑)','일반건설공사(을)','중건설공사','철도·궤도신설공사','특수·기타건설공사')),
  CONSTRAINT ck_rate_bracket CHECK (bracket IN ('under5','mid','over50'))
);
INSERT INTO safety_cost_rate(construction_type,bracket,rate,base_added) VALUES
 ('일반건설공사(갑)','under5',0.0293,0),('일반건설공사(갑)','mid',0.0186,5349000),('일반건설공사(갑)','over50',0.0197,0),
 ('일반건설공사(을)','under5',0.0309,0),('일반건설공사(을)','mid',0.0199,5499000),('일반건설공사(을)','over50',0.0210,0),
 ('중건설공사','under5',0.0343,0),('중건설공사','mid',0.0235,5400000),('중건설공사','over50',0.0244,0),
 ('철도·궤도신설공사','under5',0.0245,0),('철도·궤도신설공사','mid',0.0157,4411000),('철도·궤도신설공사','over50',0.0166,0),
 ('특수·기타건설공사','under5',0.0185,0),('특수·기타건설공사','mid',0.0120,3250000),('특수·기타건설공사','over50',0.0127,0);

-- ── 안전관리비 검증 (공고당 1건) ─────────────────────────────────────
CREATE TABLE safety_cost_check (
  check_id          BIGSERIAL     PRIMARY KEY,
  notice_id         VARCHAR(50)   NOT NULL UNIQUE REFERENCES notice(notice_id) ON DELETE CASCADE,
  construction_type VARCHAR(40)   NOT NULL,
  base_amount       BIGINT        NOT NULL,                       -- 대상액(원)
  bracket           VARCHAR(10)   NOT NULL,
  rate_applied      NUMERIC(10,6) NOT NULL,
  base_added        BIGINT        NOT NULL DEFAULT 0,
  required_cost     BIGINT        NOT NULL,                       -- 산정 기준 안전관리비(원)
  formula           TEXT          NOT NULL,                       -- 산정식(가독)
  input_sufficiency VARCHAR(10)   NOT NULL,                       -- full/partial
  declared_cost     BIGINT,                                       -- 명시 안전관리비(비교용)
  verdict           VARCHAR(20)   NOT NULL,                       -- 정상/과소계상_의심/검토필요
  rate_note         TEXT,
  calculated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT fk_scc_ctype_rate FOREIGN KEY (construction_type, bracket)
       REFERENCES safety_cost_rate(construction_type, bracket),
  CONSTRAINT ck_scc_input   CHECK (input_sufficiency IN ('full','partial')),
  CONSTRAINT ck_scc_verdict CHECK (verdict IN ('정상','과소계상_의심','검토필요'))
);
COMMENT ON TABLE safety_cost_check IS '안전관리비 기준액 산정·판정 (공고당 1건)';
CREATE INDEX idx_scc_verdict ON safety_cost_check(verdict);

-- ── 위험작업 태그 (공고당 N건) ───────────────────────────────────────
CREATE TABLE risk_tag (
  tag_id       BIGSERIAL    PRIMARY KEY,
  notice_id    VARCHAR(50)  NOT NULL REFERENCES notice(notice_id) ON DELETE CASCADE,
  tag          VARCHAR(100) NOT NULL,                             -- 고소작업/굴착흙막이/밀폐공간 등
  severity     SMALLINT     NOT NULL,                             -- 1경미 2중간 3높음
  evidence     TEXT         NOT NULL,                             -- 근거 문장(task_text 부분)
  source       VARCHAR(10)  NOT NULL,                             -- ai/rule/mock
  extracted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_rt_severity CHECK (severity BETWEEN 1 AND 3),
  CONSTRAINT ck_rt_source   CHECK (source IN ('ai','rule','mock'))
);
COMMENT ON TABLE risk_tag IS '공고문에서 추출한 위험작업 태그';
CREATE INDEX idx_rt_notice ON risk_tag(notice_id);
CREATE INDEX idx_rt_tag    ON risk_tag(tag);

-- ── 종합 위험 프로파일 (공고당 1건) ──────────────────────────────────
CREATE TABLE risk_profile (
  profile_id               BIGSERIAL   PRIMARY KEY,
  notice_id                VARCHAR(50) NOT NULL UNIQUE REFERENCES notice(notice_id) ON DELETE CASCADE,
  score                    SMALLINT    NOT NULL,                  -- 0~100
  breakdown_risk_works     SMALLINT    NOT NULL DEFAULT 0,        -- 위험작업 기여(≤40)
  breakdown_safety_cost    SMALLINT    NOT NULL DEFAULT 0,        -- 안전관리비의심 기여(≤25)
  breakdown_win_rate       SMALLINT    NOT NULL DEFAULT 0,        -- 저가낙찰/공기 기여(≤15)
  breakdown_disaster_stats SMALLINT    NOT NULL DEFAULT 0,        -- 공종재해통계 기여(≤20)
  top_factors              TEXT[]      NOT NULL DEFAULT '{}',     -- 상위 위험요인
  recommendations          TEXT[]      NOT NULL DEFAULT '{}',     -- 권고사항
  calculated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  cache_expiry             TIMESTAMPTZ,
  CONSTRAINT ck_rp_score CHECK (score BETWEEN 0 AND 100)
);
COMMENT ON TABLE risk_profile IS '안전관리비·위험태그·낙찰·재해통계 종합 위험도(0~100)';
CREATE INDEX idx_rp_score ON risk_profile(score DESC);

SET search_path TO public;
COMMIT;

-- =====================================================================
--  검증 쿼리(선택) — 실행 후 수동 확인용
--    SELECT count(*) FROM safeprocure.safety_cost_rate;            -- 기대 15
--    SELECT round(1450000000*rate+base_added)                     -- 기대 32319000
--      FROM safeprocure.safety_cost_rate
--     WHERE construction_type='일반건설공사(갑)' AND bracket='mid';
--    -- 충돌 0: public ∩ safeprocure 동명 테이블 없음
-- =====================================================================
