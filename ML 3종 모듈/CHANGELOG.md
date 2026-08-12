# CHANGELOG

## v4.0.0 — 2026-08-01 (모듈 초판)
- 모델: v4 확정판 3종 (실기기 검증 사슬 완전 — 자가검증 6/6·시나리오 4종·25h 착용)
  - work_veto: RF, 임계 0.675 (precision우선 ≥0.95 → 0.971/0.154)
  - impact: SVM-RBF, 임계 0.710 (fpr5%), LOSO PR-AUC 0.460 — 증거 전용
  - recovery: Logistic, 임계 0.35 (asym 안전측), 1인 21윈도 (증량 예정)
- 학습 데이터: imu_collect.imu_window 2026-07-05 오후 스냅샷
  - work_veto·impact: 586윈도 (4명 × 6라벨, A3 540 + 고G 낙상 편입 46)
  - recovery: 21윈도 (recovered 10 / nonrecovered 11, admin3470, 07-05 14:59~15:10)
  - 미포함: 07-05 저녁 이후 수집분·DRIFT 68윈도(실환경 음성 — v5급 재학습 편입 후보)
- 신규: FallMLModule(단일 진입점+추적성 trace) · CountdownGuard(30초, 버튼+지속움직임 자동취소)
- 아키텍처: 판정 규칙 제거 — 남는 규칙은 1.5G 캡처 게이트뿐(임계 스윕으로 근거화, 낙상 97% 포착)
- 문서: README·통합가이드·검증절차(v5 사태 재발 방지 게이트)

### 참고 — 계보
v1(540) → v2(+고G 14) → v4(+32, 배포판) → (v5: 타팀 무검증 교체 사고, 본 모듈 미채택) → 모듈 v4.0.0
