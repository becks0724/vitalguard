# Compose 메인 앱 2c 검증 기록 — 2026-09-27

지시서: `../../../plan-draft/TASK-compose-main-stage2c.md`, `../../../plan-draft/TASK-compose-main-stage2c-fix1.md`.
기록 범위: `Lenova idea tap 12.7/app/vitalguard_field_android/`의 소스·테스트·문서.
§4의 지정 완료 로그 추가를 제외하면 외부 파일은 수정하지 않았다. 기존 외부 작업 파일 변경은 보존했다.
이번 작업에서 Gradle·네트워크·ADB·기기 설치를 실행하지 않았다. 아래 검사 결과는 수정 1 반영 후 갱신했다.
기존 실기기/Gradle 산출물은 읽기만 했으며 새 실행 결과와 구분한다.

## 실행한 검사

| 검사 | 결과 | 증거/한계 |
| --- | --- | --- |
| `python3 tools/check-jvm-offline.py` | 통과, **246 tests** | `build/offline-jvm/compile.log`, `junit.log`. 기존 245개 + 수정 1 회귀 1개. 캐시 Kotlin 2.4.0 직접 컴파일/JUnit 실행. Android 경계의 기존 BackgroundContrastTest는 기존 도구대로 제외 |
| `python3 tools/check-android-kotlin-offline.py` | 통과 | `build/offline-android-kotlin/compile.log`, `classpath.txt`, `api-check.jar`. main/androidTest/screenshotTest 소스 검사. R/BuildConfig는 이름 스텁 |
| `python3 tools/check-stage2c-static.py` | 통과 | `stage2c-static-audit.json`. XML 20개, drawable 참조 15개, 원본 Flutter/촬영 파일럿 120개 해시 일치, 의존성 변경 0 |
| `git diff --check -- <프로젝트 경로>` | 통과 | 공백 검사. 실기기 UI 검증을 뜻하지 않음 |

JVM의 가짜 JsonTransport/MultipartTransport/DownloadTransport와 메모리 저장소만 사용했다.
실제 HTTP를 호출하지 않았다. JDK native/Unsafe 및 기존 Compose 테스트 API 등의 deprecation 경고는 남아 있다.
Gradle의 실제 클래스패스 선택과 리소스 링크는 확인하지 않았다.

## 구현과 검증 대응

| 요구 | 구현 | 확인 |
| --- | --- | --- |
| 좌측 미니 월간 + 우측 주간, 좁은 창은 위/아래 | `ui/record/RecordCalendarScreen.kt`, 폭 760dp 기준 | 소스 API 컴파일·구조 검사 통과. 렌더 미확인 |
| 일요일 시작·주 경계·6×7 균등 월간 | `weekStart`, `weekDays`, `monthDays` | RecordCalendarTest |
| 00~24시·44dp·최초 07시·격자만 스크롤 | 주간 고정 헤더/종일 띠, 단일 시간 스크롤, 최대 640dp | JVM 상수/배치, 구조 검사. 실제 scroll offset 계측은 작성·미실행 |
| 오늘 반투명 원·선택 채운 원·선택 우선 | CalendarDay의 숫자 주변 CircleShape | 소스 검사. 시각 검수 미확인 |
| 촬영 시간대 묶음/시각 미상 종일/사진·음성 수 | CalendarRecord/CalendarBlock 화면 투영 | RecordCalendarTest의 배치·KST·건수·중복 댓글 검사 |
| 로컬/서버 같은 사진 합치기 | 기존 CalendarMedia의 operationId/sourceKey 및 Outbox 영수증 id | RecordCalendarTest |
| 주간 from/to 조회/계정 전환/늦은 응답 | RecordCalendarController/FieldCoordinator/LiveGateway | CalendarControllerTest, CalendarGatewayTest |
| 날짜 목록→상세→닫힘→달력 | 날짜 목록 시트, RecordNavigation/RecordWorkspace | JVM 닫힘 상태 검증. 계측 작성·미실행 |
| 촬영/스캔 FAB 2개 | 캘린더 Scaffold의 두 ExtendedFloatingActionButton | 구조 검사. 클릭/64dp 계측 작성·미실행 |
| 뒤로/탭 이탈/onStop에서 자동 전송 | Workspace flush→readyBundle 영속화→상세 해제→sendBundle | AutomaticSendTest. 실제 Activity 수명은 계측 미실행 |
| 네트워크 복귀 시 waiting/네트워크 failed 재시도 | ConnectivityWatcher 기본 네트워크 VALIDATED 콜백→connectivityChanged→자동 전송 | JVM 콜백 입력/상태기계 검사. Wi-Fi 교체 실기기 미확인 |
| 일반 failed는 수동, uncertain 유지 | automaticCandidate의 명시적 판정과 기존 결과 조회/수동 재시도 | AutomaticSendTest 및 기존 Outbox/Lookup 회귀 |
| 완료 사진 추가분만 전송 | 기존 원장 완료 참조, 새 dependent, 완료 ink 보존 | AutomaticSendTest, CalendarControllerTest |
| 서버 사진 URL/7일 캐시 | 지정 download-url→DownloadTransport, CalendarFileCache(cacheDir) | URL/토큰·캐시 계정 분리·7일 만료 JVM 검사. 실서버 인증 제약은 아래 참조 |
| 완료 사진 서버 DELETE/유예 만료 403 | deletePhoto는 서버 성공 뒤 로컬 제거 | CalendarGatewayTest가 code/원문/기기 파일 보존/화면 오류 상태 검사 |
| 전송함=이력, 대기/검토 UI 제거 | OutboxHistoryContent, historyEntries, 기존 상세 전송 버튼 제거 | 구조/API 검사. 기존 UI 테스트 이름·의도 갱신 |
| singleTask/두 번째 실행 뒤 액티비티 하나 | Manifest, SingleTaskComposeTest의 getAppTasks·numActivities·isTaskRoot | manifest/API 검사 통과. 수정 전 Hist 파서 실패 확인, 수정 후 계측 재실행 미확인 |

