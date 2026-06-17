# apps/worker-phone — SafetyMonitor 작업자 폰 앱 (Flutter)

> **현재 상태 (2026-05-26 오후)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~75% + D3 ~55% — iPhone 2대 install (BECKS + YJH iPhone 15 Pro Max) codesigned release + `_effectiveWorkerId` getter (사원번호 입력 시 자동 workerId) + iOS 백그라운드 keepalive + 보호자/GPS payload + 낙상 시연 + Cloudflare Tunnel 우회. **Cyён iPhone 16 install 차단** — Apple Developer team `F2P5ZFP65Q` 디바이스 한도 도달 (연 100대, 1년 1회 reset). 발표 폰 구성 변경 → **iPhone 2대 + Galaxy 실기기 1대**. 2026-05-26 인프라 nohup+disown 안정화 + IDE Run ▶/디버그 🐞 버튼 영구 금지 정책. 마지막 단계: 2 iPhone in-app URL 새 cloudflared 갱신 + Galaxy 실기기 install (Cyён 대체, USB 디버깅 + `adb install` 또는 `flutter run --release`) + 작업자 신규 입력 → 대시보드 5칸 슬롯에 등록 → 카드 표시 검증** · 발표 마감 **2026-06-04 (D-9)** · 상세 [../../docs/progress.md](../../docs/progress.md#quick-summary-30초-안에-읽기)

iOS + Android 단일 코드 Flutter 앱. 페어된 워치 (Apple Watch / Galaxy Watch) 의 생체 데이터를 HealthKit / Health Connect 로 query 후 AWS IoT Core (또는 HTTP fallback) 로 publish. 시연 메인 클라이언트.

## 지금까지 작업

### D0 (셋업)
- [x] Flutter 3.44.0 · CocoaPods 1.16.2 설치 · `flutter create` (`kr.indusview.workerPhone`)
- [x] `lib/main.dart` placeholder + `test/widget_test.dart` 1/1 + iOS 시뮬레이터 빌드 30s

### D1 (Flutter 폰 앱 → 백엔드 publish)
- [x] `health` · `mqtt_client` · `flutter_secure_storage` · `http` 패키지 통합
- [x] `health_vitals_service.dart` — HealthKit/Health Connect 권한 + HR/SpO₂/손목 온도 latest query. **개별 type 별 try-catch** (한 type 실패해도 나머지 수집)
- [x] `vital_publisher.dart` — AWS IoT mTLS MQTT publish 골격 + HTTP POST fallback. **`http.post.timeout(4s)` + `TimeoutException → HttpException("타임아웃 (4s) — LAN 도달 실패")`**
- [x] 5초 간격 폴링 (`Timer.periodic`) + Health 단계와 publish 단계 분리. Health 빈값 시 시연용 fallback (`hr≈72±, spo2=97, temp=36.5`) 전송
- [x] 메인 화면 — 현재 HR · SpO₂ · 손목 온도 + 연결 상태 (단계별 명확 메시지) + 디바이스 ID + 큰 SOS 버튼 + 우상단 ⚙️ 설정 진입
- [x] **수신 서버 URL 입력 카드** — TextField + 저장 버튼 + secure storage 영속화 (`mock_receiver_url`). dart-define `MOCK_RECEIVER_URL` 은 default fallback. LAN IP/터널 URL 변경 시 재빌드 불필요
- [x] **★ 설정 화면 (`SettingsPage`)** — 우상단 ⚙️ 아이콘 → 작업자 이름 + 사원번호 TextField + secure storage 영속화 (`worker_name` · `employee_id`). 저장 후 폴링/SOS payload 마다 `workerName` / `employeeId` 자동 동봉. 상태 패널 "작업자 / 사원번호" row 표시 + 메인 "작업자" 카드에 `이름 (사원번호)` 표시. VitalSampleSchema 도 optional 필드 확장 (max 40자)
- [x] iOS HealthKit entitlement + capability 적용 후 iPhone `BECKS` 실기기 권한 허용 + HR 84 / SpO₂ 98 / 손목 온도 35.9℃ 수집 확인
- [x] **★ release 빌드 + Apple Development 신뢰 + standalone launch 검증** — debug 빌드는 iOS 14+ 에서 `Cannot create a FlutterEngine instance in debug mode` 로 즉시 SIGKILL. release 빌드만 홈 아이콘 standalone launch 가능
- [x] **★ codesigned release 빌드 + devicectl install/launch** — Automatic signing (`F2P5ZFP65Q`) 으로 17.4MB. `xcrun devicectl device install app + process launch --terminate-existing` 한 번에 install + launch 성공
- [x] **★ Cloudflare Tunnel 우회** — 라우터 client isolation (`ping 192.168.219.114` 100% loss) 으로 LAN 직접 도달 불가. `cloudflared tunnel --url http://localhost:3000` → 무작위 `https://*.trycloudflare.com` 발급 (세션마다 변경)
- [x] `flutter test` 1/1 통과 (viewport 확대 + "수신 서버" row assertion 추가)
- [x] **★ 사원번호 기반 workerId 자동 분리 (2026-05-25)** — [main.dart:240-244](lib/main.dart#L240) 의 `_effectiveWorkerId` getter. 사원번호 입력 시 workerId = empId 자동, 미입력 시 빌드 타임 default fallback. `_pollOnce` (1차+fallback) / `_sendSos` / `_sendFall` 4 곳 교체. 빌드 한 번으로 여러 iPhone 자동 분리 (이전엔 모든 iPhone 이 `demo_ios_01` 충돌)
- [x] **★ YJH iPhone 15 Pro Max 추가 install (2026-05-25)** — Xcode 직접 빌드 SPM 헤더 4 issue → flutter CLI 표준 (clean + pub get + pod install + build ios --release) → 17.6MB AOT codesigned → `xcrun devicectl device install + process launch --terminate-existing` 한 번에 install + launch 성공

## 현재 상태

- **빌드**. iOS codesigned release 빌드 + **iPhone 2대 install 완료** (BECKS 장우진/EMP-6861, YJH iPhone 15 Pro Max 양지후/EMP-1024) + Apple Development 신뢰 + Health 수집 정상. **Cyён iPhone 16 install 차단** — Apple Developer team `F2P5ZFP65Q` 디바이스 한도 도달. **Galaxy 실기기 install 완료 (2026-05-27, 김동현/EMP-2222)** — UI/메타데이터 정상. **Health 권한 "대기" 블로커** — Health Connect 우산 권한 (앱 권한 "건강, 피트니스, 웰니스") 은 허용되었으나 데이터 타입별 권한 미허용. 4단계 검증 절차 (Health Connect 앱 설치 → worker_phone 데이터 타입별 권한 → Samsung Health 동기화 → Watch 인입) 진행 예정
- **★ Xcode 직접 빌드 영구 금지** — `flutter build ios --release` CLI 만 사용. Xcode Play / Run 버튼 사용 시 SPM 통합 플러그인 (`geolocator_apple` 등) 헤더 못 찾고 빌드 산출물 (build/ios/iphoneos/Runner.app) 을 120MB debug 로 깨면서 덮어씀
- **★ IDE Run ▶/디버그 🐞 버튼 영구 금지 (2026-05-26)** — VS Code/Android Studio Flutter plugin 의 Run 버튼은 `flutter run` (--release 없이) = debug 빌드를 install + launch. 우리 release 17.6MB AOT 산출물을 120MB debug 로 덮어씀 → iOS 14+ standalone launch 거부 다이얼로그
- **★ Apple Developer team 디바이스 한도 = 연 100대 / 1년 1회 reset** — Cyён iPhone 16 install 차단 원인. Android 측 device 수 제약 없음 → Galaxy 실기기로 우회 (`adb install` + debug APK 도 standalone 실행 OK)
- **수신 서버 경로**. iPhone → **Cloudflare Tunnel** (세션마다 새 `https://*.trycloudflare.com`, 현재 `prisoners-hosting-shape-assists`) → Mac localhost:3000 → Next.js mock receiver. LAN 직접 도달은 라우터 client isolation 으로 차단됨 (+ Mac IP 환경 따라 변동). dev + cloudflared 둘 다 `nohup ... & disown` 으로 셸 lifecycle 분리 → 부모 task 종료 영향 없음
- **작업자 메타데이터**. 우상단 ⚙️ → 이름·사원번호 (★ 사원번호가 자동 workerId 가 됨) + 보호자 이름·전화. payload 마다 자동 동봉 → 대시보드 카드 헤더 + 모달 + 차트 패널 + recent table 모두 실시간 매칭
- **시연 디바이스 (2026-05-27 갱신)**. iPhone 2대 (BECKS + YJH, install 완료) + Apple Watch + **Galaxy 실기기 1대 (김동현/EMP-2222, install 완료, Health 권한 활성화 남음)** + Galaxy Watch (페어링 + Samsung Health 인입 남음)
- **마지막 단계**. (a) **★ Galaxy Health Connect 권한 활성화** (현재 블로커) — Step 1 Health Connect 앱 설치 확인 → Step 2 worker_phone 데이터 타입별 권한 (HR/SpO₂/체온) 각각 토글 ON → Step 3 Samsung Health → Health Connect 동기화 ON + 항목별 ON → Step 4 Galaxy Watch 페어링 + Samsung Health 측정값 인입 확인 → 앱 강제 종료 + 재시작 + "수집 시작" (b) **2 iPhone (BECKS + YJH) 우상단 ⚙️** → 작업자 이름 + 사원번호 + 보호자 + 수신 서버 URL `https://prisoners-hosting-shape-assists.trycloudflare.com/api/mock/vital` + 저장 + 위치 권한 "항상 허용" (Galaxy 는 이미 동일 URL 저장됨) (c) 대시보드 빈 슬롯 → 대기 큐 → 폰 선택 → 등록 → 카드 표시 검증
- **AWS**. 결제 문제로 보류. 실제 IoT endpoint/cert 연결은 이후

## 다음 할 일

1. **★ 사용자 — Galaxy Health Connect 권한 활성화 (현재 블로커)** — 4단계 검증 절차: Step 1 `설정 → 앱 → "Health Connect"` 검색 → 설치 여부 확인 (Android 14+ OS 내장 / 13 이하 Play Store "Health Connect by Android" 별도 설치) → Step 2 Health Connect 앱 → 앱 권한 → worker_phone → 심박수/산소포화도/체온 각각 토글 ON → Step 3 Samsung Health → ⋮ → 설정 → Health Connect → 동기화 ON + 항목별 ON → Step 4 Samsung Health 홈에 워치 HR 측정값 가시 확인 + Galaxy Wearable 페어링 점검 → 앱 강제 종료 + 재시작 + "수집 시작" 재시도
2. **사용자 — 사용자 확인 4건** — Q1 Galaxy 모델/Android 버전, Q2 Health Connect 앱 설치 여부, Q3 "수집 시작" 시 권한 다이얼로그 표시 여부 (안 뜨면 Health Connect 미설치 강력 신호), Q4 Samsung Health 에 워치 HR 측정값 가시 여부
3. **사용자 — 선택적 adb logcat 진단** — USB 디버깅 ON + Mac 연결 시 `adb logcat -s flutter:V HealthConnectKit:V | grep -iE 'health|permission'` 로 `requestAuthorization` false 사유 직접 추출
4. **사용자 — 2 iPhone (BECKS + YJH) URL 갱신** — 우상단 ⚙️ → 작업자 이름 + 사원번호 (BECKS=`EMP-6861`, YJH=`EMP-1024`) + 보호자 이름·전화 + 수신 서버 URL `https://prisoners-hosting-shape-assists.trycloudflare.com/api/mock/vital` + 저장. 위치 권한 "항상 허용". (Galaxy 는 이미 동일 URL 저장됨)
5. **사용자 — 시연 시나리오** — 폰 잠금 화면에서도 5초 폴링 유지 확인 → SOS 버튼 탭 → 대시보드 모달 자동 팝업 + GPS 좌표 + 보호자 매칭 + SMS body 사전작성 확인. 낙상 시연 버튼 → 카드 낙상 행 빨강 블링크 + 누적 차트 fall 칩
6. **자동 (D2)** — 나머지 위험 감지 자동 트리거 (SpO₂ alert · 심박 이상 SVG marker · fall analyzer 자동 호출)
7. **보류 옵션** — Apple Developer 콘솔 device 정리 → Cyён 폰 install 재시도 (annual reset 1년 1회, 발표 후 검토)
8. **보류 (AWS dev)** — IoT Core mTLS endpoint/cert 발급 후 `_publisher.connectMqtt(config)` 활성화. tunnel 불필요

상세는 [../../docs/checklist.md "D1"](../../docs/checklist.md) 참조.

## 명령어

```bash
flutter pub get                                     # 의존성 설치
flutter test                                        # 위젯 테스트
flutter doctor                                      # 환경 점검
flutter clean && flutter pub get                    # release 재빌드 전 캐시 클린

# iPhone codesigned release 빌드 (★ 표준 — Automatic signing)
flutter build ios --release \
  --dart-define=MOCK_RECEIVER_URL=https://<tunnel-url>/api/mock/vital

# devicectl 로 직접 install + launch (이미 codesigned 된 Runner.app)
xcrun devicectl device install app --device <iPhone_id> build/ios/iphoneos/Runner.app
xcrun devicectl device process launch --device <iPhone_id> --terminate-existing kr.indusview.workerPhone

# (대안) flutter run 한 번에 (codesign + install + launch + hot reload 콘솔)
flutter run --release -d <iPhone_id> \
  --dart-define=MOCK_RECEIVER_URL=https://<tunnel-url>/api/mock/vital

# Android (시뮬레이터/실기기)
flutter emulators --launch SafetyMonitor_API_35
flutter run -d SafetyMonitor_API_35 \
  --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital
flutter build apk --debug

# Cloudflare Tunnel (Mac, dev 서버 노출 — 매 세션 새 URL)
brew install cloudflared    # 1회만
cloudflared tunnel --url http://localhost:3000 --no-autoupdate
# → stdout 에서 `https://<random>.trycloudflare.com` 추출 후 iPhone in-app URL 에 입력
```

## 사전 조건

- iOS — Xcode 26.4+ · CocoaPods 1.16+ · iPhone + Apple Watch 페어링 · Apple Development 신뢰 1회 (설정 → 일반 → VPN 및 기기 관리)
- Android — Android Studio + Android SDK + JDK 17 · Galaxy phone + Galaxy Watch 페어링 (Health Connect 권한)
- Mac — dev 서버 (`pnpm dev:web`) + cloudflared tunnel 백그라운드 running
- AWS — IoT Core dev 계정 + 디바이스 인증서 (결제 문제 해소 후 연결)
