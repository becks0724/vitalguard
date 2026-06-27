# SafeProcure 스키마 정합성 검사 — 2026-06-24

> ⚠ **STALE (2026-06-27 갱신)**: 본 검사는 **구 요율(5공종·15행) 시점** 기록이다. 당시엔 레포 SQL = 라이브 DB가
> 진짜로 일치했으나, 2026-06-27 레포 SQL이 현행 고시 제2025-11호 **신 4공종·12행**으로 갱신되며 라이브 campus DB
> (아직 구 요율 15행)와 어긋났다. → **라이브 DB 재시드(safety_cost_rate DROP+재INSERT) 후 재검증 필요.**
> 아래 본문(컬럼·제약·인덱스는 불변, 요율 시드·산정값만 변동)은 과거 스냅샷으로 보존.

레포 정의(`db/integrated/vitalguard_safeprocure_full.sql`)와 campus 라이브 DB의 `safeprocure` 스키마를
컬럼·제약·인덱스·시드·산정로직 단위로 대조한 결과. **결과: 완전 일치(드리프트 0건).**

- **대상(레포)**: `VitAlGuard-jodal/vitalguard-jodalcheong` · `db/integrated/vitalguard_safeprocure_full.sql`
- **대상(라이브)**: campus PostgreSQL · schema `safeprocure` (5테이블)
- **방법**: `information_schema` + `pg_constraint`(`pg_get_constraintdef`) + `pg_indexes` introspection ↔ 레포 DDL 대조. 읽기 전용.

## 테이블별 정합성

| 테이블 | 컬럼(레포=라이브) | 제약 | 인덱스 | 일치 |
|---|---|---|---|---|
| `notice` | 17 = 17 | PK(notice_id) · CHECK kind/source | region·kind·created 3 | ✅ |
| `safety_cost_rate` | 4 = 4 | 복합PK(construction_type,bracket) · CHECK ctype/bracket | (PK) | ✅ |
| `safety_cost_check` | 14 = 14 | PK(check_id) · FK notice·(ctype,bracket)→rate · UNIQUE notice_id · CHECK verdict/input | verdict | ✅ |
| `risk_tag` | 7 = 7 | PK(tag_id) · FK notice(CASCADE) · CHECK severity(1~3)/source | notice·tag | ✅ |
| `risk_profile` | 11 = 11 | PK(profile_id) · FK notice(CASCADE) · UNIQUE notice_id · CHECK score(0~100) | score | ✅ |

- 모든 FK가 `safeprocure` 스키마 내부에서 해소(cross-domain FK 없음, public과 격리).
- `public ∩ safeprocure` 동명 테이블 0 — 네임스페이스 충돌 없음.

## 시드 · 산정로직 검증

- **`safety_cost_rate` 15/15행** — 고용노동부 고시 제2025-11호 별표1(5공종 × 3구간) 값과 일치.
- **산정 검증**: 일반건설공사(갑) · `mid` · 대상액 1,450,000,000원
  → `round(1450000000 × 0.0186 + 5,349,000)` = **32,319,000원** (라이브 DB 계산값 = 기대값).

## 데이터 현황(row counts)

| 테이블 | 행수 | 의미 |
|---|---|---|
| `safety_cost_rate` | 15 | 정적 참조 시드(요율표) |
| `notice` | 0 | 실 G2B 공고 미적재 |
| `safety_cost_check` | 0 | 판정 미산출 |
| `risk_tag` | 0 | 위험태그 미추출 |
| `risk_profile` | 0 | 종합 위험도 미산출 |

→ **엔진(스키마+요율시드)은 라이브 배포 완료**, 실 공고 데이터 적재(G2B 수집)는 후속 단계.

## 결론

- 레포 SQL = 라이브 배포본. **추가 마이그레이션·DDL 수정 불필요.**
- 후속(선택): G2B 공고 수집 파이프라인으로 `notice` 적재 → `risk_tag`/`safety_cost_check`/`risk_profile` 산출.
