# 갤럭시워치 단독 수집기 — 결정과 근거

작업 중 내린 결정을 근거와 함께 쌓는다. 나중에 "왜 이렇게 했나" 를 다시 묻지 않기 위해서다.

## R-01 · SpO₂ "상시 불가" 는 과한 결론이었다 — 비교 기준이 틀렸다

08-24 1차 판단에서 *"SpO₂ 상시 불가 → 안드로이드 트랙 재고"* 까지 적었다. **철회한다.**

틀린 이유는 **iOS 쪽을 다시 안 잰 것**이다([[L-107]] ①). 현재 iOS 도 SpO₂ 를 상시로 재지 않는다.

```swift
// WatchStreamer.swift:735 — 앱은 측정을 시키지 않는다. 애플워치가 알아서 잰 것을 줍는다
query.updateHandler = { _, samples, _, newAnchor, _ in self?.ingestSpO2(...) }
```

`HKAnchoredObjectQuery` = **수동 구독**. 측정 시점·주기는 애플이 정하고 앱은 개입 못 한다.

| | iOS 현재 | 갤럭시워치8 |
|---|---|---|
| 측정을 누가 시키나 | 애플워치가 알아서 | **앱이 직접** (`SPO2_ON_DEMAND`) |
| 주기 | 애플 비공개 · 산발 | **앱이 정함** |

⟹ 이 항목은 **갤럭시워치가 우위**다. "연속 스트림이 없다" 와 "상시 값을 못 얻는다" 는 다른 말이다.

## R-02 · 판정 근거는 웹 문서가 아니라 AAR 바이트코드다

사용자가 로컬 SDK 2종을 제공해 `javap` 로 열거형을 직접 읽었다([[L-112]] ① — 채널을 코드로 확인).

```
SPO2              ← deprecated · on-demand
SPO2_ON_DEMAND    ← 현행 · "1 data point for each measurement"
```

**웹 요약만 봤으면 `SPO2` 라는 상수가 따로 있는 것을 근거로 "상시가 있다" 고 오독할 뻔했다.**
공식 API 레퍼런스가 둘 다 on-demand 라고 명시해 확정했다.

## R-03 · 이전 표를 뒤집은 발견 3건 — 워치8이 애플워치를 이긴다

AAR `ValueKey` 하위 클래스를 전수로 읽어 나왔다.

| 발견 | 근거 클래스 | 의미 |
|---|---|---|
| 주변 온도 | `SkinTemperatureSet` = `OBJECT_TEMPERATURE` + **`AMBIENT_TEMPERATURE`** | 스키마의 `skinTempC` **와** `ambientTempC` 를 둘 다 채운다. 애플은 주변온을 안 준다 ⟹ WBGT 환경축이 작업자별로 쪼개진다 |
| HRV 원본 | `HeartRateSet` = `HEART_RATE` + **`IBI_LIST`** + `IBI_STATUS_LIST` | IBI 가 상시로 온다 ⟹ SDNN 을 직접 계산. 애플의 산발 SDNN 보다 촘촘 |
| SpO₂ 원재료 | `PpgSet` = `PPG_GREEN`+`PPG_IR`+`PPG_RED` **25Hz 상시** | SpO₂ 는 red/IR 흡광비로 계산한다. 애플은 raw PPG 를 아예 안 준다 |

⟹ 1차 답변의 *"신호 3종 영구 결손"* 은 **호흡수·MET·일광시간** 셋으로 줄었고, 셋 다 가중치가 낮다.

## R-04 · `:wear` 를 Flutter 안드로이드 프로젝트 안에 둔다

워치가 **단독**이라 Flutter 앱에 기술적으로 의존하지 않는다. 그런데도 같은 Gradle 프로젝트에 둔다.

**이유 셋.**
1. **JWT 전달이 Data Layer 를 요구한다.** 워치 자판으로 로그인하는 건 현실성이 없어 폰에서
   1회 페어링해 넘겨야 하는데, Data Layer 는 **같은 패키지명·같은 서명**을 요구한다.
   팀원 앱 README 가 같은 제약을 적어 뒀다.
