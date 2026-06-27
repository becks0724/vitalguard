-- =====================================================================
--  SafeProcure 안전관리비 요율표 마이그레이션 (구 5공종 → 현행 4공종)
--  대상: campus PostgreSQL · schema safeprocure · 테이블 safety_cost_rate
--  사유: 레포/코드 정본이 고용노동부 고시 제2025-11호(시행 2025.2.12) 별표1
--        신 4공종(건축/토목/중건설/특수)으로 갱신됨(2026-06-27).
--        라이브 DB는 구 요율(2018 개정, 5공종·15행) 상태 → 정본과 불일치.
--  작성: 2026-06-27
--
--  [보완 2026-06-27] step4 를 자동 검증 게이트(DO/RAISE)로 강화.
--    종전 SELECT 는 출력만이라 -f 비대화 실행 시 값이 틀려도 COMMIT 됐음.
--    → 행수/공종수/대표 계산이 어긋나면 예외 발생 → ON_ERROR_STOP 으로 트랜잭션 중단(무적용).
--    (사람이 출력을 안 봐도 잘못된 재시드가 커밋되지 않음.)
--  ⚠ 남은 필수 확인(코드로 불가): 12개 rate/base_added 값을 고시 제2025-11호 별표1 원문과 1:1 대조.
-- ---------------------------------------------------------------------
--  ⚠ 실행 전 백업:
--     pg_dump "$DSN" -t safeprocure.safety_cost_rate -f safety_cost_rate_backup_20260627.sql
--  ⚠ 전제: 요율표를 참조하는 safety_cost_check 가 0행이어야 무손실 재시드 가능.
--        (실 공고 미적재 상태 — 스크립트가 0행 자동 확인, 아니면 중단함.)
--  실행: psql "$DSN" -v ON_ERROR_STOP=1 -f 01_rate_migration_2026-06-27.sql
--  전부 단일 트랜잭션 — 실패/검증불일치 시 부분 적용 없음.
-- =====================================================================
BEGIN;
SET search_path TO safeprocure;

-- 0) 안전 확인: 요율표를 참조하는 검증행이 없어야 무손실 재시드 가능
--    (fk_scc_ctype_rate: safety_cost_check(construction_type,bracket) → safety_cost_rate, ON DELETE 없음)
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM safeprocure.safety_cost_check;
  IF n > 0 THEN
    RAISE EXCEPTION 'safety_cost_check 에 % 행 존재 — FK 영향 검토 후 수동 진행 필요(스크립트 중단).', n;
  END IF;
END $$;

-- 1) 구 요율 15행 삭제 (참조행 0이라 무손실)
DELETE FROM safety_cost_rate;

-- 2) CHECK 제약 교체 (구 5공종 → 신 4공종) — 신 공종 INSERT 전 필수
ALTER TABLE safety_cost_rate DROP CONSTRAINT ck_rate_ctype;
ALTER TABLE safety_cost_rate ADD CONSTRAINT ck_rate_ctype CHECK (construction_type IN
  ('건축공사','토목공사','중건설공사','특수건설공사'));

-- 3) 현행 요율 12행 적재 (고시 제2025-11호 별표1, 기초액 단위 '원')
INSERT INTO safety_cost_rate(construction_type,bracket,rate,base_added) VALUES
 ('건축공사','under5',0.0311,0),('건축공사','mid',0.0228,4325000),('건축공사','over50',0.0237,0),
 ('토목공사','under5',0.0315,0),('토목공사','mid',0.0253,3300000),('토목공사','over50',0.0260,0),
 ('중건설공사','under5',0.0364,0),('중건설공사','mid',0.0305,2975000),('중건설공사','over50',0.0311,0),
 ('특수건설공사','under5',0.0207,0),('특수건설공사','mid',0.0159,2450000),('특수건설공사','over50',0.0164,0);

-- 4) 자동 검증 게이트 [보완] — 어긋나면 예외 → 트랜잭션 중단(COMMIT 차단)
--    기대: 12행 / 공종 4종 / 건축 mid 대상액 14.5억 → 37,385,000원
DO $$
DECLARE c int; ct int; calc bigint;
BEGIN
  SELECT count(*) INTO c FROM safety_cost_rate;
  IF c <> 12 THEN RAISE EXCEPTION '검증 실패: 행수 % ≠ 12', c; END IF;

  SELECT count(DISTINCT construction_type) INTO ct FROM safety_cost_rate;
  IF ct <> 4 THEN RAISE EXCEPTION '검증 실패: 공종 수 % ≠ 4', ct; END IF;

  SELECT round(1450000000*rate+base_added) INTO calc FROM safety_cost_rate
   WHERE construction_type='건축공사' AND bracket='mid';
  IF calc IS DISTINCT FROM 37385000 THEN
    RAISE EXCEPTION '검증 실패: 건축 mid 계산 % ≠ 37,385,000', calc;
  END IF;

  RAISE NOTICE '검증 통과: 12행 / 공종 4 / 건축 mid 37,385,000 — COMMIT 진행';
END $$;

-- 4b) 참고 출력(가독용 — 게이트가 이미 강제 검증함)
SELECT count(*) AS rows_expect_12 FROM safety_cost_rate;
SELECT round(1450000000*rate+base_added) AS expect_37385000
  FROM safety_cost_rate WHERE construction_type='건축공사' AND bracket='mid';

COMMIT;
-- 롤백 복원(필요 시): 백업 파일 psql "$DSN" -f safety_cost_rate_backup_20260627.sql
