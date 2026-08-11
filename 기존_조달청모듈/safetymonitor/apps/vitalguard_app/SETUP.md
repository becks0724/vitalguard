# VitAlGuard 웨어러블 PoC — 셋업 (조건 A. 워치 → 아이폰 → 서버)

> 2026-08-11 검토 반영판. 원문 대비 수정 지점은 **[반영 n]** 으로 표시(1=Podfile, 3=시뮬레이터, 4=디바이스 한도, 5=Info.plist 생성 방식).
> 이 프로젝트는 `apps/worker-watch-poc`(조건 B. 워치→서버 직송, 실증 완료)와 별개의 **조건 A 검증용 독립 Flutter 프로젝트**다.
> **★ 신규 앱 원칙(2026-08-11 사용자 결정)** — GitHub 레포·로컬의 기존 iOS/워치 앱(worker-phone·네이티브 VitAlGuard 앱·worker-watch-poc)의 **코드를 활용하지 않고 신규 애플리케이션으로 개발**한다. 기존 자산에서 가져오는 것은 코드가 아니라 교훈(인증서·페어링·API 함정)뿐이다.

---

## 0. 원칙

| 레이어 | 언어 | 책임 |
|---|---|---|
| Watch App | SwiftUI | HR 수집, 5초 배치, WCSession 송신 |
| iOS 네이티브 | Swift | WCSession 수신, 로컬 큐, 서버 업로드 |
| Flutter | Dart | UI, 설정, 알람 표시 **만** |

**데이터가 Dart를 경유하면 안 된다.** iOS 앱이 백그라운드면 OS가 `WCSessionDelegate`는 깨우지만 Flutter 엔진은 살리지 않는다.

---

## 1. Flutter 프로젝트 생성 — ✅ 완료 (08-11)

```bash
cd 기존_조달청모듈/safetymonitor/apps
flutter create --org com.vitalguard --platforms=ios,android vitalguard_app
```

- 위치는 기존 관례를 따라 `safetymonitor/apps/` 밑에 두었다(worker-phone·worker-watch-poc 와 동급).
- **fvm 미사용** — 이 Mac 에 fvm 이 없고, 전역 Flutter **3.44.3**(Dart 3.12.2)이 worker-phone 의 SDK 핀 `^3.12.0` 과 정합해 그대로 사용한다. 팀원 머신과 버전을 맞출 필요가 생기면 그때 fvm 을 도입한다.

---

## 2. 워치 타깃 추가 — ✅ 스크립트로 완료 (08-11)

원문의 Xcode GUI 절차(File → New → Target → watchOS App) 대신 **xcodeproj gem 스크립트로 자동 추가**했다. 재현이 필요하면 GUI 절차도 유효하다.

### Bundle ID 규칙 (틀리면 페어링 안 됨)

```
com.vitalguard.vitalguardApp                 ← Runner
com.vitalguard.vitalguardApp.watchkitapp     ← VitalWatch
```

### [반영 5] Info.plist 는 실파일 방식

최신 Xcode 의 워치 템플릿은 Info.plist 파일 없이 Build Settings 의 "Info.plist Values"(`GENERATE_INFOPLIST_FILE=YES`)로 키를 관리한다 — GUI 로 만들었다면 파일을 찾지 말고 빌드 설정에서 값을 확인해야 한다. 이 프로젝트는 결정론적 관리를 위해 **실파일 `ios/VitalWatch/Info.plist` + `GENERATE_INFOPLIST_FILE=NO`** 방식을 채택했다. 핵심 키는 아래와 같다.

```xml
<key>WKApplication</key><true/>
<key>WKCompanionAppBundleIdentifier</key>
<string>com.vitalguard.vitalguardApp</string>
```

---

## 3. Podfile — 가장 많이 깨지는 지점

**[반영 1] 원문 스니펫을 Podfile 전체로 교체하면 안 된다.** 원문에는 Flutter 표준 전문(`flutter_root` 해석 → `podhelper.rb` require → `flutter_ios_podfile_setup`)이 빠져 있어, 그대로 교체하면 `flutter_install_all_ios_pods` 미정의로 `pod install` 이 실패한다. 규칙은 하나다.

