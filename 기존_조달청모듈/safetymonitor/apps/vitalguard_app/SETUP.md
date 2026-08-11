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
- [ ] Phase 0 — WatchStreamer + PhoneReceiver (워치 HR → 폰 콘솔)
  - [x] 코드 작성·타깃 등록·무서명 빌드 통과 — 08-11
  - [ ] 실기기 게이트 — iOS 콘솔 5초 간격 HR 로그 + 워치 백그라운드 지속
- [ ] Phase 1 — VitalPipeline (로컬 큐 + 서버 업로드)
- [ ] Phase 2 — VitalBridge + vital_stream.dart (Flutter 표시)
