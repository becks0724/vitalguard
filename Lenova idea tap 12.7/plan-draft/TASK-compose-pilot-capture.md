# TASK — 담당관 태블릿 앱 Compose 전환 파일럿 (카메라+OCR 화면 1개) · 2026-09-26

## 0. 왜 · 범위
- 태곤 님 결정(9/26): Flutter 태블릿 앱을 Jetpack Compose/Kotlin 으로 다시 만든다. **1단계 파일럿** = 촬영·서류 스캔·OCR·각인 흐름 하나를 Compose 로 옮겨 실기기에서 돌리고, 빌드·테스트 순환 시간을 재는 것. 전체 전환은 이 결과를 보고 태곤 님이 확정한다.
- **이 지시서에서 만드는 것**: 새 안드로이드 프로젝트 `Lenova idea tap 12.7/app/vitalguard_field_android/` (독립 Gradle 프로젝트, Kotlin + Compose + Material 3).
- **손대지 말 것**: `Lenova idea tap 12.7/app/vitalguard_field/`(Flutter 앱) 은 **읽기만**. 그 외 저장소의 어떤 파일도 수정 금지. 새 프로젝트 폴더 안에만 쓴다.
- **Gradle 은 실행하지 마라**(네 샌드박스는 네트워크가 없다). 빌드·테스트·설치는 claude 가 한다. 대신 빌드가 한 번에 통과하도록 파일을 정확히 써라.

## 1. 원본 (Flutter, 읽고 그대로 옮긴다)
- UI 흐름: `app/vitalguard_field/lib/ui/record/capture_screen.dart` — `CaptureActionPanel`(서류 스캔·사진 촬영 버튼, 준비 문구, 상태 문구, 진행바) → `CameraCaptureScreen`(미리보기 + 촬영 버튼, 오류/로딩 상태·문구) → 처리 → `PhotoDetail` 로 이동.
- 파이프라인·순수 로직: `app/vitalguard_field/lib/ui/record/capture_ocr.dart` — `captureKstStamp`·`captureKstIso`·`captureCoordinateDigits`·`captureStampLines`·`captureUploadFields`·`CapturePipeline.process`(★ OCR 은 **원본 경로**로 먼저, 각인·리사이즈는 그 뒤).
- 네이티브(이미 Kotlin, **거의 그대로 재사용**): `app/vitalguard_field/android/app/src/main/kotlin/com/vitalguard/vitalguard_field/CaptureNative.kt` — ML Kit 문서 스캐너 준비/실행(`prepareScanner`·`scanDocuments`·`launchScanner`·`onActivityResult`), 위치(`requestLocation`·`recentLastLocation`·`beginLocation`), 역지오코딩(`reverseGeocode`·`addressLine`), 각인+리사이즈(`createStampedJpeg`, maxEdge 2400 · quality 85). MethodChannel 껍데기만 벗기고 코틀린 함수(suspend 또는 콜백)로 바꿔라.
- 기존 Dart 테스트: `app/vitalguard_field/test/` 에서 `capture` 가 들어간 파일을 찾아 순수 로직 테스트를 Kotlin JVM 테스트로 **같은 케이스**로 옮겨라.
- 의존 주석(번들 OCR 모델·스캐너 최초 1회 다운로드 이유): `app/vitalguard_field/android/app/build.gradle.kts` 의 dependencies 블록. 그 주석의 취지를 새 build 파일에도 남겨라.
- 화면 제원: 866dp 폭(340dpi) 태블릿, 세로·가로 둘 다 쓴다. targetSdk 36 이라 방향 고정 불가 → 회전해도 상태가 살아야 한다(ViewModel).
- 탭 크기: 주 버튼 최소 높이 64dp(Flutter 의 `vgTapPrimary`), 촬영 버튼 폭 240dp.