최초 2c JVM 테스트 30개는 RecordCalendarTest 9, AutomaticSendTest 9, CalendarGatewayTest 8,
CalendarControllerTest 4개다. 수정 1에서 AutomaticSendTest에 메모 저장→상세 닫힘 회귀 1개를 추가했다.
기존 215개는 삭제하지 않고 변경된 동작에 맞게 갱신했다.
HoldBundleContractTest는 RecordBundleContractTest로, HoldBundleComposeTest는 RecordCalendarFlowComposeTest로 이름/의도를 옮겼다.
기존 미전송 목록 테스트는 로컬·서버 달력 통합 검사로 갱신했다.

## 보존한 데이터 규칙

- `outbox:v1`, schemaVersion 1, 기존 키·작업 ID·사진→주석/메모/음성 순서와 동시 묶음 전송 합류를 유지했다.
  `autoSendReady`, `networkFailure`, `serverReference`만 선택 필드로 추가했다.
  이전 v1의 새 필드 누락을 허용한다. 중단된 sending은 조회가 필요한 uncertain으로 복구한다.
- 등록 전 DNS/소켓 실패는 전송 경계의 onSubmitted 여부로 구분한다. 제출 뒤 오류는 자동 재전송하지 않는다.
  일반 HTTP 거절과 권한 오류는 네트워크 재시도로 분류하지 않는다.
- 신규 사진과 상세에서 붙이는 항목은 검토가 끝나기 전 자동 전송 자격이 없다.
  상세 닫힘은 저장 중인 작업/초안 보존을 기다린 뒤 자동 전송 가능 상태를 먼저 저장한다.
  UI는 HTTP 완료를 기다리지 않고 달력으로 돌아간다. 여러 장 스캔은 첫 상세에서 해당 촬영 묶음을 함께 닫는다.
- 저장·확인하지 않은 STT/녹음/새 주석은 묶음 완료 정리로 지우지 않는다.
  완료 부모에 새 딸린 항목이 있으면 부모 영수증의 7일 만료를 미뤄 참조가 끊기지 않게 한다.
- 서버 사진은 같은 기존 OutboxEntry 모델의 완료 참조로 재사용한다. 참조 행 자체는 업로드하거나 전송 이력에 표시하지 않는다.
  CalendarRecord/CalendarBlock은 배치용 투영이며 서버 미디어 모델을 새로 만들지 않았다.
