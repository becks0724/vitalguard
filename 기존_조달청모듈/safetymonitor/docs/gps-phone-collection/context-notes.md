# 폰 GPS 수집 트랙 — 결정과 근거

측정으로 확인한 사실만 적는다. 추정은 추정이라고 밝힌다.

---

## G-01 · 신규 앱에 위치 코드가 한 줄도 없다

`vitalguard_app` 전체에서 `CoreLocation`·`CLLocationManager` grep **0건**. 워치·폰 `Info.plist` 에 `NSLocation*` **0개**. 워치는 `UIBackgroundModes` 자체가 없고 폰은 `fetch`,`processing` 뿐이다.

실데이터도 같은 말을 한다 — `vital_samples` 08-10~08-16 **36,007행에 GPS 0건**. 마지막 위치는 **2026-07-31 21:46**(구 앱).

**그래서 이 트랙은 신규 개발이 아니라 생산자 복구다.** 서버 스키마(`latitude`/`longitude` optional)·DB 컬럼·지오펜스 100m 히스테리시스·동선 조회·CSV/XLSX 내보내기가 전부 살아 있다.

## G-02 · 구 앱의 GPS 747건은 폰이 아니라 **워치 자체 GPS** 였다

`source` 라벨만 보고 폰으로 읽었다가 코드로 정정했다.

| 경로 | source | 좌표 출처 | 실적 |
|---|---|---|---|
| 워치 | `VitAlGuard-WatchVitals` | 워치 `CLLocationManager` (`WorkoutManager.swift:70→1141→1148→1149`) | 747건 |
| 폰 | `VitAlGuard-iPhone` | 폰 `UserDefaults` 캐시 (`VitAlGuardPreviewApp.swift:3914-3926`) | 71건 |

폰 경로에만 `payload["locationSource"] = "iphone"` 이 있다(`:3925`).

## G-03 · 워치 좌표가 63분씩 묵은 것은 고장이 아니라 설계다

`ConnectionSettings.swift:881-886` 의 `shouldPublishLocation` 이 **직전 발행 지점에서 반경 이상 움직여야** 새 좌표를 채택한다. 반경 기본값 **500m**(`:828`, 클램프 100~5,000m).

`WorkoutManager.swift:1146` 주석 그대로 — *"boundary-approved location만 payload가 된다."*

실측 수신 주기.

| 구간 | 기준 | 갱신 | 중앙 간격 |
|---|---|---|---|
| 구-구 앱 (06-27~07-29) | 좌표 변화 | 10,905회 / 201,132행 | **12초** |
| 구 앱 (07-30~08-01) | 측위 시각 | **46.4시간에 8회** | **7.6시간** |

## G-04 · ★ 그 반경이 관제 판정과 5배 어긋나 있었다

단말 게이트 **500m** vs 관제 구획 **100m**(`DemoDashboard.tsx:66`). 100m 원을 벗어나도 500m 를 안 넘으면 좌표가 안 올라와 이탈이 잡히지 않는다.

**사용자 결정 = 관제구역 반경을 최소 50m · 최대 100m 로 맞춘다.** 단말 게이트와 관제 판정이 같은 정책을 공유해야 이 어긋남이 재발하지 않으므로 상수를 한 곳에 두고 Swift·TS 양쪽을 가드로 묶는다.

## G-05 · 폰·워치 좌표 융합(하이브리드)은 채택하지 않는다

사용자 제안(폰 main + 워치로 오차 보정)을 실데이터로 검증했다. 07-30~07-31 에 같은 워커(`EMP-admin6861`)로 두 출처가 동시에 들어온 구간이 있다.

- 두 좌표 이격 **p50 142m · 최대 577m**(±30초 15쌍) · 완전 일치 0건
- 그러나 그 이격은 **오차가 아니라 노후**다 — 워치 좌표 나이 **p50 3,781초(63분) · p90 7.7시간**, 738행 중 705행이 60초 초과

원리적으로도 기대가 낮다. GNSS 오차는 전리층·위성 궤도/시계·멀티패스 같은 **공통모드**가 지배하고, 손목과 주머니는 50cm 떨어져 그 오차를 거의 그대로 공유한다. 진짜 오차 감소는 **좌표를 아는 기준국**과의 차분에서 나온다.

**대신 워치의 값은 폴백(가용성)에 있다** — 폰을 두고 워치만 착용하면 폰 좌표는 작업자 위치가 아니다. 이번 범위 밖으로 두고 기록만 남긴다.

## G-06 · ★ 정확도는 앱이 보내는데 서버가 조용히 버렸다

단말 양쪽이 이미 보낸다 — `VitalTransmitter.swift:121`, `VitAlGuardPreviewApp.swift:3921`.

```swift
payload["locationAccuracyMeters"] = (latestLocation.horizontalAccuracy * 10).rounded() / 10
```

