# VitAlGuard 현장 — 사진 배경·반투명 패널 1.3.1

> **1.3.1 상태 띠 수정:** 상단 오프라인 띠를 반투명 청회색으로 바꾸고, 현장명·Wi-Fi 제한 아이콘·오프라인 문구·오른쪽 안내 아이콘의 세로 중심을 맞췄다.
> release **1.3.1 / 6** 빌드 완료. JVM **296/296**, 프리뷰 **22/22**, 관련 실기기 **9/9** 통과. 주 앱 설치는 USB 재연결 대기이며, 마지막 확인된 주 앱은 **1.3.0 / 5**다.
> 최신 정본: [status-strip-verification.md](plan-draft/status-strip-verification.md). 아래는 이전 단계 기록이다.

> **사진 배경 반영:** 사용자 제공 공사 현장 사진 위에 전체를 감싸는 반투명 패널과 개별 카드를 겹쳤다. 사이드바는 불투명 유지.
> release **1.3.0 / 5** 설치 완료. JVM **296/296**, 실기기 **52/52**, 프리뷰 **22/22**.
> 최신 정본: [wallpaper-layout-verification.md](plan-draft/wallpaper-layout-verification.md). 아래는 이전 단계 기록이다.

> **1.2.1 디자인 기록:** 반투명 카드·불투명 사이드바를 홈/상세/경보/기록/전송 이력/설정/CCTV에 적용했다. 상태는 아이콘+짧은 제목으로, 긴 설명은 필요할 때 펼친다.
> release **1.2.1 / 4** 설치 완료. JVM **296/296**, 실기기 **52/52**, 프리뷰 **22/22**. 기존 계정·기록 유지.
> 최신 정본: [dashboard-design-verification.md](plan-draft/dashboard-design-verification.md). 아래는 각 단계의 당시 이력이다.

> **4단계 기록:** 계정별 왼손/오른손 설정·촬영 버튼 위치, 기존 서명 release **1.1.0 / 2**. JVM **295/295**, 실기기 **49/49**, 프리뷰 **17/17**.
> 실제 Flutter 토큰·2계정/16키/전송7/초안4 호환 확인 후 기존 앱에 데이터 보존 업데이트했다. 기기 인터넷 연결이 없어 현재 오프라인 복원까지 확인했으며 네트워크 설정은 변경하지 않았다.
> 최신 정본: [stage4-verification.md](plan-draft/stage4-verification.md). 아래 단계별 기록은 당시 이력이다.

> **3단계 기록:** CCTV·경보·기상/작업자/가스/AED 상세 이식. JVM **291/291**, 전체 실기기 **47/47**, 프리뷰 **15/15** 통과.
> 실계정 상세·경보 조회 및 CAM-03 실영상 연속 수신 확인. 경보 확인 쓰기는 모의 표본으로만 검증했다.
> 3단계 결과는 `plan-draft/stage3-verification.md`가 정본이며, 아래의 “다음 단계” 문구는 해당 작성 시점의 이력이다.

> **9/27 2d 독립 검증 완료:** Gradle 빌드·JVM **264/264**, 실기기 계측 **43/43**(전체 1회 실행), 기존 프리뷰 **8/8** 통과.
> 실제 서버 사진에서 댓글 4개·지역 시각·주석본 보기·음성 재생/완료 확인. 개발 앱 `com.vitalguard.field.dev`에 데이터 보존 덮어설치했고 계측 전후 로그인 파일 해시가 일치했다.
> 아래 각 단계의 “미실행” 문구는 작성자가 소스 작업을 끝낼 당시의 기록이다. 최신 실행 근거는 `plan-draft/stage2d-verification.md` 마지막 절을 본다.

지시서: `../../plan-draft/TASK-compose-main-stage1.md`, `../../plan-draft/TASK-compose-main-stage2a.md`, `../../plan-draft/TASK-compose-main-stage2b.md`, `../../plan-draft/TASK-compose-main-stage2c.md`.
Flutter `../vitalguard_field/`의 세션·셸·현장 요약을 옮긴 별도 프로젝트다.
기존 Flutter·촬영 파일럿은 수정하지 않았다.

**작성 단계에서는 Gradle·네트워크·실기기 실행을 하지 않았다. 이후 독립 실행 결과는 위의 2d 검증을 따른다.**
2c에서 캐시된 Kotlin 컴파일러를 직접 실행한 순수 JVM 테스트 245개와 Android/Compose 소스 API 검사는 통과했다.
이 검사는 Gradle 빌드·리소스 링크·실기기 검증을 대체하지 않는다. 현재 결과는 아래 2c 절과 `plan-draft/stage2c-verification.md`에 구분했다. 2a·2b 절은 각 단계 당시의 기록이다.

## 범위와 구조

