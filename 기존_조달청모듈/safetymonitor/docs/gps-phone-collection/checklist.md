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
- [x] **설치 후 좌표 도착 확인(2026-08-19 11:09)** — 재설치(11:08:47) 직후부터
      `latitude`·`location_accuracy_m` 117건 도착. 좌표 = 35.150517, 126.916316 단일값
      (100m 등급 = WiFi 측위 양자화 · 정지 상태라 정상).
- [x] **★★ 좌표가 기동 +10분41초에 끊겼다 — 원인 = iOS 자동 일시정지 + 신선도 게이트
      (2026-08-19 실측 · 원인 조사 완료)**.
      타임라인 = 기동 11:08:47 → 마지막 fix ≈11:14:28(기동 +5분41초 · 폰이 책상에 정지) →
      신선도 300초(`maxFixAgeSec`)가 그 fix 를 11:19:28 까지 실어줌 → 이후 0건.
      ★ **끊은 것은 권한이 아니다** — 117건이 왔으므로 권한은 살아 있다. 범인은
      `pausesLocationUpdatesAutomatically = true`(`LocationProvider.swift:81`) — iOS 가
      정지 ~5분에 위치 업데이트를 자동 일시정지했다.
      ⚠ **일시정지는 스스로 안 풀린다(애플 문서화된 함정)** — 재개하려면 앱이
      `locationManagerDidPauseLocationUpdates` 에서 재시작해야 하는데 **이 델리게이트가
      구현돼 있지 않다.** 게다가 `noteVitalsActive()` 는 `tracking` 플래그가 true 면 재시작을
      건너뛰는데, 일시정지돼도 플래그는 true 로 남는다. ⟹ **작업자가 6분 정지했다가 다시
      움직여도 좌표는 영영 안 돌아온다**(생체가 120초 끊겨 stopTracking 이 플래그를 내릴
      때까지). 경계 감시(geofence)는 OS 몫이라 살아 있음 — 이탈은 잡힌다.
      **처방 후보(미착수)** = `locationManagerDidPauseLocationUpdates` 에서
      `startUpdatingLocation()` 재호출(3줄). 폰만 바뀌므로 워치 무관·재설치 1회.
      08-25 재서명 때 얹으면 추가 설치 비용 0.
- [x] **★★ 위 진단은 반증됐다 — 이동 실험 실측(2026-08-19 12:43~13:19)**.
      ⚠ **"영영 안 돌아온다" 가 틀렸다.** 이동 실험(12:55) 을 시작하기도 **전인 12:43 에 좌표가
      스스로 복귀**했다. 일시정지가 실제로 걸렸는지조차 확인된 바 없다.
      ★ **실제 동작은 설계대로다** — fix 간 거리 **124m·147m·105m·100m**(= `distanceFilter`
      100m) · 각 fix 가 실린 시간 **295·295·210초**(= `maxFixAgeSec` 300초). 즉
      `fix 도착 → 최대 300초 실림 → 만료 → 100m 이동해야 다음 fix` 가 그대로 관측된다.
      ⟹ **11:20~12:42 의 83분 공백은 일시정지를 안 불러도 설명된다** — 폰이 USB 로 책상에
      묶여 100m 를 안 움직였으니 새 fix 가 없었고 신선도 게이트가 묵은 값을 막은 것이다.
      **결함이 아니라 "묵은 좌표를 안 싣는다" 는 설계가 의도대로 동작한 것**이다.
      ★ 남는 사실 = `locationManagerDidPauseLocationUpdates` **미구현은 코드상 여전히 참**이다.
      다만 그것이 만든다고 내가 주장한 증상(영구 고착)은 관측으로 반증됐으므로 **처방의 근거가
      사라졌다**. 재개하려면 먼저 **일시정지가 실제로 발동하는지**를 잡아야 한다(현재 관측 수단 없음).
      ⚠ **내 오류의 형태** — 코드를 읽고 세운 인과 사슬을 관측으로 검증하지 않고 결론으로 적었다.
      같은 날 `mv` 사슬에서 밟은 것과 같은 형태다(L-67 계열).
- [ ] **배터리 실측** — iOS 설정 > 배터리의 앱별 소모. 폰 배터리는 **한 번도 잰 적이 없다**(폰 소스 71행 전부 `batteryPct` 없음)

---

## 남은 판단

- [ ] 구역 중심을 서버(`/api/monitor/site-coord`)에서 받을지 — 지금은 앱이 그날 첫 fix 로 앵커한다
- [ ] 관제 화면에 좌표 나이 게이트를 붙일지 — 심박에 한 것과 같은 처방(별도 트랙). `locationTimestamp` 는 이미 올라온다
- [ ] 워치 좌표를 **폴백**으로 쓸지 — 정확도가 아니라 가용성 문제다(폰을 두고 워치만 착용하는 08-18 시험 B 가 정확히 그 상황)
- [ ] 근무 시간대(time-of-day) 개념 — 생기면 "근무 중" 판정을 생체 수신에서 그쪽으로 옮긴다

