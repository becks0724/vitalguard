#!/usr/bin/env bash
# VITALGUARD PostgreSQL 모니터링·정기유지보수 설정 스크립트.
# pg_stat_statements·pgaudit 활성화, pg_cron 정기 VACUUM/ANALYZE 등록, 핵심 모니터링 쿼리 출력을 담는다.
# 자체서버 1인 운영 기준. 운영자가 검토 후 직접 실행한다. 비밀번호는 PGPASSWORD 환경변수로 주입한다(argv 금지).
#
# 근거. 정적 DDL 감사(에이전트 7 설정·8 유지보수·10 관측성) 결과 db/ 와 앱 코드 어디에도
# pg_stat_statements·pgaudit·pg_cron 흔적이 0건이었다. 본 스크립트가 그 공백을 메운다.
#
# 주의.
#  - pg_stat_statements·pgaudit 는 shared_preload_libraries 등록 + 서버 재시작이 선행되어야
#    실제 수집/감사가 동작한다. CREATE EXTENSION 만으로는 작동하지 않는다(재시작=다운타임).
#  - pg_cron 도 shared_preload_libraries 등록 + 재시작이 필요하다.
#  - 시계열 테이블(vital_samples 등)의 보존(리텐션) DELETE 는 비가역이라 사전 백업 후에만 적용한다.

set -euo pipefail

# --- 연결 파라미터(환경변수로 주입, 비밀번호는 PGPASSWORD) ---------------------
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-vitalguard}"
export PGHOST PGPORT PGUSER PGDATABASE

if [[ -z "${PGPASSWORD:-}" ]]; then
  echo "오류. PGPASSWORD 환경변수가 비어 있다. export PGPASSWORD=... 후 다시 실행한다." >&2
  exit 1
fi

# psql 공통 옵션(에러 시 중단, 조용한 출력)
PSQL=(psql --no-password -v ON_ERROR_STOP=1 -X -q)

# --- 실행 전 확인 프롬프트 -----------------------------------------------------
confirm() {
  local prompt="$1"
  local answer
  read -r -p "${prompt} [y/N] " answer
  [[ "${answer}" == "y" || "${answer}" == "Y" ]]
}

echo "============================================================"
echo " 대상 DB : ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
echo " 작업    : 확장 활성화 + 정기 VACUUM/ANALYZE 등록 + 모니터링 쿼리 출력"
echo "============================================================"
if ! confirm "위 DB 에 대해 진행한다. 계속할까?"; then
  echo "취소했다."
  exit 0
fi

# --- 0) 사전 상태 점검 --------------------------------------------------------
echo
echo "## 0. 사전 상태 — 설치된 확장·preload 라이브러리"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
SELECT extname, extversion FROM pg_extension
 WHERE extname IN ('pg_stat_statements','pgaudit','pg_cron','pgcrypto')
 ORDER BY extname;
SELECT current_setting('shared_preload_libraries') AS shared_preload_libraries;
SQL

# --- 1) pg_stat_statements ----------------------------------------------------
echo
echo "## 1. pg_stat_statements (쿼리 성능 관측)"
echo "   주의. shared_preload_libraries 에 'pg_stat_statements' 등록 + 재시작이 선행돼야 수집된다."
if confirm "CREATE EXTENSION pg_stat_statements 를 실행할까?"; then
  "${PSQL[@]}" -d "${PGDATABASE}" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
  echo "   완료. (재시작 전이면 통계 수집은 아직 시작되지 않음)"
else
  echo "   건너뜀."
fi

# --- 2) pgaudit (민감정보 접근 감사 로깅) -------------------------------------
echo
echo "## 2. pgaudit (접속기록 보관 의무 — 민감정보 건강·위치)"
echo "   주의. shared_preload_libraries 에 'pgaudit' 등록 + 재시작 필요."
echo "   권장. 1인 운영 부담 고려해 민감 스키마(fall_ml) 단위로 범위 한정."
if confirm "CREATE EXTENSION pgaudit 를 실행할까?"; then
  "${PSQL[@]}" -d "${PGDATABASE}" -c "CREATE EXTENSION IF NOT EXISTS pgaudit;"
  echo "   완료. 이후 postgresql.conf 에 pgaudit.log='read,write' 설정 후 재시작 권장."
else
  echo "   건너뜀."
fi

# --- 3) pg_cron 정기 VACUUM/ANALYZE 등록 --------------------------------------
echo
echo "## 3. pg_cron 정기 유지보수 (고빈도 시계열 테이블 통계 신선도 유지)"
echo "   주의. pg_cron 은 shared_preload_libraries 등록 + 재시작 필요(보통 postgres DB 에 설치)."
if confirm "pg_cron 확장 생성 + 정기 ANALYZE/리텐션 잡을 등록할까?"; then
  "${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- (a) 고빈도 테이블 통계 갱신 — 매시 정각
SELECT cron.schedule('analyze-vital', '0 * * * *',
  $$ANALYZE vital_samples; ANALYZE vital_samples_galaxy; ANALYZE cctv_fall_events;$$);

-- (b) 리텐션 — 매일 새벽 4시, 보존기간(예: 180일) 경과분 삭제.
--     ts 가 TEXT(ISO8601) 라 문자열 비교. 보존기간은 산업재해 보존의무·개인정보 최소보관과 합의 후 확정.
--     비가역이므로 사전 백업 필수. 실제 적용 전 기간을 검토해 조정한다.
SELECT cron.schedule('retention-vital', '0 4 * * *',
  $$DELETE FROM vital_samples
     WHERE ts < to_char(now() - interval '180 days', 'YYYY-MM-DD"T"HH24:MI:SS');$$);