2. **툴체인이 이미 증명됐다.** 08-24 `flutter build apk --debug` 가 통과했다(에러 0 · APK 146MB).
   새 프로젝트를 파면 Gradle 9.1 / AGP 9.0.1 / JDK 25 조합을 다시 증명해야 한다.
3. 팀원 앱(`apps/VitAlGuard-Flutter-Android-App/android/wearos_companion`)이 같은 형태다 — 선례.

**부작용 하나.** 루트 `build.gradle.kts` 의 `subprojects { evaluationDependsOn(":app") }` 때문에
`:wear` 평가가 `:app`(Flutter) 평가를 먼저 부른다. 빌드는 되지만 `:wear` 단독 빌드에도
Flutter 플러그인 해석이 붙는다. 지금은 감수한다 — 분리는 되돌릴 수 있고, 서명 공유는 못 되돌린다.

## R-05 · 진단 UI 는 Compose 가 아니라 순정 View 로 쓴다

Wear Compose 를 붙이면 Kotlin 2.3.20 · AGP 9.0.1 과 Compose 컴파일러 버전을 맞춰야 하고,
그 실패는 **SDK 링크 성공 여부와 무관한 잡음**이다. 1단계 성공 기준은 "AAR 이 링크되고 빌드된다"
하나뿐이라 UI 는 최소로 간다. 팀원 wear 동반앱도 `LinearLayout`+`TextView` 다 — 선례.

**제품 UI 는 3단계에서 Compose 로 간다.** 지금 쓰는 것은 버리는 코드다.

## R-06 · `SDK_POLICY_ERROR` 가 파트너 승인 판별자다

`HealthTracker.TrackerError` 열거형에 둘뿐이다.

```
PERMISSION_ERROR    권한 미부여
SDK_POLICY_ERROR    ★ 패키지명·서명이 삼성에 등록 안 됨 = 파트너 미승인
```

삼성이 파트너 프로그램 **접수를 중단**한 상태라 승인은 못 받는다. 대신 **개발자 모드**
(설정 > 앱 > Health Sensor Service > 제목 10회 탭)로 미승인 상태에서도 완전히 동작한다.
공모전 시연·실증에는 문제가 없고 **상용 배포만** 막힌다.

⟹ 프로브가 이 오류를 **화면에 그대로 적게** 한다. 안 적으면 다음 사람이 "센서가 없다" 로 오독한다.

## R-07 · 권한은 Wear OS 6 에서 이름이 바뀐다 — 신·구 병기

갤럭시워치8 = Wear OS 6 = **Android 16 (API 36)**.

| targetSdk | 권한 |
|---|---|
| 33~35 | `BODY_SENSORS` + `BODY_SENSORS_BACKGROUND` |
| **36** | `android.permission.health.READ_HEART_RATE` + `READ_HEALTH_DATA_IN_BACKGROUND` |

구권한에 `maxSdkVersion="35"` 를 달고 신권한을 함께 선언한다(공식 권장 형태).

**⚠ 배포 시 반드시 걸리는 것.** 백그라운드 권한은 restricted 라 **런타임 팝업에 "항상 허용" 이 없다.**
사용자가 설정에 직접 들어가 켜야 한다. 안 켜면 앱이 백그라운드로 가는 순간 `onPermissionLost()`
가 뜨고 전경 권한까지 잃는다. 실측 ⑥ 이 이 단계 수를 세는 이유다 — 온보딩 문구를 그 수에 맞춘다.

## R-08 · 5초 배치를 그대로 옮기지 않는다 (2단계 결정 예고)

Wear OS 공식 전력 가이드가 *"비필수 네트워크 접근은 충전 중까지 미루라"* 고 명시한다.
LTE 상시 업로드는 정확히 그 반대다. 워치8 배터리는 325mAh(40mm)/425mAh(44mm) · AOD 30h 기준.