3단계 추가: `data/alerts`(명시적 ack·GET 대조·경보 띠), `data/cctv`(1회용 티켓/스트림/수명),
`ui/alerts`, `ui/cctv`, `ui/site/SiteDetails.kt`. 실제 연결은 FieldApplication/FieldViewModel/FieldApp에서 조립한다.
기상·작업자·가스·AED 상세와 경보·CCTV에 이어 4단계 설정·릴리스 교체까지 완료했다.

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

Debug의 다른 앱 ID는 별도 앱 샌드박스를 사용한다. 4단계에서 기존 Flutter 토큰/파일을 실제 읽기 검증하고, 같은 서명 release로 데이터 보존 업데이트했다. 상세 수치와 오프라인 확인 범위는 stage4-verification.md를 따른다.

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
- 2b 구현: 주석 편집기·메모/음성 입력·녹음기·온디바이스 STT·세션 복구. 기상/작업자/가스/AED 상세는 이번 범위 밖이다.
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

### 2a 당시 넘긴 범위

2a 당시 자리만 있던 주석 그리기·메모·음성 입력·녹음기·세션 복구를 아래 2b에서 실제 화면으로 연결했다.
딸린 항목 모델/전송/표시/정리 경계는 2a 구현을 사용한다. 설정 토글·CCTV·경보 대응 HTTP는 후속 단계다.

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


## 2b — 펜 주석·메모/음성 입력·녹음·STT·작성 세션 복구

2026-09-27, `TASK-compose-main-stage2b.md`에 따라 이전 실행의 `audio/`, `VoiceRecorder.kt`,
`MockVoiceRecorder.kt`, `data/record/` 파일을 먼저 읽고 같은 파일을 이어서 완성했다.
코드·테스트·검증 문서는 이 앱 폴더에만 작성했다. §3에서 지정한 `../../plan-draft/astra-done.txt`에는
기존 바이트를 유지하고 완료 기록만 덧붙였다. Flutter·파일럿·다른 앱은 읽기만 했다.

### 구현과 저장 계약

- `RecordNavigation`은 사진 상세 → `editor/{id}`(R-04), `input/{id}`(R-06)을 연결한다.
  NavController는 계정 셸에 유지하므로 다른 탭에서 끝난 로컬 저장도 같은 스택에 반영한다.
  R-06에서 편집기를 열었다 돌아오면 메모와 세션 대상도 R-06으로 돌아온다. 중복 탭은 같은 경로를 중첩하지 않는다.
- `RecordWorkspace`를 `FieldViewModel`이 소유한다. 회전·탭 왕복에도 동일 컨트롤러를 유지하고,
  `beforeLock`은 활성 잉크·메모·녹음을 모두 보관한다. 한 보관 작업이 실패해도 다른 보관/마이크 정지는 실행한다.
  셸 첫 프레임에 계정별 `record:active-draft`를 읽어 기록 탭을 선택하고 사진 상세 → 작성 화면 순서로 복원한다.
  없는/완료된 사진은 세션만 닫고, 복구 실패는 원문의 스낵바를 표시한다. 복구는 전송하지 않는다.
- `InkStroke`/`InkEditorController`: 원본 정규화 좌표·압력·너비 비율, `{v:1,strokes:[…]}`를 유지한다.
  지우개는 사진 종횡비와 선분 거리를 반영해 접촉한 획 전체를 삭제한다. 옛 지우개는 저장 순서대로 적용한다.
  진행 중 펜 획도 즉시 스냅샷을 쓰며, 미확정 지우개는 복구본에 적용하지 않는다.
- `InkCanvas`는 raw `awaitPointerEventScope`를 사용한다. `PointerType.Stylus`만 그리며 `pressure`를 사용한다.
  손가락은 이동/1~4배 핀치만 수행하고, 펜 접촉 중 손바닥 접촉은 떼기까지 무시한다.
  좌표 4자리·압력 2자리로 반올림하고 1px 미만 이동은 버린다. 일반 up은 확정하고,
  `ACTION_CANCEL`·`FLAG_CANCELED`·소비된/취소된 포인터는 획과 지우개를 버린다.
  회전/창 크기 변경/백그라운드는 받은 펜 점까지 확정하여 뒤늦은 cancel로 잃지 않는다.
- 도구 4개·굵기 3개·색 3개, undo/확인 후 전체 지우기/원본 보기/폭 맞춤, 원문 대화상자와 키를 유지했다.
  도구는 56dp, 주석 저장은 180×64dp, `ActionDock(maxWidth=960.dp)`다. 오류 표시 슬롯도 고정하여
  필기 중 레이아웃을 바꾸지 않는다. 편집기 동안 레일은 접히고 펼치기와 경보 표시를 지연한다.
