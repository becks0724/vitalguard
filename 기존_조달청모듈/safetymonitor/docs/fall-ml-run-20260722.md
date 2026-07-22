# 낙상 ML 트랙A 1차 실행 결과 (2026-07-22)

워치 낙상 디텍터 임계 최적화(트랙A)를 **정답 라벨 실측 데이터로 처음 완주**한 기록.
데이터 수집 파이프라인 → 피처 변환 → 학습(그리드+교차검증) → 정량 지표까지 전 루프가 실제로 돈다.

## 1. 데이터

- 소스 = `imu_collect.imu_window` 원시 6축 IMU 윈도(50Hz·impact_index 완비). **666개 사용**(DRIFT 보정용 68개 제외).
- 착용자 4명(LOSO subject: admin3470·admin0740·admin6861·Worker7276).
- 라벨 매핑 — 양성 215 = fall 189 + recovered 13 + nonrecovered 13 / 음성 451 = walk 126(수집 후 필터 여파로 194→126)·sit 87·pound 87·throw 76·hammer 75.
  ※ 음성은 전부 "낙상과 물리적으로 헷갈리는 동작"으로 의도 설계된 hard negative.
- 단위는 데이터로 검증 — walk 전 샘플 |a| 평균 1.255 → G 단위, fall 회전 피크 중앙값 9.2 → rad/s. 변환 불필요.

## 2. 방법

1. **피처 변환** — [ml/fall-detection/extract_imu_features.mjs](../ml/fall-detection/extract_imu_features.mjs).
   - `FallDetector.swift`의 `process()` 상태머신을 그대로 이식한 **exact replay**(기준선 검증용) +
     **임계-독립 피처**(그리드 탐색용 · 피벗=최대 totalG, 자유낙하 0.8s lookback·정지밴드 ±0.3G·postWindow 4s 동일 상수).
   - 일관성 검증 = exact replay 발화 47건 vs 임계-독립 피처에 현행 임계 적용 45건(근사 차이 2건).
2. **학습** — `optimize_thresholds.py` (selftest 7/7·demo 재현 후 실행). 그리드 하한 CLI 인자
   `--impact-grid-min`/`--still-grid-min`을 외과 추가(기본값=기존 동작 불변) — 원시 파형 소스라
   2.8G 게이트 아래 탐색이 유효해졌기 때문(기존 라이브 후보 CSV는 게이트 조건부라 불가했음).

## 3. 결과 — 운영점 비교 (양성 215 · 음성 451)

| 운영점 (impact/still/rot) | recall | 오탐율 | precision | 교차검증(4-fold, 작업자 단위) |
|---|---|---|---|---|
| **현행 2.8 / 1.2 / 6.0 (기준선)** | **0.209** | 0.080 | 0.556 | — |
| 기존 그리드 내 최적 2.8 / 0.6 / 3.0 | 0.312 | 0.144 | 0.508 | recall 0.288±0.156 |
| 오탐 상한 10% 최적 1.6 / 1.7 / 3.5 | 0.330 | 0.084 | 0.651 | recall 0.209±0.179 (불안정) |
| **고recall 1.6 / 0.0 / 3.5** | **0.884** | 0.803 | 0.344 | **recall 0.901±0.032 (안정)** |

로지스틱 참고 모델(트랙B 미리보기) average precision = 0.505 — 4피처 선형 결합으로도 분리력 낮음.

## 4. 핵심 결론

1. **약충격 편향 실증** — 실낙상(fall) 피크G 중앙값 **2.76G < 현행 게이트 2.8G**. 실낙상 절반이
   후보조차 열리지 않아 기준선 recall이 20.9%에 그친다. 놓친 170건의 대부분이 fall(159) —
   느린 주저앉음·손 짚는 낙상 계열.
