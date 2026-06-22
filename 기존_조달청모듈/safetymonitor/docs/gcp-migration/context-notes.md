# GCP 이전 — 컨텍스트 노트 (결정·근거·실측)

> 발표(2026-07-07)용 안정 데모 서버 + 상용화 기반 겸용. 진행하며 덧붙인다.

## 목표·범위 (2026-06-22 확정)
- **목적** = cloudflared URL 회전 제거 → 폰·워치가 붙는 **고정 HTTPS** 백엔드. 발표 데모가 곧 상용화 기반.
- **배포** = Next.js **단일 서비스**(UI+API 한 몸)를 **Cloud Run**에 1개로. 프론트/백 물리 분리 안 함(현 코드 그대로).
- **DB** = 자체 Cloud SQL **안 씀**. 보유 중인 **캠퍼스 PostgreSQL**에 백엔드가 직접 접속.
- **웨어러블·앱** = 워치/폰이 Cloud Run HTTPS 엔드포인트로 POST.

## DB 실측 (2026-06-22)
- host=`project-db-campus.smhrd.com`(→49.171.84.3) · port=`3310` · user/db=**`vitalguard`(소문자 확정)** · PostgreSQL **14.5**.
- 빈 DB(테이블 0) · public 스키마 **CREATE 권한 O** → 스키마 직접 생성 가능.
- ⚠️ **SSL 미지원(평문 전용)** → `sslmode=disable` 필수.
- `.env.local`에 `DATABASE_URL=postgresql://vitalguard:****@project-db-campus.smhrd.com:3310/vitalguard?sslmode=disable` (gitignore, 배포 시 Secret Manager).

## 핵심 트레이드오프
- **DB 구간 평문** — Cloud Run↔캠퍼스 DB가 인터넷에서 비암호화(자격증명+PII). **발표 데모 한정 수용**, 상용화 시 SSL DB 또는 SSH/stunnel 터널.
- **새 GCP 결제 계정 필요** — A(VM)·B(Cloud Run) 공통 전제(카드 등록). $300/90일 무료 크레딧으로 발표 기간 실비 ≈ 0. 결제 위험 아님(업그레이드 전 자동청구 없음).
- **better-sqlite3(동기)→pg(비동기)** = 이번 작업의 80%. 동기 API라 못 피함(Node 동기 pg 드라이버 없음).

## 코드 영향 범위 (정밀 측정)
- `lib/db.ts` 공개 함수 **29개** 전부 async 전환 + 내부 `better-sqlite3`→`pg` Pool.
- `app/api/mock/store.ts` `addSample`(+ totalPersisted/countsByWorker/workerProfiles 래퍼) async.
- `lib/db` import 파일 **23개**(대부분 라우트 — 이미 `async`라 `await`만 추가). 단 `AdminExportModal.tsx`·`site-workerdays-mock.ts`는 **타입 전용 import**(런타임 무관, 확인 필요).
- `store.ts` 소비자 = `vital/route.ts`·`cctv/ingest.ts`·`store.test.ts`.

## DDL 변환 메모 (SQLite→PG)
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY` / `BIGSERIAL`.
- `strftime('%Y-%m-%dT%H:%M:%fZ','now')` default → `to_char(now() at time zone 'utc', ...)` 또는 앱에서 ISO 주입.
- `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING` · upsert → `ON CONFLICT ... DO UPDATE`.
- `substr(ts,1,10)` → `left(ts,10)` / `LIKE ... ESCAPE` → 동일(PG도 지원), 대소문자 필요 시 `ILIKE`.
- 파라미터 `@name`(better-sqlite3) → `$1,$2`(pg) 또는 named (pg는 positional).
- REAL→`double precision`, TEXT→`text`, INTEGER→`bigint`.

## 검증 기준 (Phase 1 완료 정의)
`pnpm test` 통과 + dashboard `tsc --noEmit` 0 + 실 Postgres에 스키마 생성 + POST(/api/mock/vital, /api/cctv/event)→GET 적재 확인.
