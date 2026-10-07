# Compose 메인 앱 2d 검증 — 2026-09-27

> **후속 독립 실행 완료:** Gradle JVM 264/264 · 실기기 43/43 · 스크린샷 8/8.
> 실제 서버 사진·댓글·주석본·음성 재생 확인, 기존 개발 앱 세션 보존. 아래 작성 단계의 미실행 기록과 마지막 절을 구분한다.

지시서: `../../../plan-draft/TASK-compose-main-stage2d.md`.
변경 범위는 `app/vitalguard_field_android/`와 지시서가 별도 지정한 완료 로그뿐이다.
Gradle·네트워크·ADB·설치·실기기 실행은 하지 않았다. 기존 외부 변경을 보존했다.

## 결과와 한계

| 항목 | 결과 | 근거 |
|---|---|---|
| 서버 댓글 전부 표시 | 소스/JVM 통과, 기기 미확인 | 상세를 열 때 날짜 GET. 오래된 영수증 1개 → 응답의 글 3·음성 1개 |
| 첨부 합산/중복 제거 | 소스/JVM 통과 | RecordAttachments: 댓글 작업 ID/영수증 ID, 로컬 작업 ID. 달력 음성 수도 같은 계산 |
| 정확한 동일 날짜 서버 잉크 행 수 | **미충족·미확인** | 목록은 원본만 반환하고 최신 annotationId만 제공. 전체 잉크 조회 API 없음 |
| 주석본 토글 | 소스 API 컴파일 통과, 기기 미확인 | 로컬 미리보기 + 서버 download-url, 2b 렌더러의 벡터/기존 비트맵 |
| 댓글 시각 | JVM 통과 | 기기 Asia/Seoul: 2026-09-27T03:00:02.862Z → 2026-09-27 12:00:02; UTC 전환도 검사 |
| 음성 URL/길이/재생 제어 | JVM/소스 API 컴파일 통과, 실음성 미확인 | audio_url만 다운로드, 7744ms→0:07, 주소 없음은 비활성+미확인 사유, 한 번에 하나 |
| 부수 401/403 격리 | JVM 통과 | 사진 401/403 × action null/none/reauth: authStage·전체 FieldState·토큰·beforeLock 불변, refresh 0회 |
| me/필수 쓰기 잠금 | JVM 통과 | me 401/reauth·허용되지 않는 역할, 사진/댓글/음성/삭제/경보 확인 401 none/reauth |
| refresh 규칙 | 기존 검사 유지·통과 | refresh 401/403/reauth 잠금, 단일 비행·늦은 응답 격리·오프라인 복원 |

서버 원본 사진의 첨부 예시는 `주석 1개 이상 · 메모 3 · 음성 1`로 보인다.
annotationId 하나를 전체 1개로 가장하지 않는다. 최신 ID/로컬 잉크 영수증 ID로 확인 가능한 부분만 합치고,
같은 날짜의 전체 주석 수를 확인할 수 없다는 문구를 표시한다. 목록에 annotationId 필드 자체가 없으면
주석 수를 미확인으로 두며, 순수 로컬 기록의 건수는 기존처럼 정확히 센다.

## 읽은 실제 서버 계약

아래 경로는 저장소의 `기존_조달청모듈/safetymonitor/apps/dashboard-web/` 기준이다. 모두 읽기만 했다.

- `lib/db.ts:4833 listCalendarMedia`: `m.annotation_of IS NULL`, 날짜 범위. 연결 행 중 created_at/id 역순
  LIMIT 1의 ID를 annotationId로 반환한다. 잉크 행의 날짜/작업 ID/총수는 반환하지 않는다.
- `lib/db.ts:5002 listCommentsForMedia`: 해당 media_id의 **전체** 댓글을 created_at ASC로 조회한다. LIMIT 없음.
- `app/api/calendar/media/route.ts:32 GET`: 앱 JWT 허용. comments를 각 미디어에 붙이고
  audio_storage_key가 있으면 presignDownload로 audio_url을 발급한다.
