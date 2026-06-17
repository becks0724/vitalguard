# Audit Fix Tracker — Tier 0 (보안·안전 핵심)

출처: [docs/audit-report-20260612.pdf](audit-report-20260612.pdf) (60건). 범위: **Tier 0**. 규칙: 각 수정 tsc/test/analyze/xcodebuild 검증 · 의미 단위 커밋 · 자동 푸시 안 함 · 수정 영역 최소.

## 체크리스트
- [x] **#3 CCTV 오픈 프록시** — `app/ai-cctv/[...path]/route.ts` 경로 allowlist(`^cctv/(stream|stats|connection)\d*$`) + 트래버설 차단. ✅ tsc 0
- [x] **#2 AED 점검 무인증** — `lib/aed-sign.ts`(HMAC) + 라우트 GET(admin 발급)/POST(서명 검증 401) + 점검 페이지 sig 전달 + NFC 모달 서명 fetch + `.env.example`. ✅ tsc 0 · 테스트 20/20 · 서명 라운드트립(위조 거부) · ⏳ rate limit 은 Tier 2 로 이연
- [x] **#1 FallDetector 데이터 레이스** — `stop()` 의 `resetEvent()` 를 모션 콜백과 같은 직렬 큐로 보내 직렬화. ✅ xcodebuild watchOS Sim BUILD SUCCEEDED (실기기 런타임은 사용자 재빌드 필요)
- [x] **#4 vital alert 활동 게이트** — 알림 전이(recordAlert "vital")를 안정 임계로(활동 게이트 미적용) → false-negative 0. 카드·신호등 표시 게이트는 유지(세션33 "감사는 안정 기준" 정합). ✅ tsc 0 · 테스트 20/20
- [x] 최종 — dashboard `tsc --noEmit` EXIT=0 + `pnpm test` 20/20 + 워치 BUILD SUCCEEDED ✅

## 결정 로그
- **#4** = 세션33 의도 기능(작업 중 심박 활동 게이트). 수정(전이 판정을 안정 임계로 보수화)은 그 설계를 일부 되돌림 → **착수 전 사용자 확인**.
- **#2** = NFC 현장 점검은 무로그인 의도(현장 관리자 여러 명 태깅). UX 보존 위해 **admin(대시보드 로그인 상태)이 서명된 태그 URL 발급(mint, 인증 필요)** → 태그 보유자는 제출 가능, 무서명 인터넷 POST는 거부. 비밀은 `AED_INSPECT_SECRET`(env, 미설정 시 dev fallback).
- **#1** 등 디바이스 코드(Swift/Flutter)는 컴파일·시뮬 검증까지. **실기기 동작 확인은 사용자 재빌드·재설치 필요**.

## Tier 1 (24/7 안정성·false-OK) — 완료
방식: workflow(파일그룹별 1 에이전트, 겹침 0) → 상위 tsc/test 일괄 검증. 전부 dashboard TS, 디바이스·설계결정 없음.
- [x] **#5·#19·#20·#21 fetch 타임아웃** — kma/typhoon/radar/youtube fetch 에 `AbortSignal.timeout(6~8s)` + 기존 목업/502 폴백 보존
- [x] **#22 youtube allSettled** — id 모드 `Promise.all`→`allSettled`(채널별 실패 격리)
- [x] **#16 배열 POST 격리** — vital/route 항목별 try/catch(ZodError만 dropped, 나머지 계속). 단일 POST 불변
- [x] **#28 NaN 체온 가드** — SosAlertModal core 비유한수 → `idle`(녹색 false-OK 차단)
- [x] **#29 severity 가드** — SafetySignalBoard `weather.severity in STYLE` 폴백
- [x] **#30 빈배열 Infinity 가드** — WeatherRuleModal HourlyTempSection `length===0`→null
- [x] **#8 핵심 경로 테스트** — `vitalDanger` export + store.test 5건(안정 임계·reserved null·스키마 throw)
- [x] 검증 — **tsc EXIT=0 · pnpm test 24/24(+4)**
- 잔여 메모: #28 buildSmsBody 의 NaN(audit 범위 밖, 별도 권장) · #2 rate limit(Tier 2).

## Tier 2 (상용화 위생·최적화) — 완료
방식: workflow 2회(파일그룹별, 겹침 0) — 1차 G1~G3(세션한도로 중단·커밋) + 2차 G4~G14(1am 리셋 후 재개). 검증 일괄.
- [x] G1 라우트·스크립트 #12·#17·#18·#34 · G2 관리자 인증 #13·#14·#36·#15 · G3 DemoDashboard #7·#23·#24·#37·#38
- [x] G4 WeatherStrip #26·#27 · G5 CctvQuadView #25·#49 · G6 SiteSafetyTables #39·#40·#48
- [x] G7 메모이즈·누수 #41·#42·#43 · G8 store 핫경로 #35
- [x] G9 분석기 sustain+테스트 #32·#33·#9·#10·#44 · G10 스키마·stress 테스트 #11·#45
- [x] G11 .env·heroui dead #46·#47·#50 · G12 문서 #56·#57·#58·#59·#60
- [x] G13 워치 flush 타이머+dead #6·#53·#54·#55 · G14 폰 initState+dead #31·#52
- [x] 검증 — analyzers 재빌드+28/28 · schemas 13/13 · dashboard tsc 0+24/24 · flutter analyze 0 · watchOS BUILD SUCCEEDED
- 제외: #51(connectMqtt 의도 보존). 디바이스(#6·#31)는 컴파일 검증까지 — 실기기 동작은 재빌드 필요.

**→ audit 60건 전부 처리 완료(수정 59 + 의도보존 1).**
