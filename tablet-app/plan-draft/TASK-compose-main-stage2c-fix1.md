# TASK — 2c 수정 1: 실기기 계측 3건 실패 · 2026-09-27

프로젝트 `tablet-app/app/vitalguard_field_android/` 안에서만 수정. Gradle·네트워크 금지. 지시서 `TASK-compose-main-stage2c.md` 의 규칙 유지.
클로드가 실기기(TB373FU · Android 16)에서 `:app:connectedDebugAndroidTest` 를 돌린 결과: **41개 중 3개 실패**(JVM 246·스크린샷 8장은 통과). 각 실패의 원문과 함께 원인을 코드에서 찾아 고치라. 테스트를 지우거나 조건을 느슨하게 해서 통과시키지 말 것. 코드가 맞고 테스트가 틀렸으면 테스트를 고치되 그 판단 근거를 README/검증 기록에 적어라.

## 1. `RecordCalendarFlowComposeTest.offlineDetailClosesToCalendarAndWaitsOutsideHistoryUntilReconnect`
```
java.lang.AssertionError: Action performScrollTo() failed.
Reason: Expected exactly '1' node but could not find any node that satisfies:
(Text + InputText + EditableText contains '오프라인입니다. 연결 후 전송할 수 있습니다.' (ignoreCase: false))
```
- 2c 에서 상세의 [전송] 버튼을 없앴으니, 이 문구를 어디서 누가 그리는지(상세? 달력 항목?) 확인. 실제 화면에 없는 문구를 테스트가 기다리는 것인지, 오프라인 안내를 그려야 하는데 빠진 것인지 판정.

## 2. `RecordEditingComposeTest.memoIsConfirmedAndSavedAsSingleLocalAttachment`
```
androidx.compose.ui.test.ComposeTimeoutException: Condition still not satisfied after 5000 ms
at RecordEditingComposeTest.memoIsConfirmedAndSavedAsSingleLocalAttachment(RecordEditingComposeTest.kt:147)
```
- 2b 에서는 통과하던 테스트. 2c 의 자동 전송(상세 닫힘 → waiting → sendBundle)이나 원장 구조 변경이 "로컬 첨부 1건" 판정 조건을 바꿨는지 확인. 147행의 조건이 무엇을 기다리는지부터 읽을 것.

## 3. `SingleTaskComposeTest.launcherAfterExplicitStartKeepsOneMainActivityHistoryEntry`
```
java.lang.AssertionError: 두 번째 startActivity 뒤 MainActivity Hist는 하나여야 합니다 expected:<1> but was:<0>
at SingleTaskComposeTest.kt:51
```
- 0 은 "겹쳤다"가 아니라 **세는 방법이 실패**했다는 뜻이다(계측 프로세스에서 `dumpsys activity` 를 못 읽거나 출력 형식이 다름). 실기기 Android 16 의 출력은 `* Hist  #0: ActivityRecord{… u0 com.vitalguard.field.dev/com.vitalguard.field.MainActivity t212 …}` 형태다(클로드가 adb 로 확인). 셸 권한이 없으면 `ActivityManager.getAppTasks()`/`Activity.isTaskRoot` 같은 앱 API 로 판정을 바꾸고 근거를 적어라.

## 4. 완료
- `README.md` 2c 절에 수정 내역, `plan-draft/stage2c-verification.md` 갱신, `../../../plan-draft/astra-done.txt` 덧붙이기.
