# 잠금·백그라운드 생체 모니터링 — 상용화 해결 로드맵

> 발표 프로토타입에서 드러난 **"iPhone 잠금 시 생체데이터 미수신"** 문제를, 실제 상용화 단계에서 어떻게 푸는지 정리한 의사결정 문서.
> 본 문서는 **상용화(발표 후) 트랙** 용 — 발표(2026-07-07) 범위에는 포함되지 않는다. 발표용 대응은 [§7](#7-발표프로토타입-vs-상용화-구분) 참조.
> 근거 스킬 — axiom-health(`authorization-and-privacy.md`/`sync-and-background.md`/`workouts.md`), axiom-watchos(`platform-basics.md`/`background-and-networking.md`).

---

## 1. 한 줄 결론

잠금 중 생체 수신은 **"잠금 우회"로 못 풀고, *데이터 소스*를 "폰이 HealthKit을 읽기" → "워치/전용 디바이스가 직접 스트리밍"으로 바꿔야** 풀린다. **Flutter→네이티브 재작성은 이 문제에 아무 효과가 없다.**

---

## 2. 문제 정의 — iOS 잠금 시 HealthKit 읽기 불가 (플랫폼 한계)

### 증상 (2026-05-28 DB 진단으로 확정)

BECKS(EMP-6861) 최근 150건을 수신 간격 + null 패턴으로 분석한 결과.

- **전송은 한 번도 안 끊김** — 일정하게 5.0초 간격, 12초 넘는 공백 0건 (위치 keepalive + 콜백 이중화 작동).
- **vitals만 잠금 구간에서 null** — 잠금 해제 구간엔 `hr 85→90.9 / spo2 94 / temp 35.9` 실측, 잠금 구간엔 `null/null/null` 으로 깜빡임.
- 대시보드는 store sticky 로 **직전 실측값을 유지**(고정)해 카드가 비지는 않으나, 값이 *변하지 않는다*(새 읽기 불가).

### 근본 원인

iOS가 잠금 시 건강데이터를 `NSFileProtectionComplete` 로 암호화 → 백그라운드 앱이라도 잠금 중 복호화 불가. Apple 공식 문서(*Protecting User Privacy*).

> "your app may not be able to read data from the store when it runs in the background."
> "Writes still work in the background via temporary caching. **Reads do not reliably work when the device is locked.**"

**앱 코드로 끌 수 있는 엔타이틀먼트가 없다.** 즉 이건 우리 코드의 버그가 아니라 플랫폼 설계다.

> 참고 — "디자인 변경 전엔 잠금 중에도 됐다"는 착시. 제거된 시연 fallback(`72/97/36.5` 조작)이 잠금 시 null 을 가짜값으로 채워 *그렇게 보였던* 것(실측 아님).

---

## 3. 안 되는 길 (오해 정리)

| 시도 | 잠금 중 실시간 읽기 | 이유 |
|---|---|---|
| 위치 keepalive + HealthKit read | ❌ | 전송은 살아있지만 잠금 중 read 가 null (DB로 입증) |
| `HKObserverQuery` + `enableBackgroundDelivery` | ❌ | 변경 시 앱을 깨우나, 보호 데이터 읽기는 **잠금 해제 시점까지 지연**만 |
| `HKAnchoredObjectQuery` (delta 동기화) | ❌ | 동일한 잠금 제약 |
| **Flutter→Xcode 네이티브 iOS 재작성** | ❌ | Flutter `health` 는 네이티브 `HKHealthStore`/`HKSampleQuery` 의 얇은 래퍼. 같은 API → 같은 null. **잠금 한계는 Flutter 한계가 아니라 iOS 한계** |
| 투트랙(Flutter + 네이티브 iOS + 네이티브 Android) | ❌ + 비용 폭증 | 소스를 안 바꾸면 네이티브여도 동일. 코드베이스 3개 = 유지보수 3배 |
| iOS 26 iPhone-originated workout session | ❌ | iPhone엔 심박 센서가 없음 — 결국 워치가 소스여야 함 |

**결론 — "네이티브로 다시 짜기"는 잠금 문제 해결과 무관하다.** 네이티브가 의미 있는 경우는 `health` 패키지가 안 감싸는 API(워크아웃 세션 mirroring 등)가 필요할 때뿐이고, 그것조차 잠금 중 읽기는 못 준다.

---

## 4. 되는 길 (데이터 소스 전환)

| 방안 | 메커니즘 | 잠금 중 동작 | 비용 |
|---|---|---|---|
| **A. Apple Watch workout session** | watchOS 앱이 `HKWorkoutSession`+`HKLiveWorkoutBuilder` 로 워치 센서를 연속 수집 | ✅ 워치가 소스라 폰 잠금 무관 | 네이티브 watchOS 타깃 신규 |
| **B. 자체 BLE/LTE 웨어러블** | 전용 디바이스가 BLE GATT notify 로 push, 폰은 Core Bluetooth `bluetooth-central` 백그라운드 모드로 수신 | ✅ HealthKit 미경유 → 암호화 한계 자체가 없음 | 하드웨어 + 펌웨어 |
| **C. Android Wear OS** | Wear OS 앱 Health Services + foreground service | ✅ iOS 같은 잠금-읽기 제약 없음 | Wear OS 앱 (또는 Flutter foreground service) |

### 4.A Apple Watch 워크아웃 세션 (Apple 생태계 표준)

Strava·Nike 등이 "폰을 주머니에 넣고 잠가도 연속 심박"을 얻는 정석 방식.

- **수집** — watchOS 앱에서 `HKWorkoutSession`(예: activityType `.other`, "작업 중" 세션) + `HKLiveWorkoutBuilder`. 워치가 세션 동안 심박을 연속 수집. `Info.plist` 에 `WKBackgroundModes: [workout-processing]` 필수.
- **전송 2안**.
  - **직접(권장)** — 워치 `URLSession` 으로 서버 POST. 페어 iPhone 온라인이면 시스템이 블루투스 프록시 경유, **LTE 워치면 셀룰러 직송** → 폰 의존성 0. 끊김 대비 `URLSessionConfiguration.background(...)`.
  - **mirroring** — 워치 `startMirroringToCompanionDevice()`(watchOS 10+) → iPhone companion 이 콜백 수신(iOS 17+) → relay. 단 Flutter Dart 가 `WCSession` 을 직접 못 써서 iOS Swift platform channel 브리지 추가 필요 → 직접 전송이 더 깔끔.

#### watchOS 측 제약 (axiom-watchos)

| 제약 | 내용 |
|---|---|
| 네이티브 필수 | Flutter 는 watchOS 빌드 미지원. 워치 앱은 **100% Swift/SwiftUI** 별도 타깃 (Flutter iOS Xcode 프로젝트에 watchOS 타깃 추가). 권장 형태 = independent + companion |
| **배터리** | 워크아웃 세션은 센서 상시 가동 → 소모 큼. 일반 Watch(~18h)는 8시간 풀시프트 부담. 산업용은 **Ultra(36h+)** 또는 교대 충전 전제. 실측 Ultra 1 ≈ ~10.7%/hr(§9.3) → 전송 배칭·센서 cadence·수집타입 최소화로 절감(A+B+C) |
| **네트워킹 (TN3135)** | watchOS 일반 앱은 raw socket·WebSocket·NWConnection 차단 → **URLSession(HTTP)만** 허용. 워치에서 **MQTT 직접 불가** (HTTP 게이트웨이 또는 워치→폰→MQTT 경유) |
| Always On | 잠금/저전력 시 최대 1Hz 갱신. 운동 화면 단순 뷰로 분기 |
| 단일 세션 | 워크아웃 세션 동시 1개만. 작업자가 운동 앱을 따로 켜면 `anotherWorkoutSessionStarted` 충돌 |
| 제출 게이트 | App Store 제출 시 **watchOS 26 SDK + arm64**(2026-04 의무). 발표 데모엔 무관 |
| off-label 성격 | "작업 중" 상시 모니터링에 워크아웃 세션을 쓰는 건 피트니스 앱의 연속 HR 정석이나, 워치에 운동 표시가 뜨고 사용자가 종료할 여지가 있음 |

- 추정 작업량 — 견고한 1차 버전 기준 약 1~2주(워치 앱 + HealthKit 권한 + 세션 + URLSession 전송 + 폰과 메타데이터 동기화).

### 4.B 자체 BLE/LTE 웨어러블 (산업 grade 최선)

- 전용 디바이스가 raw HR/SpO₂/체온을 BLE characteristic notification 으로 스트리밍 → 폰은 Core Bluetooth `bluetooth-central` 백그라운드 모드로 **잠금 중에도 수신**. **HealthKit 을 전혀 안 거치므로** iOS 잠금-암호화 한계가 적용되지 않는다.
- 디바이스 자체에 NB-IoT/LTE 를 넣어 **게이트웨이(폰) 없이 클라우드 직송**하면 폰 잠금·분실·방전 변수 전부 제거 → KOSHA 실시간 위험성 평가·산재 자료(gap-free 기록) 요구에 가장 부합.
- 비용은 가장 크나(하드웨어), 신뢰성·통제력은 최상. 프로젝트의 "자체 웨어러블" 로드맵과 일치.

#### ★ 계획 (확정 아님 · 2026-05-29) — 플랫폼별 잠금-대응 분기 + 자체 웨어러블 Android 화

> **확정 아님 — 방향성만.** 발표(2026-07-07) 비범위, 발표 후 트랙.

- **iOS / 애플워치** — HealthKit 잠금-암호화를 우회하는 `HKWorkoutSession` 워크아웃 세션(이미 §4.A PoC PASS).
- **Android (폰 / 자체 앱)** — 우회 트릭 불필요. **포그라운드 서비스 정공법** — 상주 서비스가 센서 읽고 서버로 직접 POST(잠금 중 포함). 근거: 안드로이드는 부팅 후 **최초 1회 잠금 해제** 시 Credential-Encrypted 저장소가 **재부팅 전까지 유지** → 화면을 다시 잠가도 재암호화 안 됨(iOS 의 per-lock 재암호화와 다름). 전제 = foreground service + 배터리 최적화 예외(+ 삼성 절전 앱 제외).
- **자체 웨어러블** — **Android 기반(AOSP), 디스플레이 없음.** 헤드리스 상주 서비스가 자기 센서 읽고 (자체 LTE/NB-IoT 있으면) 클라우드 직송. 모든 설정·페어링은 **폰 앱에서**(BLE GATT config write 또는 서버 매개 pull) — 자체 하드웨어라 애플워치의 WCSession 컴패니언 제약 없음.
- **미확정** — Wear OS(Health Services + Data Layer) vs 커스텀 AOSP · 자체 통신(LTE/NB-IoT) vs 폰 테더링 · 칩/펌웨어 선정.

### 4.C Android 측

- Android 는 native/Flutter 무관하게 **foreground service**(상시 알림)로 잠금 중 센서 읽기가 iOS 보다 자유롭다. Wear OS 는 Health Services(`PassiveMonitoringClient`/`ExerciseClient`)로 연속 HR.
- 즉 Android 의 자유도는 "네이티브라서"가 아니라 **OS 정책 차이** — Flutter 에서도 foreground service 플러그인으로 가능.

---

## 5. 공통 — store-and-forward 버퍼링 (컴플라이언스 필수)

실시간 전송에 구멍이 생겨도 *기록*은 끊기면 안 된다(산재 3년 보존). 워치/디바이스가 **로컬 링버퍼에 버퍼링 → 재연결 시 delta sync**. HealthKit 소스라면 anchored-query(`HKAnchoredObjectQueryDescriptor` + `HKQueryAnchor` 영속) 패턴으로 누락·중복·삭제(`HKDeletedObject`)까지 정확히 동기화하는 게 정석(axiom-health `sync-and-background.md`).

---

## 6. 권장 상용화 아키텍처

- **Apple 측** — watchOS 앱 + 워크아웃 세션 (LTE 워치면 직송, 아니면 폰 relay).
- **Android 측** — Wear OS 앱 + Health Services + foreground service.
- **장기/산업 grade** — 자체 BLE/LTE 웨어러블(B). 최종적으로 가장 신뢰성 높음.
- **횡단** — 디바이스 버퍼링 + delta sync(gap-free 기록).
- **분석 위치 불변** — 어느 소스든 단말/워치는 raw 수집·전송만, 분석은 `packages/analyzers`(서버 사이드) 단일 source 유지(CLAUDE.md 하드룰).

---

## 7. 발표(프로토타입) vs 상용화 구분

| | 발표 (2026-07-07) | 상용화 (발표 후) |
|---|---|---|
| 잠금 대응 | iPhone **자동 잠금 끄기**(화면 on=백그라운드 읽힘) / **Galaxy 잠금 시연** | §4 의 소스 전환(워치 세션 / 자체 웨어러블) |
| 워치/Wear 앱 | 비범위 (작성 안 함) | 작성 |
| 서사 | "잠금 한계를 인지하고 있으며, 상용 단계에선 워크아웃 세션/자체 웨어러블로 푼다" 슬라이드로 제시 | 실제 구현 |

발표에서 잠금 한계를 *숨기지 말고* 본 로드맵을 근거로 "해결책을 안다"고 보여주는 편이 설득력이 높다.

---

## 8. 결정 로그 / 참고

- 2026-05-28 — DB 진단으로 "전송 지속 + vitals null" 확정, iOS HealthKit 잠금-암호화가 근본 원인임을 axiom-health 로 검증. 메모리 `ios-healthkit-locked` 와 일치.
- 2026-05-28 — "네이티브 재작성으로 해결되는가?" 질문에 **불가** 결론 — Flutter `health` 는 네이티브 HealthKit 의 래퍼라 잠금 한계 동일.
- 인용 출처 — Apple *Protecting User Privacy*, TN3135(watchOS 저수준 네트워킹 제한), axiom-health/axiom-watchos 스킬 레퍼런스.
- 2026-05-28 세션3 — "네이티브 재작성 ≠ 잠금 해결" 재확인(§3) + **워치 워크아웃 세션 채택**(§4.A) + 독립 워치 PoC 구현·구동검증(§9, 커밋 `1873254`).
- 2026-05-28 세션3(이어서) — **물리 워치 §4 PASS** — BECKS Apple Watch Ultra 실기기에서 iPhone 잠금 15분간 워치 null 0% vs 폰 null 98%. §4.A 워치 워크아웃 세션 경로 실증 확정(§9). 설치 교정 커밋 `b89042d`.
- 관련 문서 — [plan.md](plan.md) · [context-notes.md](context-notes.md) · [stress-algorithm-plan.md](stress-algorithm-plan.md). 비범위 정의는 CLAUDE.md "의도적 비범위" 참조.

---

## 9. 워치 워크아웃 세션 PoC — 구현·검증 (2026-05-28 세션3)

§4.A 를 실제 코드로 검증하기 위해 **독립 watchOS PoC** 를 [../apps/worker-watch-poc/](../apps/worker-watch-poc/) 에 구현.

- **구성** — `WorkoutManager`(HealthKit 권한 + `HKWorkoutSession`+`HKLiveWorkoutBuilder` HR live 수집, end-sequence 준수) · `VitalTransmitter`(`URLSession` POST `/api/mock/vital` + 실패 버퍼링·재전송) · `ContentView`/App(시작·정지·HR·전송 상태) · Info.plist(`workout-processing`) · entitlements(HealthKit) · `project.yml`(xcodegen) · README(셋업·서명·§4 검증).
- **Flutter 와 분리** — 별도 watchOS 프로젝트(bundle `kr.indusview.safetyWatchPoC`)라 `apps/worker-phone` release AOT 를 안 건드림 → 여기선 Xcode 빌드가 정상·유일 경로(IDE Run 금지 규칙은 Flutter 앱 전용). 생성 `.xcodeproj` 는 gitignore(`project.yml` 이 source).
- **검증(완료)** — swiftc 타입체크 EXIT=0 / `xcodebuild ... watchOS Simulator` **BUILD SUCCEEDED** / 페이로드 `VitalSampleSchema` Zod valid / 로컬 dev POST 201.
- **★ 실기기 §4 잠금 검증 — PASS (2026-05-28)** — BECKS Apple Watch Ultra(watchOS 26.5)에 install(무료 **Personal Team** 서명 → `F2P5ZFP65Q` 100대 한도 우회). iPhone 잠금 15분 구간 DB 판정:
  - **EMP-9001 워치**: 182건 · **null HR 0% · gap>20s 0**(최대 7s) · 배터리 85%→85%(15분 변화 0)
  - **EMP-6861 폰(대조군)**: 244건 · **null HR 98%** · gap>20s 0 → 전송은 양쪽 정상, 차이는 *읽기 소스*뿐
- **결론(실증 확정)** — "잠금 중 HR 연속 수신"이 실기기에서 입증됨. §4.A(워치 워크아웃 세션)가 발표용 한계(자동잠금 끄기/Galaxy)를 넘어 **상용 1차 경로로 확정**. SpO₂/체온 연속이 필요하면 §4.B(자체 BLE/LTE)로 확장. 배터리 풀시프트 소모는 더 긴 측정 필요(미검증 항목).
- **설치 교정(커밋 `b89042d`)** — PoC가 빌드는 됐으나 실기기 설치 거부 → Info.plist 표준 번들 키 + `WKWatchOnly=true`(누락 시 MIInstaller 97 InvalidCompanionApp) 추가, entitlement 에서 무료팀 미지원 `healthkit.background-delivery` 제거.

### 9.1 통신 경로와 "현장 1km+" 거리 해명

흔한 오해 — "애플워치가 블루투스만 가능하면 1km 떨어진 관제 웹에 어떻게 보내나". **현재 로직에서 워치가 블루투스로 관제 웹까지 직접 쏘는 게 아니다.** 블루투스는 *워치 ↔ 옆에 있는 iPhone* 한 구간에만 쓰이고, *iPhone ↔ 관제 웹* 구간은 인터넷이다.

```
워치 ──(BLE/Wi-Fi, 근거리)── iPhone ──(인터넷: LTE/Wi-Fi)── cloudflared ── 관제 웹
       └ 워치 URLSession 은 폰을 게이트웨이로 watchOS 가 자동 라우팅(TN3135)
```

- 워치 `VitalTransmitter` 의 `URLSession.shared` POST 는 **HTTP 패킷**이지 블루투스 신호가 아니다. watchOS 가 "직접 인터넷이 없으면 페어 iPhone 경유로 자동 라우팅"한다.
- **"1km" 가 어느 구간이냐**가 관건:
  - **워치↔iPhone 이 1km** (워치만 블루투스, 폰은 멀리) → **불가능.** 블루투스 실효 도달거리 ≈ 10m. 워치가 게이트웨이(폰)에 못 닿아 인터넷 자체에 못 올라가고 `VitalTransmitter` 버퍼에만 쌓이다 재연결 시 드레인.
  - **iPhone(게이트웨이)↔관제 웹 서버가 1km** (작업자가 워치+폰을 같이 소지) → **문제없음.** 이 구간은 인터넷 라우팅이라 물리 거리가 1km든 1000km든 무의미. cloudflared 터널이 "거리 무관 인터넷 통과"를 담당.
- **실제 현장** — 작업자는 워치와 폰을 *둘 다 몸에 지니므로* 워치↔폰은 사실상 1m 미만 → 위 후자(Case B)에 해당. "BLE 직송 불가"의 의미는 *워치가 1km 떨어진 관제소로 블루투스 직송* 이 불가능하다는 것이고, 그래서 **워치→iPhone→웹** 구조로 고정한 것. 현재 로직이 1km+ 현장을 전제로 설계된 게 맞다.
- **보강** — BECKS의 Apple Watch Ultra 는 **LTE(셀룰러)+Wi-Fi 내장**이라, 폰이 블루투스 범위를 벗어나도 워치가 자체 LTE/Wi-Fi 로 직접 인터넷에 올라가 관제 웹에 도달 가능(Case A 도 회피). 단 셀룰러 요금제 활성화 여부는 `확인 필요`.

### 9.2 워치 PoC 기능 확장 (2026-05-29 세션5)

§4 잠금 PASS 위에 모니터링 항목·운영성·브랜드 UI 를 확장. 테스트 기기 = **Apple Watch Ultra 1**(Watch6,18).

- **센서별 가용성 (Apple Watch 한계 명시)**:
  - **심박** — 워크아웃 세션 live 콜백(연속). 기존.
  - **낙상** — Apple 내장 낙상감지는 **서드파티 미개방** → `FallDetector`(Core Motion `CMMotionManager` 50Hz, 충격 ≥2.8G + 충격 후 정지 1.2s)로 자체 판정. 임계는 PoC 기본값, 현장 튜닝 필요. 워크아웃 세션 중 가속도 지속 → 잠금-무관.
  - **SpO₂** — 한국 판매 Ultra 1 은 Masimo 미국 금지 미적용이라 동작. **연속 아님**(백그라운드 간헐 스팟, 앱이 측정 트리거 불가, 워크아웃 중 더 드묾) → `SpO2Reader`(`HKAnchoredObjectQuery`) 최신 샘플 구독. "참고용 저빈도".
  - **손목온도** — Apple Watch 는 **수면 중에만** 측정(`appleSleepingWristTemperature`), 주간 on-demand API 없음 → 워치 모니터링 **불가**. 실시간 작업 중 체온은 §4.B 자체 BLE/LTE 웨어러블(피부온 센서)이 유일한 길.
  - **스트레스** — 워치는 입력 7종 raw 수집만(`StressInputsReader`, 폰 미러). 지수는 `packages/analyzers` `computeStressIndex` **단일 소스**가 서버/대시보드에서 산출(워치 자기 HealthKit 읽기라 폰 잠금 중에도 입력 수집). Swift 포팅은 drift 위험으로 기각.
- **운영성 — 인앱 설정 동적화** — 수신 URL·작업자(이름/사원번호)를 워치 설정에서 편집(UserDefaults, 매 전송 동적 읽기) + 연결 테스트. 터널 URL 회전 시 **재빌드·재설치 불필요**. 상용에선 named tunnel/MDM 프로파일로 대체될 부분.
- **UI** — 파스텔 카드 섹션(메트릭별), 단말은 위험 판정색 없음(raw 표시, 서버 판정). 앱 아이콘 = VitAIGuard, **watchOS 단일 다크 아이콘**(다크/라이트 변형은 iOS 홈 전용이라 워치 미적용).
- **실기기 검증(완료, 2026-05-29 세션5)** — 누적 변경 재설치 후 EMP-9001 신규 빌드가 관제 store 에 age 1s 로 **SpO₂ 92·안정심박 100·활동에너지·낙상 accelG 5.45·배터리 70·작업자명 장우진** 수신 → SpO₂/낙상 센서 + 스트레스 입력 + 인앱 설정 실기기 동작 확인(Ultra 1 한국 모델 SpO₂ 정상). **남은 검증** = 배터리 풀시프트(8h) 소모만. 발표 비범위(상용화 트랙).

### 9.3 워치 배터리 소모 분석 + 절감 A+B+C (2026-05-29 세션8)

- **실측(Ultra 1)** — "설치 후 배터리 소모 증가" 보고. DB(EMP-9001) 연속 방전 70%→65% / 28분 ≈ **시간당 ~10.7%**(완충 ~9h), 전송 cadence 4~5초. Ultra 1 정상 idle ~36h 대비 **3.5~4배** → 8h 풀시프트 빠듯(여유 <1h).
- **원인(추정 비중)** — ① 워크아웃 세션 **연속 광학 HR**(~50-65%, **불가피** — 잠금 우회 핵심) ② Always-On+UI(~15-20%) ③ **5초마다 개별 URLSession**=라디오 상시 기상(~10-20%) ④ 가속도 50Hz(~5-10%) ⑤ HealthKit 쿼리(~3-5%). 정밀 per-subsystem 은 Instruments Energy Log 필요.
- **절감 = 부차 소모만(지배원은 제거 시 잠금 우회 깨짐)** — **A** 송신 30초 배칭(라디오 기상 ~1/6, 낙상 즉시, backlog 재시도, ts 보존, 서버 배열 수신 하위호환) · **B** 가속도 50→25Hz · **C** 불필요 수집 타입 disable(거리/기초대사, HR·활동에너지 유지). 합산 ~7~8%/hr 수준(추정).
- **상태** — 코드 적용 + watchOS 시뮬 빌드/tsc/POST 검증 + **BECKS Ultra Release 빌드·재설치 완료**. **§4 잠금 재검증 미완**(실기기·사용자 몫) — 기준 변경: 배칭이라 "전송 끊김 0"은 **`ts`(수집시각) gap**(~5초)으로 봐야 하고 received_at 은 30초 묶임. null HR 0% 동일. **상용 시사점** = 워크아웃 세션 채택 시 전송 배칭·센서 cadence·수집타입 최소화가 표준 절감 레버. 8h 풀시프트 소모 절감폭 실측은 여전히 미검증.

### 9.4 상용화 배터리 최적화 경로 — 프로토타입 제약 탈출 (2026-06-05 세션22)

> 프로토타입의 ~11h(완충, 안정 구간 ~8~9%/hr 실측)는 **무료 개발계정 + 무개조 소비자 Apple Watch + "잠금우회를 워크아웃 세션으로 구현"** 한 데서 온 **인공적 산물**이다. §9.3 비중상 지배원(워크아웃 세션 연속 광학 HR ~50-65%)을 프로토타입은 못 건드리지만, 상용화는 **접근법 자체를 교체**해 이 지배원까지 절감할 수 있다. 즉 "애플워치 앱 코드 미세 튜닝"이 아니라 **데이터 소스 전환(§4)** 이 본질적 해법이다.

**3 트랙** (§4 데이터 소스 전환과 정합):

| 트랙 | 핵심 | 지배원(연속 HR) 처리 | 기대 배터리 |
|---|---|---|---|
| **① Apple Watch + 유료 엔타이틀먼트** | 24/7 워크아웃 세션 불필요화 | observer/배치 전달로 대체 → 대폭↓ | Ultra 8h 풀시프트 여유 확보 목표 |
| **② Android / Wear OS** (§4.C) | 잠금-읽기 제약 없음 → 우회 자체 불필요 | 포그라운드 서비스가 자연 cadence로 읽음 → 사실상 소멸 | 폰 종일 / Wear OS 풀시프트 |
| **③ 자체 AOSP 웨어러블** (§4.B "산업 grade 최선") | 펌웨어가 센서 duty-cycle 직접 제어 | 설계 단계에서 제거 | 산업용 **다일(days)** |

**① Apple Watch 유료 엔타이틀먼트 표** — 무료 Personal Team(F2P5ZFP65Q) 서명 불가, **유료 Developer Program + 일부 Apple 승인** 필요:

| 엔타이틀먼트 / API | 효과 | 비고 |
|---|---|---|
| `com.apple.developer.healthkit.background-delivery` | `HKObserverQuery` 백그라운드 HR 수신 → **연속 워크아웃 세션 불필요**(지배원 절감) | §4 때 무료팀이라 제거한 그 엔타이틀먼트(§156). 백그라운드 전달은 throttle/지연 → 응급 즉시성과 **trade-off** |
| `com.apple.developer.coremotion.fall-detection` (`CMFallDetectionManager`) | Apple 저전력 칩이 낙상 처리 → 우리 deviceMotion 50Hz **부차 제거** | watchOS 9+, Apple 승인 필요(세션21 결정 ch) |
| `CMBatchedSensorManager` (엔타이틀먼트 불요, Ultra/S8+) | 가속도/자이로 **배치 전달**(앱 프로세서 sleep) → 모션 부차 대폭↓ | 워크아웃 세션 중·잠금 중 배치 전달 spike 검증 필요(`확인 필요`) |

**② Android / Wear OS** — 잠금-읽기 제약이 없어 워크아웃 세션 트릭이 **불필요**. 포그라운드 서비스가 자연 cadence로 센서를 읽으므로 지배원이 소멸한다. Wear OS `PassiveMonitoringClient` = 저전력 연속 HR(워크아웃 세션 비용 없이). 모션은 OS 센서 FIFO 하드웨어 배칭(`SensorManager` batch latency)으로 추가 절감.

**③ 자체 AOSP 웨어러블** (§4.B) — 펌웨어가 HR(N초 주기)·모션(wake-interrupt)·라디오(duty-cycle)를 직접 제어 + 큰 배터리 + 무디스플레이 → 소비자 워치의 배터리 천장 자체를 벗어남. 산업용 안전 밴드가 다일~주 단위로 가동되는 근거.

**정직한 한계** — (a) 백그라운드 전달은 전력↓ 대신 응급(낙상/SOS) 즉시성↓ → trade-off 튜닝 필요(정확 cadence `확인 필요`). (b) Apple Watch 는 유료 엔타이틀먼트로도 **소비자 기기 한계**가 잔존(완전한 다일 배터리는 어려움). (c) 진짜 풀시프트+여유는 **자체 HW 가 정답**. 전부 **발표 비범위(상용화 트랙)**.
