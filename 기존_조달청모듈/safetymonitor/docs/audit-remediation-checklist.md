# 감사 80건 리메디에이션 체크리스트 (2026-07-04 착수)

> `audit-response-20260704.md` 재검증 판정 위에서 구현. 범위 결정(사용자) = **관제웹(dashboard-web·packages·db)만** · 수집 API 인증 = **토큰 병행(soft)** · 미배선 분석기 = **스킵·문서화** · 보안 헤더 = **헤더 + CSP Report-Only**. 모바일(Flutter)·워치(Swift)는 별도 트랙(이 환경 빌드·배포 불가).
> 실행 = 구현(🔴A·🟠B·B1 = fable 서브에이전트 / 🟡C = Opus 4.8 직접 — fable 세션한도 반복 사망 + 사용자 지시) → 검증(tsc/lint/test) → 그룹 경계마다 `/deploy`. 각 항목 = 별도 커밋.

## 진척 요약 (2026-07-05 현재)

**지금까지 작업 (배포 완료 32건)**
- 🔴A 발표 데모 안정성 **14건** + 🟠B 안전 정체성 **3건**(C1 범위밖 vital 무음폐기·활동 90초 TTL·메트릭별 danger 전이) → **라이브 `00066-nks`** (5커밋 `149bd9e→b09907c`).
- 🟡C 조달 게이트 **15건**(무인증 쓰기 인증+클라 토큰·수집 API 토큰 병행 soft·AED fail-closed·XFF 신뢰홉·귀속위조·통합/doc_media DROP 가드·통합 FK+SG_ID UNIQUE·출역 KST일) → **라이브 `00067-4cm`** (4커밋 `082f4a6→a23f71d`).
- 전 그룹 tsc=0·lint 0err·schemas 21·analyzers 46·dashboard 89·라이브 실측 통과(게이트 회귀 0·C17 캐스트 정상·soft 토큰 정상).

**현재상태** — GitHub main `8401a60` 동기(0/0)·작업 트리 clean. 라이브 = `vitalguard-dashboard-00067-4cm` 100%. SQL 가드(C15/C16/C18)는 수동 스크립트라 레포에만 반영(배포 미포함, 운영자 재실행 시 데이터 보호).

**다음 할 일 (🟢D — 착수 순서 사용자 결정 대기)**
1. **안전·즉시**: D1 보안헤더 HSTS·X-Frame-Options·CSP **Report-Only** · D2 Google id_token 검증 · D3 admin timing 오라클 · D4 안전 핵심경로 테스트.
2. **설계 필요**: C10 앱 JWT 폐기(token_version+DB 리보케이션) · C7 프록시 레이트리밋 · D7 세션 httpOnly 쿠키(로그인 흐름 변경).
3. **⚠️ 라이브 공유 DB ALTER(신중)**: C19 vital_samples CHECK · C20 FK · C21 upsert 락 — 기존 데이터 위반/고아 시 ALTER 실패 → **가드 마이그레이션 파일로 작성(운영자 수동 실행)**, 프로드 직접 ALTER 지양(L-04 정신).

## 🔴 A. 발표 데모 안정성 (dashboard-web · 전부 외과적)

### 헤드라인 5
- [x] A1 · GPS 지터 → 특보영상 재생 리셋. `DemoDashboard.tsx` `fieldCoords` `toFixed(3)`(~110m) 양자화 (FE-H1)
- [x] A2 · VitalHistoryPanel 메트릭전환/오류 시 이전 데이터 오표시("78bpm→78℃ 위험"). effect 시작·catch에 `setData(null)` + 응답 workerId/metric/range 일치 확인 (FE-H2)
- [x] A3 · SOS/낙상 상태 휘발성 → 새로고침 재발화. ack 시각 localStorage 영속 (FE-M5)
- [x] A4 · noticeId 드롭 → 안전관리비 엉뚱 현장 폴백. `loadSiteInfo` noticeId 보존 (FE-M7)
- [x] A5 · DB 풀 error 핸들러·타임아웃 부재. `lib/db.ts` `pool.on('error')`+`connectionTimeoutMillis`+`statement_timeout` (DB-H2, 유일 데모 크래시 리스크)