⟹ 배치 주기 후보 **30~60초**. 다만 **지금 정하지 않는다** — 실측 ⑤⑦⑧ 의 배터리 곡선을 보고
3단계에서 정한다. 근거 없이 숫자를 박으면 [[L-107]] 의 "전제 없는 착수" 가 된다.

## R-09 · flush 1회 = 병합 항목 1건 — 서버 UNIQUE(worker_id, ts) 가 설계를 정한다

iOS 는 배치에 심박 항목 여러 건을 담고 서버가 ts 충돌로 뒤 항목을 **조용히 버렸다**
(2026-08-14 가드 주석 — 그래서 실도착이 12행/분 = flush 주기와 일치했다). 워치 이식은
처음부터 **한 항목만** 만든다(`SampleBuilder`). 실질 도착률은 같고 유실이 설계가 된다.

같은 이유로 세 가지 규칙을 계약으로 굳혔다.
① 측정 시각은 ts(전송 시각)와 별개 키(`heartRateMeasuredAt`·`spo2MeasuredAt`) — 세 시각 구분.
② 측정된 것만 싣는다 — 0 채움·직전 값 복사 금지(구 앱 HRV 가짜 밀도 사고의 재발 방지).
   HRV 는 **창 주기(5분)당 1회만** — 매 flush 재계산 전송은 같은 사고의 재현이다.
③ 무동작 지속만은 단독 전송 허용 — 벗음/쓰러짐 판별이 정확히 그 구간에 필요하다(iOS 규칙).

부수 확정 — 로컬 실왕복에서 서버가 persist 실패를 **503 + accepted** 로 응답함을 확인.
큐를 지우면 안 되는 응답이다. 상태기계는 2xx 에서만 큐를 비운다(그 외 전부 30s/300s 재시도).

## R-10 · 실왕복은 DB 를 차단하고 한다 — L-04 의 이 트랙 적용형

`.env.local` 의 DATABASE_URL 은 프로덕션이다. 로컬 `next dev` 로 왕복하면 검증(Zod·JWT·
사번 결속)은 DB 앞단에서 끝나므로, DATABASE_URL 을 `127.0.0.1:1`(unroutable)로 덮어
**한 행도 쓰지 않고** 계약 통과만 실측한다. 판정 = `accepted` 건수(12/12). workerId 도
실제 사번이 아니라 `WEAR-LOCALTEST` 를 쓴다 — 만에 하나 DB 에 닿아도 실계정 오염이 없다.

## R-11 · 워치 무선 ADB 런북 — IPv6 전용 핫스팟의 4중 함정 (08-24 실전에서 전부 밟음)

공유기(무선 격리) → 폰 핫스팟 이동 후에도 3겹이 더 있었다. 다음에 그대로 재사용한다.

① **공유기 무선 격리** — 같은 SSID 인데 ARP `incomplete`. 공유기 우회 = 폰 핫스팟.
② **통신사 폰 핫스팟은 IPv6 전용(464XLAT)** — 클라이언트 IPv4 는 192.0.0.x/32 **더미**라
   기기 간 IPv4 유니캐스트가 원래 안 된다(페어링 화면의 192.0.0.4 는 미끼다). 판별 지문 =
   Mac ifconfig 에 `clat46` · 넷마스크 0xffffffff.
③ **경로** — `dns-sd -L`(SRV→호스트명) → `dns-sd -G v6`(AAAA) → **pair 는 글로벌 v6**
   `adb pair "[2001:...]:포트" 코드` → **connect 는 링크로컬+스코프** `adb connect
   "[fe80::...%en0]:포트"` (글로벌 connect 는 Network unreachable 로 실패했다).
