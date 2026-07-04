# VitAlGuard 통합 감사 대응 — 재검증 리포트 (2026-07-04)

> 외부 통합 점검 리포트(`VitAlGuard_통합점검리포트_2026-07-04.pdf`, 치명6·높음19·중간34·낮음21 = 80건)를 **실제 코드로 재검증**하고 해결 방안·우선순위를 정리한 문서. 감사는 read-only였고 본 재검증도 **코드 변경 0**(분석·계획).

- **소스 기준** `vitalguard-jodalcheong @ b9344d5` (재검증 시점 라이브 = Cloud Run `vitalguard-dashboard-00065-svc`)
- **방법** 감사 스스로 "권고 적용 전 재확인 권장"·"분석기 미배선" 전제를 명시 → 맹신 없이 6도메인 전부 cited `file:line`을 Read/Grep으로 확인, `CONFIRMED / PARTIAL / REFUTED / ALREADY-FIXED / UNWIRED-LOW` 로 재판정. 각 결함에 **데모위험(2026-07-07 발표가 실제로 깨지는가)**과 **조달·상용화 blocker**를 분리.
- **성격** 발표용 프로토타입이자 상용화·조달 제출 목표. `CLAUDE.md`에 의도적 프로토타입 스코프 명시(in-memory→무상태 JWT 전환 완료, 캠퍼스 공유 DB, 세션마다 회전하는 임시 터널 등).

---

## 총평 — 재검증이 바꾼 3가지 (맹신 금지 지점)

1. **분석기 미배선 = 死코드 확정.** `detectFall`·`detectHeartRateAbnormal`·`detectSpo2Low`·`detectHyperthermia`·`buildSosEvent`는 정의(`packages/analyzers/src/*.ts`)+단위테스트에만 존재하고 앱/서버 **호출처 0건**. 실제 경보는 ① 워치/폰 이벤트 플래그(`manualSos`/`fallDetected`)→`app/api/mock/store.ts` `addSample`→`recordAlert`, ② `app/lib/severity.ts` 즉시값(`heartRateStatus`/`spo2Status`/`coreTempStatus`)으로만 동작. → 감사의 **C2(detectFall)·sustain·마지막샘플·손목온도 오프셋·hr_abnormal 불일치·workerZone**은 현 실효 없음(상용화 시 분석기를 배선하면 재발).
2. **DB 대부분 런타임 미배선.** `lib/db.ts`는 인라인 `CREATE TABLE IF NOT EXISTS`(`ensureSchema`/`initSchema`)만 실행하고 `doc_media` 스키마는 **생성조차 안 함**, 90/180일 보존 `DELETE`는 수동 SQL/pg_cron 전용. → **치명 DROP TABLE·verdict COALESCE·no_metadata·stale-hash**는 데모위험 0(운영자 수동 재실행 시에만 조달 리스크).
3. **일부는 이미 방어됨.** GET PII = `exposePii`(env AND 유효세션) 이중게이트 + `redactPii`(**ALREADY-FIXED**), mediaUrl open-redirect = 다운로드·업로드 모두 인증(**REFUTED**), "SOS 타임아웃·재시도 부재" = `_sendOne` 4초 타임아웃 + `_sendSos` 3회 재시도 존재(**반증**).

**결론:** 발표(07-07) 데모를 실제로 위협하는 건 소수이고, 나머지는 **조달 제출 게이트**와 **상용화 로드맵**이다.

---

## 우선순위 로드맵

### 🔴 A. 발표 데모 안정성 (리허설 전, 전부 외과적)
| 결함 | 도메인 | 데모위험 | 해결(노력) |
|---|---|---|---|
| GPS 지터 → 특보영상 재생 리셋 | FE-H1 | 조건부 high | `fieldCoords` `toFixed(3)` 양자화 (S·1곳) |
| VitalHistoryPanel 메트릭전환 오표시(78bpm→"78℃ 위험") | FE-H2 | med | effect·catch에 `setData(null)` (S·2줄) |
| SOS 새로고침 재발화 | FE-M5 | med | ack 시각 localStorage 영속 (M) |
| noticeId 드롭 → 안전관리비 엉뚱 현장 | FE-M7 | med | `loadSiteInfo` noticeId 보존 (S·1줄) |
| DB 풀 error 핸들러·타임아웃 부재 | DB-H2 | low(공유DB 이벤트 시 크래시) | `pool.on('error')`+timeouts (S·5줄) |

