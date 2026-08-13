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

**운영 이월 항목** — ① 실사용 계정 정식 사번 귀속 — ✅ **완료(08-12·아래 "신원 전환" 절)** ② 서명 프로파일 — 멤버십 미구매·7일 재설치 운용 확정(08-12). **08-12 재서명 실행 완료 → 다음 만료 ≈08-19(수)**, 이후 매주 반복(미리 알림 08-17 09:00 — 만료 이틀 전이라 유지). 절차 = 아이폰 연결 → Xcode Run 1회 → 앱 1회 전면 실행(수칙). 만료를 넘기면 앱 실행 불가 → 수집 중단. 멤버십 구매 시 TestFlight 전환으로 루프 종료 ③ 검증 기기 iOS 베타 → 안정판 권장 ④ SpO₂·낙상 확장은 VitalSample 스키마에 필드가 이미 있어 워치 수집부만 추가하면 됨 ⑤ 워치 배터리 풀시프트 실측 — ✅ **완료(08-12)**. 11:25 88% → 16:34 55% = 5시간 9분에 33%p, **시간당 6.4%**(Ultra·HKWorkoutSession 상시+5초 전송+수동 SpO₂ 반복·재설치 등 최악 조건). 100% 충전 출발 기준 8h 시프트 후 잔량 ≈49%·10h ≈36% → **풀시프트 운용 가능, B4(배칭 튜닝) 불필요 판정**. 단 여유가 크지 않아 실운용 1주 관찰 후 재평가(8%/h 넘으면 5초→30초 배칭 검토·관제 신선도 게이트 60초라 실시간성 무손실) ⑥ **계정 교체 시 잔여 큐 폐기 보강** — ✅ **구현 완료(08-12)**. 로그인 성공 시 직전 로그인 사번(`AuthStore.lastWorkerId` — 로그아웃에도 안 지움)과 다르면 `VitalPipeline.purgeQueue` 로 미전송 큐 폐기(같은 직렬 큐라 폐기가 업로드보다 앞선다). 첫 로그인·같은 계정 재로그인은 폐기하지 않는다. 실기기 검증 = ① 신원 전환(EMP-admin6861→EMP-6861 재로그인)이 그 발동 시나리오였다.

**신원 전환 완결 (08-12) — worker1 재생성 대신 "쓰던 계정에 정식 사번" 방식**

- **경위.** 이월 ① 의 원안(worker1/EMP-6861 로 로그인 전환)은 **worker1 계정이 팀원 DB 정리로 삭제**돼 불가(전체 users 5명 실측·worker 계정 0). 근로자 추가 UI 도 07-31 제거 상태라 재생성 대신 **admin6861 계정의 사번을 정식화**하는 방식을 채택 — 사용자가 원한 운영 모델("관제웹 id/pw 그대로")과 오히려 더 일치하고 비밀번호 분실 문제도 소멸.
- **실행.** ⓐ 관제웹 '내 정보'에서 admin6861 사번 `EMP-admin6861`→`EMP-6861` ⓑ 앱 재로그인(새 JWT workerId=EMP-6861·10:11) ⓒ **worker_alias 방향 뒤집기** — 기존 `EMP-6861→EMP-admin6861` 별칭이 새 데이터를 옛 카드로 접고 있었음(관제웹 "적용 안 됨"의 원인). 삭제 후 `EMP-admin6861→EMP-6861`·`admin6861→EMP-6861` 로 재등록(과거 이력 20.4만 건 병합·터미널 스크립트 실행).
- **판정.** 서버 5초 간격 201(gcloud 로그 실측) · 관제웹 단일 카드 **장우진/EMP-6861** 실시간 수신·EMP-admin6861 행 소멸.
- **잔여 2건 — 전부 해소(08-12).** ⓐ 누적 별칭 접힘 — `countsByWorker` 수정(`7d59ca0`·가드 3건+음성 대조) 배포 `00248-f7q` 로 라이브 반영, **관제웹 누적 210,018 실측 확인**(과거 이력 병합 완성 · 양지후·김태곤 카드도 각자 별칭 분 합산 확인) ⓑ 직급(팀장) 재등록 — ✅ 완료(관제웹 "직급 +" 로 EMP-6861 키에 등록).
- ⚠ **교훈.** 신원 키를 바꿀 때는 **worker_alias 의 기존 방향부터 조회**할 것 — 별칭이 남아 있으면 새 키가 조용히 옛 키로 접혀 "전환이 안 된 것처럼" 보인다.

