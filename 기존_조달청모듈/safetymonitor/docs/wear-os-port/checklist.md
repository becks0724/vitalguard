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

## 2단계 — 워치 도착 후 실측 6개

- [ ] ② SDK 연결 — `SDK_POLICY_ERROR` 면 개발자 모드(설정>앱>Health Sensor Service>제목 10탭)
- [ ] ③ `getSupportHealthTrackerTypes()` 덤프
- [ ] ④ Health Services `getCapabilitiesAsync()` 덤프 — **SpO₂ 가 여기 있으면 파트너 제약 없이 해결**
- [ ] ⑤ wake-up 심박 화면꺼짐 10분 생존 — 60초 규칙 검증
- [ ] ⑥ `READ_HEALTH_DATA_IN_BACKGROUND` 부여 경로 단계 수 세기 (온보딩 문구 확정용)
- [ ] ⑦ `SPO2_ON_DEMAND` 가 화면 꺼진 백그라운드에서 성공하는지 — **문서에 답이 없어 실측만이 답**
- [ ] ⑧ LTE 직접 POST 왕복 (`TRANSPORT_CELLULAR` 바인딩)

## 3단계 — 설계 확정 (실측 뒤)

- [ ] SpO₂ 주기 결정 (⑦ 성공률이 정한다)
- [ ] 배치 주기 결정 — 5초 그대로는 LTE 배터리에서 부딪힌다. 30~60초 후보
- [ ] JWT 를 워치에 넣는 경로 (Data Layer 페어링 · 같은 패키지·서명 필요)
- [ ] 가드 18개를 Kotlin 면까지 넓히기 ([[L-113]] 변이 통과 의례 포함)
