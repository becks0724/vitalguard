# 폰 GPS 수집 트랙 — 체크리스트

**목표.** 신규 앱(`vitalguard_app`)의 **iOS 폰**이 위치를 수집해 관제로 올린다. 방식은 **region monitoring(경계 감시) + 근무 중 coarse 추적**. 관제구역 반경은 **최소 50m · 최대 100m**.

**배경.** 08-01 이후 GPS 수신 0건이다. 신규 앱에 위치 코드가 한 줄도 없고 권한 문구·백그라운드 모드도 없다. 서버 스키마·DB 컬럼·지오펜스·동선·CSV 내보내기는 전부 살아 있으므로 **생산자만 복구**하면 된다. 근거는 `context-notes.md` G-01~G-09.

**범위 밖.** 워치 GPS(배터리 대가가 크고 watchOS 는 region monitoring 이 없다) · 폰·워치 좌표 융합(공통모드 오차라 평균해도 안 준다) · 근무 시간대(time-of-day) 개념 신설 · 관제 화면 신규 UI.

---

## Phase 1 — 공유 계약(반경 정책)

- [x] `apps/dashboard-web/lib/site-radius.ts` 신설 — `SITE_RADIUS_MIN_M=50` · `SITE_RADIUS_MAX_M=100` · `clampSiteRadiusM()`
- [x] `DemoDashboard.tsx` 의 `SITE_CIRCLE_RADIUS_M` 을 그 상수에서 가져오게 교체(리터럴 100 제거)
- [x] 단위 테스트 — 클램프 하한·상한·비유한 입력

## Phase 2 — 서버가 정확도를 버리지 않게

- [x] `packages/schemas/src/vital-stream.ts` 에 `locationAccuracyMeters` 추가(0~10000 · optional)
- [x] `apps/dashboard-web/lib/db.ts` — `location_accuracy_m` 컬럼 + `ALTER TABLE … IF NOT EXISTS` + insert 매핑 + 행 타입
- [x] 단위 테스트 — 스키마 통과·범위 밖 strip

## Phase 3 — iOS 위치 수집

- [x] `ios/Runner/LocationProvider.swift` 신설
  - [x] `desiredAccuracy = kCLLocationAccuracyHundredMeters` · `pausesLocationUpdatesAutomatically = true`
  - [x] `distanceFilter` = 관제구역 반경(50~100m)
  - [x] `CLCircularRegion` 경계 감시(`notifyOnExit`·`notifyOnEntry`)
  - [x] 구역 중심 = **그날 첫 유효 fix**(UserDefaults 영속 · 날짜 바뀌면 재앵커)
  - [x] 근무 중 판정 = **워치 생체가 들어오는 동안**(앱에 근무시간 개념이 없다)
  - [x] 정확도 게이트 — `horizontalAccuracy` 가 반경보다 나쁘면 채택하지 않는다
- [x] `ios/Runner/Info.plist` — `NSLocationWhenInUse…` · `NSLocationAlwaysAndWhenInUse…` · `UIBackgroundModes += location`
- [x] `ios/Runner/VitalPipeline.swift` — 페이로드에 `latitude`·`longitude`·`locationAccuracyMeters`·`locationTimestamp` 주입
- [x] `ios/Runner/AppDelegate.swift` — 기동 시 `LocationProvider.shared.start()`
- [x] Xcode 프로젝트에 새 파일 등록(`project.pbxproj`)

## Phase 4 — 회귀 가드

- [x] 반경 정책 가드 — Swift 상수와 TS 상수가 갈리지 않는다
- [x] 저전력 설정 가드 — `Best`/`BestForNavigation` 승격 금지 · `pauses…` 유지 · region monitoring 유지
- [x] 정확도 계약 가드 — 스키마 필드·DB 컬럼·앱 전송 3자가 함께 산다
- [x] 근무 중 게이트 가드 — 생체 없이 상시 추적으로 되돌아가지 않는다
- [x] 음성 대조 — 각 결함을 되돌리면 그 가드만 실패하는지 확인

## Phase 5 — 검증

- [x] `pnpm --filter @safetymonitor/schemas build`
- [x] typecheck · lint · test 3종
- [x] `xcodebuild` Runner 무서명 빌드
- [ ] **실기기 확인(사용자)** — 권한 시트 → 좌표 수신 → 관제 지도 표시
- [ ] **배터리 실측(사용자)** — iOS 설정 > 배터리에서 앱별 소모

---

## 남은 판단

- [ ] 구역 중심을 서버(`/api/monitor/site-coord`)에서 받을지 — 지금은 앱이 그날 첫 fix 로 앵커한다
- [ ] 관제 화면에 좌표 나이 게이트를 붙일지 — 심박에 한 것과 같은 처방(별도 트랙)