그런데 `packages/schemas/src/vital-stream.ts` 에 그 필드가 없다. Zod 가 unknown key 를 strip 하고 `db.ts:934` 가 `raw_json: JSON.stringify(sample)` 로 **파싱 후 객체**를 저장하므로 raw_json 에도 안 남는다.

같은 파일 `:132` 주석이 이 병에 이미 이름을 붙여 뒀다 — *"이름이 스키마에 없어 그동안 100% 무음 strip 됐다(감사 BND-CONTRACT-01)."* `mlFallPipelineActive`·낙상 ML 텔레메트리가 같은 식으로 전량 폐기됐던 전례가 있다. **위치 정확도가 아직 안 고쳐진 세 번째다.**

→ Phase 2 에서 스키마·DB 컬럼·insert 매핑을 함께 넣는다. 셋 중 하나만 넣으면 다시 조용히 사라진다.

## G-07 · "근무 중" 을 시간대가 아니라 **생체 수신 여부**로 정의한다

관제웹·앱 어디에도 근무 시간(work hours) 개념이 없다(grep 0건). 새로 만들면 이번 범위를 넘고, 정하는 순간 현장마다 다른 값이 된다.

대신 앱이 이미 아는 신호를 쓴다 — **워치 생체가 들어오는 동안이 근무 중이다.** 워치를 벗으면 생체가 끊기고 추적도 멈춘다. 배터리와 개인정보 양쪽에 맞는 정의다.

⚠ 한계를 명시한다 — 워치를 차고 퇴근하면 그 구간도 추적된다. 근무 시간대 개념이 생기면 그때 좁힌다.

## G-08 · 구역 중심은 **그날 첫 유효 fix** 로 앵커한다

region monitoring 에는 중심이 필요하다. 선택지는 서버 조회·첫 fix·하드코딩 셋이다.

서버에는 이미 `/api/monitor/site-coord` 가 **그날 최초 라이브 좌표 1행**을 들고 있고(`DemoDashboard.tsx:4457`), 관제 지도의 `siteCircleCenter` 가 그것을 쓴다. 앱이 **그날 첫 fix** 로 앵커하면 두 값이 자연히 같은 것을 가리키고, 앱 전용 엔드포인트를 새로 만들지 않아도 된다.

날짜(KST)가 바뀌면 재앵커한다 — 현장이 바뀌어도 다음 날 따라간다. 서버에서 받아오는 방식은 미결로 남긴다.

## G-09 · 저전력 설계는 구 앱 폰 설정을 그대로 계승한다

```
desiredAccuracy = kCLLocationAccuracyHundredMeters   :7072
distanceFilter = 100                                 :7074
pausesLocationUpdatesAutomatically = true            :7075
allowsBackgroundLocationUpdates = false              :7078
CLCircularRegion(notifyOnExit:)                      :12345
startMonitoring(for: region)                         :12352
```

핵심은 **region monitoring** 이다 — 앱이 GPS 를 계속 돌리는 것이 아니라 **OS 가 경계를 감시하다 벗어날 때만 앱을 깨운다**. iOS 에서 지오펜스를 하는 가장 싼 방법이고, 워치에는 이 수단이 아예 없다(`WorkoutManager.swift` 주석 — *"watchOS는 지역 이탈 콜백을 제공하지 않으므로 시스템 거리 필터를 사용한다"*).

**★ `kCLLocationAccuracyBest`/`BestForNavigation` 으로 승격하지 않는다.** 그 등급은 GNSS 상시 구동이라 배터리 축이 완전히 달라진다. 가드로 막는다.

⚠ 배터리 실측은 **폰에 대해 한 번도 없다**(폰 소스 71행 전부 `batteryPct` 없음). 워치 실측 6.97 %/h(190.3시간)는 워치 값이라 폰에 대입할 수 없다. 폰은 iOS 설정 > 배터리가 앱별 소모를 이미 보여주므로 **붙인 뒤 하루 돌려 읽는다**.

## G-10 · 5분 신선도 게이트를 계승한다

구 앱 폰이 `fresh = Date().timeIntervalSince(timestamp) <= 300` 으로 묵은 좌표를 안 실었다(`VitAlGuardPreviewApp.swift:3917`).

실측상 그 게이트가 있어도 폰 좌표에 10분 초과 10건·**7.7시간 1건**이 섞였는데(사고 시 예외 분기), 게이트가 없으면 훨씬 나쁘다. 이번 구현은 **예외 없이** 5분을 적용한다 — 이 앱에는 아직 사고 스냅샷 경로가 없다.

`locationTimestamp` 는 함께 실어 관제가 값의 나이를 알게 한다(심박의 `heartRateMeasuredAt` 과 같은 계약).

## G-11 · 좌표는 새 행을 만들지 않는다

`VitalPipeline.ingest()` 가 조립하는 **기존 생체 샘플에 컬럼으로 얹는다**. 행 수·요청 수 불변이고 새 엔드포인트도 없다.

워치 코드는 한 줄도 건드리지 않는다 — 08-18 시험 B 기준선이 흔들리면 안 된다.
