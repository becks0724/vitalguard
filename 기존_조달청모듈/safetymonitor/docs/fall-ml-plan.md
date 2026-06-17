# 낙상 감지 ML 데이터 수집 계획 (fall-ml)

> 목적 — 워치 낙상 감지 알고리즘의 **임계값 최적화(입력값 최적화)** 를 위한 지도학습 데이터셋 수집 파이프라인.
> 트랙 — 발표(2026-07-07) 후 ML 학습이 본 작업이나, **데이터 누적은 지금부터**(스트레스 baseline 과 동일 전략).
> 결정(2026-06-05 세션22) — 사용자 선택: **수집 범위 = 전체 활성화 요소 + 음성샘플**, **관리자 항목 = 내보내기 + 라벨링**.

## 배경 — 현재 한계 (왜 필요한가)

기존 워치 [FallDetector](../apps/worker-watch-poc/Sources/FallDetector.swift) 는 **양성(발화)만** 전송했고, 페이로드에 담긴 모션 특징은 `accelMagnitudeG`(충격 피크)·`motionStillSec`(정지초) **2개뿐**. 알고리즘이 내부에서 계산하는 `freefallPrecededImpact`(자유낙하 전조)·`peakRotation`(자이로 회전 피크)·`fallDecision`(판정 사유)은 **계산 후 폐기**됐다.

ML 임계 최적화에는 ① 음성 샘플(거부된 작업충격) ② 전체 활성화 요소 ③ 정답 라벨(실제 낙상 여부) 이 모두 필요 → 본 작업으로 셋 다 확보한다.

## 데이터 모델

### 워치 → 페이로드 (신규 필드, schema optional)
| 필드 | 의미 | 비고 |
|---|---|---|
| `fallCandidate` | 낙상 디텍터 후보 샘플 표시(양성·음성 공통) | 라이브 카드/알림은 무시 |
| `fallDecision` | `fall` / `rejected_no_corroboration` / `rejected_timeout` | 알고리즘 판정 사유 |
| `accelMagnitudeG` | 충격 피크 G (기존) | |
| `motionStillSec` | 충격 후 누적 저활동초 (기존) | |
| `freefallPreceded` | 충격 직전 자유낙하 전조 유무 | 신규 |
| `peakRotationRadS` | 후보 구간 자이로 회전 피크(rad/s) | 신규 |
| `fallDetected` | 실제 발화(양성)만 true | 기존 — 알림/카드 트리거 |

- **양성**(decision=fall): `fallCandidate=true` + `fallDetected=true` → 즉시 전송(긴급).
- **음성**(rejected\_\*): `fallCandidate=true`, `fallDetected` 미동봉 → 30초 배칭(라디오 절감, 알림/카드 미발火).

### DB (vital_samples 멱등 마이그레이션 + fall_labels)
- 신규 컬럼: `accel_magnitude_g`·`motion_still_sec`·`fall_candidate`·`freefall_preceded`·`peak_rotation_rad_s`·`fall_decision`.
- **레거시 154건**(컬럼 NULL, 값은 raw_json) → export 시 `COALESCE(col, json_extract(raw_json,…))` 로 백필 포함.
- `fall_labels(sample_id PK, label, note, labeled_by, labeled_at)` — 관제자 정답 라벨. `label ∈ {true_fall, false_positive, unsure}`.

## 컴포넌트별 작업

1. **워치** [FallDetector.swift](../apps/worker-watch-poc/Sources/FallDetector.swift) — `onFall`→`onCandidate(FallCandidate)`. 양성/음성 두 거부 사유 모두 결정 시점에 emit. `FallCandidate` 구조체(decision/peakG/stillSec/freefallPreceded/peakRotationRadS).
2. **워치** [WorkoutManager.swift](../apps/worker-watch-poc/Sources/WorkoutManager.swift)·[VitalTransmitter.swift](../apps/worker-watch-poc/Sources/VitalTransmitter.swift) — 후보 1샘플 전송(양성 즉시·음성 배칭). `simulateFall` 합성 양성 보존.
3. **스키마** [vital-stream.ts](../packages/schemas/src/vital-stream.ts) — optional 4필드 + `pnpm --filter @safetymonitor/schemas build`.
4. **DB** [db.ts](../apps/dashboard-web/lib/db.ts) — 마이그레이션·fall_labels·`persistSample` 확장·`exportFallDataset`/`listFallCandidates`/`setFallLabel`/`fallCollectionStats`. `getDb()` HMR 가드를 신규 statement 로 갱신.
5. **API** — `/api/admin/fall-candidates`(GET 통계+목록)·`/api/admin/fall-label`(POST)·`/api/admin/fall-export`(GET CSV). 전부 `verifyBasicAuth`.
6. **UI** [AdminExportModal.tsx](../apps/dashboard-web/app/components/AdminExportModal.tsx) — `FallMlPanel`(수집 통계 배지 + 기간 + ML CSV 다운로드 + 후보 라벨링 표).

## 체크리스트