### 🟠 B. 안전 정체성 — 응급 무음 폐기 (데모엔 안 보이나 최중요)
- **C1 · 범위 밖 vital 하나가 SOS/낙상 무음 폐기** (아래 상세) — 유일하게 배선된 안전경로의 무음 폐기. **최우선.**
- 모바일(상용화 24/7): 폰 재부팅 재시작(C3), 폰 백로그 영속화, SOS 우선 채널, 워치 기본 URL 고정 HTTPS, device-motion no-op 경고.

### 🟡 C. 조달 제출 게이트 (제출 전 필수, 데모 무관)
- **무인증 쓰기**: `weekly-report/inputs`·`submit`·`photos`, `mock/vital`·`cctv/event` POST(토큰 병행), 외부 프록시.
- **인증**: AED 폴백 시크릿 fail-closed, XFF 신뢰 홉 IP, 앱 JWT 버전 클레임, 귀속 위조(app-media JWT workerId 강제).
- **DB/무결성**: 통합·doc_media 스크립트 DROP 제거/가드, 통합 FK 인덱스+SG_ID UNIQUE, 출역 UTC/KST 일 통일, doc_media verdict(운영 진입 시).

### 🟢 D. 상용화 로드맵
TEXT→`timestamptz`, SERIAL→`BIGSERIAL`, 세션 httpOnly 쿠키, 분석기 배선 시 임계 재정의, 안전 핵심경로 테스트, ATS 평문→https.

---

## 도메인 1 · 안전 직결 (생체·낙상 응급 판정)

> C1과 배선 여부는 직접 확인. 나머지 분석기 계열은 "호출처 0건" 확정에 근거해 UNWIRED-LOW 로 판정.

| ID | 결함 | 판정 | 데모 | blocker | 노력 |
|---|---|---|---|---|---|
| **C1** | 범위 밖 vital 하나가 SOS/낙상 무음 폐기 | **CONFIRMED(배선)** | low | **Y(안전)** | S~M |
| C2 | detectFall 단위 불일치(절대 미발화) | UNWIRED-LOW | none | 배선 시 | M |
| H | sticky 활동값 → 안정 시 빈맥 팝업 억제 | CONFIRMED(severity 배선) | low | Y | S |
| H | 손목→심부 +0.5℃ 고정 오프셋 | PARTIAL(coreTempStatus 배선/hyperthermia 미배선) | low | 배선 시 | M |
| M | SpO2/HR 마지막 샘플만 검사 | UNWIRED-LOW | none | 배선 시 | S |
| M | sustain 로직 FP/FN | UNWIRED-LOW | none | 배선 시 | S |
| M | any-danger 이진 전이가 2번째 응급 삼킴 | PLAUSIBLE(store 배선) | low | Y | S |
| M | workerZoneMap 미시딩 → fusion confirmed 미도달 | CONFIRMED(UNWIRED) | none | 배선 시 | M |
| M | hr_abnormal 'warning' vs severity 'danger' | UNWIRED-LOW | none | 배선 시 | S |
| L | optimize_thresholds.py 절단 still_sec | CONFIRMED(ML 트랙) | none | N | S |
| L | CCTV 합성 폴백 20초마다 가짜 'fall' | CONFIRMED(poller 미배선) | none | N | S |

**C1 상세(최고 가치 발견 · 직접 확인).** `packages/schemas/src/vital-stream.ts`는 `heartRate.min(20).max(250)`·`spo2.min(50).max(100)`·`accelMagnitudeG.max(20)`. `app/api/mock/store.ts:71` `const parsed = VitalSampleSchema.parse(normalized)`는 `.parse()`(throw)이고 `recordAlert`(99~108행, `manualSos`/`fallDetected` 분기)보다 **먼저** 실행된다. 워치는 배치 전송이고 `app/api/mock/vital/route.ts:55~80` 배치 경로는 parse 실패를 `dropped`로 세고 `ok:true` 반환. → **심정지(HR≈15)·저산소(SpO₂ 47, 모션 아티팩트)·강한 낙상충격(>20G)처럼 이 시스템이 잡아야 할 바로 그 응급의 vital이 범위를 벗어나면, SOS/낙상 플래그가 실린 샘플 전체가 조용히 폐기**된다(경보 0건). 데모는 정상값이라 미노출이나 현장 실사용엔 치명적.
- **해결(S~M):** 이벤트 플래그(`manualSos`/`fallDetected`)가 있는 샘플은 범위 밖 vital을 **필드 단위 strip/clamp 후 수용**(전체 거부 금지). 배치 `dropped`는 서버 경고 로그. 이 폐기를 정상으로 고정한 `vital-stream.test.ts`도 함께 수정.