④ **워치 Wi-Fi 절전이 유휴 TCP 를 수 초 만에 끊는다** — ping 은 9.5ms 인데 세션만 죽는 지문.
   해법 = 연결 직후 keep-alive 쉘(`shell "while true; do echo ka; sleep 1; done"` 백그라운드)로
   링크를 붙잡고 그 사이에 작업. 스트리밍 설치(abb_exec)는 이 링크에서 깨지므로
   **push + `pm install -r`** 로 우회한다(9.7MB 가 0.7초에 들어갔다 — 링크 자체는 빠르다).

기기 실측 = SM-L355N · Android 17 · API 37. 매니페스트의 SDK_INT>=36 분기·신권한 그대로 유효.

## R-12 · wake-up 센서는 배치로 온다 — 도착 시각을 측정 시각으로 쓰면 최대 3.7분이 어긋난다

08-24 실측 ⑤(12.2분)가 강제한 수정이다. 화면이 꺼지면 센서 허브가 표본을 FIFO 에 모았다가
CPU 가 깰 때 몰아서 준다. **유실은 0이었다** — 746건/732초 = 101.9%.

```
공백 219.4초 → 직후 2초 내 221건 도착   (5구간 모두 공백 초 ≈ 직후 건수)
분당 표본수 … 19:24=60 · 19:25~27=0 · 19:28=241 · 19:29=31
```

**판정 규칙 둘.**
① **"공백"을 유실로 읽지 않는다.** 배치인지 정지인지는 *공백 초 대 직후 도착 건수*가 가른다.
   같으면 배치(수집 계속), 직후에도 1Hz 면 진짜 정지다. 표본 수/경과 초로 수집률을 먼저 낸다.
② **측정 시각은 `event.timestamp`(부팅 후 나노초)를 벽시계로 환산해 쓴다.**
   `System.currentTimeMillis()` 를 쓰면 배치로 온 221건이 전부 같은 순간에 잰 값이 되어
   `heartRateMeasuredAt` 이 최대 3.7분 어긋난다. 서버가 ts(전송)·measured_at(측정)·
   received_at(도착) 셋을 나눠 두는 이유가 정확히 이것이다 — iOS 계약과 같은 자리.

⟹ `SensorTrackerSource.eventWallClockMs()` 신설 · 배치 구간 계약 시험(BatchDeliveryTest) 추가.
⚠ 이 배치 거동은 **배터리에 유리하다**(CPU 가 계속 깨지 않는다) — 없애려 하지 않는다.
   다만 flush 주기 설계(R-08)에서 "60초마다 올린다"가 실제로는 "몇 분에 한 번 몰아서"가 될 수
   있음을 전제해야 한다. 큐가 그 사이를 흡수하므로 유실은 없다.

## R-13 · 업로드를 메인 스레드에서 돌렸다 — 삼킨 예외가 원인을 3시간 숨겼다 (08-24 실기)

⑦ 본수집을 켰는데 관제웹에 한 건도 안 왔다. 로그에는 `업로드 대기 30s (auth=false) · 큐 1`
만 반복. 큐만 쌓이고 전송은 0이었다.

**원인 = `CollectorService` 의 tick 을 `Handler(Looper.getMainLooper())` 로 돌린 것.**
`HttpTransport.post()` 가 메인 스레드에서 소켓을 열자 Android 가 `NetworkOnMainThreadException`
을 던졌고, `runCatching{}.getOrDefault(-1)` 이 그것을 **네트워크 오류(-1)로 둔갑**시켜
상태기계가 "30초 뒤 재시도"로 읽었다. 영원히.

**재발방지 룰 셋.**
① **워치/폰의 네트워크 I/O 는 전용 워커 스레드에서만.** `HandlerThread("vg-collector")` 로
   교체했다. 센서 콜백은 메인에서 오므로 `CollectorEngine` 의 진입점을 `@Synchronized` 로 묶었다.
