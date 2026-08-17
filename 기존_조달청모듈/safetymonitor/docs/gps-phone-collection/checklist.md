# 폰 GPS 수집 트랙 — 체크리스트

**목표.** 신규 앱(`vitalguard_app`)의 **iOS 폰**이 위치를 수집해 관제로 올린다. 방식은 **region monitoring(경계 감시) + 근무 중 coarse 추적**. 관제구역 반경은 **최소 50m · 최대 100m**.

**배경.** 08-01 이후 GPS 수신 0건이다. 신규 앱에 위치 코드가 한 줄도 없고 권한 문구·백그라운드 모드도 없다. 서버 스키마·DB 컬럼·지오펜스·동선·CSV 내보내기는 전부 살아 있으므로 **생산자만 복구**하면 된다. 근거는 `context-notes.md` G-01~G-09.

**범위 밖.** 워치 GPS(배터리 대가가 크고 watchOS 는 region monitoring 이 없다) · 폰·워치 좌표 융합(공통모드 오차라 평균해도 안 준다) · 근무 시간대(time-of-day) 개념 신설 · 관제 화면 신규 UI.

---

## 현재 상태 (2026-08-17)

**코드는 완료·검증 통과. 라이브에는 아직 없다.** 남은 둘은 사람 손이 필요하다.

| 항목 | 상태 |
|---|---|
| 커밋 | `e5226c9`(정확도 계약) · `855373e`(위치 수집) — push 완료 |
| 빌드 | `xcodebuild` Runner Release 무서명 BUILD SUCCEEDED · 경고 0 |
| 테스트 | 986 pass / 0 fail · 음성 대조 8/8 |
| **앱 설치** | ❌ **미설치** — 기기에는 아직 위치 코드가 없는 앱이 돌고 있다 |
| **서버 배포** | ❌ **미배포** — `location_accuracy_m` 컬럼이 라이브 DB 에 없다 |

⚠ **둘의 순서는 상관없지만 둘 다 해야 값이 남는다.** 앱만 설치하면 좌표는 저장되고 **정확도만 조용히 strip** 된다(이 트랙이 고치려던 바로 그 형태). 배포만 하면 컬럼이 비어 있을 뿐이다.

⚠ **앱 재설치는 이 트랙 단독이 아니다** — 같은 재설치에 아이콘·앱 이름 변경도 함께 실린다.

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

## Phase 6 — 반영 (사람 손 필요)

- [ ] **앱 재설치** — Xcode 로 **Runner 타깃만** Run. 워치 타깃을 건드리면 `HKWorkoutSession` 이 끊긴다
- [ ] **권한 '항상 허용'** — 첫 실행 시트. 사용 중 허용만으로는 **배경에서 경계 감시 콜백이 오지 않는다**
- [ ] **배포** — DB 컬럼 추가가 포함돼 `ensureSchema` 가 `ALTER TABLE` 을 실행한다(`/deploy` 명시 필요)
- [ ] 설치 후 관제 지도에 마커가 뜨는지 · `vital_samples.latitude` 가 채워지는지 DB 확인
- [ ] **배터리 실측** — iOS 설정 > 배터리의 앱별 소모. 폰 배터리는 **한 번도 잰 적이 없다**(폰 소스 71행 전부 `batteryPct` 없음)

---

## 남은 판단

- [ ] 구역 중심을 서버(`/api/monitor/site-coord`)에서 받을지 — 지금은 앱이 그날 첫 fix 로 앵커한다
- [ ] 관제 화면에 좌표 나이 게이트를 붙일지 — 심박에 한 것과 같은 처방(별도 트랙). `locationTimestamp` 는 이미 올라온다
- [ ] 워치 좌표를 **폴백**으로 쓸지 — 정확도가 아니라 가용성 문제다(폰을 두고 워치만 착용하는 08-18 시험 B 가 정확히 그 상황)
- [ ] 근무 시간대(time-of-day) 개념 — 생기면 "근무 중" 판정을 생체 수신에서 그쪽으로 옮긴다