- **flutter 가 생성한 Podfile 을 그대로 두고, 워치 타깃(`target 'VitalWatch'`)을 절대 추가하지 않는다.** Flutter Pod 이 워치로 상속되면 빌드가 실패한다.
- `platform :ios, '15.0'` 주석만 해제·조정한다.

현재(플러그인 0개) 상태에서는 pod 의존성이 없어 `pod install` 자체가 불필요하다. 첫 플러그인 추가 시점에 위 규칙을 적용한다.

### Embed 검증

- Runner 타깃 → Build Phases → **Embed Watch Content** 에 `VitalWatch.app` 이 있는지 확인.
- VitalWatch 타깃 → General → Frameworks 에 **`Flutter.framework` 가 없어야** 한다. 있으면 제거한다. 심사 반려 사유다.

---

## 4. Capability & 권한

### VitalWatch 타깃 — ✅ 완료

- HealthKit capability = `ios/VitalWatch/VitalWatch.entitlements` (`com.apple.developer.healthkit`).
- `Info.plist` 에 `WKBackgroundModes`(`workout-processing`)·`NSHealthShareUsageDescription`·`NSHealthUpdateUsageDescription` 포함.

### Runner 타깃 — ✅ 완료

- `UIBackgroundModes` = `fetch`, `processing`.
- `BGTaskSchedulerPermittedIdentifiers` = `com.vitalguard.upload`.
- `NSHealthShareUsageDescription` 포함.

### ATS

dev 서버는 cloudflared(https)를 쓰므로 `NSAllowsArbitraryLoads` 는 넣지 않았다. HTTP 엔드포인트가 꼭 필요해지면 임시로 넣되 **운영 전환 시 반드시 제거**한다. 조달 보안 요건에 걸린다.

---

## 5. 파일 배치

```
ios/
  Runner/
    PhoneReceiver.swift      ← Phase 0
    VitalPipeline.swift      ← Phase 1
    VitalBridge.swift        ← Phase 2
    AppDelegate.swift        ← 수정
  VitalWatch/
    VitalWatchApp.swift      ← 진입점 (배치됨)
    ContentView.swift        ← Phase 0에서 수정 (배치됨)
    WatchStreamer.swift      ← Phase 0
lib/
  vital_stream.dart          ← Phase 2
```

Xcode 에서 파일 추가 시 **Target Membership 체크**를 반드시 확인한다. 워치 파일이 Runner 에 들어가면 컴파일 에러가 난다.

---

## 6. 단계별 검증 게이트

각 Phase 는 아래를 통과해야 다음으로 넘어간다.

- **Phase 0** — 워치에서 보낸 HR 이 Xcode 콘솔(iOS)에 5초 간격으로 찍힘. 워치 앱을 백그라운드로 내려도 지속
- **Phase 1** — 아이폰 앱을 스와이프 종료 → 워치에서 계속 전송 → 서버 로그에 데이터 도착
- **Phase 2** — Flutter 화면에 최신 HR 과 큐 적체 수가 실시간 갱신

Phase 0/1 은 Flutter 를 건드리지 않는다. 브리지를 먼저 얹으면 장애 지점 구분이 불가능해진다.

---

## 7. 실기기 검증

**[반영 3]** Xcode 14 부터는 페어링된 시뮬레이터 간에도 WatchConnectivity 가 동작한다(현 툴체인 Xcode 26.6). 다만 실 심박 센서·백그라운드/강제종료 시맨틱은 시뮬레이터를 신뢰할 수 없으므로 **게이트 판정은 iPhone + Apple Watch 실기기 페어링에서만 유효**로 친다. Orca 워크트리 중 `wt-main` 하나만 실기기에 물린다.

**[반영 4] 디바이스 등록 한도** — Apple Developer 팀 `F2P5ZFP65Q` 는 100대 한도에 도달한 상태다(worker-watch-poc README 참조). 이번에 쓸 iPhone·Watch 가 이미 등록돼 있으면 통과, 새 기기면 개발자 콘솔에서 슬롯 정리가 선행돼야 한다. 서명 팀은 두 타깃 모두 빌드 설정에 넣어 두었다(`DEVELOPMENT_TEAM=F2P5ZFP65Q`, Automatic).

---

## 8. 진행 체크리스트

