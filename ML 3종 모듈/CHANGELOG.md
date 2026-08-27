# CHANGELOG

## v6.1.1 — 2026-08-27 (섀도 보고를 모듈로 편입 — 양 플랫폼)
- **판정 로직·모델·임계 무변경.** 낙상 판정 섀도 서버 적재(`FallShadowReporter`)를 모듈로 편입 —
  추적기(trace)의 **생성과 전송이 한 경계** 안에 있어야, 전송이 끊기거나 모양이 바뀌었을 때
  모듈 무결성 검사(MANIFEST·버전)로 책임 추적이 된다(ML 담당 결정).
- 갤럭시(`SourcesWearOS/FallShadowReporter.kt`): 서버 키 직접 방출(직접 업로드 구조) · 앱 배선 3점.
- 애플(`Sources/FallShadowReporter.swift`): 릴레이 축약 키 방출(fcid/fph/fpg/ftr/fpo/frs — 폰이
  서버 키로 펼침) · **WatchStreamer 인라인 섀도 로직의 교체 대상**(통합은 앱 담당 — 통합가이드 ⑤).
- 두 판 모두 fallDetected·fallDecision 을 만들지 않는다(섀도 계약) — 실경보 전환은 모듈 경유.

## v6.1.0 — 2026-08-27 (갤럭시워치 Wear OS 지원 추가)
- **판정 로직·모델·임계 무변경** — 애플워치 경로(Sources/·Models/)는 버전 문자열 외 그대로.
- 신규: `SourcesWearOS/` Kotlin 판정 코어 6파일 (Swift 와 동일 계약·동일 수치, `com.vitalguard.ml`)
- 신규: `ModelsWearOS/` — sklearn 원본(joblib)에서 skl2onnx 변환한 `.onnx` 3종 + thresholds·정답지 사본.
  변환 검증 = 정답지 6건 + recovery 206벡터 확률오차 **최대 9.6e-7** (게이트 0.01, Core ML 때와 동일 기준).
- 신규: `WearOS통합가이드.md` — 센서 단위 변환(-a/9.80665), 배선 4조각, 검수 3단계, 알려진 한계.
- 실탑재(같은 날): `기존_조달청모듈/safetymonitor/apps/vitalguard_app/android/wear/` — 코어 6파일·onnx 전량 바이트 동일 확인.
- 주의: 모델은 애플워치 데이터 학습본 — 갤럭시워치 실기기 시나리오 검증 필수(가이드의 한계 항목).

## v6.0.0 — 2026-08-20 (신규 워치 앱 전달판)
- **판정 로직·모델 파일 무변경** — v4.0.0 검증본 그대로. 바뀐 것은 버전 표기와 MANIFEST뿐.
- 버전 승격 사유: 신규 워치 앱을 처음부터 올리면서 **모듈 번호를 앱 세대와 맞추고, 사고 번호(v5)를 영구 결번 처리**.
  - v5는 타팀이 무검증 교체한 impact 모델(낙상 전량 0점)의 번호다. 재사용하면 로그·DB에서 사고본과 정상본이 섞인다.
  - 따라서 5.x는 건너뛰고 6.0.0으로 승격 — 이후 `module_version`이 `6.x`면 검증 사슬이 완전한 본 모듈임이 자명해진다.
- 갱신: `VERSION`, `FallMLModule.version`("6.0.0" — 로그·trace에 그대로 찍힘), README 판정구조 표기, `Verification/MANIFEST.sha256` 재생성.
- 검증: MANIFEST 18/18 ✅ (재생성 후 자체 대조), 모델 3종 체크섬 v4 산출물과 동일함 유지.
- 전달물: `ML3종모듈_v6.0.0.zip`

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
v1(540) → v2(+고G 14) → v4(+32, 배포판) → (v5: 타팀 무검증 교체 사고, 본 모듈 미채택·번호 결번) → 모듈 v4.0.0 → 모듈 v6.0.0(표기 승격, 모델 동일) → 모듈 v6.1.0(WearOS 추가, 모델 동일)