- `AndroidInkRenderer`: 화면용 원본만 최대 변 1600px 이하로 샘플링하고 저장은 `inSampleSize=1`이다.
  원본 크기 mutable 비트맵 한 장에 직접 그려 PNG를 만든 뒤 recycle한다. 전체 크기 출력 비트맵을 별도로 만들지 않는다.
  marker 알파 0.35, 사각형 첫/끝점, 압력 굵기 `0.45+0.9p`, 첫 점 원을 공통 렌더러로 그린다.
  원본 크기 렌더 메모리가 부족하면 초안을 보존하고 오류를 표시한다. 4160px 실제 기기 메모리 동작은 미확인이다.
- 주석 저장: `annotation:<id>`의 원문 필드/리비전, 2 MiB 검사, 이전 잉크 전송 중·결과 불명·완료 거부,
  이전 대기 리비전 discard → `enqueue(ink, dependsOn, annotationDraftId, draftKeys, previewBytes)`를 유지했다.
  빈 잉크 저장으로 기존 주석을 지울 수 있고, 깨끗한 빈 초안의 저장은 비활성이다. 저장은 HTTP를 열지 않는다.
- R-06: 관리자 기록 안내와 원문 문구, 3~8줄 직접 입력, 후보 최대 5개·문장 수정·전체 확인·64dp 메모 저장을 구현했다.
  `comment-draft:<id>:new`에 직접 쓴 글과 명시적으로 확인한 STT 문장만 보관한다.
  미확인 후보는 로컬 초안·Bundle·진단 로그에 넣지 않는다. 커서/선택 정수만 saved state로 보관하며 IME를 강제하지 않는다.
  뒤로/탭 이탈/백그라운드/lock은 persist + STT 취소 + 녹음 보관을 수행한다.
- `VoiceCommentDraft`: 시작/녹음/정지/재생/보관 상태, 1초 경과 표시, 미리듣기/취소/다시 녹음/음성 저장,
  `voice-comment-draft:<id>`와 `:audio`, `[owner,mediaId]` JSON recorderKey를 유지했다.
  백그라운드 전환 뒤 늦게 끝난 미리듣기 파일 읽기/다시 녹음은 시작하지 않는다.
  native 경로 + 로컬 오디오 사본으로 복구하며, enqueue 직후 operationId 저장 전에 중단된 경우에도 sourceKey로 중복을 막는다.
  음성 저장은 `audioMs`/`siteId`/`dependsOn`/원문 sourceKey와 draftKeys를 가진 로컬 전송 대기 항목만 만든다.
- `DeviceVoiceRecorder`: 원본 Kotlin RecorderNative의 채널을 Flow/계약으로 바꿨다.
  AAC ADTS 저널 → 정상 정지/완성 프레임 복구 → M4A, MediaPlayer 재생, 180초·10 MiB 상한,
  앱 백그라운드 정지, AtomicFile 계정·사진별 초안과 원본 보존을 유지한다. 회전은 같은 ViewModel 녹음기를 유지한다.
- `DeviceSpeechInput`: API 31 이상 온디바이스 `SpeechRecognizer`만 사용한다. ko-KR·후보 5개,
  원본 이벤트명/status/partial/final/error/cancelled/diagnostic_error, runId/늦은 콜백 차단·타임아웃을 유지한다.
  진단 화면/원음/후보 로그/온라인 인식기 fallback은 추가하지 않았다.
- `MicrophoneAccess`와 Activity Result로 `RECORD_AUDIO` 런타임 권한을 요청한다.
  Activity는 ViewModel에 보관하지 않고 회전 후 host를 재연결한다. 취소한 요청의 늦은 권한 결과는 새 요청을 시작하지 않는다.
  Manifest의 마이크 권한/RecognitionService query를 추가했다. 신규 라이브러리는 없다.
- `MockSpeechInput`/`MockVoiceRecorder`는 마이크·파일·HTTP 없이 고정 후보/모의 오디오를 제공한다.
  FieldApplication 조립 지점의 live/mock 선택과 instrumentation 주입 경로를 사용한다.

### 2b 검증

Gradle·네트워크·ADB·APK 설치를 실행하지 않았다. 기존 캐시로 다음 두 도구를 직접 실행했다.

```sh
python3 tools/check-jvm-offline.py
python3 tools/check-android-kotlin-offline.py
```

- **통과: 순수 JVM 215개**(기존 165 + 2b 50). 증거: `build/offline-jvm/junit.log`.
  Kotlin 2.4.0/JUnit 4.13.2/coroutines 1.10.2/org.json 20240303. Android/Compose용 BackgroundContrastTest는 제외했다.
- **통과: main + androidTest + screenshotTest 소스 API 컴파일**. 증거: `build/offline-android-kotlin/compile.log`와 `classpath.txt`.
  캐시 Android 37.0·Compose compiler 2.4.0·Navigation 2.10.2로 검사했다. R/BuildConfig 이름 스텁을 쓰므로
  Gradle 의존성 해석/리소스 링크/manifest merge/APK 빌드 결과는 아니다.