### FE 확장 (도메인5 나머지 CONFIRMED)
- [x] A6 · 통합 신호등 가스/AED 램프 `useMemo([])` 동결. tick nonce를 deps에 (`SafetySignalBoard.tsx`, FE-M3)
- [x] A7 · 2초 vital 폴 요청순서 미보장(경보 플랩). 시퀀스 번호로 최신만 commit (`DemoDashboard.tsx`, FE-M4)
- [x] A8 · WeeklyReportBoard 제출 실패 조용히 성공처럼. `res.ok` 검사+오류 배너 (`WeeklyReportBoard.tsx`, FE-M6)
- [x] A9 · 캘린더 미디어 fetch 레이스 가드 없음. effect별 AbortController/from-to 일치 (`DemoDashboard.tsx`, FE-M8)
- [x] A10 · CCTV 타일 죽은 백엔드 1.2초 무한 재시도 + 숨김에도 3스트림. 지수 백오프+상한·visibility 중단 (`CctvQuadView.tsx`·`WidgetCarousel.tsx`, FE-M9)
- [x] A11 · RadarRealtime 일시 실패 시 동작 레이더를 오류화면 교체. `error && !data`일 때만 오류 UI (`RadarRealtime.tsx`, FE-L1a)
- [x] A12 · setState updater 내부 부수효과 StrictMode 중복 PUT. next를 밖에서 계산 (`DemoDashboard.tsx`, FE-L1b)
- [x] A13 · `.then(r=>r.json())` ok 미확인(오류 JSON 정상수용). 공통 `if(!r.ok) throw` (NewsPanel·KoshaAccidentTicker·KoshaAccidentCaseCard·HospitalPanel, FE-L1c)
- [x] A14 · SosAlertModal 임계 하드코딩(현재값 일치). `lib/severity` 재사용 (`SosAlertModal.tsx`, FE-L1d)

## 🟠 B. 안전 정체성 — 응급 무음 폐기 (packages·dashboard-web)
- [x] B1 · **C1 범위 밖 vital 하나가 SOS/낙상 무음 폐기**(최우선). 이벤트 플래그(`manualSos`/`fallDetected`) 샘플은 범위 밖 vital 필드 strip 후 수용, 배치 dropped 서버 경고. `packages/schemas/src/vital-stream.ts`·`app/api/mock/store.ts`·`app/api/mock/vital/route.ts` + `vital-stream.test.ts` 수정
- [x] B2 · sticky 활동값 → 안정 시 빈맥 팝업 억제. 활동 필드 신선도 TTL(90s) 만료 시 null→안정 임계 폴백 (`lib/severity.ts`·`store.ts`, 도메인1-H)
- [x] B3 · any-danger 이진 전이가 2번째 별개 응급 삼킴. 메트릭별 독립 전이 추적 (`store.ts`, 도메인1-M)

## 🟡 C. 조달 제출 게이트 (dashboard-web·db)

> **진행(2026-07-05)**: **C1~C6·C8·C9·C11~C18 완료**(무인증 쓰기 인증·수집 토큰 병행(soft)·AED fail-closed·XFF 신뢰홉·귀속 위조 차단·에러 400/500·상세 숨김·통합/doc_media DROP 가드·통합 FK 인덱스+SG_ID UNIQUE·출역 KST일). **🟢D 이관(리스크/설계)**: C7(외부 프록시 레이트리밋 — 다중 인스턴스 in-memory 한계·클라 광범위 변경) · C10(앱 JWT 폐기 — async DB 리보케이션 인프라 필요) · C19·C20·C21(vital_samples CHECK·FK·락 — **라이브 공유 DB 기존 데이터 위반/고아 시 ALTER 실패 → 가드 마이그레이션 필요**).

