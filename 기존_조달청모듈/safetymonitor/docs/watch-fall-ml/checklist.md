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

## P2 — 50Hz IMU 스트림 ✅ 코드 (08-27 · 실기기 확인 진행중)
- [x] `deviceMotionUpdateInterval` 1.0 → 1/50 · 전용 직렬 `OperationQueue`(`userInitiated`) 로 이관
- [x] ★ **무동작 경로 보존** — 1Hz 다운샘플(`stillTickInterval`)로 창 60 = 60초 유지
- [x] ★ **메인 스레드 계약 유지** — 무동작 변수는 메인 런루프 `flush()` 가 읽으므로 쓰기도 메인
- [x] 종료 로그 문구 `콜백 N회` → `1Hz 틱 N회`(50배 부푼 값을 종전 이름으로 부르지 않는다)
- [x] 실효 Hz 를 세션 종료 로그에 남긴다
- [ ] **검증** — 실효 Hz ≥45 (실기기 · 세션 종료 로그에만 찍혀 미측정)
- [x] **검증** — `motion_still_sec`·`motion_var_mg` 종전 의미 유지 (11:36~11:48 실측)
      ★ **판별 근거 = 재시작 직후 `mv` 공백**. 11:41·11:45 재설치 직후 `mv` 가 1건·0건으로 비었다가
      다음 분에 12건으로 찬다 — 창 60개가 **60초를 덮는다는 지문**이다. 다운샘플을 안 했으면
      1.2초 만에 차서 이 공백이 아예 안 생긴다. `msc` 는 최대 10~40초로 종전 범위 유지.
      수집도 무손상 — 12행/분 지속.

## P3 — 배선 4조각 ✅ 코드 (08-27)
- [x] `IMUWindowLogger(preSec:2, postSec:10, logThresholdG:1.5, refractorySec:2)`
- [x] `FallMLModule()` — nil 이면 **`log.error` 로 알린다**(조용한 비활성 금지)
- [x] `CountdownGuard()`
- [x] 콜백에 `ingest(...)` + `feed(...)` — 가속도는 `userAcceleration + gravity`(G·정지 −1g)
- [x] `onWindow` → `assess(window, spanSec: 12.0)` → `danger` 면 `start()`
- [x] ★ `trace` 전량 로그(`[FALL] decision · 확률3 · 샘플 · 실효Hz · 피크G · 모듈버전`)
- [ ] **검증** — 1.5G 넘기고 12초 뒤 `[FALL]` 로그 출현(실기기)

## P4 — UI ✅ 코드 (08-27)
- [x] 카운트다운 오버레이(전체 화면 — 쓰러진 사람이 목록을 스크롤할 수 없다) + **"낙상 아님"**
- [x] 햅틱 — 진입 `.notification` · 확정 `.failure`
- [x] 결말 3종 배선 — `onAutoCancel`·`onManualCancel`·`onConfirm`
- [x] `MLSelfCheck.run()` 버튼 + 결과 6줄 표시
- [x] ⚠ `onConfirm` 은 로그만 — 서버 신고 미구현(P7). **보내는 척하지 않는다**

## P5 — 실기기 자가검증 (통과 의례)
- [x] `MLSelfCheck.run()` **6줄 전부 ✅ — 2026-08-27 11:45 실기기(Apple Watch Ultra)**
      기동 시 자동 실행분. 파이썬 정답지와 Core ML 확률이 소수점 3자리까지 일치.
      ```
      walk  ·impact    p 0.037/0.038 ✅      fall  ·impact    p 0.869/0.869 ✅
      walk  ·work_veto p 0.105/0.105 ✅      fall  ·work_veto p 0.110/0.110 ✅
      hammer·impact    p 0.146/0.146 ✅      hammer·work_veto p 0.810/0.810 ✅
      피처 최대오차 7.4e-07  (허용 1e-5)
      ```
      ※ 이 6건은 갤럭시(ONNX) 트랙의 대조군이다 — 같은 joblib 형제 산출물이라 두 플랫폼
        확률이 일치해야 정상(변환 게이트 0.01).
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