- **작성·소스 컴파일 확인, 실행 미확인: 신규 Android 계측 12개**.
  RecordEditingComposeTest 8개(56dp/선택·touch 무획·raw stylus/취소·주석 저장·Back/회전·메모·STT·녹음·재로그인·커서),
  InkRendererAndroidTest 2개(픽셀 알파/지우기·4160×3120 원본 저장), MicrophoneAccessTest 2개(거절/회전 뒤 늦은 권한 결과).
  기존 HoldBundleComposeTest의 2b 자리표시자 기대값을 실제 화면 진입으로 갱신했다.
- **작성·소스 컴파일 확인, 렌더링 미확인: 프리뷰 2개**. `Stage2bPreviewTest`의 `RecordEditorPreview`, `RecordInputPreview`.
  각각 866×1385dp·340dpi·한국어·고정 데이터. 실제 PNG·시각 검수는 미확인이다.
  앞 절의 ASCII 복사본 screenshot 절차를 후속 실행 시 사용한다.
- 정적 확인과 원본 해시/필수 키·문구 점검은 `plan-draft/stage2b-static-audit.json`, 상세는 `plan-draft/stage2b-verification.md`에 기록했다.
- **미확인**: Gradle 전체 빌드/리소스/계측 실행, 실제 권한창·녹음/재생·한국어 온디바이스 모델·STT 오류,
  실제 프로세스 강제 종료 중 AAC 복구/저장 공간 부족, TB373FU 팜 리젝션·펜 압력/지연·회전/분할창/IME/큰 글꼴,
  4160px 메모리, 실제 서버 전송/기존 Flutter 데이터·서명 호환. 서버 판정과 관리자 기록은 분리했고 조치수준 칩은 없다.

| 원본 테스트 | 2b 대응 |
| --- | --- |
| ink_stroke_test.dart | InkStrokeTest, InkRendererAndroidTest |
| record_editor_ink_test.dart | InkEditorTest, RecordEditingComposeTest |
| ink_upload_test.dart | InkEditorTest + 기존 MultipartGatewayTest/OutboxBundleTest |
| record_input_test.dart | RecordInputTest, RecordEditingComposeTest |
| record_recovery_test.dart | RecordRecoveryTest, RecordEditingComposeTest |
| voice_comment_test.dart | VoiceDraftTest, RecordInputTest, RecordRecoveryTest, RecordEditingComposeTest |
| voice_recorder_test.dart | VoiceDraftTest(ADTS/모의/복구 계약), MicrophoneAccessTest |
| voice_upload_test.dart | VoiceDraftTest + 기존 MultipartGatewayTest/OutboxBundleTest |
| hold_bundle_ui_test.dart 편집/입력 부분 | RecordEditingComposeTest, 갱신한 HoldBundleComposeTest, Stage2bPreviewTest |


## 2c — 워크 캘린더·자동 전송·전송 이력·singleTask

기준: `../../plan-draft/TASK-compose-main-stage2c.md`(2026-09-27). 코드·테스트·검증 문서는 이 프로젝트 안에서 변경했다.
§4가 별도로 지정한 완료 로그는 기존 `../../plan-draft/astra-done.txt`에 추가한다
(`app/` 모듈 기준으로는 지시서의 `../../../plan-draft/astra-done.txt`).
웹 원본·Flutter·촬영 파일럿은 읽기만 했다. 신규 라이브러리와 Gradle 설정 변경은 없다.

- 기록 탭은 `RecordCalendarScreen`이다. 가용 폭 866dp에서 왼쪽 미니 월간과 오른쪽 주간 격자가 보인다.
  760dp 미만은 미니 월간을 위에 둔다. 일요일 시작, 미니 월간 6×7 균등 행, 날짜 숫자 원형 선택,
  오늘의 반투명 원보다 선택 원을 우선한다. 00~24시·시간당 44dp, 격자만 스크롤하고 최초 07시에서 시작한다.
  큰 창에서도 초기 위치가 유지되도록 시간 격자는 최대 640dp이다. 날짜/시간 블록을 누르면 그 날 목록 시트가 열린다.
  서류 스캔·사진 촬영은 두 개의 FAB이고 미확인 배지·토스트·헤더 캘린더 진입점은 추가하지 않았다.
