# 갤럭시워치 단독 수집기 — 계획·체크리스트

**사용자 결정(2026-08-24).** *"최종 어플리케이션은 워치에서 단독으로 서버로 생체데이터를 보낼 계획."*
갤럭시워치8 **LTE** 오후 구매 예정 · 안드로이드 폰 보유 · 삼성 SDK 2종 로컬 제공됨.

## 무엇을 왜

**구조가 바뀐다.** 워치가 폰을 거치지 않고 직접 서버에 쏜다.

```
[현재 iOS]  워치 ─WCSession─▶ 폰(디스크 큐·재시도) ─HTTPS─▶ 서버
[계획]      워치 ───────────── LTE · HTTPS ─────────────▶ 서버
```

`PhoneReceiver`(217줄)가 사라지고 `VitalPipeline`(373줄)·`LocationProvider`(514줄)가 워치로 간다.
서버는 안 바뀐다 — `/api/app/vital` 주석이 이미 *"작업자 폰/워치의 POST 와 같은 경로"* 라고 적어 뒀다.

**이 트랙(1단계)의 범위는 SDK 적용과 실측 도구까지다.** 수집기 본체·업로드·UI 는 실측 결과를
보고 2단계에서 정한다. 기기가 아직 없어 지금 설계를 확정하면 [[L-107]] 의 "전제가 사라진 트랙" 이 된다.

## ⛔ 범위 밖

- Play Store / Galaxy Store 배포 — 삼성 파트너 프로그램 **접수 중단** 상태라 애초에 불가
- 관제웹·서버 변경
- 폰 Flutter 앱 변경 (촬영·기록은 그대로 둔다)
- Dart 코드 — 워치는 Kotlin 이라 한 줄도 안 간다

## 성공 기준 (1단계)

```
① 삼성 Sensor SDK 1.4.1 이 링크되어 :wear 모듈이 빌드된다 (기기 없이 검증 가능)
② 실기기에서 SDK 연결이 성공한다 — 실패하면 errorCode 를 화면에 적는다
③ 지원 트래커 전량이 화면에 뜬다 (HealthTrackerCapability)
④ Health Services 지원 DataType 전량이 함께 뜬다 (삼성 SDK 없이 되는 범위)
⑤ wake-up 심박이 화면 꺼짐 10분을 생존한다
⑥ 배터리·권한 단계 수가 기록된다
```

**①은 오늘 기기 없이 판정한다. ②~⑥은 워치 도착 후.**

---

## 1단계 — SDK 적용 (기기 없이)

- [x] SDK 정본 판독 — `javap` 로 `HealthTrackerType` 열거형 전량 확인
- [x] `SPO2` 는 deprecated · `SPO2_ON_DEMAND` 와 동일한 on-demand 확정
- [x] `PpgSet` 이 green+IR+red 25Hz 상시 제공 확인 (SpO₂ 자체 계산 경로)
- [x] `HeartRateSet.IBI_LIST` 확인 (HRV 자체 계산 경로)
- [x] `SkinTemperatureSet` 이 `AMBIENT_TEMPERATURE` 까지 제공 확인
- [x] `:wear` Gradle 모듈 신설 · AAR 링크
- [x] 매니페스트 권한 — Wear OS 6(API 36) 신·구 권한 병기
- [x] 실측 도구 3종 (SDK 프로브 · Health Services 프로브 · 심박 FGS)
- [x] `assembleDebug` 통과 — **성공 기준 ①** (08-24 · wear-debug.apk 9.6MB · dex 내 삼성 SDK 참조 96건 실측 · :app 비회귀 확인)

## 1.5단계 — 워치 도착 전 선행 (B → A → C · 사용자 승인 08-24)

**원칙 — 기기 없이 검증까지 되는 것만 만든다. 설계 숫자(주기·임계)는 상수로만 두고 3단계에서 확정한다.**

- [x] **B** 파생 계산 모듈 — SDNN(IBI→ms)·무동작 지속·모션 변동성. 순수 Kotlin(android 의존 0)
  - 완료(08-24) — 손계산 대조 벡터 포함 단위테스트. iOS 상수(0.03g·창 60·0.1s 반올림·null 규칙) 이식
  - 판정: 손계산 대조 벡터 + 경계 사례 단위테스트 초록. ⚠ iOS 실데이터 골든은 **불성립**
    (애플은 IBI 원본을 안 주고, 서버 축적분은 5초 스냅숏이라 1Hz 스트림 복원 불가) — 대조 벡터로 대체
- [x] **A** 업로드 파이프라인 — 디스크 큐(상한 5,000·오래된 것부터 폐기)·배치(≤500)·재시도·JWT 헤더
  - 완료(08-24) — MockWebServer + **로컬 실왕복 accepted 12/12**(DB 는 127.0.0.1:1 로 차단해 L-04 준수 ·
    503=persist 실패 응답은 큐 보존→30s 재시도로 정확히 이어짐을 상태기계가 처리)
  - 판정: MockWebServer 시나리오(재시도·폐기·중복 ts) + 로컬 `next dev` 실왕복. 프로덕션 송신 금지(L-04)
