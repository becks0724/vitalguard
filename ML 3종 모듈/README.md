# VitAlGuard ML 3종 모듈

Apple Watch 온디바이스 낙상 판정 모듈 — **work_veto · impact · recovery** 3모델 + 판정 파이프라인 + 카운트다운 가드.

## 역할 분담 (팀 계약)

| 역할 | 담당 | 범위 |
|---|---|---|
| **모듈 제작·관리·업데이트** | ML 담당 (김태곤) | 이 저장소 전부 — 모델 학습·교체, 임계 산출, 판정 로직, 검증 |
| **워치 앱 통합** | 앱 담당 | `통합가이드.md`대로 파일 탑재 + 콜백 배선. 모듈 내부 수정 금지 |

모듈 업데이트 흐름: ML 담당이 새 버전 커밋·태그 → 앱 담당은 **폴더 통째 교체** → 자가검증 버튼 ✅ 확인 → 끝.
통합 코드는 바뀌지 않는다 (그러라고 만든 경계다).

## 구성

```
Sources/        판정 코어 6파일 + 섀도 보고 1파일 — 애플워치(Swift, 진입점 = FallMLModule.swift)
SourcesWearOS/  판정 코어 6파일 + 섀도 보고 1파일 — 갤럭시워치(Kotlin, 동일 계약·동일 수치)
Models/         mlmodel 3개 + thresholds.json (임계 산출 근거) — 애플워치용
ModelsWearOS/   onnx 3개 + thresholds.json + 정답지 사본 — 갤럭시워치용(assets 로 복사)
Verification/   자가검증 정답지 + 검증절차(모델 교체 게이트 규칙)
Appendix/       MLFusion.swift — 구(규칙 융합) 통합용 참고, 신규 통합엔 불필요
WearOS통합가이드.md  갤럭시워치 통합 절차 (애플워치는 통합가이드.md)
작업기록.md      모듈 작업 로그 (모든 변경은 여기 기록)
```

## 판정 구조 (v6.1.1)

```
12초 윈도(충격 전2s+후10s) → FallMLModule.assess()
  ① work_veto p≥0.675 → veto_work (기각)          [기각권 — precision 0.97]
  ② recovery 비회복 p≥0.35 → danger → CountdownGuard [주판정 — 애매하면 위험]
     └ 30초: 버튼 취소 ∨ 지속움직임 자동취소 ∨ 무반응→확정
  ③ impact p → 증거 첨부 전용 (거부권 없음 — fail-open 원칙)
```

## 추적성 (디버그 계약)

`Verdict.trace`(dict)를 **신고 payload와 로그에 반드시 포함**할 것:
module_version · decision · 확률 3종 · 샘플수 · 실효Hz · 피크G · 판정시각.
이 정보 + 원시 윈도가 DB에 남으면 어떤 판정이든 사후 완전 재현 가능하다 (v5 사태 같은 회귀를 데이터로 잡는 장치).

## 절대 규칙 (v5 사태 재발 방지 — Verification/검증절차.md)

> **모델·임계 교체는 검증 게이트 통과 없이 금지.** 라벨 데이터 채점 리포트 + 온디바이스 자가검증 ✅ 없는 mlmodel 교체 커밋은 되돌린다.

## 성능 요약 (정직 기재)

- work_veto: LOSO 기각 정밀도 0.971 / 낙상 오기각 실측 0
- impact: LOSO PR-AUC 0.460 — 단독 판정 부적합을 실측으로 확정, 증거 전용
- recovery: 인물내 정확도 86% (위험미탐 1/11) — **1인 21윈도 한계, 증량 업데이트 예정**
- 실기기: 자가검증 6/6, 시나리오 4종 통과, 25h 착용 배터리 2.8%/h
- 학습 데이터: `imu_collect.imu_window` 2026-07-05 스냅샷 (586+21윈도, 4명) — 상세 `CHANGELOG.md`