- `data/record/RecordCalendar.kt`는 기존 `CalendarMedia`/`OutboxEntry`의 화면 투영과 주간 조회 상태를 담당한다.
  GET `/api/calendar/media?from=YYYY-MM-DD&to=YYYY-MM-DD`로 보이는 주를 가져온다.
  작업 ID(`client_operation_id`/`clientOperationId`), `sourceKey` 또는 서버 영수증 ID가 같으면 서버 행 한 개를 표시한다.
  같은 날짜·촬영 시간대는 사진/음성 건수로 묶고, 시각을 읽지 못한 사진도 종일 띠에 둔다.
  불명 → 전송 중 → 실패/재로그인 → 기기 보관 → 완료 순으로 묶음 상태를 표시한다.
- 사진 상세는 별도 경로다. [전송]은 없으며 주석·메모·음성 추가와 [삭제]를 제공한다.
  뒤로/달력으로/탭 이탈/실제 `onStop`에서 저장을 기다린 뒤 달력으로 돌아가고 묶음을 자동 전송한다.
  회전 재생성은 닫힘으로 취급하지 않는다. 여러 장 스캔은 첫 장 상세를 열고 닫을 때 해당 촬영 묶음의 저장된 항목을 전송한다.
  확인하지 않은 STT·저장 전 녹음·미저장 주석 초안은 전송에 넣지 않고 기기에 보존한다.
- 완료 사진과 서버에서 읽은 사진에도 새 주석·메모·음성을 붙일 수 있다.
  서버 사진은 기존 원장에 완료된 참조(`serverReference`)로 연결하며 사진 업로드/가짜 전송 이력을 만들지 않는다.
  기존 사진과 완료된 첨부는 다시 보내지 않는다. 서버 원본 내용은 수정하지 않는다.
- `autoSendReady`는 닫힘을 영속화한다. 작성 중 묶음은 재접속해도 보내지 않는다.
  `ConnectivityWatcher`는 `registerDefaultNetworkCallback`의 기본 네트워크/검증 상태를 관찰하고 종료 시 해제한다.
  요청 성공의 `markOnline`도 유지한다. 대기와 명확한 전송 전 네트워크 실패만 복귀 시 재시도한다.
  다른 실패는 [전송], `uncertain`은 서버 조회/사람의 미등록 확인 후 기존 작업 ID 재시도 규칙을 유지한다.
  부모 완료 후 딸린 항목 순서·동시 묶음 중복 방지·`outbox:v1`/schemaVersion 1을 유지했다.
  새 선택 필드가 없는 v1 원장도 읽으며 중단된 sending은 계속 uncertain으로 복구한다.
- 서버 사진은 GET `/api/calendar/media/download-url?id=`의 URL로 내려받고 `cacheDir/calendar-media/`에
  계정·ID 해시별로 7일 캐시한다. 서명 URL 요청에 앱 토큰을 재전달하지 않는다.
  전송 완료 이력은 기존처럼 7일 초과 시 정리하되 미전송 추가분의 부모 참조는 보존한다.
- 완료 사진 삭제는 DELETE `/api/calendar/media?id=` 성공 후에만 로컬 묶음/파일을 지운다.
  서버의 403 `MEDIA_DELETE_WINDOW_EXPIRED`와 `삭제 유예 시간(10분)이 지났습니다` 문구를 그대로 보존/표시한다.
- 전송함은 ‘전송 이력’이다. 대기/검토 UI를 제거하고 완료(서버 확인 시각·작업 ID), 실패, 불명, 전송 중만 표시한다.
  재로그인이 필요한 항목은 실패 그룹에서 재로그인/명시적 재개를 제공한다.
  `MainActivity`는 `android:launchMode="singleTask"`이며 재실행 뒤 앱 API로 태스크 1개·내부 액티비티 1개를 확인한다.

### 2c 검사와 남은 확인

실행한 검사는 다음과 같다. 모두 기존 로컬 캐시만 사용한다.

```sh
python3 tools/check-jvm-offline.py
python3 tools/check-android-kotlin-offline.py
python3 tools/check-stage2c-static.py
```

- **통과: 순수 JVM 246개**(2b 215개 + 2c 30개 + 수정 1 회귀 1개). 달력 배치/합치기/건수/상태, 닫힘/재접속/추가분,
  불명 유지, 삭제 403, 캐시 만료/계정 분리, 주간 조회/늦은 응답, 메모 저장부터 상세 닫힘까지를 확인했다.
- **통과: main/androidTest/screenshotTest Kotlin/Compose 소스 API 컴파일**. 캐시 AAR/JAR와 R/BuildConfig 스텁을 사용한다.
  Gradle 의존성 해석·리소스 링크·manifest merge·APK·계측 실행 검증은 아니다.
- **통과: 구조 검사**, XML 20개·drawable 참조 15개·읽기 전용 원본 120개 해시 일치·신규 의존성 0개.
- `RecordCalendarFlowComposeTest`(기존 HoldBundle UI 테스트의 의도 갱신), `RecordCalendarLayoutComposeTest`,
  `SingleTaskComposeTest`와 기존 촬영/편집/이력 계측 테스트를 작성·갱신했다.
  수정 전 TB373FU·Android 16 결과는 41개 중 3개 실패이며, 아래 수정 1 반영 후 **실기기 재실행은 미확인**이다.
