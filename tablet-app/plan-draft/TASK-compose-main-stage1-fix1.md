# TASK — 메인 앱 1단계 후속 수정 1 (2026-09-26 · claude 검증 결과)

프로젝트: `tablet-app/app/vitalguard_field_android/` (이 폴더 안에서만 수정. Gradle 실행 금지).
claude 실측: assembleDebug 통과 · JVM 56/56 통과(LocalStoreTest 의 90회 반복 키는 맥 PATH_MAX 초과라 20회로 이미 고침 · `QueuedFileStore.operation` 의 ApiFailure 에 `initCause` 이미 추가) · 실기기 Compose 8개 중 1개 실패.

## 1. 실패 원인 — 화면 재생성 뒤 커서가 맨 앞으로 간다 (실제 회전 결함)
- `FieldAppComposeTest.mainStartsAtLoginAndMockTotpSurvivesActivityRecreation` 79행 대기 시간 초과. `recreate()` 뒤 인증번호 필드에 "123" 이 남는 것까지는 통과했지만 이어서 `performTextInput("456")` 이 **"456123"** 이 되어 모의 인증번호 123456 과 달라 `totp` 단계에 머문다.
- 원인: `ui/auth/AuthScreen.kt` 69·75·79행이 `OutlinedTextField(form.code, onCode, …)` 처럼 **String 값 오버로드**를 쓴다. 재생성으로 컴포저블 내부 `TextFieldValue` 가 새로 만들어지면 선택(커서)이 0 으로 초기화된다. 사용자가 태블릿을 돌린 뒤 이어서 입력해도 앞에 끼어드는 실제 결함이다.
- 고칠 것: 아이디·비밀번호·인증번호 세 필드 모두 **재생성 뒤 커서가 텍스트 끝**에 오게 하라. 방법은 둘 중 하나로 통일: (A) `AuthUiController` 폼을 `TextFieldValue` 로 들고 화면은 그 값을 그대로 쓴다(선택 범위까지 상태에 보존 · `code()` 필터는 유지) (B) 화면에서 `rememberSaveable` 로 보존되는 `TextFieldValue` 를 두고 `form.*` 문자열이 바뀔 때만 동기화하되 선택은 끝으로. 테스트는 그대로 두고 통과해야 한다(테스트를 고쳐 맞추지 마라).

## 2. 앱 아이콘·이름
- claude 가 `app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher{,_round,_foreground,_background}.png` 와 `mipmap-anydpi-v26/ic_launcher{,_round}.xml`(적응형: background·foreground·monochrome) 을 넣어 두었다. `AndroidManifest.xml` 의 `<application>` 에 `android:icon="@mipmap/ic_launcher"` `android:roundIcon="@mipmap/ic_launcher_round"` 를 연결하라.
- 앱 이름: `android:label="@string/app_name"` 으로 바꾸고 `res/values/strings.xml` 에 `app_name` = `VitAlGuard 현장`. **debug 빌드만** `VitAlGuard 현장 (dev)` 가 되게 `app/build.gradle.kts` 의 `buildTypes.debug` 에 `resValue("string", "app_name", "VitAlGuard 현장 (dev)")` (release 는 values 의 값). 태블릿에서 Flutter 앱과 구분하기 위함.

## 3. 정리
- 네가 남긴 `source-baseline.json`·`static-audit.json`(프로젝트 루트)은 저장소에 넣지 않는다. 지우거나 `.gitignore` 에 올려라.
- 끝나면 `plan-draft/astra-done.txt` 에 덧붙여라. 못 돌려본 것은 미확인.