---

## 도메인 2 · API (무인증 쓰기·데이터 노출)

| ID | 결함 | 판정 | 데모 | blocker | 노력 |
|---|---|---|---|---|---|
| H1 | weekly-report/inputs 무인증 읽기+덮어쓰기 | **CONFIRMED** | none | **Y** | S |
| H2 | mock/vital 무인증 POST 생체/SOS 주입 | **CONFIRMED**(GET PII=ALREADY-FIXED) | none | **Y** | M |
| H3 | weekly-report/photos 무인증 파일 디스크 쓰기 | **CONFIRMED** | none | **Y** | S |
| H4 | cctv/event 무인증 이벤트 주입 | **PARTIAL**(실근로자 경보는 zone 미배선) | none | Y | M |
| M1 | fall/imu-window 무인증·무제한 insert | CONFIRMED(UNWIRED-LOW) | none | N | S |
| M2 | weekly-report/submit 무인증 감사기록 | **CONFIRMED** | none | **Y** | S |
| M3 | 외부 API 프록시 무인증(키·쿼터) | CONFIRMED | none | 부분 Y | M |
| M4 | calendar/media 페이지네이션 없음 | CONFIRMED(인증됨·성능) | low | N | M |
| L1 | 응답에 내부 에러 상세 노출 | CONFIRMED | none | 부분 | S |
| L2 | 서버 실패에 400(ZodError 미구분) | CONFIRMED | none | N | S |
| L3 | aed/inspections GET 점검자 이름 | PARTIAL(경미) | none | N | S |
| L4 | mediaUrl open-redirect | **REFUTED** | none | N | — |

**핵심.** ① `weekly-report/inputs`·`submit`(H1·M2)이 무인증이라 안전관리비 4-way 교차검증의 청구·BNO·출역·감사기록을 공개 URL로 위조/생성 가능 → **제품 핵심 무력화**. `getSession`/`verifyBasicAuth` 게이트만 얹으면 해결(S). ② `mock/vital`·`cctv/event`·`photos`(H2·H3·H4)는 가짜 생체/SOS·zone hazard 주입·무제한 파일 쓰기. `app-media` 패턴처럼 `APP_UPLOAD_TOKEN`/JWT 병행 수용이 정공(H4의 "실 근로자 낙상 경보"는 `setWorkerZone` 미배선이라 현재 UNWIRED, 배선 시 즉시 승격). ③ `mediaUrl open-redirect`(L4)는 다운로드(`verifyBasicAuth`)·업로드(토큰/세션) 모두 인증이라 **REFUTED**, GET PII도 이중게이트+redaction으로 **ALREADY-FIXED** — 이번 우선순위에서 제외.

---

## 도메인 3 · 인증·권한·시크릿

| ID | 결함 | 판정 | 데모 | blocker | 노력 |
|---|---|---|---|---|---|
| H1 | AED 서명용 하드코딩 폴백 시크릿 | **CONFIRMED** | low | **Y** | S |
| H2 | 스푸핑 가능 XFF 로 로그인 잠금 우회 | **CONFIRMED** | low | **Y** | M |
| M1 | 세션 JWT sessionStorage 저장(XSS) | CONFIRMED | low | N(권고) | M |
| M2 | 30일 앱 JWT 폐기·비번변경 무효화 없음 | **CONFIRMED** | low | **Y** | M |
| M3 | 이메일 인증 가입 시 미강제(死코드) | CONFIRMED(승인제로 무력) | none | N | S |
| M4 | 자기수정 employee_id/클라 workerId(귀속 위조) | **CONFIRMED** | low | **Y** | S |
| L1 | 타이밍/단락 오라클로 admin ID 노출 | CONFIRMED | none | N | S |
| L2 | Google id_token aud/iss/exp 미검증 | CONFIRMED(수용 가능) | none | N | S |

