<p align="center">
  <img src="VitAlGuard_logo/vitalguardlogo.light.png#gh-light-mode-only" alt="VitAlGuard" width="360">
  <img src="VitAlGuard_logo/vitalguardlogo.dark.png#gh-dark-mode-only" alt="VitAlGuard" width="360">
</p>

# VitAlGuard — 건설현장 안전 통합 모니터링

조달청 조달데이터 AI 활용 창업경진대회 프로젝트.
**근로자 생체·낙상(Apple Watch) + 현장 CCTV AI + 가스 감지 + AED 상태 경보**를 하나의 관제
대시보드로 통합해, 사고를 감지·확정·전파하는 시스템이다.

```
[Apple Watch]──생체·낙상(온디바이스 ML 3종)──┐
[CCTV + AI ]──영상 이벤트────────────────────┤
[가스포드   ]──O₂·CO·H₂S·온습도──────────────┼──▶ [관제서버/대시보드] ──▶ 알림·조치
[AED 알람   ]◀──상태 폴링(경보 출력)──────────┘            │
                                                        [DB (PostgreSQL)]
```

## 저장소 지도

| 폴더 | 내용 |
|---|---|
| [`hardware/`](hardware/) | **현장 물리 장치** — AED 알람(라즈베리파이), 가스포드 요약·링크 |
| [`Final_GasPod/`](Final_GasPod/) | 가스포드 v4.2 확정 문서·펌웨어·서버 연동 가이드 |
| [`db/`](db/) | DB 스키마·감사·통합 문서 (fall_ml / imu_collect / integrated / audit 등) |
| [`기존_조달청모듈/`](기존_조달청모듈/) | safetymonitor — 워치·폰 앱, 대시보드, cctv-ai, ml/fall-detection 등 기존 모듈 |
| [`조달청_안전관리비_모듈/`](조달청_안전관리비_모듈/) | 안전관리비 계산 모듈(safeprocure) |
| [`조달청 공문/`](조달청%20공문/) | 대회 공고·참가신청 양식 |
| [`VitAlGuard_logo/`](VitAlGuard_logo/) | 로고 에셋 (라이트/다크) |

## 핵심 구성 요소

### 1. 워치 낙상 감지 — 실데이터 학습 ML 3종, 온디바이스 추론
Apple Watch 위에서 Core ML로 실시간 추론 (서버 왕복 없음, event-gated로 배터리 보호):

| 모델 | 알고리즘 | 역할 |
|---|---|---|
| work_veto | RandomForest | 작업동작(망치질 등) 오탐 기각 — precision 우선(≥0.95) 운영 |
| impact | SVM-RBF | 낙상 충격 판별 보조 증거 |
| recovery | Logistic | 충격 후 회복/비회복 — 애매하면 위험 쪽(asym 0.35) |

판정 구조 = 규칙(충격 게이트·무활동)이 1차축, ML은 기각권·보조 증거, 최종 확정은
카운트다운+무반응(사용자 확인). 팀 4명 실수집 데이터(600+ 윈도)로 학습, LOSO 평가,
실기기 시나리오·25시간 착용 검증 완료. 워치/폰 앱 코드:
[VitAlGuard-for-iOS-WatchOS](https://github.com/yangjeehoo/VitAlGuard-for-iOS-WatchOS)

### 2. 가스포드 — 밀폐공간 가스 감지 (ESP32-S3)
O₂·CO·H₂S·온습도 측정, 현장 부저·LED 경보 + 서버 전송. 상세: [`hardware/`](hardware/)

### 3. AED 알람 — AED 상태 현장 경보 (Raspberry Pi)
관제서버 폴링으로 AED 배터리·패드 상태를 LED·사이렌으로 표시. 상세: [`hardware/AED_alarm/`](hardware/AED_alarm/)

### 4. 관제 대시보드·DB
Cloud Run 배포 대시보드 + PostgreSQL. 스키마·감사 문서는 [`db/`](db/),
기존 모듈(대시보드·cctv-ai 포함)은 [`기존_조달청모듈/safetymonitor/`](기존_조달청모듈/safetymonitor/).

---
문서 기준일: 2026-07-08