SQL
  echo "   등록 완료. 현재 등록된 잡:"
  "${PSQL[@]}" -d "${PGDATABASE}" -c "SELECT jobid, schedule, command, active FROM cron.job ORDER BY jobid;" || true
else
  echo "   건너뜀."
fi

# --- 4) 고빈도 테이블 autovacuum 임계 강화 ------------------------------------
echo
echo "## 4. 고빈도 append 테이블 autovacuum/analyze 임계 강화(절대 행수 기준)"
echo "   대형 테이블에서 기본 scale_factor(0.1~0.2)는 너무 늦다. 5000행 변동마다 청소한다."
if confirm "vital_samples/vital_samples_galaxy/cctv_fall_events 에 autovacuum 임계 ALTER 를 적용할까?"; then
  "${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
ALTER TABLE vital_samples        SET (autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 5000,
                                      autovacuum_vacuum_scale_factor  = 0.0, autovacuum_vacuum_threshold  = 5000);
ALTER TABLE vital_samples_galaxy SET (autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 5000);
ALTER TABLE cctv_fall_events     SET (autovacuum_analyze_scale_factor = 0.0, autovacuum_analyze_threshold = 5000);
SQL
  echo "   완료. (되돌림: ALTER TABLE ... RESET (autovacuum_*))"
else
  echo "   건너뜀."
fi

# --- 5) 핵심 모니터링 쿼리 출력(읽기 전용) ------------------------------------
echo
echo "## 5. 핵심 모니터링 스냅샷 (읽기 전용)"

echo
echo "### 5-1. 테이블·인덱스 크기 상위(디스크 증가 추적)"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
SELECT n.nspname AS schema, c.relname AS table, c.reltuples::bigint AS est_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       pg_size_pretty(pg_indexes_size(c.oid))        AS indexes_size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind='r' AND n.nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 20;
SQL

echo
echo "### 5-2. dead tuple 비율·마지막 (auto)vacuum/analyze 신선도"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       CASE WHEN n_live_tup+n_dead_tup>0
            THEN round(100.0*n_dead_tup/(n_live_tup+n_dead_tup),1) ELSE 0 END AS dead_pct,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
ORDER BY n_dead_tup DESC NULLS LAST LIMIT 20;
SQL

echo
echo "### 5-3. 트랜잭션 ID wraparound 위험(age 2억 근처면 긴급 VACUUM)"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
SELECT n.nspname AS schema, c.relname AS table, age(c.relfrozenxid) AS xid_age
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind='r' AND n.nspname IN ('public','safeprocure','doc_media','fall_ml','imu_collect')
ORDER BY age(c.relfrozenxid) DESC LIMIT 15;
SQL

echo
echo "### 5-4. 커넥션 상태·장기 유휴 트랜잭션(풀 누수·블로킹 감지)"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
SELECT state, count(*) AS sessions,
       max(now()-state_change) AS longest_in_state,
       max(now()-query_start)  AS longest_query
FROM pg_stat_activity WHERE datname = current_database()
GROUP BY state ORDER BY sessions DESC;
SQL

echo
echo "### 5-5. 캐시 히트율·데드락 누적(DB 단위 안정성 신호)"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
SELECT datname, deadlocks, xact_commit, xact_rollback,
       CASE WHEN blks_read+blks_hit>0
            THEN round(100.0*blks_hit/(blks_read+blks_hit),2) ELSE 0 END AS cache_hit_pct
FROM pg_stat_database WHERE datname = current_database();
SQL

echo
echo "### 5-6. pg_stat_statements 상위 부하 쿼리(확장 활성·재시작 후에만 데이터 존재)"
"${PSQL[@]}" -d "${PGDATABASE}" <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') THEN
    RAISE NOTICE 'pg_stat_statements 설치됨 — 아래 쿼리로 상위 부하 확인 가능.';
  ELSE
    RAISE NOTICE 'pg_stat_statements 미설치 — 1번 단계 적용 + 재시작 필요.';
  END IF;
END $$;
SQL
# 설치·재시작 완료 시 아래 주석을 해제해 사용한다.
# "${PSQL[@]}" -d "${PGDATABASE}" -c \
#   "SELECT query, calls, total_exec_time, mean_exec_time, rows
#      FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;"

# --- 6) 권장 모니터링 알림 임계(1인 운영 최소셋) ------------------------------
echo
echo "## 6. 권장 알림 임계(별도 cron/스크립트로 주기 점검)"
cat <<'NOTE'
   (a) 디스크 사용률 85% 임계 알림(df 또는 node_exporter).
   (b) 가장 오래된 트랜잭션 나이 > 30분 알림(5-4 쿼리).
   (c) relfrozenxid age > 1.5억 알림(5-3 쿼리 — wraparound 사전 경보).
   (d) deadlocks 증가·연결 수 포화 알림(5-5 쿼리).
   (e) imu_collect 가 export 후에도 N일 이상 남아 있으면 회수 누락 알림.
   도구 부담을 줄이려면 pg_stat_statements + log_min_duration_statement(예: 500ms) 설정 후
   주간 느린 쿼리 리뷰부터 시작하는 것을 권한다.
NOTE

echo
echo "완료. 재시작이 필요한 확장(pg_stat_statements·pgaudit·pg_cron)은 postgresql.conf 의"
echo "shared_preload_libraries 등록 후 서버를 재시작해야 실제 동작한다."