- `app/api/calendar/media/comment/route.ts`: POST/PATCH/DELETE만 존재한다. **별도 댓글 GET은 없다.**
- `app/components/CalendarVoiceComment.tsx`: src(audio_url)를 audio 태그에서 재생한다. 댓글 ID로 사진 다운로드 API를 호출하지 않는다.
- `app/api/calendar/media/download-url/route.ts`: 현재 소스는 앱 JWT를 받고 CalendarMedia ID의 URL을 발급한다.
  사진/최신 잉크 다운로드에 사용한다. 댓글은 이 테이블의 ID가 아니므로 이 경로에 넣지 않는다.
- `app/api/calendar/media/ink/route.ts`: 관제 인증만 수용하며 잉크 파일 JSON만 반환한다.
  앱은 호출하지 않는다. 이 API에도 연결 잉크 목록/개수 응답은 없다.

지시서의 리비전 00408 배포 결과와 DB 4행은 제공받은 실측이다. 이 작업에서 서버를 호출하거나
실제 응답/DB를 새로 수집하지 않았다. 회귀 표본은 위 소스 계약으로 만든 합성 데이터다.
정확한 동일 날짜 잉크 총계에는 연결 행의 날짜·작업 ID·총수 또는 전체 목록을 제공하는 서버 계약이 필요하다.
허용 범위에 서버 수정이 없으므로 임의 API/필드를 만들지 않았다.

## 원인과 수정

1. 상세 건수는 기존 attachmentCounts(attachments)로 로컬 원장만 셌다. 이제 RecordAttachments가
   서버 댓글과 로컬 첨부를 함께 투영한다. 분류는 audio_ms/audio_url 유무가 아니라 audio_storage_key 기준이다.
2. 상세는 fromOutbox(photo).comments, 즉 영수증 스냅숏을 렌더했다. 상세 진입 자체에는 최신 댓글 조회가 없었다.
   RecordDetailController가 날짜 GET으로 갱신하고 조회 중/실패 상태를 상세에만 표시한다.
   실측 당시의 실제 HTTP 응답은 없으므로 **댓글 1건의 직접 원인이 캐시였다는 것은 확정하지 않았다.**
   회귀 검사는 오래된 1건 스냅숏이 최신 4건 응답으로 교체되는 경로를 고정한다.
3. authorized의 부수 401이 refresh/재시도/lock으로 이어졌고 action=reauth도 직접 lock했다.
   기본 요청 분류를 부수 조회로 두고 me/필수 쓰기만 세션 판정으로 지정했다.
   부수 요청의 401/403/reauth는 `권한 없음 · 다시 로그인하면 다시 시도합니다` 항목 오류이며 action은 none이다.
   응답 때문에 refresh하지 않는다. 기기에서 만료를 확인해 요청 전에 하는 refresh는 유지한다.
4. 초기 me의 잠금 상태를 catch가 login으로 덮지 않도록 reauthenticate를 유지한다.
   me에서 역할 거부를 확인하면 토큰도 삭제해 다음 오프라인 복원이 거부된 신원을 다시 쓰지 못하게 한다.
5. 현장 조회 401도 현장 데이터 제거/폴링 중단만 수행한다. 로그인 직후 site-info 권한 거부는 새 세션을 취소하지 않는다.

세션 판정 호출 전체 목록/재시도 예외는 README 2d 표에 기록했다. refresh의 기존 403 잠금,
beforeLock 초안 보존, 단일 refresh, 쓰기 결과 불명 자동 재전송 금지, 삭제 유예 403 원문 보존은 유지한다.

## 실행한 검사

프로젝트 루트에서:

```sh
python3 tools/check-jvm-offline.py
python3 tools/check-android-kotlin-offline.py
git diff --check -- .
```

- 수정 전: 기존 246개 + 부수 인증 회귀 2개 = **248개 중 2개 실패**.
  달력 부수 401에서 expected ready / actual reauthenticate, 사진 권한 오류 문구 불일치.
  원문: `stage2d-repro-jvm.txt`.
