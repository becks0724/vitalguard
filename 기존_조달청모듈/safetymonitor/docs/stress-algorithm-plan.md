# 작업자 스트레스 모니터링 알고리즘 — 적용 계획

> 사용자 제공 사양서("현장 작업자 스트레스 모니터링 알고리즘 사양서")를 SafetyMonitor 스택에 맞춰 적용하기 위한 계획·체크리스트·결정 기록.
> **최종 발표 2026-07-07 트랙** (중간 데모 2026-06-04 와 별개). baseline 축적 시간 확보됨.

> **현재 상태 (2026-05-29)** — P0 수집 + P1-lite 지수 + 대시보드 작업자 카드 헤더 스트레스 칩은 유지. 2026-05-29 관제 웹 VitAlGuard 브랜딩/레이아웃 폴리싱은 표시 레이어 변경이며, `packages/analyzers` 스트레스 알고리즘과 payload 스키마는 변경 없음. 다음 알고리즘 작업은 개인 baseline(STEP0) 롤링 계산과 EMA/경보(P2).

---

## 1. 무엇을 / 왜

현장 작업자의 **심리적 스트레스**를 생체·활동 데이터로 실시간 추정한다. 핵심은 **신체부하(physical load)와 심리스트레스(mental stress)의 분리** — 활동으로 설명되는 심박을 빼고(활동보정 초과심박 ExcessHR), 설명 안 되는 상승 + HRV 저하를 스트레스 신호로 본다.

기존 위험감지 5종(낙상·심박이상·SOS·SpO₂·고온)에 더해 **작업자 부담 모니터링** 차원의 보조 지표. "참고용 추정"으로 포지셔닝(의료 진단 주장 금지 — CLAUDE.md).

## 2. 사양서 vs 우리 스택 — 매핑

| 사양서 가정 | 우리 적용 | 사유 |
|---|---|---|
| `HealthKitManager.swift` (네이티브) | Flutter `health` 13.3.1 read 확장 | 폰 앱은 Flutter 단일 코드 |
| `baseline.py`/`stress_index.py` + FastAPI | **`packages/analyzers` TS 순수함수** | CLAUDE.md 하드룰: 분석 로직은 analyzers 단일 source, 단말 분석 금지 |
| 폰에서 분석 | 폰은 **raw 수집·publish 만** | drift 방지 |
| LSTM (STEP4) | 발표 후 (3차) | CLAUDE.md: ML 2차 이후, 1차는 규칙·통계 |

### 데이터 가용성 (검증 완료 2026-05-28)

8개 입력 전부 Apple Watch SE + Flutter `health` 13.3.1 로 수집 가능.

| 사양 식별자 | health enum | 종류 | 비고 |
|---|---|---|---|
| heartRate | `HEART_RATE` | discrete | 기존 수집 중 |
| heartRateVariabilitySDNN | `HEART_RATE_VARIABILITY_SDNN` | discrete(산발) | 휴식 시 |
| restingHeartRate | `RESTING_HEART_RATE` | 일 1회 | baseline 기준점 |
| activeEnergyBurned | `ACTIVE_ENERGY_BURNED` | **cumulative** | 구간 합산 필요 |
| stepCount | `STEPS` | **cumulative** | `getTotalStepsInInterval` 사용 (소스 중복 방지) |
| walkingHeartRateAverage | `WALKING_HEART_RATE` | 일 1회 | 이름 다름 |
| flightsClimbed | `FLIGHTS_CLIMBED` | **cumulative** | 기압 고도계 |
| respiratoryRate | `RESPIRATORY_RATE` | discrete(수면) | 옵션 |

- **누적형(cumulative)** 은 최근 1샘플이 아니라 **구간 합**을 읽어야 함. iPhone+Watch 공유 store 라 raw 합산 시 이중계산 위험 → STEPS 는 `getTotalStepsInInterval`, 나머지 누적형은 소스 인지 합산.
- **Galaxy(Health Connect)** 는 HRV(SDNN) 노출이 제한적 → Android 작업자는 정확도 낮음. iOS 우선.

## 3. 단계 계획

### P0 — 데이터 수집 (지금 / long pole)
raw 8종을 수집·영속만. 분석 없음. 목적 = 07-07 전 baseline 축적.
- Flutter `health` read 7종 확장(HR 은 기존) + 누적형 구간합 처리.
- **60초 sub-cadence** — 5초 vital 폴링과 별개로, 매 12번째 폴(60s)에 스트레스 입력 수집. HRV·RHR·활동은 빠르게 안 변하고 배터리 보호.
- `VitalSampleSchema`(Zod) + Dart `VitalSample` + SQLite `vital_samples` 에 optional 스트레스 컬럼 추가. 같은 payload·엔드포인트·테이블 재사용(신규 인프라 최소).
- **폰 재빌드에 동반** — 이미 (fallback 제거 + 자동재연결 + offset 0.5) 로 재install 대기 중 → P0 read 확장을 같이 실어 추가 install 0건.