- [ ] 워치 FallDetector 후보 캡처(양성+음성+활성화 요소)
- [ ] 워치 전송 배선(양성 즉시/음성 배칭)
- [ ] 스키마 4필드 + build
- [ ] DB 마이그레이션 + fall_labels + 함수 + HMR 가드
- [ ] API 3종
- [ ] UI FallMlPanel
- [ ] 검증: 스키마 build · dashboard tsc · 유닛 14/14 · 워치 watchOS Sim BUILD SUCCEEDED · 낙상 로직 standalone · 런타임 POST→DB 컬럼 확인

## 비범위 / 주의

- **학습·모델링은 발표 후** — 본 작업은 데이터 수집·내보내기·라벨링까지.
- 음성 후보가 작업충격마다 다수 발생할 수 있음(망치질 등) → 배칭으로 라디오는 절감되나 DB 적재량 증가. 데모 전 과적재 우려 시 수집 일시중지는 발표후 토글(현재 범위 밖).
- 라벨은 관제자 **수기 판단** — 정답 품질이 ML 성능을 좌우. CCTV/현장 대조 권장.
- 워치 재빌드는 `xcodebuild`/`devicectl`(Flutter 아님 → AOT 함정 없음). 실기기 install 은 사용자 몫.

---

## 2026-06-13 — 오탐(false positive) 난관 + 다중 모달 융합 타당성

> 맥락 — 건설현장 작업자는 손 사용 빈도·강도가 높아(망치질·드릴 등) 손목 IMU 낙상 감지의 오탐이 구조적으로 높다. 검출 임계만으론 못 풀며, 계층적 완화 + 다중 신호 융합이 필요하다. **고찰·타당성 기록 — 구현은 우선순위에 따라 별도 착수(현재 미구현).**

### A. 정확한 오탐 경로 (현재 알고리즘의 구멍)

발화 = (충격 ≥2.8G) **AND** (정지 1.2s) **AND** (`freefallPrecededImpact || peakRotation ≥ 6.0`).

자유낙하 전조 게이트는 "순수 충격"을 막지만(망치질엔 무중력 구간이 없음), **마지막 `OR` 분기가 그 보호막을 다시 연다.**

- 망치 타격(≥2.8G) → 직후 1.2s 멈춤(공구 들고 확인) → 스윙 중 손목 회전이 ≥6 rad/s(≈344°/s) → 자유낙하 없이 `peakRotation` 분기로 발화 = **오탐**.
- 연속 망치질(멈춤 없음)은 `rejected_timeout` 으로 정상 거부됨. 새는 정확한 패턴은 **"치고-멈춤" + 고회전 스윙**.

### B. 왜 검출 레이어 단독으론 못 푸는가

손목은 인체 최동적 부위라 고강도 수작업의 가속/회전 분포가 낙상의 그것과 물리적으로 겹친다. 임계↑ = 진짜 낙상(특히 느린 주저앉음) 놓침, 임계↓ = 오탐 폭증 → recall↔precision 교환에 원천적 상한이 있다. 업계(Apple Watch)도 모델 정확도가 아니라 **확인 prompt + 부동(immobility) 승격**이라는 *사후 레이어*로 해결한다. → **검출은 고-recall 로 두고, 오탐은 하류에서 흡수**하는 계층 구조가 정답.

### C. 계층적 완화 (보유 자산 매핑 · 우선순위)

| 계층 | 아이디어 | 보유 자산 | 비용 |
|---|---|---|---|
| **L0-a 반복충격 억제** ⭐ | 낙상=단발 충격, 망치질=주기적 충격 train. 최근 ~3s 내 충격 ≥2회면 fall 억제 | `impactAt` 타임스탬프 추적만 | 매우 낮음 |
| **L0-b 회전→방향변화** ⭐ | 순간 `rotationRate`(스윙) 대신 **중력벡터 net Δangle** 요구. 망치질=작업자세 복귀(작은 Δ), 낙상=큰 자세변화 | `gravity` 이미 보유 | 낮음 |
| **L0-c 정지 2단** | 1.2s 는 "후보"로만, 알림 승격은 **지속 부동(10~30s)** 으로 | - | 낮음 |
| **L1 확인 prompt** ⭐⭐ | 후보 시 즉시 알람X → "괜찮으십니까?" 카운트다운. dismiss→무알림 + **공짜 hard-negative 라벨**, 무응답/부동→SOS 승격 | candidate emit + SOS infra | 중(워치 UI) |
| **L2 컨텍스트 게이팅** | 지속 heavy 손작업 감지 중엔 corroboration 을 **자유낙하 필수(OR 제거)** 로 강화 | `classifyActivity`/work-HR 게이트 패턴 | 낮음 |
| **L3 멀티모달 융합** ⭐⭐ | **CCTV CAM-02 카메라 낙상(YOLO-pose) + 워치 IMU 교차검증.** 카메라 커버 구역에서 카메라가 워치 오탐 veto | 둘 다 이미 보유(고유 강점) | 중 |
| **L4 ML 개인화** | 망치질을 hard-negative 클래스로 라벨 → 고정 임계 대신 분류기(feature 확장) | `fall-ml` 파이프라인·`optimize_thresholds.py` | 데이터 병목 |
| **L5 센서 배치(상용)** | 손목은 낙상 검출 최악 위치 → 토르소/벨트/헬멧 IMU 보조(손목=HR/SpO₂) | 자체 웨어러블/Wear OS 트랙 | 하드웨어 |