- [x] 프로젝트 생성(`apps/vitalguard_app`) — 08-11
- [x] VitalWatch 워치 타깃 추가 + Embed Watch Content — 08-11
- [x] 권한·capability(HealthKit·WKBackgroundModes·BGTask) — 08-11
- [x] 무서명 빌드 검증(Runner.app 안에 Watch/VitalWatch.app 임베드 확인) — 08-11
- [x] **Phase 0 — 실기기 게이트 통과 (08-11)** — BECKS iPhone(iOS 27 b5) + Apple Watch Ultra(watchOS 26.5)
  - [x] 코드 작성·타깃 등록·무서명 빌드 통과 — 08-11
  - [x] 실기기 게이트 — `[HR] seq` 연속(유실 0)·5초 간격·sendMessage 채널·워치 백그라운드+손목 내림에서 지속 수신

### Phase 0 실기기 트러블슈팅 기록 (재발 대비)

- **HealthKit 사용 설명 문구가 짧으면 requestAuthorization 에서 크래시** — `NSInvalidArgumentException: The string "…" is an invalid value for NSHealthUpdateUsageDescription`. 서술형 긴 문구로 교체 + **컴패니언(Runner)에도 Share/Update 두 키**를 넣어 해소.
- **Watch 앱 "설치" 무반응/무결성 에러 = 워치 개발자 모드 꺼짐**이 1순위 원인(설정 → 개인정보 보호 및 보안 → 개발자 모드 → 재부팅까지).
- **iOS 베타 아이폰이 중계하는 Xcode↔워치 터널은 깨질 수 있다** — iOS 27 b4 에서 "device rejected the connection request", b5 업데이트 후 해소. 검증 기기는 안정판 권장.
- **Flutter debug 빌드는 홈 화면 단독 실행 시 즉시 종료가 정상** — Phase 0~2 동안 폰 앱은 항상 Xcode Run 으로 실행.
- 서명 프로파일이 7일짜리(만료 08-18)로 발급됨 — 멤버십 상태 확인 전까지 **매주 Xcode 재실행 필요** 가능성.
- [ ] Phase 1 — VitalPipeline (로컬 큐 + 서버 업로드)
  - [x] 1a 코드 — VitalPipeline.swift(파일 영속 큐·배치 500·JWT·BGTask·재시도) + PoCConfig.plist 주입(gitignore, 예시=PoCConfig.example.plist) — 08-11
  - [x] 1a 서버 계약 검증 — dev 서버(데모·프로덕션 무접촉·PoC 전용 시크릿) + cloudflared 터널 + 발급 JWT 로 `POST /api/mock/vital` **accepted:1**(`watchos_data_vitalguard` 분류) — 08-11
  - [x] **1a 게이트 통과 (08-11)** — Release 빌드 스와이프 종료(15:20) 후 4분+ 연속 5초당 1건 서버 도착(POST 166→216·중단 0). iOS 가 WCSession 수신으로 강제종료 앱을 백그라운드 재기동함을 실증
    - ⚠ **debug 빌드로는 이 게이트를 판정할 수 없다** — 디버거 없는 재기동이 즉사해 4분간 도착 0건(교란 변수). 종료 구간 데이터는 transferUserInfo 큐에 보존돼 재실행 시 전량 도착(유실 0 실증)
    - ⚠ Flutter 템플릿의 프로젝트 Release 구성 `SUPPORTED_PLATFORMS=iphoneos` 가 워치 타깃에 상속돼 Release 빌드가 깨진다 — 워치 타깃에 `watchos watchsimulator` 명시로 해소(6f2e6ba)
  - [ ] 1b — 프로덕션 전환(관제웹 계정 실로그인) → 관제웹 실시간 확인 → 직후 APP_JWT_SECRET 회전(구 앱 토큰 일괄 폐기)
    - [x] 관제웹 배포 — `/api/app/vital` 별칭 라이브(`00240-4m4`·무토큰 401 실측) — 08-11
    - [x] 앱 로그인 구현 — Flutter 로그인 화면(관제웹 동일 id/pw) + VitalBridge(MethodChannel) + Keychain JWT + 파이프라인 자격 갱신·기본 서버=프로덕션(dev 는 `DevBaseURLOverride`) — 08-11
    - [x] **실기기 로그인 → 관제웹 실시간 표시 확인 (08-11)** — 앱 로그인·전송 큐 UI 정상, 관제웹 작업자 행 심박 95bpm 실시간 수신(16:14)·백그라운드 전송 확인. ⚠ 로그인 계정이 admin 계열(EMP-admin6861·사번 미설정 폴백)이라, 실사용 표기는 사번 등록된 worker 계정 권장
    - [x] **APP_JWT_SECRET 회전 완료 (08-11 16:22)** — 버전 3 발급·리비전 `00242-lkb` 100%·구 토큰 401 실측(16:22:57~) → 재로그인 후 201 재개(16:30:27~) → 버전 1·2 disable. **구 앱 잔존 자격 청산 완결**(가스포드는 별도 토큰이라 무영향)