- `RecordCalendarPreview`(2026-09-27·로컬 2건+서버 1건), `OutboxHistoryPreview`는 각각
  **866×1385dp·340dpi·ko** 고정 표본이다. 수정 지시서에 이전 스크린샷 8개 통과가 보고됐다.
  이번 수정에서 PNG 재생성·시각 검수는 실행하지 않았다.

**2c 작업 당시의 서버 연동 제약(2d 갱신은 아래 참조):** 당시 읽은 웹 소스의 `app/api/calendar/media/download-url/route.ts`는
`verifyBasicAuth()`만 호출하며, 이 검증은 앱 JWT를 직접 수용하지 않는다. 목록 API의 JWT 분기와 다르다.
지정된 다운로드 API를 앱에 연결했지만, 당시 소스 기준으로 앱 JWT의 사진 다운로드가 거부될 수 있었다.
이 작업의 수정 범위에서 웹을 제외했으므로 서버 인증은 변경하지 않았다. 서버 대응 후 실제 사진 열람/추가 주석을 검증해야 한다.

이번 작업에서 Gradle·네트워크·ADB·APK 설치·실기기 테스트는 실행하지 않았다. TB373FU Wi-Fi 교체 시 띠 해제/전송 재개,
앱 백그라운드/프로세스 종료, 수정한 런처 재실행 검사, 회전/분할창/큰 글꼴/실제 이미지·음성,
실서버 삭제 유예와 추가분 전송은 **미확인**이다. 자세한 근거는 `plan-draft/stage2c-verification.md`에 있다.

### 2c 수정 1 — 실기기 계측 실패 3건

기준: `../../plan-draft/TASK-compose-main-stage2c-fix1.md`(2026-09-27).
운영 코드의 문구·메모 저장·자동 전송·singleTask 설정은 유지하고, 실패한 계측의 전제와 관찰 방법을 수정했다.

- **오프라인 상세:** 안내는 `PhotoDetailContent`의 `if (offline)`에서 실제로 그린다.
  테스트의 `RecordUiGateway`는 `siteStatus`만 실패시켰고 새 달력 조회는 성공해
  `FieldCoordinator.authorized → markOnline`이 안내를 숨겼다. 실제 테스트 클래스를 추출한 로컬 재현에서
  조회 후 `offline=false`를 확인했고, 달력 조회에도 같은 오프라인 실패를 적용한 뒤 `true` 유지가 통과했다.
  안내 문구 검사를 유지하고, 닫힘 후 waiting·이력 제외·복귀 후 업로드 정확히 1회·완료 이력까지 확인한다.
- **메모 1건:** 실패 당시 147행은 `dependents(photo.id).size == 1`을 기다렸다.
  `enqueue`는 첨부를 추가하고 완료 정리는 파일만 지우므로 2c에서도 이 조건이 맞다.
  신규 `AutomaticSendTest.confirmedMemoStaysOneLocalAttachmentUntilPhotoDetailCloses`가 온라인 저장·원장 재조회·재접속·입력 닫힘 동안
  로컬 첨부 정확히 1건/원문/전송 0회를, 상세 닫힘 뒤 사진·메모 각각 1회 전송과 원장 1건 유지를 확인했다.
  실기기 로그에는 메모 입력 직후 IME 표시 전환이 있고 실패 대기 중 Activity onStop은 없다.
  계측은 키보드 닫힘과 IME 인셋 0을 기다린 뒤 실제 버튼을 누르며, 확인 체크·저장 활성화·오류 없음·kind/phase/원문을 추가 검증한다.
  기존 5초 제한·첨부 1건·안내 문구·상세 건수 검사는 유지했다.
  **IME 전환 중 클릭 경합은 추정 원인이며, 로그만으로 누락된 클릭을 확정할 수 없다. 수정 후 실기기 확인이 필요하다.**
- **singleTask:** 기존 `"Hist #"` 검색은 Android 16의 `"Hist  #0"`를 찾지 못한다.
  셸 조회를 제거하고 `ActivityManager.getAppTasks()`의 실행 중 태스크 1개·`numActivities == 1`·동일 taskId·base/top Activity,
  `Activity.isTaskRoot`·동일 Activity 객체·ViewModel 생성 1회를 검사한다.
  두 재실행 각각의 RESUMED 콜백을 기다리므로 Intent 전달 전 상태로 통과시키지 않는다.

수정 전 보고된 Gradle JVM 246개와 이번 오프라인 JVM 246개는 구성 범위가 다르다.
오프라인 도구는 Android 의존 `BackgroundContrastTest` 1개를 기존대로 제외하고 신규 회귀 1개를 포함한다.

