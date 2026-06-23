# db/integrated/ — VITALGUARD + SafeProcure 통합 스키마

두 도메인을 한 PostgreSQL DB에 공존시키는 **단일 설치 스크립트**.

| 파일 | 내용 |
|---|---|
| `vitalguard_safeprocure_full.sql` | ① VITALGUARD(완성본 7테이블, `public`) + ② SafeProcure(5테이블, `safeprocure` 스키마) 풀 DDL |

## 구성
- **① VITALGUARD** (`public`) — 작업자 생체·안전 모니터링. aquerytool 모델링 **완성본** 원본 DDL(한글 코멘트·FK 포함). T_COMPANY·T_WORKER·T_SENSING·T_SITE·T_SAFEGUARD·T_ALERT·T_SAFETY_EXPENSE.
- **② SafeProcure** (`safeprocure`) — 조달 안전관리비 위험검증. notice·safety_cost_rate(요율 15행 시드)·safety_cost_check·risk_tag·risk_profile. ①과 **FK 없이 독립**.
- 두 도메인 **테이블명 충돌 0**(캠퍼스 PG 라이브 검증), 별도 schema 격리로 이중 안전.

## 적용
```bash
psql "$DSN" -v ON_ERROR_STOP=1 -f db/integrated/vitalguard_safeprocure_full.sql
```
신규(빈) DB 기준. 전체가 단일 트랜잭션 — 실패 시 부분 적용 없음.

## ⚠ 정본 구분
- 본 파일 ① 파트 = aquerytool **완성본**(모델 정본/통합 뷰).
- **SafeProcure 5테이블 단독본** = `db/schema.sql` + DB 연동층 `db/client.ts`·`db/safeprocure.repo.ts` (현재 `feat/safeprocure-schema` 브랜치, main 미병합).
- **VITALGUARD 실 배포본(V2, 캠퍼스 적용)** = `safetymonitor` 레포(becks0724/safetymonitor) `backend/db/schema.sql` — 차이: FK 컬럼 BIGINT화 · `AMOUNT` BIGINT · `T_DEVICE` 추가 · 애플워치 v2 컬럼 · 5초 연속집계(T_SENSING_SUMMARY_5S 등).
- SafeProcure 요율값은 고시 정리본 — 현행 고시(제2025-11호)로 교차검증 필요.