2. **임계 단독으로는 해결 불가(정량 확인)** — 오탐율 10% 이하 제약에서 recall 상한 ~33%뿐이고
   교차검증도 불안정(과적합 신호). recall을 88%로 올리면 오탐율 80%. 4피처 규칙의 recall↔오탐
   교환에는 원천 상한이 있다([fall-ml-plan.md](fall-ml-plan.md)의 구조 진단이 수치로 확인됨).
3. **충격+정지형 오탐은 임계로 분리 불가 — 카운트다운 UX 담당으로 분류**. 고recall 운영점의
   오탐 구성 = walk 99·pound 79·hammer 68·throw 66·sit 50, 전부 "착용자가 멀쩡히 움직이는 동작"
   → L1 확인 prompt("괜찮으십니까?" 카운트다운)의 dismiss로 무해화 + hard-negative 라벨 공짜 수집.
   기존 실측(25h 착용)에서도 동일 결론 확인됨.
4. **권장 운영점 = 고recall(1.6 / 0.0 / 3.5)** — 단 **카운트다운 UX와 한 패키지로만 배포**
   (단독 배포 금지 — 윈도 단위 오탐율 80%는 확인 prompt 없이는 운영 불가). 교차검증
   recall 0.901±0.032로 착용자 간 일반화가 가장 안정적인 운영점이기도 하다.

## 5. 한계 (정직 고지)

- **still 축은 이 데이터로 최적화 불가** — 수집 윈도가 충격 중심으로 짧아(피벗 후 여유 중앙값
  0.8s) 정지 1.2s 판정 시간이 구조적으로 절단됨. 고recall 해의 still=0.0은 "정지 게이트 제거"가
  아니라 "이 데이터로는 판단 불가"로 읽어야 하며, 실환경 still 튜닝은 긴 윈도 수집 또는 라이브
  shadow 비교로 확정해야 한다.
- 윈도 단위 오탐율 ≠ 실환경 시간당 오탐 횟수(음성이 전부 hard negative 라 보수적 추정).
  시간당 prompt 빈도는 25h 착용 실측과 shadow 모드로 산출.
- freefallG(0.6)·stillBandG(0.3)·postWindow(4s)는 원시 파형 확보로 재튜닝이 *가능해졌으나*
  이번 범위 밖(스크립트 확장 필요).
- 착용자 4명 — 개인 간 편차는 4-fold LOSO 로 점검했으나 표본 확대 여지.
- v4 모델(규칙×ML 융합) 오프라인 비교는 이번 실행에서 제외. 아티팩트 위치는 확인됨 —
  **origin/main `apps/VitAlGuard-iOS-WatchOS-App/Watch/ML/`**(impact·work_veto·recovery.mlmodel +
  thresholds.json[4명 LOSO OOF 운영점: veto 0.675=precision≥0.95·impact 0.710=FPR5%] + ml_selfcheck.json),
  융합 코드 = 같은 앱 `Watch/Sources/MLFusion.swift`·`FallMLPipeline.swift`. 제외 사유 2가지 —
  ① 88피처 추출기 이식 필요(학습 스크립트는 리포 밖·미니앱 IMU_ML_Test 계보)
  ② **v4 학습 데이터가 본 평가셋과 동일 소스(imu_window 4명)** → 오프라인 재평가는 낙관 편향
  위험이 있어 v4 검증은 shadow/실착용(5단계)이 정도(正道).

## 6. 재현

```bash
node ml/fall-detection/extract_imu_features.mjs          # DB → imu-features CSV (DATABASE_URL 필요)
python3 ml/fall-detection/optimize_thresholds.py \
  --csv <위 CSV> --impact-grid-min 1.6 --still-grid-min 0.0
```

산출물(PR곡선 PNG·best_thresholds.json)은 로컬 out/ — 커밋 제외.

## 7. 다음

- **5단계 패키지**(별도 go) = v4 모델 + 고recall 임계 + 카운트다운 버튼을 한 번에 워치 반영 →
  shadow/실착용 검증. 임계 단독 반영 금지(§4-4).