**핵심.** 조달 blocker = **H1**(`lib/aed-sign.ts:5` `SECRET = env ?? "safetymonitor-dev-aed-inspect"` → env 미설정 시 소스 상수로 폴백, 위조 AED 점검 POST 가능 → `admin-auth`/`app-jwt`처럼 **fail-closed** 전환)·**H2**(잠금 키 `ip:id`의 ip가 클라 제공 XFF 최좌측 → Cloud Run은 신뢰 프록시가 XFF 최우측에 실 IP append하므로 **최우측 홉 사용**)·**M2**(앱 JWT에 `jti`/버전 없어 해고/정지/비번변경이 발급 토큰에 무효과 → `token_version` 클레임+DB 대조)·**M4**(app-media가 폼 `workerId`를 JWT보다 우선 → **JWT 클레임 강제**). **데모위험은 전반 낮음**(라이브 env 시크릿 설정·승인제 게이트가 M3 무력화·scrypt로 브루트포스 느림). **감사가 인정한 "양호" 4항목(scrypt N=16384·JWT 서버측 HMAC 재계산으로 alg:none 불가·OAuth state httpOnly 쿠키 검증·owner 라우트 서버측 강제)은 코드상 실제 유지 확인** — 반박 불필요.

---

## 도메인 4 · DB·무결성

| ID | 결함 | 판정 | 배선 | 데모 | blocker |
|---|---|---|---|---|---|
| DB-C1 | 통합 설치 스크립트 무방비 DROP TABLE | CONFIRMED(수동실행 한정) | ✗ 수동 | none | **Y(조달)** |
| DB-C2 | doc_media 확정본 무조건 DROP | CONFIRMED(수동실행 한정) | ✗ 수동 | none | **Y(조달)** |
| H1 | 무결성 verdict 해시 없으면 'verified' | **REFUTED** | ✗ doc_media 전용 | none | N |
| **H2** | **DB 풀 error 핸들러·타임아웃 없음** | **CONFIRMED** | ✓ 전 DB 경로 | low~med | **Y** |
| H3 | 90일 보존 삭제 시간대 불일치 | UNWIRED-LOW | ✗ 수동/cron | none | N |
| **H4** | **출역 집계 UTC일 vs KST일 어긋남** | **CONFIRMED** | ✓ 보고서 API | low | **Y** |
| M1 | 전 타임스탬프 TEXT + 사전식 비교 | CONFIRMED(설계·무해) | ✓ | none | N |
| M2 | fall_labels.sample_id FK 없음 | CONFIRMED | ✓ | none | N |
| M3 | initSchema calendar_media_comment FK 누락 | CONFIRMED | ✓ | none | N |
| M4 | vital_samples SpO2/HR CHECK 없음 | PARTIAL(Zod가 방어) | ✓ 앱레이어 | none | N |
| M5 | upsertReportInputs 락 없음 | CONFIRMED | ✓ | none | N |
| M6 | no_metadata 문서 suspect 오분류 | **REFUTED** | ✗ doc_media 뷰 | none | N |
| M7 | 해시 NULL 리셋 후 stale origin_match | **REFUTED** | ✗ doc_media 트리거 | none | N |
| M8 | 낙상 라벨 도메인 3분열 UNION | CONFIRMED | ✓(fall_labels) | none | N |
| **M9** | 통합 스키마 무인덱스 FK6·SG_ID UNIQUE 부재 | CONFIRMED | ✗ 통합 미배선 | none | **Y(조달)** |
| L | SERIAL(int32) PK·int8 parseInt·순서 | CONFIRMED(경미) | ✓ | none | N |

**핵심.** DROP·verdict·no_metadata·stale-hash는 `doc_media` 스키마가 런타임에 **생성조차 안 되고**(REFUTED/미배선), 보존 DELETE는 수동/pg_cron 전용이라 **데모위험 0**·조달(수동 재실행) 리스크만. 실 배선 확정은 ① **H2**(`lib/db.ts:97-106` `new Pool({max:8})`에 `pool.on('error')`·`connectionTimeoutMillis`·`statement_timeout` 전무 → 공유 DB 유휴 커넥션 error가 unhandled로 프로세스 크래시 가능, 5줄 수정 — 유일한 데모 안정성 리스크)·② **H4**(`auditWorkerDays`의 `substr(ts,1,10)`=UTC일 vs `ymdInKst`=KST일 → KST 00:00~09:00 샘플이 전날 버킷으로 빠져 안전관리비 교차검증 어긋남)·③ **M9**(통합 스키마 조달 배포 전 FK 인덱스+회사단위 SG_ID UNIQUE 필수). **SpO₂ CHECK 부재(M4)는 Zod `min(50).max(100)`이 `addSample`에서 강제라 런타임 우회 불가(PARTIAL)** — 심층방어로 DB CHECK 권장하나 우선순위 낮음.

