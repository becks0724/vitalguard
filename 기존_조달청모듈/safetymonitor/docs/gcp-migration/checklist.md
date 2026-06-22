# GCP 이전 — 체크리스트

> 근거·결정은 [context-notes.md](context-notes.md). 진행하며 체크.

## Phase 0 — GCP 계정·프로젝트·결제 ✅ 완료 (2026-06-22)
- [x] 결제 계정 — **기존 활성 계정 재사용**(카드 등록 불필요)
- [x] 프로젝트 — 기존 **`safetymonitor-498508`** 재사용
- [x] `gcloud auth login`(233276656+becks0724@users.noreply.github.com) + project/region 설정(`asia-northeast3`)
- [x] API 활성화 — run·cloudbuild·secretmanager·artifactregistry

## Phase 1 — DB 재작성 (better-sqlite3 → pg) ✅ 완료 (2026-06-22)
- [x] 캠퍼스 Postgres 접속·권한 확인(빈 DB·CREATE O)
- [x] `.env.local DATABASE_URL` 정리(sslmode=disable)
- [x] `pg` + `@types/pg` 추가, `better-sqlite3`·`@types/better-sqlite3` 제거(-22 패키지)
- [x] `lib/db.ts` — `pg.Pool`(DATABASE_URL) + DDL Postgres화 + 29함수 async + int8 파서
- [x] `app/api/mock/store.ts` — `addSample` 및 래퍼 async
- [x] 라우트 ~20개 — `await` 전파(grep 전수, tsc 무탐지 런타임 자리 포함) + `ingestCctvEvent` async
- [x] 타입 전용 import 확인(`AdminExportModal.tsx`·`site-workerdays-mock.ts` — 런타임 무관)
- [x] 실 Postgres에 스키마 10테이블 생성(첫 쿼리 `ensureSchema` 멱등)
- [x] 검증 — `tsc --noEmit` 0 · `pnpm test` 101/101(schemas 15·analyzers 46·dashboard 40) · POST→GET 실 적재·조회 확인 · 테스트 행 정리

## Phase 2 — 컨테이너화 + Artifact Registry ✅ 완료 (2026-06-22)
- [x] `next.config` `output:"standalone"` + `outputFileTracingRoot`(monorepo)
- [x] `transpilePackages` 에 analyzers 추가(standalone dist 누락 → fusion 런타임 실패 회피)
- [x] monorepo `Dockerfile`(node:22-slim 멀티스테이지·비루트) + `.dockerignore`(`.env*` 제외)
- [x] standalone 로컬 실행 검증(GET/·fusion·pg 적재 OK)
- [x] Cloud Build 빌드·푸시(2m21s) → `asia-northeast3-docker.pkg.dev/safetymonitor-498508/vitalguard/dashboard:latest`
- (감사 PDF 한글폰트 = 런타임 PDF 라우트 없음 → 스킵)

## Phase 3 — 기존 Postgres 연결 점검 ✅ 완료 (2026-06-22)
- [x] **Cloud Run egress에서 캠퍼스 DB 도달 확인**(POST→적재 201, IP 허용목록 없음 = VPC 커넥터 불필요)

## Phase 4 — Cloud Run 배포 + 시크릿 ✅ 완료 (2026-06-22)
- [x] Secret Manager — `DATABASE_URL`·`ADMIN_PASSWORD` + 런타임 SA secretAccessor
- [x] `gcloud run deploy` — `--allow-unauthenticated`·`--set-secrets`·`--min-instances=1`·512Mi
- [x] 검증 — **고정 HTTPS** `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app` 200 + 로그인 + cctv/vital 201

## Phase 5 — 폰·워치 전환 (★ 사용자 액션 남음)
- [ ] 폰 인앱 수신 URL → `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app/api/mock/vital`
- [ ] 워치 `ConnectionSettings.defaultURLString` → 위 URL + 재빌드(ATS 예외 불필요 = 정식 HTTPS)
- [ ] 검증 — 실기기 POST 201 → 대시보드 수신 → Postgres 적재

## 후속(선택)
- [ ] 외부 API 키(KMA/KOSHA/G2B/PPS/YOUTUBE) Secret 추가 → 날씨·특보·안전관리비 라이브화(현재 키 없어 mock 폴백)
- [ ] 상용화 시 DB 평문 → SSL DB 또는 SSH/stunnel 터널
