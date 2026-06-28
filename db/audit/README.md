# DB 종합 감사 (VITALGUARD / SafeProcure) — `db/audit`

PostgreSQL **정적 스키마+코드 감사** 산출물. 전 과정 읽기 전용이며 운영 DB·데이터를 일절 변경하지 않았다.

- **감사 실행** 2026-06-28.
- **대상** `db/` DDL 11파일(1,267줄) + 앱 DB 코드(`apps/dashboard-web/lib/db.ts`, `app/api/**`).
- **방식** 10개 전문 에이전트 병렬 정적 감사 → 교차검증 → 한국어 보고서 합성. **라이브 DB 미연결.**

---

## 1. 지금까지 한 작업

1. **연결 디스커버리** — `psql` 미설치 확인. 유일한 라이브 경로는 앱의 캠퍼스 **공유 운영 DB**(`.env.local`)뿐 → 가드레일(L-04)·부하 위험으로 **정적 감사 선택**(사용자 확정).
2. **스키마·코드 디스커버리** — 핵심 테이블(`T_WORKER/T_SITE/T_COMPANY/T_SAFETY_EXPENSE/T_SENSING/T_ALERT/T_SAFEGUARD`, `doc_media.*`, `fall_ml.*`, `imu_collect`, safeprocure) + 민감정보 컬럼(phone·email·계좌·주소·면허·비밀번호) 스코프 확정.
3. **10-에이전트 감사 워크플로 실행** — 보안·성능·무결성·설계·백업·컴플라이언스·설정·유지보수·앱통합·문서.
4. **교차검증** — 충돌 해소·중복 제거·Top5 우선순위·SQL 문법/안전성 검증·공수 산정.
5. **보고서 합성** — 한국어 종합 보고서·통합 수정SQL·운영문서(백업·모니터링).
6. **PDF 생성** — Chrome 헤드리스 `--print-to-pdf`(한글 네이티브). pandoc/wkhtmltopdf 미설치 우회.

(1차 실행은 10병렬 버스트로 서버 레이트리밋에 전멸 → finder **웨이브 3개 + 합성 순차**로 동시성을 낮춰 재실행 성공.)

## 2. 현재 상태

| 지표 | 값 |
|---|---|
| 전체 건강점수 | **46 / 100** (상용화 전 시정 필요) |
| 컴플라이언스(개인정보보호법) | **28 / 100** |
| Critical / High / Medium | **1 / 9 / 22** |
| 예상 총공수 | 약 **96시간** (P0~P2 약 2.5주) |

**최대 리스크 (Critical).** DB 계층 방어(RLS·pgcrypto·`GRANT/REVOKE`·접속로그)가 전 DDL에서 **0건**. 작업자 건강·생체(심박/SpO2/체온)·GPS가 평문이고 `sslmode=disable`([db.ts:96](../../기존_조달청모듈/safetymonitor/apps/dashboard-web/lib/db.ts#L96))로 전송도 평문. 테넌트 격리가 앱 코드 단일 의존 → DB 직접접속 한 곳만 뚫리면 타사 작업자 민감정보 전체 노출. **개인정보보호법 제23조·제29조 직결.**

**긍정 소견(실제 강점).** 앱 인증(users) scrypt 해시·fail-closed·IP잠금 양호 · 전 경로 파라미터화로 **SQL 인젝션 표면 없음** · 주민번호 컬럼 없음 · SECURITY DEFINER 0건.

**산출물 — 전부 검토용, 미적용.**

| 파일 | 내용 |
|---|---|
| `db-audit-report.md` / `.pdf` | 4부 종합 보고서(경영요약·에이전트별·30일플랜·컴플라이언스) |
| `db-audit-summary.md` / `.pdf` | 1페이지 경영요약(영업/제출용) |
| `db-audit-fixes.sql` | 우선순위순 통합 수정SQL — `BEGIN`/롤백/백업헤더 동반, **미적용** |
| `backup-strategy.md` | 3-2-1 백업전략·복구 SOP |
| `monitoring-setup.sh` | pg_stat_statements·pgaudit·pg_cron 설정(운영자 직접 실행) |
| `db-audit-reconcile.json` | 교차검증 원본(충돌·중복·Top5·SQL검증) |
| `*.html` | PDF 재출력용 인쇄 HTML |

## 3. 다음 할 일

**적용 전 필수(운영자).**
1. **백업** — `pg_dump --format=custom`(custom 포맷) 후 스크래치 인스턴스 복구 검증.
2. **라이브 실태 확인** — 정적으로 단정 못 한 항목(평문 실데이터·실권한·SSL·bloat·통계 신선도)을 `monitoring-setup.sh`/보고서 진단쿼리로 운영 DB에서 직접 확인.
3. **선행 검증** — 모든 CHECK/UNIQUE 추가 전 진단쿼리로 기존 데이터 위반 0 확인(위반 시 `ADD CONSTRAINT` 실패).

**시정 우선순위(보고서 Part3 30일 플랜).**
- **1주 P0**(~14.5h) — 백업 자동화 · `SG_PWD` 해시 CHECK · FK/시계열 인덱스 · 풀 타임아웃 · calendar FK · pgcrypto 1단계.
- **2주 P1**(~30h) — 민감정보 암호화 2~3단계 · RLS · pgaudit.
- **3주 P2**(~28h) — 리텐션/파티셔닝 · 정규화 · 시각타입(ts TEXT→TIMESTAMPTZ) 정정.
- **4주**(~16h) — 문서(COMMENT) · 모니터링 스택.

**적용 시 주의(SQL 검증 메모).**
- `NOT VALID` + `VALIDATE`를 같은 트랜잭션에 두면 락회피가 무력화 → 무중단이 목적이면 분리.
- `VACUUM`은 트랜잭션 밖 별도 실행.
- 확장(pgcrypto/pgaudit/pg_stat_statements)은 `shared_preload_libraries` 등록 + 재시작 선행해야 실제 동작.

**문서 정리.**
- git 커밋/푸시는 **사용자 승인 후**(`db/audit`는 추적 폴더). 기본은 로컬 보관.

---

## 재현·확장

- 감사 워크플로 스크립트는 세션 산출물(로컬). 정적 소스만 읽으므로 안전 재실행 가능.
- **라이브 감사가 필요하면** 비운영(dev/staging) DB 접속정보를 제공 → 보고서/`monitoring-setup.sh`의 진단쿼리를 운영자가 직접 실행해 정적 추정을 실측으로 대체한다. 공유 운영 DB에는 무거운 진단을 돌리지 않는다.

## 안전 원칙 (전 과정 준수)

- 읽기 전용. 운영 DB 미연결. `UPDATE/DELETE/DROP/ALTER/TRUNCATE` 미실행.
- 수정SQL은 **생성만**. 적용은 운영자가 백업 후 직접 판단.
- 기존 파일·데이터 **무수정·무삭제**. 산출물은 신규 파일 생성만.