## B1 — SpO₂ 확장 (2026-08-12 착수 · 갱신 구조)

**설계 4층(전부 갱신 구조·사용자 확정)** — 수집=이벤트(anchored query·측정 시에만) · 저장=측정 1건당 1행(복사 전송 금지 — 구 앱 19.4만 행 사고의 정반대) · 표시=값+측정 경과("N분 전"·서버 시각 기준) · 판정=신선한 측정만(30분 초과 = 회색+`spo2Status` 제외).

- [x] 워치 — `oxygenSaturation` 읽기 권한 + `HKAnchoredObjectQuery`(앵커 영속 — 재실행 시 재전송 0) + 배치에 `{ts(측정시각), spo2}` 동봉 + 화면 SpO₂ 표시
- [x] 폰 — `VitalPipeline.ingest` 가 spo2 항목을 `spo2`+`spo2MeasuredAt` 으로 매핑(HKUnit .percent() 는 0~1 분율 → ×100 주의) / `PhoneReceiver` 최신 bpm 탐색을 "bpm 있는 마지막 샘플"로 보정
- [x] 무서명 Release 빌드 통과 (08-12·워치 임베드 포함)
- [x] 관제웹 — `lib/spo2-freshness.ts`(경과 계산·신선도 게이트·표기) + SpO₂ 셀 값+경과 서브라벨 + `spo2Status` 전 호출부 게이트 경유 + 단위/가드 테스트
- [x] 검증 3종 통과 — tsc 0 · lint 0err · test 최종 614/614(신선도 5 + 게이트 가드 4 + 겹침 5 신규·음성 대조 완료)
- [x] 배포 — `00249-ztn`(셀·게이트) → **`00251-jts`**(DB 겹침 수정) · digest 대조 일치·라우트 4종 ok
- [x] **실기기 게이트 통과 (08-12 14:33)** — 수동 측정 → DB 정확 1행(`spo2=96 측정=05:17:52Z` 등) → 관제웹 `90 % · 방금 전` + 상태 "주의" 점등(신선 측정이 판정 연동까지 실증)

**B1 함정 기록 (재발 대비)**
- ★ **갱신 구조(측정 1건=1행)는 인스턴스 메모리 병합과 충돌한다** — spo2 단독 행은 그 POST 를 받은 Cloud Run 인스턴스 메모리에만 남아, 다른 인스턴스가 GET 에 응답하면 셀이 `--%`(DB 96% 저장·화면 공백 실측). 구 앱은 매 행에 값을 복사해 실어 가려졌던 문제. 해법 = GET 이 DB 의 "워커별 마지막 spo2 행"을 표시 시점에 겹침(`latestByWorkerWithSpo2`·저장 구조 불변). **간헐 단독 필드를 새로 추가하면 같은 겹침이 필요하다**(낙상 B2 설계 시 참고 — 낙상은 이벤트 플래그라 alerts 경로가 따로 있어 다름).
- **설치/업데이트 후 앱 1회 전면 실행 필수** — 새로 설치된 앱을 전면 실행하기 전에는 iOS 가 백그라운드 WCSession 전달을 드문드문만 깨워(15분에 18건 실측), 그 비정상 구간에서 측정 1건(12:42 93%)이 유실됐다. 전면 실행 후 정상(94건/15분). 운영 수칙으로 고정.
- Xcode Run 설치가 조용히 실패하면 **서명된 DerivedData 산출물을 `xcrun devicectl device install app` 으로 직접 설치** 가능(08-12 실증 — 케이블 연결·잠금 해제 상태).

서버·스키마 변경 0 — `spo2`(50~100 검증)·`spo2MeasuredAt` 계약 기존재 확인(필수 필드는 workerId·ts 뿐이라 spo2 단독 행 수용).

## B1.6 — 심부체온 추정(심박 기반·표시만) (2026-08-12 착수)

**결정** — 실시간 손목온도는 Apple 미개방(수면 전용 API 뿐·수면 미착용 운용이라 0건)이라 워치 실측 불가. 심박 기반 칼만필터 추정(USARIEM Buller 계열·문헌 RMSE 0.21~0.30℃)을 **열 스트레스 선별 표시 전용**으로 채택(판정 비연동 — 실사용 관찰 후 별도 결정). 한계 3종을 표기·문서에 고정한다 — ①심박 억제 약물(베타차단제)은 **과소추정=놓침 방향** ②임계 근처 ±0.5℃ 회색지대 ③"측정" 아닌 "추정" 명칭 일관(의료기기 경계·MFDS 비범위 원칙).

