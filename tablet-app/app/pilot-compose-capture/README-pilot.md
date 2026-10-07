# 담당관 촬영 Compose 파일럿

Flutter `vitalguard_field`의 촬영·서류 스캔·OCR·각인 흐름을 옮긴 독립 Android 프로젝트다.
패키지는 `com.vitalguard.field.pilot`이므로 기존 `com.vitalguard.field`와 함께 설치한다.
이 파일럿 결과를 보고 전체 전환을 결정한다. 아래 「9/26 실측 결과」 이후의 본문은 astra 작성 시점(실행 전) 기술이며, 실측으로 바뀐 값은 그 절이 우선한다.

## 9/26 실측 결과 (Claude · 맥 M시리즈 · JBR 25.0.2 · 태블릿 TB373FU Android 16 · USB)

| 측정 항목 | 소요 시간 | 결과/조건 |
| --- | --- | --- |
| 최초 빌드(의존성 다운로드 포함) | 약 2분 | 3회 실패 뒤 통과 — Compose 1.12·core 1.19·lifecycle 2.11 이 **compileSdk 37** 요구 → `platforms;android-37.0` 설치(패키지 이름에 `.0` 붙음) + `android.suppressUnsupportedCompileSdk=37` |
| assembleDebug (의존성 캐시 뒤, 산출물 새로) | 15초 | 36 tasks · APK 60.4MB(debug) |
| warm assembleDebug (문구 한 글자 수정) | 0.7~0.9초 | compileDebugKotlin + packageDebug 실행 |
| testDebugUnitTest | 2초 | **31/31 통과** (4 클래스) |
| connectedDebugAndroidTest (태블릿) | 32초 | **2/2 통과** · ⚠ 끝나면 앱을 **지운다**(pm grant 가 package not found) → 다시 `adb install -r` |
| updateDebugScreenshotTest / validate | 6초 / 3초 | **한글 경로에서는 실패**(alpha15·alpha16 모두 `NoSuchFileException` + 경로 모지바케) → ASCII 복사본(`rsync` → `/private/tmp/...`)에서 통과. 심링크는 Gradle 이 실경로로 풀어 소용없음 |
| adb install -r | 3초 | |
| 설치 후 기동 `am start -W` | TotalTime 853~993ms | |
| 실기기 촬영 흐름 | 위치 12,016ms · 주소 0 · OCR 358ms · 각인 83ms · 저장 34ms | 실내라 GPS 미확보 → 12초 대기 후 「위치 미확보」(원본 CaptureNative 와 같은 12초). OCR 「[텍스트 미검출]」(카메라가 책상을 향함), 각인 3줄 정상, outbox 에 jpg 59KB + json |

- 변경한 것: `compileSdk 37`, Compose BOM 2026.09.00(유지), screenshot 플러그인 alpha16, `local.properties`(미추적).
- 스크린샷 참조 PNG 는 저장소에 넣지 않았다(한글 경로에서 validate 자체가 안 되므로). 전체 전환 시 **프로젝트를 ASCII 경로에 두거나** 스크린샷 테스트를 CI(리눅스·ASCII 경로)에서만 돌리는 것으로 정해야 한다.
- 순환 시간 결론: 편집→빌드 1초 안팎, 단위 테스트 2초, 실기기 UI 테스트 32초. Flutter 의 `flutter test`(호스트 단독) 대비 실기기 테스트만 30초 급이고 나머지는 같거나 빠르다.


## 실행 환경과 빌드

