# VitAlGuard 현장 — Compose/Kotlin 1·2a단계

지시서: `../../plan-draft/TASK-compose-main-stage1.md`, `../../plan-draft/TASK-compose-main-stage2a.md`.
Flutter `../vitalguard_field/`의 세션·셸·현장 요약을 옮긴 별도 프로젝트다.
기존 Flutter·촬영 파일럿은 수정하지 않았다.

**Gradle·네트워크 명령·APK 빌드·설치·Android 계측·스크린샷 실행은 하지 않았다.**
2a에서 캐시된 Kotlin 컴파일러를 직접 실행한 순수 JVM 테스트 165개와 Android/Compose 소스 API 검사는 통과했다.
이 검사는 Gradle 빌드·리소스 링크·실기기 검증을 대체하지 않는다. 아래 2a 절에 실행 범위를 구분했다.

## 범위와 구조

- 진입: `MainActivity`의 edge-to-edge, 방향 고정 없음, `FieldViewModel`의 회전 중 상태 보존.
- 조립: `FieldApplication`에서만 live/mock 구현 선택. UI는 계약과 화면 상태를 사용한다.
- `data/contracts`: 오류의 전체 메타데이터, 게이트웨이·저장소·StateFlow 컨트롤러.
- `data/models`: 원본 서버 JSON 필드, 현장 상태의 독립 파싱, KST/섹션 표시 함수.
- `data/session`: epoch, 역할 허용 목록, 오프라인 복원·재연결 확인, 단일 refresh, 기기 우선 로그아웃.
- `data/live`: HttpURLConnection, 주입 가능한 JsonTransport, Keystore와 순차 파일 저장, 인터넷 상태 확인.
- `data/mock`: 메모리 저장소, 정상/TOTP/worker 거부와 원본 현장 샘플.
- `ui/auth`: 단계별 로그인, 비밀번호 표시, 기억 선택, 잠금 카운트다운, 인터넷 안내 3분기.
- `ui/shell`: 80/256dp 레일, 계정별 접힘 저장, 목적지별 수신 바, 밝은 벡터 배경, 고정 경보 슬롯.
- `ui/site`: 마지막 수신·기상·작업자·가스·AED·미대응 경보·CCTV 카드.
- `ui/placeholder`: 경보·설정의 제목과 “다음 단계에서 옮깁니다”.
- 2a의 `capture`, `ui/record`, `ui/outbox`, 원장 구조는 아래 2a 절 참조.

상세 행과 “영상 보기”는 “다음 단계” 스낵바를 표시한다.
탭별 스크롤은 SaveableStateHolder, 선택·로그인 입력·진행 요청·요약 자료는 ViewModel이 유지한다.
비밀번호와 TOTP는 ViewModel 메모리에만 존재하며 SavedStateHandle/파일에 저장하지 않는다.
프로세스 종료 뒤에는 기억한 토큰 번들로만 복원한다.

로그인 허용 역할은 `platform_admin / owner / site_manager / admin`이다.
현장 API의 역할·현장 범위 거부는 서버가 판단한다.
403은 자료를 지우고 자동 조회·탭 재진입 조회를 멈춘다. 수동 새로고침과 전경 복귀는 먼저
`refreshSite()`를 시도하고 상태를 다시 받으며, 성공하면 60초 폴링을 재개한다.
통신 실패 시 이전 자료를 유지하고 마지막 수신 5분 경과를 표시한다.

수신 바 문구는 원본을 그대로 유지한다. 자리 탭에 표시되는 전송·경보·설정 안내는
최종 앱의 원본 문구이며 기록·전송 상태는 2a에서 연결했고, 경보·설정 기능은 후속 단계 범위다.
시스템 바·컷아웃·IME·제스처의 런타임 인셋을 한 계층에서 합집합으로 소비한다.
창 폭 1000dp 기준은 인셋을 빼기 전이며 회전 방향을 기준으로 삼지 않는다.

## API와 저장

기본 서버는 원본 `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`이다.

| 구현 | 메서드/경로 |
| --- | --- |
| 로그인 | POST /api/mobile/v1/session/login |
| 갱신 | POST /api/mobile/v1/session/refresh |
| 신원 확인 | GET /api/mobile/v1/session/me |
| 로그아웃 | POST /api/mobile/v1/session/logout |
| 현장 정보 | GET /api/admin/site-info — siteInfo 봉투 |
| 현장 요약 | GET /api/app/admin/site-status |

