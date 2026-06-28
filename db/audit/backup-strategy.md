# VITALGUARD 백업·복구 전략 (자체서버 1인 개발 기준)

작성 근거. 정적 DDL 감사(에이전트 5 백업·7 설정·8 유지보수·10 관측성) 결과를 운영 문서로 합성한 것이다. 현 상태는 백업 자동화·WAL 아카이빙·PITR·복제가 코드/문서 어디에도 정의되어 있지 않다(`db/` 전체와 앱 `lib/db.ts` 점검 결과 0건). 유일한 백업 언급은 요율 마이그레이션 직전 1회 수동 `pg_dump` 권고뿐이다(`db/safeprocure/01_rate_migration_2026-06-27.sql:16`). 이 문서는 그 공백을 메우는 최소 실행안이다.

대상 환경. 단일 PostgreSQL 14+, 자체서버(우진·광주), RAM 4~8GB 가정, 1인 운영. 민감정보(작업자 생체·낙상·혈액형·GPS)와 조달 증빙을 보관하므로 손실·유출 양쪽을 모두 막아야 한다.

---

## 1. 핵심 목표치 (RTO/RPO)

| 항목 | 일일 덤프만 | WAL 아카이빙·PITR 적용 시 | 비고 |
|---|---|---|---|
| RPO(허용 데이터 손실) | 최대 24시간 | 5분 이내 | 생체·낙상은 손실 민감 → PITR 권장 |
| RTO(복구 소요) | 30분~1시간 | 30분~1시간 | custom 포맷 병렬 복원(`pg_restore -j`) 기준, 실측 권장 |

RTO 실측 입력은 실제 DB 용량이다. 아래 진단 쿼리로 먼저 확인한다.

```sql
-- 전체 DB·테이블 상위 용량(백업 소요시간·저장공간 산정 입력)
SELECT n.nspname AS schema, c.relname AS table,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 25;
```

---

## 2. 3-2-1 백업 규칙

사본 3벌, 매체 2종, 오프사이트 1벌. 1인 운영에서 가장 현실적인 구성이다.

| 사본 | 매체 | 위치 | 비고 |
|---|---|---|---|
| 1차 | 로컬 디스크 | 자체서버 `/backup` | 야간 `pg_dump` 산출물 |
| 2차 | 외장 SSD 또는 NAS | 물리 분리 매체 | 주 1회 동기화 |
| 3차(오프사이트) | 클라우드 오브젝트 스토리지 | R2 또는 국내 클라우드 | 반드시 암호화 후 업로드 |

오프사이트 후보로 Cloudflare R2 어댑터가 이미 앱에 존재한다(`기존_조달청모듈/safetymonitor/apps/dashboard-web/lib/storage.ts`). 백업 업로드에 재활용할 수 있다. 단 클라우드 전송 전 반드시 로컬 암호화한다(아래 4절).

---

## 3. 백업 계층 — 단계적 구축

### 3-1. 즉시(1일 내, 비용 0) — 일일 논리 덤프

`cron` 또는 `systemd timer`로 매일 야간 전체 덤프를 돌린다. custom 포맷은 병렬 복원·선택적 테이블 복원이 가능해 RTO를 줄인다.

```bash
# 비밀번호는 PGPASSWORD 환경변수로 주입(argv 금지). DSN 에서 비밀번호 제거.
pg_dump --format=custom --no-password \
  -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
  | age -r "$AGE_RECIPIENT" > "/backup/vitalguard_$(date +%F).dump.age"
```

### 3-2. 1주 내 — 3-2-1 충족 + 보존 순환

그랜드파더-파더-선 순환을 적용한다. 일 7벌·주 4벌·월 6벌이 1인 운영에 무난하다. 단 보존기간은 무한정 늘리지 말고 개인정보 파기 의무와 연동한다(5절).

### 3-3. 2주 내(자체서버 권장) — WAL 아카이빙·PITR

일일 덤프만으로는 최대 24시간을 잃는다. 생체·낙상·조달 증빙은 손실에 민감하므로 WAL 아카이빙으로 RPO를 분 단위로 낮춘다.

- `postgresql.conf`: `wal_level = replica`, `archive_mode = on`, `archive_command` 로 WAL을 오프사이트 보관.
- 주 1회 `pg_basebackup` 으로 베이스백업 확보 → 임의 시점 복구 가능.
- 주의: 캠퍼스 공유 DB는 `archive_command` 설정 권한이 없을 수 있어, 자체서버 이전 후 적용이 현실적이다.

설정 적용 후 아래 진단 쿼리로 동작을 검증한다.

```sql
-- WAL 아카이빙 동작 점검(archived_count 증가·failed_count 0 이어야 정상)
SELECT archived_count, last_archived_wal, last_archived_time,
       failed_count, last_failed_wal, last_failed_time FROM pg_stat_archiver;

-- 아카이브/WAL 설정 점검
SELECT name, setting FROM pg_settings
WHERE name IN ('archive_mode','archive_command','wal_level','archive_timeout','max_wal_size');
```

---

## 4. 암호화·전송 보안