---

## 도메인 5 · 프런트엔드 안정성 (12/12 CONFIRMED)

| ID | 결함 | 판정 | 데모 | blocker | 노력 |
|---|---|---|---|---|---|
| **H1** | GPS 지터 → 좌표-의존 패널 fetch 폭주(특보영상 재생 리셋) | CONFIRMED | med(조건부 high) | **Y** | M |
| **H2** | VitalHistoryPanel 메트릭전환/오류 시 이전 데이터 오표시 | CONFIRMED | med | **Y** | S |
| M3 | 통합 신호등 가스/AED 램프 useMemo[] 동결 | CONFIRMED | low | Y | S |
| M4 | 2초 vital 폴 요청순서 보장 없음(경보 플랩) | CONFIRMED | low | Y | S |
| M5 | SOS/낙상 상태 휘발성 → 새로고침 재발화 | CONFIRMED | med | Y | M |
| M6 | WeeklyReportBoard 제출 실패 조용히 성공처럼 | CONFIRMED | low | Y | S |
| M7 | noticeId 드롭 → 안전관리비 엉뚱 현장 | CONFIRMED | med | Y | S |
| M8 | 캘린더 미디어 fetch 레이스 가드 없음 | CONFIRMED | low | N | S |
| M9 | CCTV 타일 죽은 백엔드 1.2초 무한 재시도 | CONFIRMED | low | Y | M |
| L1a | RadarRealtime 일시 실패 오류화면 교체 | CONFIRMED | low | N | S |
| L1b | setState updater 부수효과 StrictMode 중복 PUT | CONFIRMED | none(dev) | N | S |
| L1c | r.json() ok 미확인(4곳) | CONFIRMED | low | N | S |
| L1d | SosAlertModal 임계 하드코딩(현재 값 일치) | CONFIRMED(유지보수) | none | N | S |

**핵심.** 발표에서 실제로 드러날 수 있는 것 = **H1**(실폰+특보 발효 시 2초마다 `WarningVideoPanel`이 `setPlaying(null)`으로 재생 끊김 → `fieldCoords`를 `toFixed(3)`≈110m 양자화하면 5개 패널 전부 해소, 1곳)·**H2**(차트 메트릭 전환 순단 시 옛 78bpm에 체온 라벨·임계선 덧그려 "78℃ 위험" 오도 → effect 시작·catch에 `setData(null)`, 2줄)·**M5**(새로고침 시 확인한 SOS 재팝업 → ack localStorage 영속)·**M7**(검증탭 시연 시 잘못된 현장 매칭 → `loadSiteInfo` noticeId 보존 1줄). 나머지 M/L은 백그라운드 리소스·유지보수.

---

## 도메인 6 · 모바일·워치 수집 신뢰성

| ID | 결함 | 판정 | 데모 | blocker | 노력 |
|---|---|---|---|---|---|
| C3 | 폰 앱 OS 종료·재부팅 후 자동 재시작 부재 | **CONFIRMED** | low | **Y(상용화)** | M |
| C4 | 재진입 publishVital 레이스가 백로그 파괴 | PARTIAL(좁은 조건) | none | 중 | M |
| H | 폰 백로그 메모리 전용(UI는 영속 약속) | **CONFIRMED** | low | Y | M |
| H | SOS 우선 전송 아님(대기열 뒤 지연) | PARTIAL(타임아웃·재시도는 존재=반증) | none | 중 | S |
| H | 워치 기본 URL 하드코딩 임시 터널+수동 URL 덮음 | **CONFIRMED** | low | Y | S |
| M | 워치 JSON 직렬화 실패 시 배치 무음 드롭 | PARTIAL(이론적·NaN 원천 없음) | none | N | S |
| M | 폰 피부온 30일 lookback maxAge 없음(false-OK) | **CONFIRMED** | low | Y | S |
| M | 워치 device motion 불가/선점 시 낙상감지 무음 no-op | **CONFIRMED** | low | Y | M |
| M | HealthKit "authorized"=프롬프트일 뿐(무데이터 워치독 없음) | CONFIRMED | low | Y | M |
| M | 생체+보호자 PII 평문 전송 허용 | CONFIRMED(ATS) | none | Y(상용화) | S |
| L | resume 재개검사 死코드 / 백로그 무음 drop / 테스트 0 | CONFIRMED(경미) | none | N | S~M |

