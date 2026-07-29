# safeprocure 스키마 — ⚠️ 실행 금지 경고

## 🛑 `feat/safeprocure-schema` 브랜치의 `db/schema.sql` 을 실행하지 말 것

- 그 파일의 **첫 문장이 `DROP TABLE … CASCADE`** 다.
- 대상 5테이블(notice·safety_cost_rate·safety_cost_check·risk_tag·risk_profile)은
  **이미 라이브 프로덕션 DB에 실재**하고 FK 4개가 걸려 있다(감사 DBL-LIVE-02, 2026-07-29 실측).
- "브랜치 미병합 = DB 미적용"이 이 레포에선 **성립하지 않는다** — 미병합 브랜치 스키마가
  이미 프로덕션에 수동 적용돼 있다. 실행하면 라이브 테이블과 FK가 실제로 날아간다.
- 라이브 DB는 **PITR 불가**(`archive_mode=off`·standby 0)라 복구 수단이 없다.

## 안전 절차

- 스키마 변경이 필요하면 실 DB `information_schema` 를 먼저 조회해 현재 상태와 대조한다.
- DDL 실행은 프로덕션 쓰기다 — 사용자 명시 승인 후에만.
- 근거 문서(로컬 전용): `audit/db-live-report.md` · `audit/schema-drift.md`.
