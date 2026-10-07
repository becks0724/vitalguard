# TASK — 담당관 태블릿 메인 앱(Compose/Kotlin) 1단계 골격 · 2026-09-26

## 0. 배경 · 범위
- 태곤 님 결정(9/26): Flutter 태블릿 앱 `tablet-app/app/vitalguard_field/` 를 **Jetpack Compose/Kotlin 으로 다시 만든다.** 파일럿(`app/pilot-compose-capture/`, 촬영·OCR 흐름)은 실기기까지 통과했다. 이제 **메인 앱**을 짓는다.
- 메인 앱 경로: **`tablet-app/app/vitalguard_field_android/`** (새로 만든다. 현재 비어 있다).
- 이번 지시서 = **1단계 골격**: 앱 진입·테마 → 로그인/세션 → 셸(레일·상단 수신 바·배경) → 현장 요약(S-01) → 나머지 탭은 자리만. 2단계(기록·전송함·촬영 이식)·3단계(CCTV·경보)·4단계(설정·릴리스)는 별도 지시서.
- **손대지 말 것**: Flutter 앱·파일럿·저장소의 다른 파일은 **읽기만**. 새 프로젝트 폴더 안에만 쓴다. **Gradle 실행 금지**(샌드박스 네트워크 없음) — 빌드·테스트·설치는 claude 가 한다. 한 번에 컴파일되도록 정확히 써라.