- [x] analyzers — `estimateCoreTemp`(순수 함수·문헌 계수 고정·1분 버킷·워밍업 30분 미만 null·갭은 불확실성 증가로 계속) + 단위테스트(안정 HR≈83→37.1 유지·지속 HR 137→38.5 수렴·결정성)
- [x] 서버 — GET 이 워커별 최근 3h 심박(별칭 접기)으로 **매번 무상태 재계산**(인스턴스 메모리 함정 회피·60초 캐시) → 응답 `coreTempEst`
- [x] 관제웹 — 체온 열: 실측(skinTempC) 없고 심박 신선하면 `≈37.4℃ · 심박 추정` 표시(연결끊김·워밍업이면 미표시). **판정(coreTempStatus)에는 미주입** — 가드로 고정
- [x] 검증 3종 — tsc 0·lint 0err·test 714(analyzers 57 + dashboard 619·신규 10) / [x] 배포 완료(`00256-nbk`·73bbb35 — 마스킹 동반)

## B1.7 — 추정 추세 차트 실데이터화 (2026-08-12)

**발견** — 하단 누적 추세 차트는 전부 **발표용 모의 곡선**(해시 생성)이었다. 알고리즘 검증(추정↔심박 비교)이 목적이 되면서 두 메트릭만 실데이터로 분기.

- [x] "손목 온도" 탭 → **"체온(심박 추정)"** — 궤적 함수(`estimateCoreTempSeries`·60분 공백 세션 리셋+재워밍업=끊긴 선) 실계산, 24시간·1주일만(서버 400 강제·장기 추정은 근거 없음), 판정 미주입(참고선 38.0/37.5만)
- [x] **심박 탭 실데이터 전환**(전 기간·SQL 버킷 평균·별칭 확장) — 추정의 비교 기준선
- [x] 가드 3건 추가(실경로 분기·모의 생성기 방어선·점 판정 미주입) · 검증 3종 — test 총 722(analyzers 60+dashboard 624+schemas 38)
- [x] 배포 — 옆 세션 조율·`00256-nbk`(73bbb35). **API 실증** = coreTempEst 7일 200(76점·source=estimated·37.2~37.7℃)·30일 400·heartRate 실측(94점·84~130bpm). 브라우저 육안 완료(17:08) — 24h 곡선 37.2~37.7℃·**밤 미착용 공백이 끊긴 선으로 표현**(세션 리셋 실증)·참고선 37.5/38.0·30일+ 버튼 숨김·추정 37.5 에도 상태 '정상' 유지(판정 미주입 실증)

**이월** — 낙상 탭은 아직 모의 곡선(B2 때 실데이터 전환).

## B1.8 — SpO₂ 추세 실데이터화 (2026-08-12)

- [x] SpO₂ 추세 = 실측 행(측정 1건=점 1개) — **24시간 뷰는 실제 측정 시각 위치의 점(dot·시간축)**, 1주일 = 측정별 막대, 30일+ = **일평균+측정 횟수 병기**(사용자 결정). 곡선 연결 금지(측정 없는 시간대 오독 방지)
- [x] 탭 게이트 교체 — "지금 신선한 값" → 항상 진입, 기간 내 0건이면 "측정 없음 + 수동 측정 안내" 문구
- [x] 검증 3종 — test 725(가드 1 신규) / [x] 배포 `00257-hpc`(9b72300·ALLOW_DIRTY=옆 세션 문서 1건 제외 명시) — **API 실증** = spo2 days=1 → 측정 점 3개(14:17 96·14:33 90·14:43 92)·source=measured·tsMs 동봉. 점 위치 육안 완료(17:38) — 3점이 실제 측정 시각(14시대)에 군집·나머지 시간대 빈 공간·90% 점 주의색·참고선 92/88·4시간 눈금 전부 설계대로

## 온열 ① — 활동 에너지(activeEnergy) 수집 (2026-08-13 착수)

목적 = 온열질환 예방 3축(환경·생리·활동) 중 활동 축 확보. 심박 상승이 "운동성"인지 "열 축적·탈수(쉬는데 심박이 안 내려옴)"인지 분리하는 재료. ①은 수집·저장까지 — 화면·판정 변화 없음(② 패턴 감지·③ 예방 알림은 별도 결정).

