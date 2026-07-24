# 낙상 ML 재설계 — 팀 계획표

> 문제: 낙상 ML 수집 샘플에 약충격(비낙상 저강도 충격)이 과다해 클래스 가중치가 학습되지 않음.
> 진단 교정(리서치 결론): 표본수 문제가 아니라 **정상 동작과 낙상의 특징 공간이 겹치는(support-overlap) 문제**.
> 근거 리서치 전문: `dist/fall-detection-hf-models/index.html` (STORM 5관점·출처 70여 건).

## 핵심 통찰 3줄

1. 망치질과 낙상을 가르는 결정 변수는 심박·SpO₂가 아니라 **회전 각속도(`peak_rotation_rad_s`)** — 이미 스키마·DB에 존재.
2. 심박 특징(`hr_delta_peak` 등)은 망치/낙상 게이트가 아니라 **넘어짐→쓰러짐 심각도** 판정 계층에 쓴다.
3. 진짜 블로커는 **라벨(동작 종류) 부재** — DB 검증으로 교정됨(아래).

## DB 현황 검증 결과 (2026-07-24, `01-db-audit.mjs`)

당초 "회전값이 합성상수 7로 고정" 우려는 **틀렸다**. 실측 결과:
- 낙상 후보 **3,985건**, `peak_rotation_rad_s` **distinct 1,707개**로 분산(1.1~44.8 rad/s). 합성상수 아님.
- 단, 대부분 **mock 데이터**(worker_id 가 `EMP-admin*`, `motion_still_sec` 전부 1.2/1.5 고정, `fall_decision` 전부 `fall`) → 값은 다양하나 **랜덤 생성이지 실측 gyro 아님**, 그리고 **동작 종류 라벨이 전혀 없음**.
- `accel_magnitude_g` 평균 4.05(2.8~18.25) — 저G(약충격) 다수로 "약충격 과다" 문제와 일치.
- **결론**: 블로커는 "회전 데이터 없음"이 아니라 **"scripted 라벨된 실측 데이터 없음"**. 실기기로 망치질 vs 넘어짐을 라벨해 수집하는 게 핵심.

## 3분류 + 심각도 라벨 체계

| 축 | 값 | 결정 변수 |
|---|---|---|
| 주 라벨(층2) | `work_impact`(작업충격·일상, 음성) / `trip_samelevel`(넘어짐) / `fall_height`(추락) | `peak_rotation_rad_s`, `freefall_preceded`, `motion_still_sec`, `accel_magnitude_g` |
| 심각도(층3) | `recovered`(회복) / `collapsed`(쓰러짐) | `hr_delta_peak`, `hr_post_peak_30s`, `motion_still_sec` |

## 계층형 판정 구조 (최종 목표)

```
[충격 경로]
층1  고G·자유낙하 게이트(기존 v4 유지)         ← accel_magnitude_g, freefall_preceded
  └→ 통과한 후보만
층2  회전 기반 3분류                             ← peak_rotation_rad_s (규칙 or 소형 ML)
  └→ 넘어짐/추락으로 분류되면
층3  심박+회복으로 쓰러짐 승격                   ← hr_delta_*, motion_still_sec (B4 회복수집 연결)

[무충격 경로] ← 실신·서서히 쓰러짐 (03-syncope-layer.md 통합)
층1'  저G + 장시간 무동작 + 자세변화 → no_impact_collapse   ← fall.ts 고G 게이트 비종속 독립 계층
  + SOS "어지러움" 자기신고 채널, + 열맥락(WBGT·체온) AND 무동작 결합
     둘 다 → 공통 응답 루프: 무동작 확인 → 취소 or 무응답 → 관제 escalation
```

> 실신 계층 상세·라벨 확장·이 시스템의 천장(혈압 못 재므로 혈압주도형·무전조 심장성 실신 불가)은
> **`03-syncope-layer.md`** 참조. 낙상 재라벨링(P1)에 실신 클래스를 함께 라벨한다.

## 단계표

| 단계 | 목표 | 완료 검증 | 선후 | 워치 필요? |
|---|---|---|---|---|
| P0 라벨 설계 | 3분류+심각도 정의 확정 | `01-label-spec.md` 팀 합의 | 즉시 | ✗ |
| **P1 실측 수집** ⚠블로커 | 실제 회전 데이터 확보 | `peak_rotation_rad_s` 세션마다 실측(합성상수 7 아님)+클래스별 표본 | P0 후 | **✓ 워치** |
| P2 분리 검증 🚦게이트 | 회전이 실제로 가르는지 | `(accelG × rotation)` 산점도 분리 확인 | P1 후 | ✗(P1 데이터로) |
| P3 재라벨링+테스트셋 | 깨끗한 평가 기반 | subject-disjoint 테스트셋+지표 2개 정의 | P2 통과 후 | ✗ |
| P4 계층형 판정기 | 3층 구조 구현 | 고정 테스트셋서 현행 대비 오탐↓·재현율 유지 | P3 후 | ✗ |
| P5 HF 백본 A/B(선택) | 표현학습 이득 검증 | 두 지표 동시 개선 시만 채택 | P3 후 병렬 | ✗ |

## 워치 없이 지금 가능한 것 (이번 작업 범위)

- [x] P0 라벨 정의서 (`01-label-spec.md`)
- [x] P1 수집 각본·기록지 (`02-collection-protocol.md`) — 워치 오면 바로 실행
- [x] DB 현황 검증 스크립트 (`scripts/fall-ml/01-db-audit.mjs`) — 합성상수 문제 실증
- [x] P2 분리 검증 EDA 스크립트 (`scripts/fall-ml/02-separation-eda.mjs`) — 데이터 오면 바로 실행

## 워치 오면 즉시 할 일 (재개 지점)

1. `02-collection-protocol.md` 파일럿(2명×각 클래스 20건) scripted 수집 — **동작 종류를 알고 수집**
2. `node scripts/fall-ml/01-db-audit.mjs` → 최근 후보 목록에서 `fall_candidate_id` 확인
3. `docs/fall-ml-relabel/labels.csv` 에 이벤트별 라벨 append(각본이라 확정적)
4. `node scripts/fall-ml/02-separation-eda.mjs` → 회전 임계 분리 정확도로 **P2 게이트 판정**(≥85% 면 P3 진행)

> 주의: 기존 mock 후보 3,985건은 라벨·실측이 아니므로 학습·평가에서 제외(labels.csv 에 안 넣으면 자동 제외).

## 버릴 것 (지금 즉시, 비용 0)

- 클래스 가중치·focal loss·SMOTE 조합 탐색 중단. 문헌상 회수 안 됨(리서치 학자·회의론자 관점). 그 시간을 P1 수집으로.