이 README가 있는 `vitalguard_field_android/`에서 실행한다. Claude가 Android SDK 36을 준비하고
`local.properties`에 실제 `sdk.dir`을 넣는다. 해당 파일은 이 작업에서 만들지 않았다.
아래는 후속 실행자용 명령이며 아직 실행한 결과가 아니다.

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
./gradlew :app:connectedDebugAndroidTest
```

AGP 9.1.0 · Kotlin/Compose compiler 2.4.0 · Compose BOM 2026.09.00 · Gradle 9.3.1,
compile SDK 37(`platforms;android-37.0`, 9/26 변경) · target SDK 36 · min SDK 26 · JVM 바이트코드 17이다. Gradle 래퍼 4개 파일은 Flutter 프로젝트에서 그대로 복사했다.
JBR의 실제 Java 버전은 `"$JAVA_HOME/bin/java" -version`으로 별도 기록한다.
외부 Kotlin Android 플러그인을 적용하기 위해 `android.builtInKotlin=false`를,
워치와 같은 screenshot alpha15/기존 DSL 구성을 위해 `android.newDsl=false`를 지정했다.
추가 런타임은 코루틴 `1.10.2`뿐이다. 지정 버전들의 해석·조합 호환성도 실행 전이므로 **미확인**이다.

APK: `app/build/outputs/apk/debug/app-debug.apk`.
기본 debug 서명만 사용하며 release 서명 설정은 없다.

## 설치와 기동

USB 디버깅을 허용한 태블릿을 연결한다. 기기가 여러 대면 `adb -s <serial>`로 대상 태블릿을 지정한다.
ADB는 Android SDK `platform-tools`의 것을 사용한다.

```sh
adb devices
/usr/bin/time -p adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.vitalguard.field.pilot
adb shell am start -W -n com.vitalguard.field.pilot/.MainActivity
```

빌드된 기존 APK가 있을 때 재설치까지 한 번에 하는 대안은 `./gradlew :app:installDebug`다.
설치 시간과 `am start -W`의 `TotalTime`/`WaitTime`을 나눠 기록한다. 기존 Flutter 앱은 삭제하지 않는다.

## 프리뷰 스크린샷 1개

워치 모듈(alpha15)의 다음 버전 `com.android.compose.screenshot:0.0.1-alpha16`과 validation API를 사용한다(9/26: alpha15·16 둘 다 한글 경로에서 같은 오류).
`RecordScannerNotReadyPreview` 하나만 렌더하며 폭 866dp · 340dpi, 세로 높이는 프리뷰 표본으로 1385dp를 사용했다.
기기·카메라·ML Kit·실시간 시각을 생성하지 않는 고정 화면이다. 에뮬레이터 없이 호스트에서 도는지가 측정 대상이다.

참조 PNG는 아직 없다. 최초에는 update로 생성한 뒤 실제 이미지를 열어 버튼·한글·치수를 확인한다.
이후 validate를 실행한다. 변경 후 validate 직전에 update를 자동 실행하면 회귀가 가려지므로 두 명령을 분리한다.

```sh
./gradlew :app:updateDebugScreenshotTest
./gradlew :app:validateDebugScreenshotTest
```

참조 이미지의 예상 위치는 `app/src/screenshotTestDebug/reference/`, 보고서는 `app/build/reports/` 아래다.
실제 생성 위치/PNG/검증 성공 여부는 **미확인**이다.

**이미 저장소에 있는 제약:** 같은 alpha15가 한글 경로의 엔진 설정을 잘못 읽어 실패했고,
ASCII 경로로 실제 복사한 워치 프로젝트에서는 실행된 기록이 있다.
근거: 저장소 `기존_조달청모듈/safetymonitor/docs/wear-preview-screenshot/context-notes.md`의
“엔진 초기화 실패, 플러그인 결함(비ASCII 경로)”와 “우회 실험 결과”. 심링크는 그 기록에서 실패했다.
현재 파일럿도 한글 상위 경로에 있으므로 같은 오류라면 후속 실행자가 아래처럼 별도 ASCII 복사본에서 측정한다.
파일럿 조합에서의 재현/우회 성공 여부는 **미확인**이다. 이 작업에서는 복사본이나 참조 PNG를 만들지 않았다.

```sh
# 현재 위치는 원본 vitalguard_field_android/.
PILOT_SOURCE="$PWD"
PILOT_ASCII=$(mktemp -d /tmp/vitalguard-field-pilot.XXXXXX)
rsync -a --exclude build --exclude .gradle --exclude .kotlin --exclude .idea ./ "$PILOT_ASCII/"
cd "$PILOT_ASCII"
./gradlew :app:updateDebugScreenshotTest
# 생성된 PNG를 열어 확인한 뒤:
/usr/bin/time -p ./gradlew :app:validateDebugScreenshotTest
# 검토한 참조 PNG는 새 파일럿 안으로만 가져온다.
mkdir -p "$PILOT_SOURCE/app/src/screenshotTestDebug/reference"
rsync -a app/src/screenshotTestDebug/reference/ "$PILOT_SOURCE/app/src/screenshotTestDebug/reference/"
cd "$PILOT_SOURCE"
```

## 측정표

측정값은 아직 비워 두었다. 빌드 도구 버전·호스트·태블릿 모델/OS·배터리 상태·방향·성공/실패도 함께 남긴다.
최초 의존성 다운로드와 모델 다운로드 시간은 코드 수정 순환 시간과 구분해 기록한다.

| 측정 항목 | 소요 시간 | 결과/조건 |
| --- | --- | --- |
| cold assembleDebug | | |
| warm assembleDebug | | |
| testDebugUnitTest | | |
| connectedDebugAndroidTest | | |
| validateDebugScreenshotTest | | |
| 설치 후 기동 | | |

명령 예시(의존성 준비 후):

```sh
./gradlew :app:clean
./gradlew --stop
# cold = 산출물 제거 + daemon 정지, 다운로드 캐시는 유지.
/usr/bin/time -p ./gradlew :app:assembleDebug --no-build-cache
# warm = 같은 daemon/산출물로 무수정 재실행(UP-TO-DATE 여부 기록).
/usr/bin/time -p ./gradlew :app:assembleDebug --no-build-cache
/usr/bin/time -p ./gradlew :app:testDebugUnitTest
/usr/bin/time -p ./gradlew :app:connectedDebugAndroidTest
/usr/bin/time -p ./gradlew :app:validateDebugScreenshotTest
```

실제 편집 순환도 비교하려면 파일럿의 UI 문구 하나를 편집한 후 warm assembleDebug를 별도로 측정한다.
스크린샷은 필요 시 위 ASCII 복사본에서 측정하고, 동기화 비용을 따로 적는다.

## 동작과 저장 형식

1. 기록 화면에서 스캐너 준비를 확인한다. 스캐너가 없어도 사진 촬영은 가능하다.
2. 사진은 CameraX 후면 카메라로 원본 JPEG와 셔터 시각을 받는다. 서류는 ML Kit 스캐너로 최대 20장을 받는다.
3. 위치 → 서버 주소 포트(null) → 기기 Geocoder → **각 페이지 원본 OCR → 각인/리사이즈 → 로컬 저장**.
4. 성공 1건·실패 0건이면 결과로 바로 이동한다. 여러 페이지나 부분 실패는 기록 화면에서 성공한 항목을 눌러 확인한다.
5. 결과에서 JPEG·각인 줄·OCR 전문·필드 맵·위치/주소/OCR/각인/저장 ms를 확인한다.

저장 파일은 `filesDir/outbox/<uuid>.jpg`와 같은 이름의 `.json`이다. JSON 루트는 문자열 필드 맵이다.
`dateKey`, `capturedAt`, `title`, `ocrText`와 확보된 주소/좌표만 포함한다. `siteId=null`은 생략한다.
작업자/ID 각인은 `파일럿, -`이며 별도 신원 필드를 저장하지 않는다. 각인 최대 변 2400px · JPEG 품질 85.
촬영 원본과 스캐너 복사본은 성공/실패와 관계없이 배치 처리 뒤 `finally`에서 삭제한다.

권한 거절/위치 실패는 위치 미확보로 남기며 5분 이내 마지막 좌표만 폴백한다. 새 좌표 대기는 최대 12초다.
주소 실패는 선택값 누락, OCR 장치 인식 실패는 `[텍스트 미검출]`, 각인/저장 실패는 페이지 실패로 처리한다.
권한 카메라 거절 문구에는 재시도가 없고 일반 카메라 오류에는 재시도가 있다.

ms는 단조 시계 `System.nanoTime()`으로 측정한다. 위치에는 권한 응답/좌표 대기 시간이 포함된다.
위치·주소는 배치당 한 번이며 각 페이지에 같은 값을 보여 준다. OCR·각인·저장은 페이지별 값이다.
ms 값과 화면 목록은 ViewModel에서 보관하며 JSON에는 원본과 같은 필드 맵만 쓴다.

한국어 OCR은 번들 모델이어서 모델 다운로드가 필요 없다. 스캐너 UI/모델은 Play 서비스가 최초 1회 내려받는다.
현장 투입 전에 Wi-Fi에서 준비하고, 이후 비행기 모드에서 사진·스캔·OCR·로컬 보관을 각각 확인한다.
Geocoder 주소는 기기 서비스/연결 상태에 따라 없을 수 있으며 `(기기 추정)`으로 표시한다.

## 테스트 대응과 실기기 확인

| 원본 Dart | Kotlin |
| --- | --- |
| `capture_ocr_test.dart` 순수 로직 6개 | `CaptureLogicTest`의 GPS/미확보/오래된 좌표/기기 주소, `CapturePipelineTest`의 순서/주소 폴백 |
| `capture_ocr_test.dart` 위젯 2개 | `CaptureScreensTest` 2개: 버튼/준비 문구/크기, 일반 오류·권한 오류의 재시도 차이 |
| `capture_time_test.dart` 입력 8종 | `CaptureTimeTest`: 같은 KST 표시/누락/오류/원문 보존, 카드·결과 공용 함수 |
| `capture_site_id_test.dart` 3개 | `CaptureSiteIdTest`: 현재 ID 고정, 이전 ID 재사용 금지, 오프라인 로컬 보관 |

추가 JVM 회귀는 페이지별 경로/번호, OCR·각인·저장 실패 카운트와 계속 처리,
주소/위치 예외, 빈 OCR, 빈 입력, 취소 시 원본 정리, 단계별 ms, 로케일 독립성을 다룬다.
파일럿 실행은 언제나 siteId=null이지만 원본 계약 보존을 위해 순수 함수의 ID 인자와 테스트는 유지한다.
Compose 테스트는 하드웨어 포트를 만들지 않는 UI 테스트다. 실제 CameraX/스캐너/Geocoder 검증을 대신하지 않는다.

실기기에서 추가로 확인할 항목(모두 **미확인**):

- 세로↔가로 회전: 카메라 준비/촬영, 권한 대화상자, 스캐너 실행, OCR/저장 중, 결과 화면. Activity를 재생성하며 ViewModel과 Activity Result 콜백이 이어지는지 확인.
- 866dp·340dpi에서 버튼 높이 ≥64dp, 촬영 버튼 폭 240dp, 큰 글꼴/가로 화면 스크롤, system bar 겹침.
- 카메라 허용/거절, 위치 허용/대략적 위치/거절, 스캐너 최초 다운로드/취소/여러 페이지, 오프라인 촬영.
- 원본 EXIF 방향, 한글 OCR, 각인 줄/최대 변/품질, JPEG/JSON 쌍, 원본 임시 파일 삭제, 부분 저장 실패.
- 기존 Flutter 앱과 동시 설치 및 파일럿 첫 기동.

## 파일럿에서 뺀 것

- 서버 주소 조회: 서버 로그인 없이 동작해야 하므로 포트는 항상 null이며 기기 주소를 사용한다.
- 로그인/JWT: 촬영 전환만 측정하기 위해 작업자 이름/ID를 상수로 둔다.
- 전송/서버 API: 파일은 앱 전용 outbox에만 저장한다. 원본 상태 문구의 “주석·메모를 붙인 뒤 전송”은 문구 호환용이며 해당 편집/전송 기능은 파일럿에 없다.
- 현장 배정: 배정 정보가 없으므로 siteId를 생략한다.
- 앱 강제 종료/프로세스 사망 뒤 진행 작업 및 기존 outbox 목록 자동 복원: 이번 범위는 회전 중 ViewModel 상태 보존이다. 저장 파일 자체는 유지된다.

전체 Flutter 전환, 배포/릴리스 서명, 주석·메모 편집은 이 파일럿의 범위가 아니다.