**Phase 1 완결(08-11).** 다음 = Phase 2(VitalBridge EventChannel + 실시간 HR/큐 표시). 개선 이월 = ① 401 상태에서 수신 트리거 재시도가 5초 간격(백오프 미적용— 무해하나 재로그인 유도 UI 와 함께 정리) ② 실사용 계정은 사번 등록된 worker 계정 권장.

### 관제웹 수신 계약 요점 (실측 08-11)

- **신규 앱 표준 경로 = `POST /api/app/vital`** (08-11 신설 별칭 — `/api/mock/vital` 과 동일 핸들러·인증·검증. 구 경로는 관제웹 GET·레거시용으로 유지). 앱 JWT(Bearer) 필수, 토큰 workerId=본문 workerId 일치 강제. 배열 최대 500건·2MB·IP당 분당 120요청. ⚠ 프로덕션에는 다음 dashboard 배포 때 반영(1b 선행 조건).
- 필수 필드 `workerId`·`ts`(**전송 시각** ISO). 심박 `heartRate`(20~250)·측정 시각 `heartRateMeasuredAt`.
- **`source` 는 서버 화이트리스트** — 워치 생체는 `VitAlGuard-WatchVitals`(→`watchos_data_vitalguard`). 미등록 source 는 201 이어도 dropped(조용한 유실 주의).
- [ ] Phase 2 — VitalBridge + vital_stream.dart (Flutter 표시)
  - [x] 코드 — EventChannel `vitalguard/stream`(hr·pipeline 이벤트) + `lib/vital_stream.dart` + 홈 화면 실시간 심박/큐/인증거부 배너(재로그인 유도 — 1b 이월 ① 반영) — 08-11
  - [x] **실기기 게이트 통과 (08-11)** — 폰 화면 95bpm·"측정 5초 전·배치 #1863" 실시간 갱신, 워치 전송 1,864회·콘솔 seq 1865 와 3자 동기 확인

## ✅ PoC 완결 (2026-08-11)

**세 게이트 전부 통과 — 조건 A(워치 → 아이폰 → 서버) 신규 앱 완성.** 워치 백그라운드 수집 → 폰 강제종료 생존(WCSession 재기동) → 관제웹 프로덕션 실시간 모니터링 → 폰 화면 실시간 표시까지 실기기 실증. 기존 앱 자격은 APP_JWT_SECRET 회전으로 청산 완료.

**운영 이월 항목** — ① 실사용 계정을 사번 등록된 worker 계정으로 ② 서명 프로파일 7일 만료(08-18) — 멤버십 상태 확인, 장기 운용은 TestFlight 검토 ③ 검증 기기 iOS 베타 → 안정판 권장 ④ SpO₂·낙상 확장은 VitalSample 스키마에 필드가 이미 있어 워치 수집부만 추가하면 됨 ⑤ 워치 배터리 풀시프트 실측 ⑥ **계정 교체 시 잔여 큐 폐기 보강**(직전 사번과 다르면 큐 비우기 — 폰을 다른 작업자가 이어받을 때 오귀속 방지, 미착수).

**완결 후 개선 (08-11 저녁 · 실기기 확인 완료)**
- 로그인 화면을 관제웹과 정렬 — 슬로건·라벨(ID)·"확인 중…"·에러 문구 동일(작업자 혼동 방지, `2bd96a5`).
- 업로드 샘플에 `workerName` 동봉 — **관제웹 작업자 행이 로그인 이름("장우진")으로 표기됨을 실증**(`5901e79`). 관제웹 프로필 입력이 있으면 그쪽이 오버라이드.