- 사진 원본 수정 없이 추가분만 저장한다. 서버 DELETE 실패/403이면 원장·바이트를 삭제하지 않고 원문 메시지를 표시한다.
- 재로그인 필요 상태는 이력의 실패 그룹에서 표시하며, 온라인의 같은 계정에서 명시적 재개가 가능하다.
  불명 항목은 조회/사람 확인 경로만 유지한다. 자동으로 absent를 재전송 자격으로 바꾸지 않는다.

## 서버 소스에서 확인한 연동 제약

읽기 전용 원본: `기존_조달청모듈/safetymonitor/apps/dashboard-web/`.

- `app/api/calendar/media/route.ts` GET은 `verifyAppJwt(bearerToken(request))` 분기가 있어 앱 JWT를 허용한다.
  DELETE는 서버 `mediaWriteScope`와 10분 유예 판정에 맡긴다.
- **`app/api/calendar/media/download-url/route.ts`는 `verifyBasicAuth(request)`만 사용한다.**
  `lib/admin-auth.ts`의 이 함수는 관제 세션 토큰/Basic 자격을 검증하며 앱 JWT 검증 분기를 갖고 있지 않다.
  따라서 지시서가 지정한 이 URL API와 앱 JWT 사이에 현재 소스상 인증 불일치가 있다.
  API를 임의로 교체하거나 서버 파일을 변경하지 않았다.
  실서버의 배포 상태는 네트워크 금지로 미확인이고, 해당 API의 앱 JWT 수용 여부를 서버 작업에서 확인/해결해야 한다.
  그 전까지 서버 사진 표시 및 원본을 읽어야 하는 추가 주석은 실서비스 동작을 보장할 수 없다.
- 웹 가드의 일부 미확인 배지/토스트 항목은 이번 지시서에서 명시적으로 제외했다.
  기록 탭 외의 캘린더 진입점을 추가하지 않았다.

## 미확인 — 후속 실기기/서버 검증

1. Gradle 의존성 해석, 전체 APK 빌드/리소스·manifest 병합, 설치/기동.
2. `RecordCalendarFlowComposeTest`, `RecordCalendarLayoutComposeTest`, `SingleTaskComposeTest` 및 기존 Android 계측의 실제 실행.
   수정 전 TB373FU·Android 16의 41개 중 3개 실패를 아래에 기록했다. 수정한 3건과 전체 41개 재실행은 미확인이다.
   singleTask는 명시적 startActivity 후 런처 Intent로 재실행하고 앱 API로 태스크 1개·액티비티 1개를 검사한다.
3. RecordCalendarPreview(고정 2026-09-27·로컬 2건+서버 1건)/OutboxHistoryPreview의 866×1385dp·340dpi·ko 렌더와 PNG 검수.
   수정 지시서에는 이전 스크린샷 8개 통과가 보고됐다. 이번 작업에서 재렌더/시각 검수는 실행하지 않았다.
4. TB373FU Wi-Fi 전환 후 요청 없이 오프라인 띠 해제, 연결 검증 지연/캡티브 포털, 실패 대기 재시도와 불명 불변.
5. 사진 상세 뒤로/탭 이동/백그라운드, 회전/분할창/큰 글꼴, 스캔 여러 장/부분 실패, 저장 공간 부족,
   실제 펜·마이크·녹음 자동 정지와 프로세스 종료 후 복구. onStop 전송은 ViewModel/프로세스 수명 안에서 진행한다.
6. 실서버 앱 JWT 주간 조회/다운로드 URL 발급, 이미지 다운로드, 사진 뒤 메모·음성·주석 추가,
   타인/유예 만료 사진 삭제 거절, 정상 삭제 후 원장 정리.

위젯/JVM/소스 컴파일 통과를 실기기 정상이나 실서버 E2E 통과로 기록하지 않았다.
함수 이름이 아니라 실행한 테스트와 직접 읽은 분기를 근거로 결과를 구분했다.

## 2c 수정 1 — 원인·판정·회귀 근거

### 수정 전 증거

- 기존 `app/build/outputs/androidTest-results/connected/debug/TEST-TB373FU - 16-_app-.xml`:
  tests=41, failures=3, errors=0, skipped=0. 실패 이름은 지시서의 3건과 일치한다.