② **`runCatching`·`try/catch` 로 실패를 상수로 바꿀 때는 반드시 사유를 로그에 남긴다.**
   외부 리뷰가 INTERNET 누락 건에서 같은 구조를 지적했는데(그때는 SecurityException),
   **권한을 고쳐도 삼키는 구조가 남아 있어 다음 예외에서 똑같이 당했다.** 권한이 아니라
   **삼키는 코드가 결함**이었다. `onFailure { Log.w(...) }` + 비2xx 응답 본문 로깅을 추가했다.
③ **진단 순서** — 관제에 안 보이면 ⓐ 서비스 살아있나(`dumpsys activity services`)
   ⓑ source 화이트리스트 통과하나 ⓒ 권한 부여됐나(`dumpsys package … granted=true`)
   ⓓ 기기가 인터넷 되나(`ping`) ⓔ **그래도 모르면 삼킨 예외를 드러내는 빌드를 올린다.**
   이번엔 ⓐ~ⓓ 가 전부 정상이라 ⓔ 에서만 답이 나오는 상황이었다.

## R-14 · 관제 신선도 60초 = 워치 flush 60초 — 정상 수집이 "연결끊김"으로 보인다

`DemoDashboard.tsx:675` 의 `STALE_MS = 60_000` 과 `CollectorService.FLUSH_INTERVAL_MS` 가 같다.
게다가 [[R-12]] 의 센서 배치 전달이 겹치면 실제 도착 간격은 수 분까지 벌어진다.
iOS 는 5초 배치라 이 문제가 없었다 — **워치 단독 60초 설계가 만든 새 상황이다.**

⟹ **지금 숫자를 바꾸지 않는다.** 실측 ⑥(밤샘 배터리)과 ⑦(도착 간격 분포)이 나온 뒤
3단계에서 정한다. 후보 = ⓐ flush 를 30초로 ⓑ 관제 STALE_MS 를 단말별로 분기
ⓒ heartbeat 만 짧은 주기로 따로 보냄(iOS 하트비트와 같은 수법). 근거 없이 고르지 않는다.

## R-15 · Compose 전환 — R-05 의 보류 근거가 사라졌다 (08-25)

R-05 는 *"Compose 컴파일러 버전 맞춤 실패가 SDK 링크 검증과 무관한 잡음"* 이라 순정 View 를 썼다.
**그 전제가 두 가지로 무너졌다.**

① **Kotlin 2.0+ 부터 Compose 컴파일러는 Kotlin 과 같은 버전의 플러그인**이다
   (`org.jetbrains.kotlin.plugin.compose` version = Kotlin 2.3.20). 맞출 버전이 애초에 없다.
② **UI 반복이 실제 병목이 됐다.** 08-24 저녁 워치 무선 연결이 절전으로 계속 끊겨 화면 한 번
   확인에 10~15분이 들었다. 미리보기는 그 왕복을 0으로 만든다.

**구조 — 화면을 순수 함수로 짠다.** `ProbeScreen(state, actions)` 가 서비스·센서를 모르고
`ProbeUiState` 만 받는다. 그래서 `@Preview` 가 실기 없이 그대로 렌더한다.
미리보기 4종(대기 · 수집중 · **큐 적체** · 결과출력)을 두었다 — 상태마다 색과 줄바꿈이 달라
한 장으로는 못 본다. 큐 적체 미리보기는 08-25 서버 DB 장애 상황을 그대로 재현한 것이다.

**함정 둘.**
- `WearDevices`(LARGE_ROUND 등)는 `androidx.wear:wear-tooling-preview` 에 있고 **전이 의존으로는
  컴파일 경로에 안 들어온다.** 명시 선언해야 한다.
- `ComponentActivity` 는 `onRequestPermissionsResult` 를 그 시그니처로 안 받는다 —
  `registerForActivityResult(RequestMultiplePermissions())` 가 정석 경로다.

⚠ **APK 가 9.8MB → 27MB 로 커졌다**(Compose 런타임). 디버그 빌드 기준이고 R8 이 붙는 릴리스에서
다시 재는 것이 맞다. 워치 저장공간·설치 시간에 영향이 있으니 3단계에서 확인한다.