## 1. 원본 — 읽고 그대로 옮긴다 (Flutter 앱 `app/vitalguard_field/`)
| 무엇 | 파일 |
|---|---|
| 조립·진입·테마 | `lib/main.dart`(edge-to-edge · 방향 고정 금지), `lib/app.dart`(조립 지점에서만 구현 선택, 버튼 최소 56dp), `lib/vg_theme.dart`(색 토큰·탭 크기 56/64/16·툴바 높이·`vgTwoPaneMinWidth=1000`) |
| 계약 | `lib/data/contracts/field_contracts.dart` — `ApiFailure`(status/code/action/retryAfterSec/twoFactorRequired/uncertainWrite/networkUnreachable), `FieldGateway`, `LocalStore`, `AuthStage`(restoring/login/totp/ready/denied/reauthenticate), `FieldController` |
| 서버 모델 | `lib/data/models/server_models.dart` — **서버 JSON 이름 그대로**(AppUser·MobileSession·CctvTicket·SiteInfo·CalendarMedia·MediaComment). 화면용 이름·가상 필드 금지 |
| 현장 상태 모델 | `lib/data/models/site_status.dart` — SiteStatus·섹션(weather/workers/gas/aed/alerts)·`siteStatusReceipt`·`alertTime` |
| 세션 조정자 | `lib/data/field_coordinator.dart` — **핵심**. epoch, `_allowed`(platform_admin/owner/site_manager/admin 만), `_accept`(거부 시 서버 logout 뒤 토큰 폐기·denied), `initialize`(저장 세션 복원 → me 재확인 → siteInfo, 실패 시 refreshExpiresAt 이내면 **오프라인 진입**+캐시 현장+`_revalidateOnReconnect`), `_authorized`(만료면 refresh, 명시적 401 에 한해 refresh 후 1회 재시도, 결과 불명은 재전송 금지, `action=='reauth'` 면 `_lock`), `_refresh` 단일 비행, `_lock`(reauthenticate·토큰 삭제·`beforeLock`), `signIn/_login`(TOTP 단계·잠금 `lockedUntil`)·`submitTotp`·`cancelSignIn`·`signOut`(기기 먼저, 서버 실패는 문구만)·`refreshSite`·`siteStatus`(401/403 시 스냅샷 제거·forbidden) |
| 라이브 게이트웨이 | `lib/data/live/live_gateway.dart` — base `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`, 타임아웃(연결 20s·응답 30s·본문 30s), `Accept: application/json`·`Authorization: Bearer`, 리다이렉트 금지, 응답 `ok!=true` 면 ApiFailure(error/action/retryAfterSec/twoFactorRequired), SocketException→`networkUnreachable`, 로그인 오류 코드→한국어 문구 매핑(invalid_credentials/not_approved/too_many_attempts/invalid_request/app_auth_not_configured), 알 수 없는 코드는 로그만. 라우트: `POST /api/mobile/v1/session/login`(id·password·totpCode·platform=android·deviceName='VitAlGuard 현장 태블릿'), `POST …/refresh`, `GET …/me`, `POST …/logout`, `GET /api/admin/site-info`(`siteInfo` 키), `GET /api/app/admin/site-status`(403=권한 거부 action none), `POST /api/app/admin/cctv-ticket`, `POST /api/app/admin/alerts/ack`, `GET /api/app/address`, `GET /api/app/admin/operation-status`, `POST /api/app-media`(multipart), `POST /api/calendar/media/comment` — **1단계는 세션 4 + site-info + site-status 만 구현**하고 나머지는 인터페이스에 선언만(TODO 2·3단계) |
| 기기 저장 | `android/app/src/main/kotlin/com/vitalguard/vitalguard_field/FieldStorage.kt` — Android Keystore AES/GCM 로 토큰 번들만 암호화, `noBackupFilesDir/field-session.enc`, alias `vitalguard.field.session.v1`, 임시파일→rename, 오류 메시지에 자격 증명 금지. 계정별 키-값 파일 저장은 `lib/data/live/device_services.dart`·`local_store_paths.dart`(키를 base64url 80자 조각 디렉터리로, `value` 파일, `.pending`→rename, 순차 큐) |
| 네트워크 확인 | `NetworkNative.kt`(`hasInternet`) — 로그인 실패가 `networkUnreachable` 이면 인터넷 유무를 확인해 대화상자 문구 분기(auth_screen.dart 참고) |
| 셸 | `lib/ui/shell/field_shell.dart` — 레일(접힘 80dp/펼침 256dp · 창 폭 ≥1000dp 기본 펼침 · 접힘 상태는 계정별 로컬 키 `shell:rail-collapsed` 저장 · 그룹 "상황"(현장·경보)/"기록"(기록·전송 상태)/하단(설정·사용자·로그아웃) · 항목 최소 56dp·간격 16dp · 선택 = primary 배경+흰 글자+점), 상단 수신 바(높이 52dp×글자배율, 오프라인이면 `#FFF1CD` 아니면 `#F3F4F6`, 왼쪽 "현장 · {site_name}" 오른쪽 `receipt()` 문구 — 목적지·오프라인·forbidden 별 문구 **그대로**), 본문은 `IndexedStack` 처럼 탭 상태 유지, 하단 경보 스트립 **슬롯은 예약**(3단계까지 빈 자리라도 높이 고정), 배경 `lib/ui/shell/vg_background.dart` |
| 로그인 화면 | `lib/ui/auth/auth_screen.dart` — 제목(단계별)·아이디/비밀번호(표시 토글)·"이 기기에서 로그인 유지"·TOTP 6자리·잠금 카운트다운·메시지·64dp 로그인 버튼·"아이디부터 다시 입력"·denied 의 "다른 계정으로 로그인"·하단 안내문. 최대 폭 560dp·패딩 28 |
| 현장 요약 | `lib/ui/site/site_screen.dart`(60초 폴링은 화면이 활성일 때만 · 5분 지나면 stale 표시 · 403 이면 폴링 중단+"권한이 바뀌었으면 새로고침" · 새로고침은 `refreshSite()` 먼저 · 전경 복귀 시 재조회), `site_detail_widgets.dart`, 섹션 문구·모양은 `site_status.dart` 의 텍스트 함수 그대로. 상세 화면(기상/작업자/가스/AED)은 **2단계** — 1단계는 행을 눌러도 "다음 단계" 스낵바 |
| 원칙 | `plan-draft/p4-touch-reflect-qa/태블릿 앱 제작 기록.updated.md` §7 (조회 0행≠정상 0건 · 서버가 안 주는 수치 만들지 않기 · 상태는 색+모양 · "로컬 저장됨"≠"전송 완료" · 인셋은 런타임 · SafeArea 불신 · 화면 폭 866dp 실측), `artifacts/design-constraints.md`(V-1~V-5 색 대비 규칙), `plan-draft/CONTRACT-app-server-newdb.md` §1(라우트 15개)·§5(하지 말 것) |
| 옮길 테스트 | `test/login_connection_test.dart`, `login_error_test.dart`, `offline_restore_test.dart`, `site_status_test.dart`, `site_screen_test.dart`, `nav_rail_test.dart`, `local_store_keys_test.dart`, `common_states_test.dart`, `vg_background_test.dart`, `widget_test.dart`, `settings_test.dart`(자리 화면 범위만). `test/support/` 의 가짜 게이트웨이·컨트롤러도 참고 |