- 수정 후: **JVM 263개 전부 통과**. 기존 246개 + 17개이며 기존 BackgroundContrastTest 제외 규칙은 유지한다.
  Kotlin 2.4.0/JUnit 4.13.2/coroutines 1.10.2/org.json 기존 로컬 캐시만 사용한다.
  최종 로그: `../build/offline-jvm/junit.log`, `../build/offline-jvm/compile.log`.
- **main/androidTest/screenshotTest Kotlin/Compose 소스 API 컴파일 통과**.
  최종 로그: `../build/offline-android-kotlin/compile.log`.
  R/BuildConfig는 스텁이며 캐시 클래스패스는 Gradle의 의존성 해석 결과가 아니다.
- Flutter/파일럿 원본 **120개 해시 일치**, Gradle 관련 4개와 AndroidManifest 1개가 HEAD와 동일.
  신규 의존성 0개. Kotlin 파일 끝 개행/후행 공백과 git diff 공백 검사 통과.

새 JVM 검사: AuxiliaryAuthorizationTest 4개, RecordDetailTest 7개, CommentPlaybackTest 3개,
기존 CalendarGatewayTest/HttpTransportTest/OfflineRestoreTest 각 1개 추가.
기존 잠금 테스트는 삭제하지 않았다. FieldCoordinatorTest의 401 재시도/잠금과
RecordRecoveryTest의 초안 보존은 필수 쓰기로 트리거를 옮겼다. me 일반 403은 reauth/401과 구분하며
기존 me401 및 refresh401/403/reauth 잠금 검사는 유지한다. 캘린더 음성 표본에는 실제 서버 계약의
audio_storage_key와 각 로컬 작업의 고유 clientOperationId를 넣었다.

## 실행하지 못한 검사 — 미확인

- Gradle/APK 빌드·리소스 링크·Manifest 병합·설치.
- ServerRecordDetailComposeTest 2개와 전체 Android 계측 실행. 테스트 소스 컴파일만 통과했다.
- 실기기에서 네 댓글의 레이아웃/스크롤·큰 글꼴·회전·백그라운드·주석 토글/펜 렌더.
- 리비전 00408 앱 JWT로 실제 사진/잉크/음성 다운로드·음성 재생·서명 URL 만료 후 새로고침.
- 스크린샷 생성/시각 검수. 소스 컴파일을 화면 정상으로 간주하지 않았다.
- **서버가 반환하지 않는 정확한 동일 날짜 잉크 리비전 총계와 전체 잉크의 clientOperationId 중복 제거.**

실기기 확인 순서: 지시서의 사진 열기 → 글 3개/음성 1개·0:07·12:00:02 확인 → 음성 재생/정지 →
주석본 토글 → 사진/댓글/음성 401 또는 403에서 상세/세션 유지 → 별도의 me401/refresh 거부에서 잠금 확인.

## 독립 검증 — 9/27 Codex 인수 후 실행

작성 에이전트 종료를 확인하고 소스 161파일의 해시를 고정해 `/private/tmp/vg-compose-20260927-2d`에 복사했다.
Gradle 실행 후 원본과 비교해 소스 변화가 없음을 확인했다. 이후 바뀐 소스는 아래 프리뷰 표본 1필드뿐이다.
원본 한글 경로는 유지했다. 기존 2c 프리뷰 기준 이미지 8개를 복사해 먼저 비교했고, 최종 기준 이미지를 원본 프로젝트에도 보관했다.

| 실행 | 결과 |
|---|---|
| `assembleDebug`, `assembleDebugAndroidTest`, `testDebugUnitTest` | **성공, 264개·실패 0·오류 0·skip 0** |
| 새 `ServerRecordDetailComposeTest` | **2/2** 실기기 통과 |
| 전체 AndroidJUnitRunner 직접 실행 | **43/43**, 111.406초, 재실행 합산이 아닌 전체 1회 결과 |
| `validateDebugScreenshotTest` | 첫 비교 7/8 → 표본 보완 후 **8/8** |
| 개발 APK `adb install -r` | 성공, `com.vitalguard.field.dev` 유지 |
| 계측 전후 세션 파일 SHA-256 대조 | **동일**. 암호문 내용·해시는 보고서에 노출하지 않음 |
| 실제 서버 E2E | 아래 항목 확인, 서버 쓰기·권한 변경 없음 |