- [x] 워치 `WatchStreamer.swift` — `activeEnergyBurned` 읽기 권한 + 빌더 누적치 수신, **flush(5초)에서 증분만 적재**(심박 항목에 병합 = 서버 행 수 불증가·없으면 단독 항목·반올림 잔여 이월·세션 재시작 시 기준 재설정 가드). 워치 화면에 `활동 N.N kcal`(주황) — 폰 로그·DB 대조용
- [x] 폰 `VitalPipeline.swift` — `ae` → `activeEnergyKcal` 매핑(서버 '구간 합' 계약 그대로) / `PhoneReceiver.swift` 로그에 `ae=+N.NNkcal` 합계
- [x] **서버 변경 0건** — `activeEnergyKcal` 이 구 앱 스트레스 수집(P0) 유산으로 스키마(0~200·리질리언트 파서에서 strippable=안전 방향)·DB 컬럼 `active_energy_kcal`·insert 매핑까지 이미 존재. 재사용 확인만 했다
- [x] 무서명 Release 빌드 통과(08-13 · Watch companion 포함)
- [x] **실기기 게이트 통과(08-13 10:16)** — DB 도착 실증: 5초당 1행·**심박과 같은 행에 병합**(hr=108·ae=+0.41kcal = 행 수 불증가 설계 작동)·세션 4분간 51행 합 19.05kcal(분당 ≈5kcal — 심박 105~110 활동 수준과 정합)·워치 `활동 N.N kcal` 표시 확인
- **★ 함정(08-13 실증) — 아이폰 Xcode Run 의 워치 임베드 전달이 조용히 실패/지연될 수 있다.** 증상 = 새 read 권한 시트가 안 뜨고 신규 UI 줄이 없음(구빌드 잔존인데 실패 표시가 없다). 해법 = **스킴을 `VitalWatch` 로 바꿔 Apple Watch 대상 직접 Run(수동 설치)** — 첫 Run 은 터널 준비로 수 분. 워치가 목록에 없으면 1순위 = 워치 개발자 모드.
- [x] **② 저활동·고심박 패턴 표시(08-13 구현 · 배포 대기)** — 서버 순수 함수 `lib/heat-pattern.ts`(창 15분·심박 커버 ≥10분·평균 ≥100bpm·≤1.5kcal/분 = 주석)·**판정 불가(null)와 정상(false) 구분**(에너지 파이프라인 없는 구 앱 워커에 오독 주석 금지·창 밖 lookback 45분으로 파이프라인 존재 확인) → vital GET `heatPattern`(flagged 만) → 체온 추정 셀 `⚠ 저활동·고심박`(앰버)+상세 툴팁. **판정·경보 미주입 가드 5건** + 단위 9건 + 음성 대조 2건(응답 누락·판정 주입 → 각각 가드 실패 확인). 검증 tsc 0·lint 0err·test 645/645. **라이브 = `00260-snm`(08-13 /deploy·digest 대조·라우트 4종 ok)** — 주석 육안은 자연 발생 대기(평시엔 안 뜨는 게 정상·재현 = 계단 오르기 직후 착석)
- [ ] (후속·별도 결정) ③ 단계형 예방 알림(관심→주의→경고 · 알림 정책 = 수신자·발동 단계 사용자 확인 필요)

## 스트레스 ① — 스트레스 입력 6종 수집 (2026-08-13 착수 · 실기기 게이트 대기)

목적 = 관제웹 스트레스 지수를 **심박의 재표현에서 벗어나게** 하는 것. 지수는 저장값이 아니라 심박·HRV·활동량으로 그때그때 계산하는 파생값인데(심부체온 추정과 같은 구조·DB 컬럼 없음), 재료 중 심박만 들어오고 있었다.

**실측이 착수 근거다** (프로덕션 DB 읽기 전용 · EMP-6861+별칭 · 최근 7일 7,269행).

| 재료 | 보유 행 | 비고 |
|---|---|---|
| `heart_rate` | 7,265 | 정상 |
| `active_energy_kcal` | 60 | 온열 ① 신규분 |
| `hrv_sdnn_ms`·`resting_heart_rate`·`steps`·`walking_heart_rate`·`flights_climbed`·`respiratory_rate` | **전부 0** | 수집 자체가 없음 |

HRV·호흡수가 없으면 `computeStressIndex` 에서 `zHrv = 0`·`zRr = 0` 이 되고 활동 보정 초과심박만 남아, 지수가 **심박의 단조 변환**이 된다. 이 상태로 추세 차트를 붙이면 심박 차트와 같은 모양이라 정보가 늘지 않는다 → **수집 먼저**(사용자 결정 A안).