연결 20초, 요청/응답 헤더 30초, 본문 전체 30초를 제한한다.
`Accept: application/json`, Bearer, 리다이렉트 금지를 유지한다.
본문 쓰기는 fixed-length streaming을 사용하고 결과 불명 쓰기는 재시도하지 않는다.
게이트웨이 단독으로 인터넷 상태를 단정하지 않으며 로그인 실패 화면만 네이티브 상태를 확인한다.

아래 기록 경로는 2a에서 구현했다. CCTV·경보 게이트웨이의 기본 구현은 아직 `ApiFailure("다음 단계")`다.

| 후속 단계 | 계약/예정 경로 |
| --- | --- |
| 2a 구현 | upload·voiceComment — POST /api/app-media |
| 2a 구현 | addComment — POST /api/calendar/media/comment |
| 2a 구현 | CaptureAddressGateway — GET /api/app/address |
| 2a 구현 | OperationLookupGateway — GET /api/app/admin/operation-status |
| 3단계 | cctvTicket — POST /api/app/admin/cctv-ticket |
| 3단계 | ackAlert — POST /api/app/admin/alerts/ack |

LiveGateway는 주소·작업 조회 계약을 구현한다. 기본 MockGateway는 관제웹 미등록 확인 경로를 유지하고, MockLookupGateway를 주입하면 조회를 제공한다.
경보 확인에는 오프라인 예약이나 쓰기 재전송 경로가 없다.

- 토큰: `noBackupFilesDir/field-session.enc`, AES/GCM, alias/AAD `vitalguard.field.session.v1`.
  `v / iv / data` 봉투와 `field-session.pending → rename`을 유지한다.
- 토큰 내용: `session` 원본과 `localAccessExpiresAt`. 비밀번호를 넣지 않는다.
- 계정 값: `noBackupFilesDir/field-records/accounts/{계정 base64url 조각}/entries/{키 base64url 조각}/value`.
  padding 포함 base64url을 80자씩 나누며 UTF-8·정규 경로를 검사한다.
- 순차 Mutex 큐, `value.pending → rename`, 다른 계정 격리. 로그아웃은 기록 파일을 삭제하지 않는다.
- `site:info`는 null 응답도 캐시하고 레일은 `shell:rail-collapsed`에 `true/false`를 쓴다.
- 저장소 오류에는 자격 증명·원본 응답·암호문·파일 내용을 포함하지 않는다.

Debug의 다른 앱 ID는 별도 앱 샌드박스를 사용한다. release의 기존 Flutter 토큰/파일 호환과
기존 서명키를 사용한 덮어 설치는 **미확인**이며 4단계에서 검증한다.

## 도구 버전과 의존성

파일럿의 wrapper·루트 플러그인·Gradle 속성을 복사했다.
Gradle 9.3.1 · AGP 9.1.0 · Kotlin/Compose compiler 2.4.0 · Compose BOM 2026.09.00,
compileSdk 37 · targetSdk 36 · minSdk 26 · JVM 17,
screenshot 플러그인 0.0.1-alpha16 / validation API 0.0.1-alpha15(파일럿 조합)이다.
`android.suppressUnsupportedCompileSdk=37`, `android.builtInKotlin=false`, `android.newDsl=false`를 유지했다.

activity 1.13.0 · lifecycle 2.11.0 · core 1.19.1 · coroutines-android 1.10.2는 파일럿과 같다.
JSON은 Android 내장 org.json이며 JVM 테스트에서만 org.json 20240303을 사용한다.
HTTP 라이브러리는 추가하지 않았다.

Navigation Compose는 지시서의 “현재 안정판”을 처음 의존성을 해석하는 시점에 선택하도록
`latest.release`와 alpha/beta/rc/snapshot/dev 거부 규칙을 설정했다.
**정확히 선택되는 Navigation 버전·최신 여부·호환성은 미확인이다.**
후속 실행자는 실제 선택 버전을 기록하고 아래 모든 명령에
`-PnavigationComposeVersion=<확인한 안정판>`을 붙여 재현 가능하게 고정한다.
이 작성 작업에서는 네트워크로 버전을 조회하지 않았다.

## 후속 실행자용 빌드·테스트 명령