## 2d — 서버 첨부·전체 댓글·부수 조회 인증 오류

기준: `../../plan-draft/TASK-compose-main-stage2d.md`(2026-09-27).
상세를 열면 같은 날짜의 `GET /api/calendar/media?from&to`를 다시 읽는다. 이전 원장 영수증에
댓글이 1개만 있어도 최신 응답의 댓글 전부를 표시한다. 조회 실패는 상세 안에 표시하고 이전 자료임을 안내한다.
`RecordAttachments`가 상세와 달력의 음성 건수를 함께 계산한다. 서버 댓글의 `audio_storage_key`가
있으면 음성, 없으면 메모다. 로컬 첨부와 `client_operation_id`/`clientOperationId` 및 영수증 ID로 중복을 제거한다.

댓글 시각은 사진 상세와 같은 `captureRecordedTime`을 사용한다. 기기 시간대가 Asia/Seoul이면
`2026-09-27T03:00:02.862Z`는 `2026-09-27 12:00:02`다. 기기 시간대를 바꾸면 표시도 바뀐다.
촬영 이미지에 각인하는 KST 시각과 업로드 원문은 유지한다.

음성 댓글은 `audio_ms`를 길이로 표시한다(7744 → `0:07`, 미제공이면 `길이 미확인`).
서버 목록 GET이 `audio_storage_key`로 발급한 `audio_url`을 내려받아 MediaPlayer로 재생한다.
서명 URL에는 앱 Bearer를 전달하지 않으며, 댓글 ID로 `download-url?id=`를 호출하지 않는다.
주소가 없거나 유효하지 않으면 재생 버튼을 비활성화하고 `음성 재생 미확인` 사유를 표시한다.
다운로드 401/403은 해당 댓글의 권한 오류로 남긴다. 한 상세에서 한 음성만 재생하며,
다른 댓글 선택·상세 종료·백그라운드에서 기존 재생/다운로드를 중단하고 임시 파일을 제거한다.

최신 `annotationId` 또는 로컬 잉크가 있으면 사진 위에 **주석본 보기** 토글을 제공한다.
로컬 PNG 미리보기를 우선하고, 서버 잉크는 `download-url?id=<annotationId>`로 받는다.
벡터 JSON은 2b의 `InkStroke`/`AndroidInkRenderer`로 원본 위에 그리며 과거 PNG/JPEG도 표시한다.
`/api/calendar/media/ink`는 현재 소스에서 관제 인증만 받으므로 앱에서는 호출하지 않는다.
`download-url`의 앱 JWT 수용은 현재 소스에 있으며, 리비전 00408 배포 실측은 지시서에서 전달받은 사실이다.
작성 단계에서는 실서버 호출을 하지 않았다. 후속 독립 검증에서 현재 기기 계정으로 사진·잉크·음성 조회 및 재생을 확인했다.

**정확한 서버 주석 수는 미확인이다.** `lib/db.ts:listCalendarMedia`는 `annotation_of IS NULL`인
원본과 최신 `annotationId` 1개만 반환한다. 연결된 잉크 행·작업 ID·날짜·전체 개수를 내려주는 API는 없다.
따라서 같은 날 `annotation_of == 사진 id`인 모든 잉크 행을 앱에서 정확히 세거나 전부 중복 제거할 수 없다.
최신 ID와 기기에 남은 잉크 영수증은 ID로 중복 제거하고 확인된 개수만 `주석 n개 이상`으로 표시한다.
예시 응답(주석 ID 1개·글 3개·음성 1개)은 `주석 1개 이상 · 메모 3 · 음성 1`과
전체 주석 수 미확인 사유를 표시한다. **요청한 정확한 주석 총계는 서버의 추가 조회 계약이 있어야 충족된다.**
서버 코드와 응답 필드는 변경하지 않았다. 댓글은 목록 GET이 전부 제공하며 별도 댓글 GET은 없다.

### 2d 세션 판정 호출 목록

`authorized`는 기본값을 부수 조회로 두고, `me`와 `writing=true`인 호출만 세션 판정으로 취급한다.