현재 DB 연결은 평문이다(`lib/db.ts:96` 의 `sslmode=disable`, 캠퍼스 DB SSL 미지원). 원격에서 `pg_dump` 를 뜨면 작업자 생체·낙상·관리자 자격이 전송 구간에서 평문으로 흐른다.

- 저장 암호화(at-rest). 덤프 산출물은 반드시 `age` 또는 `gpg` 로 암호화한다. 키는 DB 밖(시크릿 매니저·오프라인)에 보관한다.
- 전송 암호화(in-transit). 자체서버 전환 시 `ssl = on` + 인증서, 또는 SSH 터널 경유로 덤프·복제 트래픽을 보호한다.
- 점검. 아래로 현재 세션이 SSL인지 실측한다.

```sql
SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();
SHOW ssl;
```

근거 법령. 개인정보 보호법 제29조(안전조치의무) 및 시행령 제30조 제1항 제3호(개인정보의 전송·저장 암호화).

---

## 5. 보존기간·파기 연동

민감 테이블(`fall_ml.*`, `vital_samples_galaxy`, `vital_samples`, `T_WORKER.WORKER_BLOODTYPE` 등)에 보유기간·자동 파기 메커니즘이 정적 DDL에 없다. 백업 보존을 무한정 늘리면 파기 의무 대상 개인정보가 백업본에 계속 잔존해 법 위반 소지가 생긴다.

원칙. 보존기간이 정해진 개인정보는 운영 DB와 백업본에서 함께 파기 주기를 맞춘다.

- 운영 보존(예) 90~180일 + 법정 보존분 분리.
- 백업 순환주기를 보존정책에 맞춰 설정(무한 보존 금지).
- 산업재해 자료 보존 의무(KOSHA 3년)와 개인정보 최소보관 원칙은 서로 충돌할 수 있으므로 법무 확인 후 보존기간을 확정한다(본 문서 범위 밖).

근거 법령. 개인정보 보호법 제21조(보유기간 경과·목적 달성 시 지체 없이 파기).

---

## 6. 복구 SOP 템플릿

백업은 복원해보기 전까지 백업이 아니다. 월 1회 복구 훈련을 의무화한다.

### 6-1. 정기 복구 훈련(월 1회)

1. 별도 임시 인스턴스(또는 컨테이너)를 띄운다.
2. 최신 암호화 덤프를 복호화 후 복원한다.
   ```bash
   age -d -i "$AGE_KEYFILE" "/backup/vitalguard_YYYY-MM-DD.dump.age" > /tmp/restore.dump
   pg_restore --no-password -j 2 -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE_RESTORE" /tmp/restore.dump
   ```
3. 정합성 검증(행수·핵심 쿼리). 예: `safety_cost_rate` 12행, `vital_samples` 카운트, `T_COMPANY`/`T_WORKER` 존재.
4. RTO(복원 소요)를 실측해 기록한다.
5. 임시 인스턴스를 파기한다.

### 6-2. 실제 장애 복구 절차

| 시나리오 | 복구 방법 |
|---|---|
| 실수 DELETE/DROP (PITR 미적용) | 최신 일일 덤프 복원 → 최대 24시간 손실 감수 |
| 실수 DELETE/DROP (PITR 적용) | 베이스백업 복원 후 사고 직전 시점까지 WAL 재생 |
| 디스크/하드웨어 장애 | 오프사이트(3차) 사본으로 신규 서버에 복원 |
| 랜섬웨어 | 오프라인/오프사이트 사본으로만 복원(로컬 사본 오염 가정) |

### 6-3. 복구 전 안전 점검

```sql
-- 장기 idle-in-transaction 세션은 복원·VACUUM 정합성을 저해한다
SELECT pid, state, now()-xact_start AS xact_age, left(query,80) AS query
FROM pg_stat_activity WHERE state IS NOT NULL AND state <> 'idle'
ORDER BY xact_start NULLS LAST LIMIT 20;

-- 트랜잭션 ID wraparound 위험(autovacuum 미추적 테이블). age 2억 근처면 긴급 VACUUM
SELECT n.nspname, c.relname, age(c.relfrozenxid) AS xid_age
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY age(c.relfrozenxid) DESC LIMIT 15;
```

---

## 7. 체크리스트

- [ ] 일일 `pg_dump` (custom 포맷) 자동화 — cron/systemd
- [ ] 덤프 산출물 `age`/`gpg` 암호화, 키는 DB 밖 보관
- [ ] 3-2-1 충족(로컬 + 외장/NAS + 오프사이트 클라우드)
- [ ] WAL 아카이빙 + 주 1회 `pg_basebackup`(자체서버 전환 후)
- [ ] 보존 순환주기를 개인정보 파기 정책과 연동
- [ ] 월 1회 복구 훈련 + RTO 실측 기록
- [ ] 자체서버 전환 시 `ssl=on` 또는 SSH 터널로 전송 암호화

참고. `db/` 의 마이그레이션 스크립트는 단일 트랜잭션·검증 게이트·멱등 가드 등 운영안전 설계가 양호하다. 정작 빠진 것은 그 앞단의 백업 그 자체이므로, 위 1차 조치(일일 덤프 자동화)를 최우선으로 적용한다.
