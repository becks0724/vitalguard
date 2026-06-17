# 낙상 감지 임계 최적화 (트랙 A) — 스캐폴드

워치 낙상 디텍터의 **임계값(입력값) 최적화**를 위한 분석 스크립트. 데이터가 충분히 쌓이면
바로 실행할 수 있도록 미리 준비해 둔 것이다. 학습·배포는 발표 후 트랙.

> 관련 계획 — [docs/fall-ml-plan.md](../../docs/fall-ml-plan.md). 데이터 수집 파이프라인은 이미 구축됨
> (워치 후보 전송 + DB + 관리자 라벨링/내보내기).

## 무엇을 하는가

`fall-export` CSV 1개를 입력받아:
1. **기준선** — 현재 FallDetector 임계(2.8G / 정지 1.2s / 회전 6.0)의 혼동행렬(recall·오탐율).
2. **그리드 탐색** — `impact_g_min · still_sec_min · rot_min` 조합을 데이터에 재적용(replay)해
   비용(놓친 낙상 가중 ≫ 오탐 가중) 최소 조합을 찾음.
3. **교차검증** — 작업자 단위 GroupKFold 로 일반화 점검(같은 작업자 누수 방지).
4. **PR 곡선** — 로지스틱(트랙 B 미리보기)으로 매끈한 PR 곡선 + 규칙 운영점 표시 PNG.
5. **권장 상수** — FallDetector.swift 에 넣을 값.

## 실행

```bash
# 0) (설치 불필요) 결정 로직 단위검증 — 지금 바로 가능
python3 optimize_thresholds.py --selftest

# 1) 의존성 설치 (가상환경 권장)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2) 합성 데이터로 파이프라인 검증 (실데이터 아님)
python3 optimize_thresholds.py --demo

# 3) 실데이터 — 관리자 메뉴에서 받은 CSV 로
python3 optimize_thresholds.py --csv ~/Downloads/fall-ml-2026-07-01_2026-07-07.csv

# 비용 가중·오탐 상한 조정 예
python3 optimize_thresholds.py --csv data.csv --w-fn 20 --w-fp 1 --fpr-cap 0.1
```

데이터 준비 = 관제 웹 → 관리자 메뉴 → **낙상 감지 ML 데이터 수집** → 후보 라벨링 →
**ML CSV 다운로드**.

## 출력 해석

- **recall(민감도)** = 실제 낙상을 잡은 비율. 산업안전에서 최우선(놓치면 치명).
- **fpr(오탐율)** = 작업충격을 낙상으로 오인한 비율. 높으면 알림 피로.
- 권장 정책: `--w-fn` ≫ `--w-fp`(놓친 낙상이 훨씬 비쌈), 또는 `--fpr-cap` 으로 오탐 상한 두고 recall 최대화.
- 결과는 `out/best_thresholds.json` + `out/pr_curve.png`.

## ⚠️ 한계 (데이터 생성 구조상 — 반드시 인지)

1. **모든 후보는 충격 ≥ 2.8G**(워치 게이트 통과분만 기록). → 충격 임계는 **올릴 수만** 있고
   **안전하게 내릴 수 없음**. 2.8G 미만 약한 낙상은 데이터에 부재 = **recall 사각지대**.
   게이트 자체를 검증하려면 알림 임계보다 낮은 **로깅 임계로 별도 수집** 필요(원시 모션 윈도 옵션).
2. **freefallG · stillBandG · postWindowSec 는 재튜닝 불가** — 워치에서 집계에 이미 반영돼
   집계 feature(`freefall_preceded` bool · `motion_still_sec`)만 남기 때문. 재최적화 가능 임계는
   `impact_g_min(≥2.8) · still_sec_min · rot_min` 셋뿐.
3. **레거시 행 제외** — 신규 feature(자유낙하·회전)가 없는 옛 양성은 replay 불가라 분석에서 빠짐.
4. **라벨 노이즈** = 정확도 천장. 관제자 수기 라벨이라 CCTV·현장 대조 권장.
5. 그리드 탐색 결과는 전체 데이터에 맞춘 것 → **shadow 모드**(구·신 판정 동시 로깅 비교) 후 배포.

## 다음(데이터 성숙 후)

- 트랙 B — 4 feature 경량 분류기(로지스틱/트리). 워치 Swift 포팅 또는 **서버측
  `packages/analyzers`(TS) 오탐 필터**로 배포.
- 폐루프 — 새 라벨 누적 → 재학습 → shadow 비교 → 교체.