## 2. 만들 것
### 2-1. 프로젝트 골격
- 경로 `Lenova idea tap 12.7/app/vitalguard_field_android/` — `settings.gradle.kts`, `build.gradle.kts`(root), `app/build.gradle.kts`, `gradle.properties`, `gradle/wrapper/`(Flutter 앱 `app/vitalguard_field/android/gradle/wrapper/` 의 jar·properties 와 `gradlew`·`gradlew.bat` 를 **복사**), `.gitignore`(build/·.gradle/·local.properties·*.iml·.idea/), `local.properties` 는 만들지 마라(claude 가 sdk.dir 넣음).
- 버전(모두 현재 Google Maven 에 있는 안정판, claude 가 9/26 확인):
  - AGP `com.android.application` **9.1.0**, Kotlin `org.jetbrains.kotlin.android` **2.4.0**, `org.jetbrains.kotlin.plugin.compose` **2.4.0**, Gradle 래퍼는 복사한 그대로(9.3.1).
  - `androidx.compose:compose-bom:2026.09.00` (material3 1.4.0 포함), `androidx.activity:activity-compose:1.13.0`, `androidx.lifecycle:lifecycle-runtime-compose:2.11.0`, `androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0`, `androidx.core:core-ktx:1.19.1`
  - CameraX **1.6.2**: `camera-core`·`camera-camera2`·`camera-lifecycle`·`camera-view`
  - `com.google.mlkit:text-recognition-korean:16.0.1`, `com.google.android.gms:play-services-mlkit-document-scanner:16.0.0`
  - 테스트: `junit:junit:4.13.2`, `androidx.compose.ui:ui-test-junit4`(BOM), `androidx.test.ext:junit:1.3.0`, `androidx.test.espresso:espresso-core:3.7.0`, `debugImplementation androidx.compose.ui:ui-test-manifest`
  - 워치 모듈이 쓰는 `com.android.compose.screenshot` 플러그인(경로 `기존_조달청모듈/safetymonitor/apps/vitalguard_app/android/wear/build.gradle.kts` 와 그 상위 settings/build 에서 버전을 찾아 같은 버전) 으로 **프리뷰 스크린샷 테스트 1개** 도 넣어라(호스트에서 도는 UI 테스트 — 에뮬레이터 없이 되는지 재는 게 목적).
- `compileSdk 36`, `minSdk 26`, `targetSdk 36`, `applicationId "com.vitalguard.field.pilot"`(Flutter 앱 `com.vitalguard.field` 과 **공존**해야 하므로 다르게), 패키지 `com.vitalguard.field.pilot`, JVM 17, `buildFeatures.compose = true`, 디버그 서명만(release 서명 설정 없음).
- Manifest: `CAMERA`·`ACCESS_FINE_LOCATION`·`ACCESS_COARSE_LOCATION`·`INTERNET`, `uses-feature camera required=false`, 단일 액티비티(`MainActivity`, `ComponentActivity`), `android:configChanges` 로 회전을 막지 말 것(Compose 가 처리).

### 2-2. 화면 3개 (Compose, Material 3, 한국어 문구는 Flutter 와 **글자 그대로**)
1. **기록 화면** `RecordScreen`: 제목 "보낼 기록", 버튼 두 개 가로 배치 [서류 스캔][사진 촬영](각 최소 높이 64dp, `FilledTonalButton`/`Button` + 아이콘), 스캐너 미준비 시 "인터넷에 연결해 한 번 준비해 주세요", 처리 중 "좌표·주소·글자를 확인하고 기기에 저장하는 중입니다." + `LinearProgressIndicator`, 결과 문구 "기기에 저장됨 · N건 · 주석·메모를 붙인 뒤 전송" / "N건 처리 실패" / 마지막 오류. 저장된 항목이 1건이고 실패 0이면 결과 화면으로 이동.
2. **카메라 화면** `CameraScreen`: CameraX `PreviewView`(AndroidView) 뒤 카메라, 하단 가운데 폭 240dp·높이 64dp "촬영" 버튼(촬영 중 "촬영 중…" + 작은 진행 표시, 비활성). 권한 거절 → "카메라 권한이 거절되어 사진을 촬영하지 않았습니다."(다시 시도 없음). 그 외 오류 → 문구 + [다시 시도]. 준비 중 → 진행 표시 + "카메라 권한과 장치를 확인하는 중입니다.". 촬영 결과는 원본 JPEG 파일 경로 + 촬영 시각.
3. **결과 화면** `ResultScreen`: 각인된 JPEG 표시, 각인 줄 목록, OCR 텍스트(스크롤), 업로드 필드 맵(dateKey·capturedAt·title·ocrText 길이·roadAddress·latitude·longitude·siteId), **단계별 소요 ms**(위치·주소·OCR·각인·저장) — 순환 시간 측정용. [기록으로] 버튼.