| 분류 | 호출 | 인증 거부 처리 |
|---|---|---|
| 세션 판정 | GET `/api/mobile/v1/session/me` — 복원·재접속 재확인 | `action=reauth` 또는 최종 401이면 잠금/토큰 삭제. `none`인 401도 포함 |
| 세션 판정 | POST `/api/mobile/v1/session/refresh` | 기존 401/403/reauth 잠금 규칙 유지. 네트워크·일반 5xx 실패는 잠금 사유가 아님 |
| 세션 판정/필수 쓰기 | POST `/api/app-media` — 사진·잉크·음성, POST `/api/calendar/media/comment`, DELETE `/api/calendar/media?id=` | reauth 또는 최종 401이면 잠금. 단순 403은 항목 실패(삭제 유예 문구 포함) |
| 세션 판정/필수 쓰기 | POST `/api/app/admin/alerts/ack` — 3단계 예약 계약 | 401/reauth 잠금, POST 자동 반복 없음. 라이브 구현은 아직 다음 단계 |
| 부수 조회 | GET `/api/admin/site-info`, `/api/app/admin/site-status` | 현장 자료의 오류/권한 상태만 변경. 로그인·복원 직후 site-info 거부도 세션 유지 |
| 부수 조회 | GET `/api/calendar/media?from&to` — 달력·상세·댓글 | 해당 달력/상세에 `권한 없음 · 다시 로그인하면 다시 시도합니다` |
| 부수 조회 | GET `/api/calendar/media/download-url?id=`와 서명 파일 GET — 사진·썸네일·잉크 | 해당 이미지에 같은 권한 문구, 세션 유지 |
| 부수 조회 | 댓글 `audio_url` GET | 해당 음성 버튼 비활성·권한 문구, 세션 유지 |
| 부수 조회 | GET `/api/app/address`, `/api/app/admin/operation-status`, POST `/api/app/admin/cctv-ticket`(3단계 예약) | 토큰 갱신/잠금 없이 호출자 항목 오류로 전달 |

로그인/TOTP의 POST `/api/mobile/v1/session/login`은 기존 로그인 단계에서 직접 판정한다.
로그아웃은 기존처럼 기기 우선이며 서버 오류로 세션을 복구하지 않는다.
부수 요청의 401/403은 `action=reauth`여도 세션을 잠그거나 그 응답 때문에 refresh를 호출하지 않는다.
세션 판정 경로의 명확한 401(`action` 미제공/`refresh`)에 대한 기존 refresh 후 1회 재시도는 유지한다.
`action=none/reauth`에는 이 재시도가 없으며, 결과 불명 쓰기는 자동 재전송하지 않는다.
요청 전 기기에서 확인한 액세스 토큰 만료에 대한 단일 refresh는 유지한다. 이 refresh 자체가 거부되면 잠근다.
지시서의 무토큰→reauth/틀린 토큰→none 실측을 반영해 action 값만으로 부수 요청을 세션 판정으로 승격하지 않는다.

### 2d 검증

**후속 실행 완료(9/27):** Gradle JVM 264개(오프라인 작성 검사의 263개 + BackgroundContrastTest 1개),
실기기 전체 43개, 프리뷰 8개 모두 통과했다. 프리뷰의 음성 표본에 누락돼 있던 `audio_storage_key`를 보완했으며
기준 이미지는 새 결과로 덮어쓰지 않았다. 검토한 기준 PNG 8개를 `app/src/screenshotTestDebug/reference`에 보관한다.
Navigation Compose는 검증 명령에서 **2.10.2**로 고정했다. 원본 한글 경로를 이동하지 않고 ASCII 복사본에서 검증했다.

실제 서버 상세는 `주석 1개 이상 · 메모 3 · 음성 1`, 메모 3개·음성 1개, `2026-09-27 12:00:02/04` 표시,
주석본 토글을 확인했다. 7744ms 음성은 재생 버튼→`재생 정지`→정상 완료 뒤 `음성 재생`으로 돌아왔고 오류가 없었다.
부수 401/403 및 세션 판정 401의 차이는 모의 JVM/실기기 계측으로 확인했으며 실제 계정의 권한을 변경하지 않았다.

**아래는 작성자가 남긴 선행 검사 기록이다.**

- **통과: 오프라인 JVM 263개**(기존 246개 + 회귀 17개). 기존 잠금 테스트를 지우지 않고
  필수 쓰기/`me` 기준으로 갱신했다. refresh 실패·초안 보존·결과 불명 재전송 금지를 유지한다.
- **통과: main/androidTest/screenshotTest Kotlin/Compose 소스 API 컴파일.** 기존 캐시·R/BuildConfig 스텁을 사용했다.
- **통과:** Flutter/파일럿 원본 120개 해시 일치, Gradle/의존성/Manifest 5개 파일 불변, 공백 검사.
- `ServerRecordDetailComposeTest` 2개는 전체 댓글·KST 시각·음성 길이/비활성 사유·잉크 토글·사진/잉크 401의 화면 유지 검사를 추가했다.
  **실제 계측 실행은 미확인**이다.
- **미확인:** Gradle/APK 빌드·설치·실기기·실서버 음성 재생과 잉크 렌더·스크린샷·정확한 서버 주석 총계.
  Gradle·네트워크·ADB를 실행하지 않았다. 상세 근거와 재현 명령은 `plan-draft/stage2d-verification.md`에 있다.