- 기존 `app/build/test-results/testDebugUnitTest/TEST-*.xml` 합계: tests=246, failures=0, errors=0.
  이는 다른 작업자가 실행한 수정 전 Gradle 결과다. 이번 오프라인 246개는 기존 245개에 신규 회귀 1개를 더한 결과이며,
  Android 의존 BackgroundContrastTest 1개는 오프라인 도구의 기존 제외 범위다.
- 스크린샷 8개 통과는 수정 지시서의 보고다. 이번 수정에서 Gradle·렌더러·기기를 실행했다고 해석하지 않는다.

### 1. 오프라인 안내: UI 누락이 아니라 모의 서버의 불완전한 오프라인 설정

실패: `offlineDetailClosesToCalendarAndWaitsOutsideHistoryUntilReconnect`에서
`오프라인입니다. 연결 후 전송할 수 있습니다.` 노드가 없어 `performScrollTo()` 실패.

- `ui/record/RecordScreens.kt`의 `PhotoDetailContent`는 상세에서 `if (offline)`일 때 원문 안내를 그린다.
  상세 전송 버튼 제거와 별개이며 문구 기대값을 삭제하거나 다른 화면으로 옮길 이유가 없다.
- `RecordUiGateway.offline`은 이전 코드에서 `siteStatus`에만 적용됐다. 2c의 날짜 선택/달력 진입은
  `MockGateway.calendarMedia`로 정상 응답을 받아 `FieldCoordinator.authorized`의 `markOnline()`을 실행한다.
  따라서 테스트가 오프라인으로 만든 상태를 상세 진입 전에 스스로 해제했다.
- 실제 계측 파일의 `RecordUiGateway` 클래스를 그대로 추출해 기존 로컬 Kotlin/JVM 코드와 실행했다.
  수정 전 로그 `build/stage2c-fix1/offline-fixture-before.log`: siteStatus 실패 후 true → 달력 조회 후 false,
  오프라인 유지 assertion 실패(exit 1). 수정 후 `offline-fixture-after.log`: true → true, exit 0.
  Android 렌더 재현이 아니라 동일 모의 서버/실제 coordinator 경계의 재현이다.
- 수정: 달력 조회도 동일 오프라인 실패를 반환한다. 업로드/메모에도 오프라인 조건을 적용해 뜻밖의 전송 성공을 막는다.
  재접속 단계에서 모의 서버도 온라인으로 복구한다. 기존 안내 검사에 달력 요청 발생/오프라인 유지,
  닫힘→waiting→이력 제외→복귀 후 업로드 정확히 1회→완료 이력을 추가했다.
  운영 코드의 성공 요청→온라인 판정은 정상 규칙이므로 바꾸지 않았다.

### 2. 메모: 첨부 1건 계약 유지, IME와 클릭 동기화 보강

실패: `memoIsConfirmedAndSavedAsSingleLocalAttachment`의 수정 전 147행,
`compose.waitUntil(5000) { model.outbox.dependents(photo.id).size == 1 }` 시간 초과.

- `RecordInputController.save`는 확인한 본문을 `OutboxKind.text`, `dependsOn = media.id`로 한 번 enqueue한다.
  재클릭은 본문/확인 초기화로 차단한다. `dependents`는 phase로 걸러내지 않으며
  `OutboxController.cleanupBundle`은 바이트/초안만 정리하고 완료 원장 항목은 유지한다.
  따라서 자동 전송 때문에 size 1 대신 0을 기대하도록 바꾸거나 `>= 1`로 완화하는 것은 잘못이다.
- `RecordWorkspace`는 메모 입력 화면의 뒤로가기로 상세를 닫지 않는다.
  신규 JVM `AutomaticSendTest.confirmedMemoStaysOneLocalAttachmentUntilPhotoDetailCloses`는
  미확인 저장 불가→확인 저장/재클릭→원장 재조회/재접속→입력 화면 닫힘→상세 닫힘을 실제 컨트롤러로 실행한다.
  상세 열림 동안 정확히 text 1건/waiting/autoSendReady=false/원문 일치/전송 0회,
  닫힘 뒤 photo·text 각각 1회 전송/같은 메모 ID 1건 유지/바이트 정리를 검증했고 통과했다.