### 무인증 쓰기 인증
- [x] C1 · weekly-report/inputs GET+POST 세션 게이트 + 클라 토큰 동봉 (route.ts·ContractorSubmitForm, API-H1)
- [x] C2 · weekly-report/submit 세션 게이트 + 클라 토큰 (route.ts·WeeklyReportBoard, API-M2)
- [x] C3 · weekly-report/photos 인증 + image/* 허용목록 + 파일당 10MB·최대 20장 (route.ts, API-H3)
- [x] C4 · mock/vital POST 토큰 병행(soft) (route.ts·lib/ingest-auth, API-H2)
- [x] C5 · cctv/event POST 토큰 병행 + GET 세션 (route.ts, API-H4)
- [x] C6 · fall/imu-window 토큰 병행 + row 상한 2000 + error.message 숨김 (route.ts, API-M1)
- [ ] C7 · 외부 API 프록시 남용(키·쿼터). 경량 레이트리밋 (API-M3) → **🟢D 이관**(다중 인스턴스 in-memory 한계·클라 광범위 변경)

### 인증 강화
- [x] C8 · AED 폴백 시크릿 fail-closed. 키 미설정 시 서명·검증 거부 (`lib/aed-sign.ts`, AUTH-H1)
- [x] C9 · XFF 스푸핑 잠금 우회. XFF 최우측 신뢰 홉 IP (`clientIpFromXff`, admin/login·app-auth/login, AUTH-H2)
- [ ] C10 · 앱 JWT 폐기·비번변경 무효화 없음. `token_version` 클레임+DB 대조 (`lib/app-jwt.ts`, AUTH-M2) → **🟢D 이관**(async DB 리보케이션 인프라)
- [x] C11 · 귀속 위조. app-media JWT workerId/name 강제(폼 폴백은 익명 토큰만), admin/profile 사번 유일성 검사 409 (app-media·admin/profile·db. employeeIdTakenByOther, AUTH-M4)
- [x] C12 · 응답 내부 에러 상세 제거. 서버 로깅 후 일반 메시지 (mock/vital·cctv/event·fall/imu-window, API-L1)
- [x] C13 · 서버 실패 400 vs 500 구분. ZodError(400)/그외(500) 분리 (cctv/event·mock/vital, API-L2)
- [x] C14 · aed/inspections GET 점검자 이름 세션 게이트 + 클라 토큰 (route.ts·SiteSafetyTables, API-L3)

### DB/무결성
- [x] C15 · 통합 설치 스크립트 무방비 DROP TABLE 제거 + 데이터 존재 시 RAISE 가드 (`db/integrated/vitalguard_safeprocure_full.sql`, DB-C1)
- [x] C16 · doc_media 확정본 무조건 DROP 제거 + 데이터 보호 가드 (`db/doc_media/01_schema_doc_media.sql`, DB-C2)
- [x] C17 · 출역 집계 UTC일→KST일. `ts::timestamptz AT TIME ZONE 'Asia/Seoul'` WHERE·GROUP BY (`lib/db.ts` auditWorkerDays, DB-H4)
- [x] C18 · 통합 스키마 FK 인덱스 6 + 회사단위 SG_ID UNIQUE (`db/integrated/...`, DB-M9)
- [ ] C19 · vital_samples SpO2/HR CHECK 미러링(심층방어) (`lib/db.ts`, DB-M4) → **🟢D 이관**(라이브 DB ALTER 가드 마이그레이션)
- [ ] C20 · fall_labels.sample_id FK + initSchema calendar_media_comment FK 누락 (`lib/db.ts`, DB-M2·M3) → **🟢D 이관**(고아 행 ALTER 실패 리스크)
- [ ] C21 · upsertReportInputs 읽기-수정-쓰기 트랜잭션/락 (`lib/db.ts`, DB-M5) → **🟢D 이관**(트랜잭션 래핑, 데모 영향 저)

## 🟢 D. 상용화 로드맵 (일부 즉시·일부 문서화)

> **🟡C 이관분 포함**: C7(프록시 레이트리밋)·C10(앱 JWT 리보케이션)·C19·C20·C21(라이브 DB CHECK/FK/락 가드 마이그레이션) — 위 C 섹션 참조.

- [ ] D1 · 보안 헤더 HSTS·X-Frame-Options·X-Content-Type-Options·Referrer-Policy + CSP Report-Only (`next.config.ts`/middleware, FE 보안)
- [ ] D2 · Google id_token aud/iss/exp·email_verified 검증(방어심층) (`lib/google-oauth.ts`, AUTH-L2)
- [ ] D3 · admin ID 타이밍/단락 오라클. 두 비교 무조건+고정길이 해시 (`lib/admin-auth.ts`, AUTH-L1)
- [ ] D4 · 안전 핵심경로 테스트 보강(store 수신 게이트·C1 회귀)
- [ ] D5 (문서화) · TEXT→timestamptz 이관 계획 (DB-M1·L)
- [ ] D6 (문서화) · SERIAL→BIGSERIAL 이관 (DB-L)
- [ ] D7 (문서화) · 세션 httpOnly 쿠키+CSRF (AUTH-M1)
- [ ] D8 (문서화) · 분석기 배선 시 임계 재정의(detectFall·sustain·hyperthermia·hr_abnormal·workerZone) — 스킵 결정
- [ ] D9 (문서화) · 손목→심부 오프셋 소스별/ambient·HR 결합 (도메인1-H PARTIAL)
- [ ] D10 (제외) · ATS 평문→https (모바일, 범위 밖)

## 부록 — 손대지 않음 (재검증 REFUTED/ALREADY-FIXED)
GET PII 이중게이트(ALREADY-FIXED) · mediaUrl open-redirect(REFUTED) · doc_media verdict COALESCE·no_metadata·stale-hash(런타임 미참조 REFUTED) · SOS 타임아웃/재시도(존재, 반증) · 이메일 인증 死코드(승인제로 무력, 저).