## 2. 프로젝트 골격 (파일럿에서 가져온다)
- `app/pilot-compose-capture/` 의 `settings.gradle.kts`·`build.gradle.kts`·`gradle.properties`·`gradle/wrapper/*`·`gradlew*`·`.gitignore` 를 **복사**해 시작한다(compileSdk **37** · AGP 9.1.0 · Kotlin 2.4.0 · Compose BOM 2026.09.00 · screenshot 플러그인 alpha16 · `android.suppressUnsupportedCompileSdk=37` 그대로). `local.properties` 는 만들지 마라.
- `applicationId "com.vitalguard.field"` + **debug 는 `applicationIdSuffix ".dev"`**(개발 중 Flutter 앱 `com.vitalguard.field` 과 공존, release 가 Flutter 앱을 대체). `namespace "com.vitalguard.field"`. minSdk 26 · targetSdk 36 · JVM 17. release 서명 블록은 **비워 둔다**(4단계에서 기존 키스토어 연결).
- 의존: 파일럿과 같은 Compose·activity·lifecycle·core + `androidx.navigation:navigation-compose`(현재 안정판) + `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2` + `org.json`(플랫폼 내장) 또는 `kotlinx-serialization-json`(쓰려면 플러그인까지 정확히). HTTP 는 **`HttpURLConnection`** 으로(OkHttp 등 새 의존 금지 — 타임아웃·리다이렉트 금지·Bearer 를 원본과 같게).
- 패키지 `com.vitalguard.field` 아래 `data/contracts`·`data/models`·`data/live`·`data/mock`·`data/session`·`ui/theme`·`ui/auth`·`ui/shell`·`ui/site`·`ui/placeholder`.
- 빌드 플래그: `buildConfigField("boolean","VG_MOCK", …)` — Gradle 속성 `-PvgMock=true` 로 켜면 `MockGateway`+메모리 저장소(모의 데이터 · 아이디 아무거나/비밀번호 `mock` · 아이디 `totp` 는 인증번호 123456 — `lib/data/mock/mock_gateway.dart` 참고). 레일에 "모의 데이터" 표시.

## 3. 만들 것 (수용 기준)
### 3-1. 세션·데이터층 (Kotlin, 순수 로직은 Android 의존 없이 — JVM 테스트 대상)
- `ApiFailure`(원본 필드 전부), `FieldGateway`(원본 메서드 전부 선언 · 1단계 미구현은 `NotImplementedError` 아닌 `ApiFailure("다음 단계")` 로), `LocalStore`, `AuthStage`, `FieldController` 상태(StateFlow 하나 또는 여러 개 — Compose 가 `collectAsStateWithLifecycle` 로 읽는다).
- `FieldCoordinator` — 원본의 **모든 분기**를 옮긴다(epoch 검사 위치까지). 시계·저장소·게이트웨이는 주입.
- `LiveGateway` — 위 표의 라우트·타임아웃·오류 매핑. `JsonTransport` 주입점을 두어 테스트에서 HTTP 없이 응답을 흉내낸다.
- `DeviceLocalStore`(Keystore 토큰 파일 + 계정별 파일 저장, 원본과 같은 경로 규칙) · `MemoryStore`(mock/테스트).
- `MockGateway` — 원본 mock_gateway.dart 의 시나리오(정상·TOTP·거부 계정·현장 상태 샘플).