이 README가 있는 폴더에서 실행한다. 이 절의 명령은 작성만 했으며 **미확인**이다.
Android SDK와 `platforms;android-37.0`을 준비하고 실행자가 SDK 경로를 설정한다.
`local.properties`는 만들지 않았다. release 서명도 비워 두었다.

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
"$JAVA_HOME/bin/java" -version

./gradlew :app:dependencies --configuration debugRuntimeClasspath
# 출력의 navigation-compose 버전을 확인한 뒤 고정한다.
./gradlew -PvgMock=true :app:assembleDebug
./gradlew -PvgMock=true :app:testDebugUnitTest
./gradlew -PvgMock=true :app:connectedDebugAndroidTest
```

`-PvgMock=true`를 생략하면 live를 조립한다. UI 테스트는 빌드 플래그와 무관하게 Activity 생성 전에
모의 게이트웨이/메모리 저장소를 주입하므로 live API에 접근하지 않는다.
정상 모의 로그인: 아이디 아무거나 / 비밀번호 `mock`.
TOTP: 아이디 `totp` / 비밀번호 `mock` / 코드 `123456`.
거부: 아이디 `worker` / 비밀번호 `mock`.

## 설치·기동

debug 앱 ID는 **com.vitalguard.field.dev**, Activity 클래스는 **com.vitalguard.field.MainActivity**다.
release 앱 ID는 `com.vitalguard.field`이며 기존 Flutter를 대체할 예정이지만 아직 서명하지 않는다.
debug는 기존 Flutter와 공존한다. 패키지가 다르므로 Activity를 아래처럼 완전한 이름으로 지정한다.

```sh
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n com.vitalguard.field.dev/com.vitalguard.field.MainActivity
```

기기가 여러 대면 각 명령에 `-s <serial>`을 붙인다.
파일럿 실측에서 connectedDebugAndroidTest 종료 뒤 대상 앱이 제거됐다.
테스트 후 실기기를 볼 때 APK를 다시 설치한다.

## 프리뷰와 테스트 대응

로그인·현장 요약 프리뷰는 각각 1장, **866dp × 1385dp · 340dpi**이며 시각/입력이 고정돼 있다.
프리뷰는 네트워크·Keystore·ViewModel 타이머를 만들지 않는다.
참조 PNG는 생성하지 않았으며 렌더링·검증은 **미확인**이다.

파일럿 README의 9/26 실측: screenshot alpha15/alpha16 모두 한글 경로에서 실패했고
실제 ASCII 복사본에서는 성공했다. 심링크 우회는 되지 않았다.
후속 실행자는 아래처럼 새 프로젝트만 ASCII 경로로 복사해 실행한다.
참조 이미지 update와 validate는 이미지 검토를 사이에 두고 별도로 실행한다.

```sh
FIELD_SOURCE="$PWD"
FIELD_ASCII=$(mktemp -d /private/tmp/vitalguard-field-stage1.XXXXXX)
rsync -a --exclude build --exclude .gradle --exclude .kotlin --exclude .idea ./ "$FIELD_ASCII/"
cd "$FIELD_ASCII"
./gradlew -PvgMock=true :app:updateDebugScreenshotTest
# 생성 PNG를 열어 한국어·크기·겹침을 검토한 뒤:
./gradlew -PvgMock=true :app:validateDebugScreenshotTest
# 검토한 참조 PNG만 원본의 새 프로젝트 안으로 되돌린다.
mkdir -p "$FIELD_SOURCE/app/src/screenshotTestDebug/reference"
rsync -a app/src/screenshotTestDebug/reference/ "$FIELD_SOURCE/app/src/screenshotTestDebug/reference/"
cd "$FIELD_SOURCE"
```

| 원본 Dart | Kotlin 소스 / 이식 범위 |
| --- | --- |
| login_error_test.dart | LoginGatewayTest — 오류별 문구·메타데이터·알 수 없는 코드 |
| login_connection_test.dart | LoginGatewayTest, HttpTransportTest, AuthUiControllerTest, CommonStatesComposeTest — 통신 분류·인터넷 3분기·늦은 결과 |
| offline_restore_test.dart | OfflineRestoreTest — 캐시·만료·거부·재연결 단일 확인·늦은 me |
| site_status_test.dart | LoginGatewayTest, FieldCoordinatorTest, SiteStatusModelTest |
| site_screen_test.dart | SitePollingTest, SiteStatusModelTest, FieldAppComposeTest |
| nav_rail_test.dart | ShellStateTest, FieldAppComposeTest |
| local_store_keys_test.dart | LocalStoreTest — UTF-8·80자 경계·손상·계정 분리 |
| common_states_test.dart | AuthUiControllerTest, ShellStateTest, CommonStatesComposeTest |
| vg_background_test.dart | BackgroundContrastTest |
| widget_test.dart | FieldAppComposeTest의 메인 진입 smoke — P4 진단 앱은 범위 제외 |
| settings_test.dart | ShellStateTest, LocalStoreTest, FieldAppComposeTest의 하단 설정·목적지 왕복만 |
| alerts_contract_test.dart | SiteStatusModelTest의 alertTime/서버 경보 파싱 — 대응 UI는 범위 제외 |

테스트마다 원본 파일 주석이 있다. 세션 epoch·단일 refresh·로그아웃 실패·모의 TOTP·잠금,
실제 HTTP 없이 header/redirect/streaming 정책을 확인하는 추가 회귀도 작성했다.
`source-baseline.json`은 작성 시작 당시 읽기 전용 원본의 SHA-256 목록이다.
`static-audit.json`은 빌드 없이 시행한 파일/문구/참조/원본 무변경 점검 결과다.

## 다음 단계와 미확인 사항

- 2a 구현: 기록·전송함·촬영/OCR·주소/작업 조회·댓글 쓰기 데이터 경계.
- 2b 예정: 주석 편집기·메모/음성 입력·녹음기·세션 복구. 기상/작업자/가스/AED 상세도 이번 범위 밖이다.
- 3단계: CCTV 티켓/영상·경보 목록/상세·명시적 대응 확인·전역 경보 스트립.
- 4단계: 설정·릴리스 서명·기존 Flutter 앱 덮어 설치/데이터 호환·출시 검증.

다음 항목은 모두 **미확인**이다.

- Gradle 의존성 해석, Kotlin/Compose 컴파일, debug APK 생성.
- Gradle testDebugUnitTest, Android instrumentation, 프리뷰 update/validate의 실행 결과(직접 JVM 실행 결과는 2a 절).
- 설치·기동·기존 앱 공존, JBR/SDK의 이 프로젝트 조합 호환성.
- 실서버 로그인/TOTP/갱신/로그아웃·실제 승인 역할·현장 범위·오프라인 복원/재연결.
- Keystore 암복호화·재시작·기기 파일 교체 실패와 복원, release 데이터/서명 호환.
- TB373FU의 세로↔가로 회전, 분할창, 시스템 제스처/IME 인셋, 큰 글꼴, 터치/펜, 접근성 읽기.
- 현장 활성 탭 60초 조회, 백그라운드 중단, 5분 stale, 403 수동/전경 복귀 복구의 실기기 동작.
- 실제 프리뷰 PNG와 모든 화면의 시각적 검수.


## 2a — 전송 보류 묶음·촬영·보낼 기록·전송 상태

기준은 `SPEC-r7-hold-until-send.md`와 지정된 Flutter 원문이다. 새 앱 폴더의 코드/테스트/문서만 수정했으며,
지시서 §3에서 지정한 `../../plan-draft/astra-done.txt`에는 완료 기록만 추가한다.
Flutter·촬영 파일럿은 읽기 전용으로 사용했다. 작업 중 외부에서 변경된 런처 이미지에는 손대지 않았다.

### 구현 구조와 동작

- `data/OutboxController.kt`: photo/ink/voice/text, 6개 phase, 원본 문구, `items/checking/lookupMessage/loadError` StateFlow.
  원장은 `outbox:v1`, `schemaVersion: 1`과 Dart의 모든 JSON 키를 유지한다. 가변 Dart 항목은 불변 Kotlin 스냅숏으로 교체한다.
  Mutex로 저장을 직렬화하고 바이트 → 원장 순으로 저장한다. `sending` 저장 실패 시 HTTP를 열지 않는다.
  중단된 `sending`은 조회가 필요한 `uncertain`으로 복구한다. 동일 sourceKey/내용은 기존 UUID를 재사용한다.
- `sendBundle`: 사진의 완료와 receipt id를 확인한 뒤 딸린 항목을 생성 순서로 전송한다. 부모가 불명·실패·재로그인 상태면
  딸린 항목에 원문의 대기 이유를 남긴다. 서버 참조는 요청 순간에만 합성하며 저장 필드에는 넣지 않는다.
  동시 묶음 요청은 한 작업을 공유한다. 조회는 50개 배치이며 자동 조회는 계정별 30초 제한이다.
  absent는 불명을 유지하고 명시적 같은 작업 재시도만 허용한다. 503·통신 실패·응답 누락은 absent가 아니다.
- 묶음 완료 시 파일·미리보기·등록된 초안·미저장 사진별 초안·해당 active-draft를 정리한다. 완료 메타는 남고 목록에서 사라진다.
  완료 영수증을 디스크에 쓴 뒤에만 파일을 지운다. UI의 모든 완료 경로는 공통 정리 함수를 사용한다.
  기존 단독 `send(photo)`의 파일 유지와 단독 잉크의 캐시 계약도 유지하며, 실제 화면은 `sendBundle`을 사용한다.
  완료 메타는 완료 시각(구형 항목은 생성 시각)에서 **7일 초과**하면 정리하고, legacy 서버 열람 캐시는 계정별 1회 삭제한다.
- `RecordOrigin.kt`: `fromOutbox`, KST 시각·달력 날짜·잉크 크기 오류·`annotationFields`, 원본 그대로인 사진별 초안 키 목록.
  `photoBytes`는 `outbox-file:<id>`만 읽는다. 서버 사진 다운로드/댓글 수정·삭제 경로는 추가하지 않았다.
- `LiveGateway`/`HttpUrlConnectionTransport`: app-media multipart, 텍스트·음성 댓글, operation-status, 주소 display.
  multipart 본문은 바이트 배열로 한 번 조립해 한 번 쓴다. 연결 20초 / 업로드 요청·응답 60초 / 본문 30초,
  fixed-length·리다이렉트 금지, 작업 ID/영수증/중복 응답 검증, 잉크 2 MiB·음성 10 MiB 제한을 유지한다.
- `capture/`: 파일럿 CaptureNative·TaskAwait·원본 OCR → 각인/리사이즈 → 로컬 저장 파이프라인.
  `DeviceCapturePipelinePort.saveLocal`은 전송함 photo/waiting을 만들고 업로드하지 않는다.
  주소는 컨트롤러 조회 후 실패하면 기기 추정으로 내려간다. 촬영 시작 시 JWT name/workerId(없으면 `-`)와
  현재 site.site_id를 고정한다. 현장 ID가 없으면 다른 보류 사진에서 빌리지 않는다. 원본은 finally에서 삭제한다.
  회전 중 Activity Result와 CameraX 작업은 FieldViewModel 소유 CaptureController에 남긴다.
- `RecordNavigation`: 기록 탭 전용 NavHost(목록/사진 상세/카메라), 셸의 SaveableStateHolder로 탭 전환·회전 시 스택과 스크롤을 보관한다.
  저장 1건·실패 0건이면 로컬 상세, 여러 장/부분 실패이면 목록이다.
- `RecordScreens`: 72dp 미리보기·촬영 KST·현장·딸린 항목 수·상태, 로컬 상세와 1000dp 이상 2단 구성,
  OCR 펼침, 딸린 항목 카드/지우기, 전송/삭제 확인, 최소 160×64dp 실행 버튼. 완료/삭제 후 목록 복귀.
- `OutboxScreen`/`OutboxUiController`: 원문의 안내·필터·작성 현장 그룹·상태/작업 ID·재조회·동일 작업 재시도·미등록 확인 대화상자.
  재로그인 버튼은 signOut을 호출한다. 진입/전경 복귀에서는 GET만 수행하며, 전경 복귀 시 만료도 정리한다.
  오프라인 전송·재시도는 비활성이다. UI 작업은 ViewModel scope에서 계속되어 탭 이동으로 보내던 요청을 새로 만들지 않는다.
- `ActionPlacement`/`ActionDock`: 계정별 `settings:action-side` 읽기, 기본 right. 최대 폭 min(480dp, 남은 폭의 90%),
  런타임 제스처 인셋 반영, 최대 높이 50%와 내부 스크롤. 설정에서 바꾸는 기능은 4단계다.
- `MockGateway`의 로컬 멱등 전송/댓글과 `MockLookupGateway`의 조회 시나리오를 추가했다.
  모의 완료 문구는 `모의 전송 완료 — 실제 서버로 보내지 않았습니다`다.

### 2b로 넘긴 것

주석 그리기·메모·음성 입력·녹음기·세션 복구는 구현하지 않았다.
상세의 두 버튼은 원문의 활성 조건을 그대로 계산하고 누르면 **“다음 단계(2b)에서 옮깁니다”** 스낵바를 표시한다.
딸린 항목 모델/전송/표시/정리 경계는 2a에 포함되어 있다. 설정 토글·CCTV·경보 대응 HTTP는 이번 범위 밖이다.

### 검증 결과와 후속 실행

Gradle과 네트워크를 실행하지 않고 다음 두 도구를 기존 로컬 캐시로 직접 실행했다.
두 도구는 필요한 캐시가 없으면 내려받지 않고 중단한다. 출력은 이 프로젝트의 `build/` 아래에만 남긴다.

```sh
python3 tools/check-jvm-offline.py
python3 tools/check-android-kotlin-offline.py
```

- **통과: 순수 JVM 테스트 165개**. Kotlin 2.4.0 직접 컴파일 + JUnit 4.13.2, coroutines 1.10.2, org.json 20240303.
  기존 순수 JVM 회귀를 포함한다. Android/Compose 배경에 의존하는 기존 BackgroundContrastTest는 이 실행에서 제외했다.
  결과: `build/offline-jvm/compile.log`, `build/offline-jvm/junit.log`.
- **통과: main + androidTest + screenshotTest Kotlin/Compose 소스 API 컴파일**.
  기존 캐시 AAR/JAR, Android 37.0 android.jar, Compose compiler 2.4.0을 사용한다.
  R/BuildConfig는 소스 이름 검사 스텁이며, 이 검사는 **리소스 링크·manifest merge·Gradle 의존성 해석·APK 생성이 아니다**.
  이 검사에서 캐시에 있던 Navigation 2.10.2를 사용했으며 Gradle이 앞으로 선택할 버전은 여전히 미확인이다.
  선택 캐시 목록/로그: `build/offline-android-kotlin/classpath.txt`, `build/offline-android-kotlin/compile.log`.
- **정적 확인**: 원본 문구/키, 네이티브 복사본, XML·리소스 참조, 순수 경계 Android import 없음, 파일 공백/개행.
  기존 원본 기준표의 Flutter lib/test·파일럿 Kotlin 114개 해시가 일치했다. 상세는 `plan-draft/stage2a-verification.md`.
- **미확인**: Gradle assemble/test, 전체 의존성 조합·리소스 링크·manifest merge·APK·설치·실서버.
- **미확인**: 신규 Android 계측 테스트 15개의 실제 실행(촬영 대신 enqueue 주입, 목록/상세/전송/삭제/스택/필터/조회/카메라 권한 UI).
- **미확인**: 프리뷰 2개 실제 렌더링·PNG·시각 검수. `PendingRecordsPreview`는 866×1385dp,
  `LocalPhotoDetailPreview`는 1385×866dp, 둘 다 340dpi다. 위의 ASCII 복사본 screenshot 절차를 그대로 사용한다.
- **미확인**: 실기기 촬영/다중 스캔/권한/서버 주소 폴백/회전·탭 전환/제스처·큰 글꼴/저장 공간 부족,
  기존 Flutter 기기 원장 경로·Keystore·서명/덮어 설치·7일 만료의 실시간 동작. JSON 호환은 fixture/JVM 수준에서만 확인했다.

| 원본 Dart 테스트 | 2a Kotlin 대응 |
| --- | --- |
| outbox_test.dart | OutboxTest, OutboxLifecycleTest, OutboxComposeTest |
| outbox_bundle_test.dart | OutboxBundleTest + Flutter v1 JSON fixture |
| hold_bundle_contract_test.dart | HoldBundleContractTest, MultipartGatewayTest |
| record_contract_test.dart | RecordContractTest + 기존 FieldCoordinatorTest/OfflineRestoreTest의 인증 공통 경계 |
| operation_lookup_test.dart | OperationLookupTest |
| capture_ocr_test.dart | CaptureLogicTest, CapturePipelineTest, CaptureScreensTest |
| capture_site_id_test.dart | CaptureSiteIdTest, CaptureOutboxTest |
| capture_time_test.dart | CaptureTimeTest(원본 8개 + compact offset/공백 구분자 2개), HoldBundleComposeTest |
| hold_bundle_ui_test.dart | RecordContractTest, HoldBundleComposeTest, OutboxComposeTest, Stage2aPreviewTest — 편집기/입력/세션 복구 제외 |