### D. 다중 모달 융합 타당성 (IMU + 생체 + 음성)

| 신호 | 가능성 | 핵심 제약 | 망치질 판별력 |
|---|---|---|---|
| IMU 낙상 알고리즘 | ✅ 보유 | 개선만(A) | (A 참조) |
| 생체데이터(HR) | ✅ 가능 | SpO₂ 는 스팟 측정→급성 낙상 무용 | 중(망치질도 HR↑) |
| 음성/소리 dB | ⚠️ **대부분 불가** | 백그라운드 마이크 차단·배터리·현장 소음 바닥·법적 동의 | 거의 없음 |

- **생체 융합 용도** — 망치질 *판별*엔 약함(망치질도 HR↑). 진짜 가치는 ① **중증도 판정**(부동인데 HR 유지/상승=긴급 vs 부동+HR 안정치 하강=양성, *움직임-HR 디커플링*) ② **실신/심장성 낙상**(충격 직전 HR 급락·부정맥, IMU 단독 미포착). → post-impact HR 궤적을 후보 페이로드에 동봉만 하면 됨.
- **음성/소리 dB 불가 3중 사유** — ① 기술: watchOS 서드파티 **백그라운드 연속 마이크 차단** + 배터리 ② 환경: 현장 소음 바닥 90~110dB·망치 타격 자체가 큰 소리 → **dB 임계 원천 무용** ③ 법: 현장 상시 음성 수집 = 개인정보보호법·근로자 동의. → 현실형은 IMU 후보 게이트 시 폰에서 *내용 저장X* 음향분류(`SoundAnalysis` 온디바이스) R&D 한정(상용 트랙). 음성 **출력**(확인·가청 경보로 주변 작업자 호출)은 즉시 가능·유용.

### E. 정확도 향상 추가 기능 (가능성×가치 순)

1. **⭐⭐ 기압 고도계(barometer)** — 낙상=급격 **고도 하강**, 망치질=고도 불변. **추락(고소작업)=건설 사망 1위**에 결정적, 손동작과 **완전 직교**·저전력. Apple Watch S3+/Ultra·iPhone 기압계 보유(상대고도 실시간). 평지 넘어짐은 손목 ~1m 약신호=보조.
2. **⭐⭐ post-impact HR 궤적** — 부동+HR 상승=긴급, 실신낙상 포착. 보유 신호.
3. **⭐ 확인 prompt + 부동 승격 + 가청 경보**(음성 출력) — 잔여 오탐 무해화 + 공짜 라벨 + 주변 호출.
4. **⭐ GPS 위험구역 가중** — 비계·개구부·단부의 후보는 신뢰도↑. GPS 보유.
5. **CCTV CAM-02 교차검증** — 카메라가 워치 오탐 veto.

**융합 방식** — 워치가 보내는 fall-ml feature(impactG·stillSec·freefall·rotation)에 **Δ고도 + post-impact HR Δ + GPS존**을 더해, 폰/서버에서 **가중 confidence 점수**로 합산. 새 인프라 0, feature vector 확장만 → `optimize_thresholds.py` 가 그대로 학습.

### F. 검증 필요 / 한계 (정직 · §1.2)

- **빌드 검증 필요** — watchOS 상대고도 API(`CMAltimeter` 류)·`SoundAnalysis`/백그라운드 오디오 entitlement·Galaxy/Wear OS 기압계 모델별 유무. *추정이며 미검증.*
- 모든 임계 수치(2회/3s·Δangle·6 rad/s·고도 Δ)는 **실측 튜닝 필요** — fall-ml 음성 수집이 전제(내 수치는 출발점).
- 검출 정밀도는 손목 수작업에 대해 **본질적 상한**. 배포 가능성은 L1 확인 + L3 융합이 만든다.
- L0-b/고도 추가 시 "느린 주저앉음"(회전·고도 약신호)은 자유낙하·부동 의존↑ → standalone 결정로직으로 **추락·치고멈춤·주저앉음** 케이스 재검증 필수(현 방식 유지).

### 우선순위 권고

- **발표 전(저위험·고ROI)** = L0-a + L0-b + L1(확인/경보). "치고-멈춤" 구멍 정조준, [FallDetector.swift](../apps/worker-watch-poc/Sources/FallDetector.swift) 국소 수정(외부 페이로드·서버 불변).
- **데모 차별화** = L3 워치+카메라 융합(부품 보유).
- **상용** = 기압 고도계 융합 + L4(현장 negative 수집·분류기) + L5(토르소 IMU).