### 3-2. 화면
1. **AuthScreen** — 원본과 같은 단계·문구·키(`testTag`: `login-id`·`login-password`·`totp-code`·`auth-submit`·`auth-message`·`mock-label`). 네트워크 불가 시 인터넷 유무 확인 대화상자(3분기 문구 그대로).
2. **FieldShell** — 레일·수신 바·본문·경보 스트립 슬롯. `testTag`: `rail-collapsed`/`rail-expanded`·`rail-collapse-toggle`·`rail-destination-0..4`·`rail-selection-dot`·`shell-receipt`·`shell-content`·`mock-rail-marker`. 로그아웃은 `signOut()`; 실패 스낵바 문구 그대로.
3. **SiteScreen(S-01)** — 마지막 수신/새로고침 카드, 기상·작업자·가스·AED 행(상태 모양+문구는 `site_status.dart` 함수 그대로 · forbidden/데이터 없음 문구 그대로), 미대응 경보 카드(수·주의 문구), 현장 CCTV 카드([영상 보기] → 1단계는 "다음 단계" 스낵바). 폴링·stale·403·전경 복귀 규칙 원본대로.
4. **자리 화면** — 경보·기록·전송 상태·설정: 제목 + "다음 단계에서 옮깁니다" 한 줄. 레일 전환·수신 바 문구는 목적지별로 이미 맞아야 한다.
5. 회전(세로↔가로)에서 상태 유지(ViewModel/StateFlow), 레일 접힘 기본값은 창 폭 1000dp 기준.

### 3-3. 테스트
- `app/src/test/`(JVM): 조정자(복원·오프라인 진입·refresh 1회 재시도·lock·거부 계정·TOTP·잠금·signOut), 게이트웨이(오류 매핑·타임아웃 분류·`ok!=true`), 저장 경로 규칙, `siteStatusReceipt`·`alertTime`·섹션 텍스트 — **원본 Dart 테스트 케이스를 옮긴 것**이어야 한다(파일마다 어느 Dart 테스트를 옮겼는지 주석).
- `app/src/androidTest/`: Compose UI — 로그인 화면 단계 전환(mock), 레일 접힘/펼침·목적지 전환·수신 바 문구, 현장 요약 행·forbidden 표시. 파일럿과 같은 방식(`createAndroidComposeRule`), mock 게이트웨이 주입.
- `app/src/screenshotTest/`: 로그인·현장 요약 프리뷰 각 1개(866dp·340dpi).

### 3-4. 문서
- `vitalguard_field_android/README.md`: 구조·빌드/테스트/설치 명령(파일럿 README 의 실측 절 참고 — `JAVA_HOME` JBR, `-PvgMock=true`, debug 앱 ID `.dev`)·1단계 범위·2~4단계 목록·미확인 목록.
- 끝나면 `tablet-app/plan-draft/astra-done.txt` 에 파일 목록·미확인 사항을 덧붙여라(기존 내용 유지). 못 돌려본 것은 전부 "미확인".

## 4. 하지 말 것
- Flutter 앱·파일럿·저장소 다른 파일 수정 금지. Gradle·네트워크 명령 금지. 새 네트워크 라이브러리 추가 금지.
- 문구를 바꾸지 마라(한국어 문구는 원본 글자 그대로). 서버 JSON 필드 이름을 바꾸거나 화면용 필드를 지어내지 마라.
- 결과 불명 쓰기를 자동 재전송하는 코드 금지. 오프라인에서 경보 확인 예약 금지(3단계에서도).
- "빌드 통과"라고 쓰지 마라 — 미확인으로.