실행 환경: JBR `/Applications/Android Studio.app/Contents/jbr/Contents/Home`, Gradle offline,
`-PnavigationComposeVersion=2.10.2`, TB373FU `HA2HG0SD` Android 16.
`connectedDebugAndroidTest`가 대상 앱을 삭제했던 이전 이력을 피하기 위해 대상/계측 APK를 각각 `install -r`하고
`adb shell am instrument -w -r com.vitalguard.field.dev.test/androidx.test.runner.AndroidJUnitRunner`를 사용했다.
테스트 주입은 기존 모의 gateway/MemoryStore를 그대로 사용했다. 실행 후 기존 계정으로 자동 복원됐다.

### 스크린샷 차이의 원인과 보완

`Stage2cPreviewTest.RecordCalendarPreview`의 음성 표본은 `audio_ms`만 주고 실제 서버가 제공하는
`audio_storage_key`를 빠뜨렸다. 2d의 올바른 분류 결과로 음성 수가 1→0이 돼 기준 이미지와 달라졌다.
표본에 `audio_storage_key="preview/voice.m4a"`를 추가하자 기존 기준 이미지 8개가 모두 통과했다.
화면을 바꾸거나 새 화면을 정답으로 등록해 실패를 숨기지 않았다.

### 실서버·실기기 확인

- 기존 세션 진입, 현장 정보·14:41:31 KST 요약 수신.
- 기록 탭의 9/27 11시 블록 → 사진 상세: **주석 1개 이상 · 메모 3 · 음성 1**.
- 글 댓글 세 개 전부 표시, UTC 원문 대신 **12:00:02 / 12:00:04** 기기 시간대 표시.
- 주석본 보기 ON에서 실제 서버 잉크가 사진 위에 그려지고, 원본 보기와 전환됨.
- 음성 **0:07** 표시, 재생 누름→`재생 정지` 표시→정상 완료 후 `음성 재생`으로 복귀(14:44:56 확인), 오류 문구 없음.
- 상세 진입·주석/음성 조회 동안 세션이 잠기지 않음. 음질·발음 정확도를 평가한 것은 아니다.
- 실제 401/403을 만들기 위해 계정·서버 권한을 변경하지 않았다. 오류 격리는 모의 실기기 계측/JVM 검증 근거다.

증적은 프로젝트 상위 `artifacts/compose-stage2d-20260927/`에 보관한다.
`verification.json`, Gradle/계측/스크린샷 로그, JVM XML, 실제 상세/댓글/주석/재생 화면 PNG.
실제 사진·위치가 담긴 화면은 로컬 자료이며 코드 커밋에 포함하지 않는다.

설치 APK SHA-256: `9880b47c4d2f5c4f3c780eec7c02d0f2d224ccd8469ea6f1e10fd1e596d97747` (62,158,089B).
원본 프로젝트의 `app/build/outputs/apk/debug/app-debug.apk`와 증적 폴더의 `app-stage2d-debug.apk`에 같은 파일을 보관했다.
현재 versionName은 기존 `0.3-stage2b` 표기를 유지하므로 실제 버전 구분은 위 해시와 커밋을 사용한다.

### 남는 경계

- 정확한 서버 잉크 리비전 총계·모든 잉크의 작업 ID는 API가 제공하지 않으므로 **최소 확인 개수**만 표시한다.
- 서명 URL 만료 후 실서버 재조회, 신규 댓글 화면의 큰 글꼴·분할창 조합은 별도 미실시다.
- 자동 전송의 상세 종료 시점은 기존 2c 동작을 유지했다. 사용자 확정 답을 기다리는 항목이며 2d에서 정책을 변경하지 않았다.
- 3단계 CCTV·경보(정수/UUID 호환 포함), 4단계 설정·릴리스·Flutter 교체는 다음 범위다.