- [x] **C** TrackerSource 심 — 실소스/페이크 교체 구조 + 수집→파생→큐→업로드 종단 페이크 테스트
  - 완료(08-24) — 60초 근무 리플레이: 병합 12건·ts 전건 유일·SpO₂ 1회 소비·HRV 창당 1회·still 45.0s 실측.
    시험이 Long.MIN_VALUE 오버플로 버그를 착수 당일 잡음(테스트 23건 전부 초록)
- [x] **격차 3건 수리(08-24 저녁 · 외부 리뷰 제보 → 실물 검증 후 수정)**
  - ① INTERNET·ACCESS_NETWORK_STATE 누락 — APK aapt 실물 대조로 확인·수리. 매니페스트 가드 신설
    (**L-113 변이 통과** — INTERNET 삭제 변이 → fail 1 · 복원 cmp 무결 · 기준선 PASS)
  - ② GPS 0건 — LocationSource 심 + GpsLocationSource(60초 듀티·순정 LocationManager) + 좌표 4종
    한 덩어리·신선도 계약 시험. ⚠ 실기 미검증 — 실측 항목에 ⑨ "GPS fix 획득" 추가
  - ③ 자격 주입 경로 — ConfigStore + adb 인텐트 엑스트라 주입 + CollectorService(FGS health|location ·
    60초 flush = 배터리 기준 프로파일) + 화면 ⑦수집시작/⑧중지. SensorTrackerSource(순정 wake-up)가
    삼성 SDK 실패 시의 대조군 실소스. 시험 29건 초록
  - 판정: 리플레이 종단 테스트 초록. 워치 도착일 잔여 코드 = 실소스 1파일
- [ ] E(에뮬레이터)는 **보류** — 재개 조건: 워치 구매가 오늘(08-24) 성사되지 않을 때만

## 보류 — 삼성계정 제거 (사용자 결정 08-24 · 실측과 무관해 뒤로 뺌)

- [ ] 워치의 빌린 계정 제거 — 워치 단독 제거 불가 확인됨(페어링 폰 계정 미러).
  **권장 경로 = 원격**: 폰 주인이 account.samsung.com > 기기 > 이 워치 로그아웃 → 워치 재부팅.
  ⛔ 초기화는 재활성화 잠금 해제 확인 전 금지 · 초기화하면 요건 폰으로 재페어링 필요.
  제거 후 Galaxy Store 용 본인 계정 등록(Health Sensor Service 갱신 경로).

## 2단계 — 워치 도착 후 실측 6개

- [x] ②-0 **워치 실연결·프로브 설치 완료(08-24 저녁)** — SM-L355N · **Android 17 / API 37**(예상 36보다 최신 · SDK_INT>=36 분기 유효). 무선 ADB 런북은 context-notes R-11
- [x] ② SDK 연결 — **성공(08-24 저녁 · 실기 화면 실측)** — "SDK 연결 성공 · 지원 트래커 21종"
  = 열거형 전량 지원(SPO2_ON_DEMAND·HEART_RATE_CONTINUOUS·SKIN_TEMPERATURE_CONTINUOUS·
  EDA_CONTINUOUS·SWEAT_LOSS 포함). ⚠ capability 조회는 정책 검사 전일 수 있다 — 진짜 관문은
  트래킹 시작(3-2 실소스)에서 재확인
- [x] ③ `getSupportHealthTrackerTypes()` 덤프 — ② 와 동시 완료(21종 전량)
- [x] ④ Health Services 덤프 — **SpO₂ 없음 확정**(passive = Steps·Distance·Calories·Floors·
  ElevationGain·HeartRate 계열 11종 / measure = HeartRate / exercise 82종). ⟹ SpO₂ 는 삼성
  SDK 단독 경로로 확정 — 최상 시나리오는 무산, 예상 시나리오대로
- [ ] ⑤ wake-up 심박 화면꺼짐 10분 생존 — 60초 규칙 검증
- [ ] ⑥ `READ_HEALTH_DATA_IN_BACKGROUND` 부여 경로 단계 수 세기 (온보딩 문구 확정용)
- [ ] ⑦ `SPO2_ON_DEMAND` 가 화면 꺼진 백그라운드에서 성공하는지 — **문서에 답이 없어 실측만이 답**
- [ ] ⑧ LTE 직접 POST 왕복 (`TRANSPORT_CELLULAR` 바인딩)

## 3단계 — 설계 확정 (실측 뒤)

- [ ] SpO₂ 주기 결정 (⑦ 성공률이 정한다)
- [ ] 배치 주기 결정 — 5초 그대로는 LTE 배터리에서 부딪힌다. 30~60초 후보
- [ ] JWT 를 워치에 넣는 경로 (Data Layer 페어링 · 같은 패키지·서명 필요)
- [ ] 가드 18개를 Kotlin 면까지 넓히기 ([[L-113]] 변이 통과 의례 포함)
