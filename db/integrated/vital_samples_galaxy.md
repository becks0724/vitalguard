# Galaxy Watch 생체데이터 스키마 — `vital_samples_galaxy` 상세 설명

> 상태: **커밋(저장)만 — 라이브 DB 미적용.** 로컬 미러에서 문법 검증만 완료(`BEGIN…ROLLBACK`, DB 무변경).
> 대상 파일: [`vital_samples_galaxy.sql`](vital_samples_galaxy.sql)

## 1. 목적 · 데이터 흐름

갤럭시워치 사용자의 생체데이터를 **Android Health Connect 표준**으로 수신하기 위한 전용 테이블.
Apple(`vital_samples`)과 **분리** 운영한다.

```
Galaxy Watch ──(Samsung Health)──▶ Android Health Connect
   ──(worker-phone, Flutter `health` 패키지)──▶ 서버 ──▶ vital_samples_galaxy
```

## 2. 왜 Apple(`vital_samples`)과 분리했나 — 지표·단위가 다름

같은 "생체데이터"라도 Apple HealthKit ↔ 갤럭시 Health Connect 는 **지표·단위·이름이 다르다.**
하나의 와이드 테이블에 섞으면 값이 오염되므로 분리한다.

| 항목 | Apple HealthKit | Galaxy Health Connect | 분리 이유 |
|---|---|---|---|
| **HRV** | **SDNN** (ms) | **RMSSD** (ms) | 단위는 ms로 같지만 **다른 지표**. SDNN 컬럼에 RMSSD를 넣으면 스트레스 모델(SDNN baseline 기준)이 오작동 → 별도 컬럼 `hrv_rmssd_ms` |
| **피부온도** | 절대값 °C (sleeping wrist temp) | **baseline 대비 delta** | HC `SkinTemperature`는 변화량만 저장 → `skin_temp_delta_c` + `skin_temp_baseline_c`(절대값 = baseline + delta) |
| **SpO₂** | 0~100 % | 0~100 %(패키지는 0~1 분율로 줄 때 있음) | 적재 전 `*100` 정규화. CHECK(0~100)로 방어 |
| **보행심박** | `WALKING_HEART_RATE` 있음 | **미지원** | 갤럭시엔 컬럼 자체를 두지 않음 |
| **계단** | `FLIGHTS_CLIMBED` | `FloorsClimbed` | 이름만 다름, 둘 다 count → `floors_climbed` |
| **활동에너지** | `ACTIVE_ENERGY_BURNED` | Active/Total 분리 | `active_energy_kcal` + `total_energy_kcal` |

## 3. 컬럼별 매핑 (Health Connect Record → 컬럼 · 단위)

| 컬럼 | 단위 | Health Connect 출처 | 비고 |
|---|---|---|---|
| `heart_rate` | bpm | HeartRateRecord | |
| `resting_heart_rate` | bpm | RestingHeartRateRecord | |
| `spo2` | % (0~100) | OxygenSaturationRecord | 0~1이면 ×100 |
| `respiratory_rate` | breaths/min | RespiratoryRateRecord | |
| `hrv_rmssd_ms` | ms (RMSSD) | HeartRateVariabilityRmssdRecord | **≠ Apple SDNN** |
| `body_temp_c` | °C 절대값 | BodyTemperatureRecord | `body_temp_location` = 측정위치 |
| `skin_temp_delta_c` | °C (변화량) | SkinTemperatureRecord.deltas | 절대값 아님 |
| `skin_temp_baseline_c` | °C | (앱이 계산/보관) | 절대온도 복원용 |
| `steps` | count | StepsRecord | interval 합 |
| `active_energy_kcal` | kcal | ActiveCaloriesBurnedRecord | |
| `total_energy_kcal` | kcal | TotalCaloriesBurnedRecord | |
| `floors_climbed` | count | FloorsClimbedRecord | Apple FLIGHTS_CLIMBED 대응 |
| `vo2_max` | mL/kg/min | Vo2MaxRecord | 선택 |
| `source_platform` | — | (고정 'health_connect') | Apple=healthkit 과 구분 |
| `hc_origin_package` | — | dataOrigin | 예: `com.sec.android.app.shealth` |
| `manual_sos` | 0/1 | (앱 SOS 버튼) | Health Connect 아님 — 앱 레벨 |

나머지: `id`, `worker_id/worker_name/employee_id/job_title`, `device_model`, `ts`, `latitude/longitude`, `battery_pct`, `received_at`, `raw_json`. (총 29컬럼)

## 4. 의도적으로 제외한 것

- **보행심박** — Health Connect 미지원.
- **낙상 / 가속도 / EDA / ECG / 체성분(BIA)** — Health Connect 에 없음(Samsung Health Sensor SDK 영역, Wear OS 앱 + 일부 삼성 승인 필요).
  - **낙상감지는 별도 알고리즘 모듈로 분리 예정** — **가스포드(ESP32 가스검출) 알고리즘과 함께 알고리즘 모듈군**으로 관리한다. 본 스키마는 "센서 raw 수신"만 담당하고, 낙상 판정 로직은 모듈에서 별도 처리.

## 5. 통합 조회 뷰 `v_vital_samples_all` (선택)

분리 테이블을 대시보드가 플랫폼 무관하게 읽도록, Apple `vital_samples` + 갤럭시 `vital_samples_galaxy` 를
`platform`('apple'|'galaxy') 컬럼으로 `UNION ALL` 한 뷰. HRV는 `hrv_sdnn_ms`/`hrv_rmssd_ms` 두 컬럼으로 분리 노출.

## 6. 남은 작업 (스키마와 별개, deferred)

1. **앱/엔드포인트 연동** — 현재 `health_vitals_service.dart`는 Android에서 HR·SpO₂·체온만 읽고 스트레스 입력은 iOS로 게이트됨. 갤럭시 채우려면 Android에서 HRV(RMSSD)·resting HR·호흡·걸음·활동에너지·층수를 Health Connect로 읽고(`health` 패키지 권한 함정 회피) → POST → `vital_samples_galaxy` insert 경로 추가.
2. **스트레스 알고리즘** — `computeStressIndex`가 SDNN 기준 → RMSSD용 baseline/변환 결정 필요.

## 7. 배포 상태 · 적용 방법

- **현재: 파일 커밋만, 라이브 미적용.**
- 적용 시(확인 후):
  ```
  psql "$DSN" -v ON_ERROR_STOP=1 -f db/integrated/vital_samples_galaxy.sql
  ```

## 8. 검증 기록

- 로컬 미러에서 `BEGIN … (DDL) … ROLLBACK` 실행 → **29컬럼 생성 성공, 뷰 생성 성공, 롤백 후 잔존 없음(DB 무변경)**.
- 멱등(`CREATE TABLE IF NOT EXISTS` · `CREATE INDEX IF NOT EXISTS` · `CREATE OR REPLACE VIEW`).