- 기존 메모 logcat(같은 결과 디렉터리의 `TB373FU - 16/logcat-com.vitalguard.field.RecordEditingComposeTest-memoIsConfirmedAndSavedAsSingleLocalAttachment.txt`):
  12:30:11.978 메모 IME 표시 요청(2845행), 12:30:12.412 표시 완료(3194행),
  실패 대기가 끝난 뒤 12:30:17.633 PAUSED(4307행), 12:30:17.862 STOPPED(5206행).
  대기 구간의 onStop→자동 전송 증거는 없다. 클릭/확인 상태 자체는 당시 로그에 없어 누락 지점은 확정할 수 없다.
- 원인 후보는 IME 전환 중 스크롤/클릭 경합이다. `FieldApp`에는 이미 safeDrawing/IME 인셋 합집합 처리가 있으므로
  근거 없이 화면에 IME 패딩을 중복 추가하지 않았다. 계측만 `Espresso.closeSoftKeyboard()` 뒤
  실제 IME 비표시·bottom inset 0을 기다리고, 확인 체크 off→on 및 저장 enabled를 검사한 뒤 실제 클릭한다.
  오류가 있으면 즉시 드러내며, 저장 뒤 kind/phase/autoSendReady/부모 상세/원문도 검사한다.
  기존 5초 저장 제한·정확히 1건·성공 문구·상세 건수는 보존했다. 컨트롤러 직접 호출로 UI 클릭을 대체하지 않았다.
- **확정 범위:** 2c 저장/원장 계약은 로컬 회귀에서 정상이다.
  **미확인:** 원래 실기기의 어느 클릭이 누락됐는지와 동기화 수정 후 해당 실기기 테스트의 통과 여부.
  다음 실행에서 확인 체크/저장 활성화/저장 오류 중 어느 단계인지도 구분할 수 있다.

### 3. singleTask: 출력 문자열 대신 앱 태스크 API로 동일 요구 검사

실패: `launcherAfterExplicitStartKeepsOneMainActivityHistoryEntry`에서 expected 1 / actual 0.

- 기존 판정은 `"Hist #" in line`이다. 지시서의 Android 16 출력 `* Hist  #0: ActivityRecord{…}`는
  공백 2개이므로 검색 결과가 0이다. 문자열 표본으로도 불일치를 재현했다.
  기존 로그에서 두 재실행은 같은 `MainActivity@6b70b3b`의 PAUSED→RESUMED로 기록돼 있다.
  셸 권한 거절 여부는 수집된 dumpsys 원문이 없어 단정하지 않는다.
- 로컬 Android SDK `sources/android-36.1/android/app/ActivityManager.java`와 `TaskInfo.java`를 읽고
  자기 앱의 `getAppTasks()` 및 태스크의 `numActivities`, `baseActivity`, `topActivity`, `taskId` 계약을 확인했다.
  이제 dumpsys/셸 권한 없이 실행 중 MainActivity 태스크 정확히 1개, 그 안 액티비티 정확히 1개,
  원래 taskId, base/top MainActivity, `isTaskRoot`, 같은 Activity 객체, ViewModel 생성 1회를 모두 검사한다.
  0개일 때도 실패하며 예외를 무시하거나 폴백으로 통과시키지 않는다.
- 최초 실행·명시적 재실행·런처 재실행마다 같은 조건을 적용한다.
  두 재실행 각각의 새 RESUMED 콜백을 기다려 Intent가 아직 전달되지 않은 이전 상태를 검사하지 않는다.
  콜백은 finally에서 해제한다. Manifest의 singleTask 설정은 바꾸지 않았다.

### 변경 범위와 남은 검증

운영 소스/Manifest/Gradle 설정을 추가 변경하지 않았다. 실패한 계측 3건은 이름과 의도를 유지했으며 삭제하지 않았다.
JVM 회귀 1개, README, 본 기록, 구조 검사 결과를 갱신하고 지정 완료 로그에 덧붙였다.
외부 완료 로그 경로는 프로젝트 기준 `../../plan-draft/astra-done.txt`, app 모듈 기준 지시서의 `../../../plan-draft/astra-done.txt`다.

수정 후 **오프라인 JVM 246개·Android/Compose API 컴파일·구조/공백 검사는 통과**했다.
**수정한 3건과 전체 41개 실기기 계측 재실행은 미확인**이며, 특히 메모 IME 동기화의 실제 기기 효과를 재확인해야 한다.
과거 38개 실기기 통과나 이번 소스 컴파일을 수정 후 실기기 정상으로 계산하지 않았다.