- [x] 워치 `WatchStreamer.swift` — 성격별로 두 방식. **이산 측정 4종**(HRV·안정심박·보행심박·호흡수) = 앵커드 쿼리(SpO₂ 패턴) / **누적 2종**(걸음·오른층) = 워크아웃 통계의 5초 구간 증분(activeEnergy 패턴). ⚠ 걸음·오른층은 `.other` 워크아웃 기본 수집 목록에 없어 **`enableCollection` 으로 명시**해야 `statistics` 에 잡힌다
- [x] 폰 `VitalPipeline.swift` — 짧은 키(`hrv`·`rhr`·`whr`·`rr`·`stp`·`flt`) → 서버 스키마 이름 매핑. 값이 실린 것만 붙인다(빈 필드를 0 으로 채우면 "측정했는데 0"이 된다)
- [x] **서버 변경 0건** — 6종 전부 Zod 스키마(`hrvSdnnMs` 0~500·`restingHeartRate` 20~150·`steps` 0~5000·`walkingHeartRate` 40~250·`flightsClimbed` 0~500·`respiratoryRate` 4~60)와 DB 컬럼이 이미 있다. 구 앱 스트레스 수집(P0) 유산
- [x] 무서명 빌드 통과(08-13 · `BUILD SUCCEEDED`·error 0 · 변경 3파일 전부 컴파일 확인 · Runner·VitalWatch 두 타깃)
- [ ] **실기기 게이트** — ① 권한 시트에서 새 항목 6종 허용 ② 워치 화면 `HRV NNms · N건` 표시 ③ DB 도착 확인 ④ **HRV 수집 빈도 실측**(아래 ★)
- [ ] (게이트 통과 후) 스트레스 추세 차트 — 심부체온 선례(`estimateCoreTempSeries`) 그대로. 저장 없이 과거 재료로 재계산

**★ 복사 전송 금지 — 구 앱의 HRV '밀도'는 가짜였다.** DB 실측상 HRV 가 들어온 **모든 워커·날짜가 예외 없이 `distinct 1`** 이다(2026-07-28 = 2,784행 전부 `47.1ms`, 07-30 = 411행 전부 `70.89ms`). 하루 1회 측정한 값을 5초마다 재전송한 것이고, `persistSample` 은 원시 샘플을 받으므로 **기기 쪽 carry-forward** 다. 그 데이터로 추세를 그리면 하루 한 번 튀는 계단이 된다. 신규 수집은 측정 시점에만 실으므로 **DB 행 수 = 실제 측정 횟수**가 된다 — 대신 점이 드물어 차트는 SpO₂ 처럼 **점 그래프**가 될 가능성이 높다(연속 곡선 기대 금지).

**★ 낡은 재생분 차단.** 이 6종에는 `spo2MeasuredAt` 같은 측정 시각 필드가 서버 계약에 **없어** 행의 시각이 곧 전송 시각이 된다. 앵커는 앱이 꺼져 있던 동안의 측정을 재실행 때 한꺼번에 돌려주므로, 그대로 실으면 **몇 시간 전 측정이 '지금'으로 찍힌다**. 그래서 순간 측정(HRV·호흡수)은 **15분** 넘으면 버리고, 일 단위 기준값(안정심박·보행심박)은 원래 하루를 대표하는 값이라 나이를 따지지 않는다(`DiscreteInput.maxAge`).

**★ 표본 빈도가 최대 미지수.** Apple 은 HRV(SDNN)를 수면·호흡 세션·휴식 시 산발 기록하고 **워크아웃 중 연속 측정은 하지 않는다**. 이 앱은 하루 종일 워크아웃 세션을 유지하므로 작업시간 중 표본이 시간당 0~수 건일 수 있다. 워치 화면 `HRV NNms · N건` 줄이 그 판정 근거다 — **0건이면 수집 설계가 아니라 전제가 틀린 것**이고, 그때는 스트레스 지수를 심박 파생으로 명시하거나 항목을 내리는 결정이 필요하다. 호흡수는 수면 전용일 가능성이 커서(손목온도가 같은 이유로 0건 확정) 0건을 예상하되 실측으로 확정한다.

**완결 후 개선 (08-11 저녁 · 실기기 확인 완료)**
- 로그인 화면을 관제웹과 정렬 — 슬로건·라벨(ID)·"확인 중…"·에러 문구 동일(작업자 혼동 방지, `2bd96a5`).
- 업로드 샘플에 `workerName` 동봉 — **관제웹 작업자 행이 로그인 이름("장우진")으로 표기됨을 실증**(`5901e79`). 관제웹 프로필 입력이 있으면 그쪽이 오버라이드.