### 2-3. 파이프라인 (`CapturePipeline`, 순수 Kotlin + 포트 인터페이스)
- Dart 의 `CapturePipelinePort` 와 같은 포트: `requestLocation`·`serverAddress`(파일럿은 **항상 null** — 서버 로그인 없음, 주석으로 명시)·`deviceAddress`(Geocoder)·`recognizeOriginal`(ML Kit 한국어, 원본 경로)·`stampResizeJpeg`·`upload` 대신 `saveLocal`(앱 전용 `filesDir/outbox/<uuid>.jpg` + 같은 이름 `.json` 에 필드 저장).
- 작업자 이름/ID 는 로그인이 없으므로 상수 `"파일럿", "-"` (주석: 본 앱에서는 JWT 사용자).
- siteId 는 null(생략). 처리 순서·실패 처리·원본 삭제(finally)는 Dart 와 동일.
- `CaptureMode.photo|document`, 제목 "현장 사진" / "서류 스캔 · 페이지 N", ocrText = "페이지 N\n<인식 결과 또는 [텍스트 미검출]>" + 각인 줄.

### 2-4. 테스트
- `app/src/test/`(JVM): 순수 로직 — `captureKstStamp`·`captureKstIso`·`captureCoordinateDigits`·`captureStampLines`(위치 미확보·정확도별 자릿수·오래된 좌표 "N분 전 좌표"·주소 "(기기 추정)")·`captureUploadFields`·`CapturePipeline.process`(가짜 포트로 순서 검증: OCR 이 각인보다 먼저, 실패 카운트, 원본 경로별 처리). Dart 테스트 케이스를 옮긴 것이어야 한다.
- `app/src/androidTest/`(실기기): Compose UI 테스트 2개 — 기록 화면에 버튼 2개가 있고 스캐너 미준비 문구가 보인다 / 카메라 화면 오류 상태에 [다시 시도] 가 보이고 권한 거절 문구에는 없다.
- `app/src/screenshotTest/`: 기록 화면 프리뷰 1개.

### 2-5. 문서
- `vitalguard_field_android/README-pilot.md`: 빌드·테스트·설치 명령(JAVA_HOME 은 `/Applications/Android Studio.app/Contents/jbr/Contents/Home`), 측정 항목표(빈 칸: cold assembleDebug · warm assembleDebug · testDebugUnitTest · connectedDebugAndroidTest · validateDebugScreenshotTest · 설치 후 기동), 파일럿에서 뺀 것(서버 주소·로그인·전송·현장 배정)과 이유.
- 끝나면 `Lenova idea tap 12.7/plan-draft/astra-done.txt` 에 만든 파일 목록·미확인 사항(직접 못 돌려본 것은 전부 "미확인"으로 적어라)을 덧붙여 써라(기존 내용 유지).

## 3. 하지 말 것
- Flutter 앱·저장소 다른 파일 수정 금지. Gradle 실행 금지. 네트워크 필요한 명령 금지.
- 스스로 "빌드 통과"라고 쓰지 마라 — 못 돌려봤으면 미확인.
- 서버 호출·로그인·업로드 코드를 만들지 마라(파일럿 범위 밖).
