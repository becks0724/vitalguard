// 위험 감지 임계값 상수 — 의료/KOSHA 권장 인용. [확인 필요] 표시 항목은 실 운용 전 자문 재검증.

export const THRESHOLDS = {
  fall: {
    accelMagnitudeG: 3.0,
    motionStillSec: 30,
  },
  collapse: {
    // 무충격 붕괴(실신·서서히 주저앉음) — 충격 없이(저G) 장시간 무동작.
    // maxImpactG: 이 미만 = 충격 없음. fall.accelMagnitudeG(3.0)와 같은 경계로 상보(≥3.0 낙상 / <3.0 붕괴 후보).
    maxImpactG: 3.0,
    // motionStillSec: 무동작 지속 임계. 정상 휴식 오탐을 줄이려 낙상(30s)보다 길게 잡은 시작값.
    // ★ 이것이 오탐/미탐의 1차 조절 knob — 현장 false-alarm 로그로 튜닝(과대=휴식 오탐, 과소=발견 지연).
    motionStillSec: 90,
  },
  heartRate: {
    highBpm: 130,
    lowBpm: 40,
    sustainSec: 5,
  },
  spo2: {
    cautionPct: 92,
    cautionSustainSec: 30,
    dangerPct: 88,
  },
  coreTemp: {
    // 추정 심부 체온 (estimated core temperature) 기준 — 손목 온도 + wristToCoreOffsetC 로 derive
    cautionC: 37.5,
    dangerC: 38.0,
    // 손목 → 심부 보정 오프셋. 의학 reference: 손목/액와 vs 구강/직장 평균 차이 0.5℃,
    // Apple Watch SLEEP_WRIST_TEMPERATURE 평균 35~36℃ 기준. Android Health Connect 의
    // BODY_TEMPERATURE 는 이미 body 측정값이라 본 보정이 약간 과대지만 단일 상수로 통일.
    // 2차에 source(SLEEP_WRIST vs BODY) 분기 + ambient/hr 회귀로 정교화 예정.
    wristToCoreOffsetC: 0.5,
  },
} as const;