---

## 2026-08-20 · 정지 중 좌표 유지 (①② 트랙)

### 왜 다시 여는가

08-19 결론은 **"결함이 아니라 설계가 의도대로 동작한 것"** 이었다. 그 판정 자체는 지금도 맞다.
바뀐 것은 **결과를 처음 측정했다는 것**이다 — 설계대로 동작한 결과가 관제 지도를 하루의 3/4 동안
비워 놓는다. 프로덕션 DB 14시간 표본(2026-08-20 02:48~16:17 KST).

```
샘플 5,586건 · 좌표 실린 행 1,407건 = 커버리지 25.1%
정확도 5.9~39.2m · 중앙 10m          → 품질은 문제 없다
마지막 좌표 15:47:44 · 조회 16:17    → 30분 공백 중 사용자가 화면을 봤다
```

**판별식** — 원인이 `maxFixAgeSec` 이 아니라면 구간 길이가 300 과 무관하게 흩어져야 한다.
좌표가 1개뿐인(=정지) ON 구간 길이를 전부 뽑았다.

```
300 · 305 · 295 · 305 · 290 · 305 · 296 · 293 초    ← 8건 전부 300±10
220 · 235 초                                         ← 2건은 중간에 이동해 끊김
좌표 여럿(=이동) 구간  1969초/43좌표 · 825/6 · 735/5 · 385/2 · 390/2
OFF 구간(분)  83 · 53 · 53 · 43 · 35 · 31 · 31 · 28 · 11 · 10 · 3 · 3 · 3
```

흩어지지 않는다. 08-19 의 `295·295·210` 과 같은 지문이고, 표본이 10배로 늘었을 뿐이다.

### 처방 — 사용자 승인 2026-08-20 (①② 동시)

- [ ] **② 앱 — 정지 중 주기 갱신**(`LocationProvider.swift`).
      fix 가 `fixRefreshAfterSec` 을 넘기면 `oneShot` 으로 한 건 직접 받아 `latestFix` 를 채운다.
      ⚠ `requestFreshFix()` 를 재사용하지 않는다 — 저것은 캐시 적중 시 `latestFix` 를 **안 건드리고**
      각인용 페이로드만 돌려주므로 업로드 경로(`currentFix()`)에는 아무 효과가 없다.
      ⚠ `maxFixAgeSec` 300초는 **그대로 둔다.** 묵은 좌표 금지는 유지하고, 좌표가 묵기 전에
      새것을 받아오는 쪽으로 푼다(③안을 사용자가 기각한 이유와 같다).
- [ ] **① 관제웹 — 마지막 좌표 + 나이**(`DemoDashboard.tsx`).
      최신 샘플 1건이 아니라 최근 좌표를 쓰고 나이를 표기한다. 이미 있는 `STALE_MS` 고스트를 확장.
      ⚠ **옆 세션이 이 파일을 점유 중**(08-20 16:2x · 미커밋). 놓았다는 회신 전까지 열지 않는다(L-87).
- [x] ③ 상수 완화(`distanceFilter`·`maxFixAgeSec`)는 **기각**. 워치 하트비트 12시간 복사 사고와 같은
      형태를 만든다 — 두 시간 전 자리에 서 있는 것으로 보인다.

### 이번에 함께 확인된 것

- [ ] **`locationTimestamp` 가 서버에서 통째로 버려진다** — G-10 이 "함께 실어 관제가 나이를 알게
      한다" 고 적어 뒀지만 **DB 컬럼도 insert 매핑도 없다**(`db.ts:949~952` 는 `location_accuracy_m`
      만 매핑 · `information_schema` 조회 결과 location 계열 컬럼 = `latitude`/`longitude`/
      `location_accuracy_m` 셋뿐). 앱은 보내고 스키마도 통과하는데 저장이 안 된다.
      BND-CONTRACT-01 계열. **①이 좌표 나이를 화면에 쓰려면 이게 먼저 필요한지 판단해야 한다**
      (샘플 `ts` 로 대체 가능하면 불필요).
- [x] `pausesLocationUpdatesAutomatically` 재개 델리게이트 미구현은 **여전히 참**이고, 여전히
      증상으로 확인된 바 없다. ②가 들어가면 4분마다 요청이 나가므로 일시정지가 걸려도
      가려진다 — 즉 **②는 이 미해결 항목을 관측 불가로 만든다.** 알고 넣는다.
- [x] 워치는 좌표 생산자가 아니다(`VitalWatch/` 전체 grep — `latitude`/`longitude`/`CLLocation` 0건).
      좌표는 폰 CoreLocation 단독이고 워치 생체 POST 에 얹혀 간다(`VitalPipeline.swift:222`).