### P1 — 분석 로직 (06-04 코어 데모 이후)
`packages/analyzers` 에 STEP 0~3 TS 포팅.
- STEP0 개인 baseline 롤링 계산(HRV_mean/std, RHR, 활동상태별 HR).
- STEP1 활동분류(휴식/경/중) — 분위수 임계.
- STEP2 ExcessHR + 정규화.
- STEP3 스트레스 지수 0~100(로지스틱) + HRV 신뢰도 가중.
- 검증 시나리오 1~4 테스트(중작업+무스트레스→낮음 / 휴식+HRV급락→높음 / 계단직후 오판X / baseline<7일 calibrating).
- baseline 미구축 기간 "calibrating", 경보 미발생.

### P2 — 표출 (07-07 전)
- 대시보드 카드에 "스트레스(참고)" 표시 + EMA(5/15분) 추세 + 경보 레벨(🟢🟡🟠🔴).
- 🟠 이상 연속 10분 지속 시 경보(단발 스파이크 무시).
- "참고용 추정 · 의료 진단 아님" 명시.

### P3 — 고도화 (발표 후)
- LSTM 추세/만성 스트레스 분류.

## 4. 체크리스트

### P0 (코드 완료 2026-05-28 — 디바이스 수집만 대기)
- [x] `VitalSampleSchema` 스트레스 입력 7필드 optional 추가
- [x] `packages/schemas` build (dashboard 가 dist import)
- [x] `lib/db.ts` 멱등 마이그레이션 — PRAGMA 컬럼 점검 후 ALTER TABLE ADD COLUMN, `persistSample` 영속, `ExportRow` 포함 (런타임 검증: 7컬럼 추가 + 값 영속 OK)
- [x] Dart `VitalSample` 모델 7필드 + `toJson` (null omit)
- [x] Flutter health 서비스 — 스트레스 7종 read (누적형 구간합, iOS 한정 가드)
- [x] `main.dart` 60초 sub-cadence 배선
- [x] 검증: `flutter analyze` clean / dashboard typecheck EXIT=0 / schemas build OK
- [ ] **(다음)** 2 iPhone 재빌드/재install → 60초마다 스트레스 컬럼 DB 누적 확인 (baseline 축적 시작)

### P1 (P1-lite 완료 2026-05-28 세션2)
- [x] analyzers `computeStressIndex` — STEP1 활동분류 + STEP2 활동보정 ExcessHR + STEP3 HRV 편차 로지스틱 + HRV 신뢰도 가중. 개인 baseline 부재 시 `STRESS_POPULATION_BASELINE` fallback
- [x] 검증 시나리오 1~4 + HRV단독 = `stress-index.test.ts` (전체 15/15)
- [ ] **(다음)** 개인 baseline(STEP0) 롤링 계산 — 데이터 축적 후 population → personal 정밀화
- [ ] 캘리브레이션 파라미터 표(§10) 실데이터 미세조정

### P2 (헤더 칩 완료 — EMA/경보 남음)
- [x] 대시보드 작업자 카드 헤더 `StressChip`(보정중/지수, 정상정적·주의/위험 블링크, "참고용 추정·의료진단 아님" 라벨) + store 스트레스 입력 sticky(60초 cadence)
- [x] **2026-05-29 UI 회귀 확인** — VitAlGuard/Coinbase 톤 레이아웃 변경 후에도 작업자 카드 헤더 스트레스 칩 유지. 알고리즘 변경 없음
- [ ] **(다음)** EMA(5/15분) 추세 평활 + 🟠 이상 연속 10분 지속 경보(단발 스파이크 무시)

### P3
- [ ] LSTM 추세/만성 스트레스 분류 (발표 후)

## 5. 결정 기록 (Context Notes)

- **(2026-05-28) 분석은 TS analyzers, 수집은 Flutter** — 사양서의 Swift+Python 은 우리 규칙과 충돌. 로직만 이식, 스택은 우리 것.
- **(2026-05-28) P0 = 데이터 수집 우선** — baseline 이 calendar-time long pole. 분석/UI 보다 수집을 먼저 시작해야 07-07 전 baseline 이 익음.
- **(2026-05-28) 같은 VitalSample payload 확장(별도 스트림 X)** — P0 최소 인프라. 스트레스 필드는 optional·sparse(60s 마다만 채움). 별도 엔드포인트/테이블은 과한 인프라로 판단. 표출 단계에서 필요하면 재검토.
- **(2026-05-28) 60초 sub-cadence** — HRV/RHR/활동은 5초마다 변하지 않음. 중복 행·배터리 낭비 방지. 매 12번째 5초 폴에 수집.
- **(2026-05-28) 누적형 이중계산 주의** — iPhone+Watch 공유 store. STEPS 는 `getTotalStepsInInterval`, 활동에너지·계단은 소스 인지 합산. (axiom-health fundamentals 경고 반영)
- **(2026-05-28) 컴플라이언스** — "참고용 추정 지표"로만 표출. 진단·치료 주장 금지(CLAUDE.md 의료기기 범위 제한).
- **(2026-05-28) Galaxy HRV 제한** — Health Connect 의 SDNN 노출 한계 → Android 작업자 정확도 낮음. iOS(Apple Watch) 우선 시연.
