# 애플워치 낙상 ML 주입 — 체크리스트

계획 = [plan.md](./plan.md) · 결정 근거 = [context-notes.md](./context-notes.md)

## P0 — 계획 산출물
- [x] plan.md
- [x] checklist.md
- [x] context-notes.md

## P1 — 파일 탑재 ✅ (08-27)
- [x] 제시본에서 `Sources/` 6파일 복사 → `ios/VitalWatch/FallML/`
- [x] `Models/` mlmodel 3종 + `thresholds.json` 복사
- [x] `Verification/ml_selfcheck.json` 복사
- [x] ⚠ `Appendix/MLFusion.swift` 는 **넣지 않는다** — 미포함 확인
- [x] `xcodeproj` gem 으로 VitalWatch 타깃에 등록 — Sources 6 · Resources 5
- [x] ⚠ Runner 오염 **0건**(재조회로 확인 — 저장했다는 사실은 등록의 증거가 아니다)
- [x] **검증** — 빌드 통과(26.2s) · 워치 번들에 `work_veto`·`impact`·`recovery` **.mlmodelc 3종 실재**
      · `ml_selfcheck.json`·`thresholds.json` 실재 · 원본 `.mlmodel` 잔재 0 · 폰 번들 `.mlmodelc` **0**
      · 앱 18.3MB → **19.0MB**
- [x] **검증** — 복사본 11파일 전수 `cmp` → **불일치 0건**(제시본과 바이트 동일)

## P2 — 50Hz IMU 스트림
- [ ] `deviceMotionUpdateInterval` 1.0 → 1/50 · 전용 직렬 `OperationQueue` 로 이관
- [ ] ★ **무동작 경로 보존** — `motionMagWindow`(창 60 = 1Hz 에서 60초)를 50Hz 가 1.2초로 만든다.
      1Hz 로 다운샘플해 적재해야 `motionVariabilityMg` 의미가 유지된다
- [ ] `motionUpdates`·`motionMaxG` 카운터 의미 재확인(로그 문구가 "콜백 N회" 라 50배 부푼다)
- [ ] 실효 Hz 를 계산해 로그·`trace` 에 남긴다(스로틀링 실측용 — 모듈이 `spanSec` 로 요구)
- [ ] **검증** — 실효 Hz ≥45 · `motionStillSec` 정상 · `motionVariabilityMg` 가 60초 창을 유지

## P3 — 배선 4조각
- [ ] `IMUWindowLogger(preSec:2, postSec:10, logThresholdG:1.5, refractorySec:2)` 생성
- [ ] `FallMLModule()` — nil 이면 ML 비활성(모델 미탑재)으로 처리하고 **로그로 알린다**
- [ ] `CountdownGuard()` 생성
- [ ] deviceMotion 콜백에 `logger.ingest(...)` + `guard_.feed(...)`
- [ ] `logger.onWindow` → `ml.assess(window)` → `danger` 면 `guard_.start()`
- [ ] ★ `v.trace` 를 **반드시** 로그에 남긴다(추적성 계약 · 사후 재현의 유일한 근거)
- [ ] **검증** — 손목 흔들어 1.5G 넘기면 12초 뒤 `onWindow` 로그 · `trace` 3종 확률 출력

## P4 — UI
- [ ] 카운트다운 화면(남은 초 표시) + **"낙상 아님"** 버튼 → `guard_.cancelByUser()`
- [ ] 햅틱 — `WKInterfaceDevice.current().play(.notification)`
- [ ] 결말 3종 배선 — `onAutoCancel`·`onManualCancel`·`onConfirm`
- [ ] 디버그 화면에 `MLSelfCheck.run()` 버튼
- [ ] ⚠ `onConfirm` 은 **아직 서버로 안 보낸다**(P7) — 로그만. 보내는 척하지 않는다

## P5 — 실기기 자가검증 (통과 의례)
- [ ] `MLSelfCheck.run()` **6줄 전부 ✅**
- [ ] 시나리오 ① 세게 쓰러져 가만히 → 카운트다운 → 무반응 → 확정
- [ ] 시나리오 ② 쓰러졌다 걸으면 → 자동취소
- [ ] 시나리오 ③ 망치질 → 무반응(기각)
- [ ] ⚠ **워치 재설치는 `HKWorkoutSession` 을 끊는다** — 설치 후 손으로 [시작], 수집 공백 ~128초 감수

## P6 — 배터리 실측
- [ ] 1시간 관찰 — 기준선 6.46%/h 대비 증가분
- [ ] 8%/h 넘으면 상시 활성 재검토(수집 모드 게이트 · 표본율 하향 · 배칭)
- [ ] **검증** — `battery_pct` 시계열로 판정(체감 아님)

## P7 — 서버 보고 (별건 · 계약 확장 필요)
- [ ] `fallDecision` 어휘에 모듈 판정(`veto_work`·`danger`) 매핑 결정
- [ ] `Verdict.trace` 담을 자리 신설 — 없으면 사후 재현이 불가능하다
- [ ] ⚠ 서버 스키마·저장·분류 관문 전수 추적([[L-115]] — 목록으로 세지 말고 값의 길을 따라간다)
