# idea.md — 영상·워치 낙상 결합(fusion) 판정

> 1단계 구상 토론 결과. 작성: 클로드(메인) ↔ 코덱스(적대적 검토, read-only). 라운드 1회 수렴.
> 본 문서는 "무엇을 왜" 만 담는다. 알고리즘 상세는 3단계 설계 문서, 구현은 4단계.

## 한 줄 요약

건설현장의 **영상(YOLOv8-pose CCTV)** 낙상 신호와 **손목 착용(Apple Watch CoreMotion)** 낙상 신호를
서버에서 **결합**하여, 단일 신호 대비 **오탐(false alarm)을 줄이고 미탐(놓침)은 늘리지 않는**
낙상 판정 단계(의심/경보/확정)를 만든다.

## 풀려는 문제 (코드로 확인된 현재 상태)

현재 두 소스는 **완전히 분리**되어 있다.

- **영상**: 별도 FastAPI(:8000)에서 YOLOv8-pose 추론 → `/cctv/stats2`로 `{total, fallen, byStatus}` 통계만
  대시보드에 **실시간 표시**. **DB 미저장, alerts 미연동, worker_id 없음**(카메라/존 단위).
  - 근거: `apps/dashboard-web/app/components/CctvQuadView.tsx:386-422`,
    `app/ai-cctv/[...path]/route.ts`(표시용 프록시).
- **워치**: CoreMotion 3단계 게이트(자유낙하→충격≥2.8G→저활동→자이로) → `fallDetected/fallCandidate`로
  `POST /api/mock/vital` → **SQLite 저장 + alerts 이력화 + 즉시 danger 판정**.
  - 근거: `apps/worker-watch-poc/Sources/FallDetector.swift`,
    `apps/dashboard-web/lib/severity.ts:93`(`fall_detected===1` → danger).

즉 영상은 "대상이 누구인지 모르는 채 화면에만", 워치는 "누구인지 알지만 손목 한 점만". 두 신호를 엮으면
**영상이 워치의 오탐(망치질·격한 동작 오검출)을 검증**하고, **워치가 영상의 자세 오탐(앉기·눕기)을 검증**할 수 있다.

## 왜 단순 결합이 위험한가 (코덱스 적대적 검토 → 전면 수용)

초안의 "가중 점수 합산"만으로는 안전 크리티컬에서 세 가지로 무너진다. 코드 대조로 모두 확인됨.

1. **부재를 음성으로 취급하는 함정** — 워치 미착용/영상 사각지대를 "낙상 아님"으로 읽으면 미탐.
   → 가용성(availability)을 `available / unavailable / blind / stale`로 **명시 모델링**. 부재는 `unknown`.
2. **대상 매칭 부재** — 영상은 `camera/zone`, 워치는 `workerId+GPS`. 1:1로 못 잇는다.
   `HazardEvent.workerId`는 **필수**(`packages/schemas/src/hazard-event.ts:18`)라 zone-only 이벤트를 못 담는다.
   → **worker 확정 fusion**과 **zone 미확정 fusion**을 분리. 후자는 `ZoneHazardEvent` 신설(대상 미특정).
3. **시간 정합 가정 붕괴** — 워치 `ts`는 충격 시각이 아니라 **발신 시각**
   (`VitalTransmitter.swift:83` `iso.string(from: Date())`). 정밀 정합 불가.
   → 좁은 윈도우 강제하지 말고 **넓은 후보창 + 낮은 확신도**. 정밀 정합은 `impactTs/frameTs` 신설이 전제(확인 필요).

## 핵심 설계 원칙 — Safety Monotonicity

> **fusion은 신뢰도를 올리기만 하고, 단독 신호가 이미 발생시킨 경보를 절대 깎지 않는다.**

워치 단독 `fallDetected`는 현재도 즉시 danger다. fusion은 여기에 영상 코로보레이션이 더해지면 "확정"으로
**격상**할 뿐, 영상이 없거나 음성이라고 워치 danger를 "주의"로 **격하하지 않는다**. 한쪽 신호 부재가 다른 쪽
경보를 약화시키는 순간 그 시스템은 안전하지 않다.

## 단독 신호 정의 (실제 코드 필드 기준)

- **영상(존 단위)**: `byStatus`의 `fallen`(확정 낙상 자세) / `lying`(누움) / `unstable`(불안정) / `standing`.
  `fallen>0`이 양성 후보. 카메라ID·존, 프레임 시각. worker_id 없음.
- **워치(작업자 단위)**: `fallDetected`(즉시 danger) 또는 `fallCandidate`+`fallDecision`(fall/rejected 2종),
  `accelMagnitudeG`(peakG)·`motionStillSec`·`freefallPreceded`·`peakRotationRadS`, `workerId`·GPS·발신 ts.

## 판정 단계와 후속 (요지, 상세는 PRD/설계 문서)

| 단계 | 트리거(요지) | 후속 |
|---|---|---|
| 의심(caution) | 영상 `lying` 단독 등 약신호 | 로깅·대시보드 표시만 |
| 경보(warning) | 워치 단독 양성 / 영상 `fallen` 단독(zone) | 관제 알림 + (워치) 작업자 자가확인 프롬프트 |
| 확정(danger) | 워치 양성 + 영상 `fallen` 시간·대상 정합 | 즉시 SOS 에스컬레이션 + 기존 alerts/severity 연동 |

단, **워치 단독은 현행 danger를 유지**(monotonicity) — 위 표의 "경보"는 영상 단독 신설 경로에만 적용하고
워치 danger를 낮추지 않는다. 상세 규칙은 PRD/설계 문서에서 확정.

## 비범위 (이번 산출물에서 제외)

- YOLO **모델 재학습**(현재 inference-only, 트랙A 임계최적화는 데이터 성숙 후) — 본 작업은 결합 로직만.
- BLE/UWB 실내 측위 하드웨어 도입 — zone↔worker 정밀 매칭은 "확인 필요"로 남기고 배정표 기반으로 제한.
- 워치 `impactTs`/영상 `frameTs` 스키마 확장의 **펌웨어/카메라 측 구현** — 인터페이스만 정의, 실제 송신부는 확인 필요.

## 확인 필요 (미확정 가정)

1. 영상 FastAPI(:8000)에 **이벤트 push(서버 저장) 엔드포인트가 없음** — 표시용 통계만. fusion하려면
   영상 낙상 이벤트를 대시보드로 보내는 경로 신설 필요. 데모 리포(`safetymonitor-cctv-demo`) 수정 권한·방법 확인 필요.
2. **zone↔worker 배정 데이터** 출처 — 현재 코드에 작업자-구역 배정표가 없음. 운영상 어떻게 채울지 확인 필요.
3. 워치 **충격 정확 시각**(`impactTs`) 송신 여부 — 현재 미동봉. 정밀 시간 정합은 이것 없이는 불가.
4. 카메라별 **커버리지(존 매핑)** 메타데이터 — CAM-02="지하 기계실" 같은 라벨만 있음.