**핵심.** 감사의 신뢰성 서사가 상당 부분 표시상이나, **발표 데모는 폰 재부팅 안 하고 실기기 deviceMotion 가용·https 터널 사용이라 다수 결함이 데모를 안 깬다**(데모위험 하향). 상용화(현장 24/7) 관점 실효는 유지 — 폰 재시작(C3, Android `BOOT_COMPLETED`+WorkManager / iOS는 재부팅 자동재시작 불가라 "1회 실행" 운영절차)·백로그 영속화·워치 URL을 **Cloud Run 고정 HTTPS로 교체**(임시 터널 하드코딩 근절). "SOS 타임아웃·재시도 부재"는 `_sendOne` 4초 타임아웃+`_sendSos` 3회 재시도로 **반증**(실효는 "오프라인 대량 누적 시 SOS 지연"으로 축소).

---

## 부록 — 감사에서 하향·반증한 것 (과잉대응 방지)

| 항목 | 감사 등급 | 재검증 | 사유 |
|---|---|---|---|
| GET /api/mock/vital PII 노출 | High | **ALREADY-FIXED** | `exposePii`(env AND 세션) 이중게이트+`redactPii` |
| mediaUrl open-redirect | Low | **REFUTED** | download-url·calendar POST 모두 인증 |
| DB verdict COALESCE(...,true) | High | **REFUTED** | doc_media 트리거, 런타임 미참조 |
| no_metadata suspect / stale origin_match | Medium | **REFUTED** | doc_media 뷰·트리거, 런타임 미참조 |
| SOS 타임아웃·재시도 부재 | High(모바일) | **반증** | 4초 타임아웃+3회 재시도 존재 |
| detectFall·sustain·마지막샘플·hyperthermia·hr_abnormal·workerZone | 치명~중간 | **UNWIRED-LOW** | 분석기 호출처 0(死코드) |
| 90일 보존 삭제·fall/imu-window | 높음~중간 | **UNWIRED-LOW** | 수동/cron·미연결 임시 버퍼 |
| vital_samples SpO2/HR CHECK 없음 | 중간 | **PARTIAL** | Zod가 앱레이어에서 강제 |
| C4 재진입 publishVital 레이스 | 치명 | **PARTIAL** | 동시 in-flight 둘 다 실패 좁은 조건 |
| 워치 JSON 직렬화 무음 드롭 | 중간 | **PARTIAL** | payload 정수 라운딩/nil 가드라 NaN 원천 없음 |
| SosAlertModal 임계 하드코딩 | 낮음 | **CONFIRMED(무영향)** | 현재 lib/severity와 값 일치(유지보수 리스크만) |

**감사가 인정한 "양호"(유지 확인):** scrypt 해싱, JWT 서버측 HMAC 재계산(alg:none 불가), OAuth state 검증, owner 라우트 서버측 강제, SQL 인젝션 없음(전면 파라미터 바인딩), 프런트 메모리 누수 없음(cleanup 완비), 외부 API `AbortSignal.timeout`, `db/safeprocure/01_rate_migration` 모범 마이그레이션.

---

## 다음 단계

작업은 **분석·계획만**이며 코드는 미변경(라이브 `00065-svc` 무변경). 착수 순서 추천 = **🔴A(발표 데모 안정성) → 🟠B의 C1(안전 정체성) → 🟡C(조달 게이트)**. 각 항목은 별도 커밋·검증(tsc/lint/test)·`/deploy`로 진행.

> 재검증 방법론·per-도메인 근거 상세는 `harness/context-notes.md`(로컬), 실행 로그는 `harness/5-observability/run-log.md`(로컬), 요약은 `CLAUDE.md` ★ 2026-07-04 항목.
