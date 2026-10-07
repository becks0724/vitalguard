# TASK — 메인 앱(Compose) 2c단계: 기록 탭을 워크 캘린더로 · 자동 전송 · 전송함=이력 · singleTask · 2026-09-27

## 0. 범위·원칙
- 프로젝트 `tablet-app/app/vitalguard_field_android/` (2b 통과 · 커밋 8364655b · 실서버 E2E 통과). **이 폴더 안에서만 수정.** 웹·Flutter·다른 파일은 읽기만. **Gradle 실행 금지.**
- 태곤 님 결정(2026-09-27 대화, 그대로 옮김):
  1. "기본적으로 자동으로 전송하게 하고, 전송에 실패하면 전송 누르게 해야지."
  2. "라이브 대시보드 워크 캘린더의 달력 형태를 앱에서도 똑같이 해서 그 날 찍은 사진·음성 녹음을 관리하게끔 틀을 잡고, 전송 전 검토는 전송함이 아니라 기록 단계에서 하게 하라. 전송함은 전송한 걸 기록하기 위한 것."
  3. 지금 기록 탭은 "레이아웃 자체가 정돈이 안 돼 있다" — 사진 상세가 탭 본문에 눌러앉는 구조를 걷어낸다.
- 해석(클로드 가정 · 태곤 님이 뒤집으면 그 말이 우선):
  - **검토 = 기록을 만드는 동안**(사진 상세에서 주석·메모·음성을 붙이고 확인). 상세를 닫는 순간(뒤로/달력으로/앱 백그라운드) 그 사진 묶음은 **자동 전송 대상**이 된다. 상세에 [전송] 버튼은 없앤다. [삭제]는 남긴다.
  - 전송 뒤에 붙인 메모·음성·주석은 추가분만 자동 전송한다(서버가 사진 뒤 댓글·주석 추가를 허용함 — 2b E2E 로 확인).
  - 전송된 사진의 삭제는 서버 `DELETE /api/calendar/media?id=` (유예 `MEDIA_DELETE_WINDOW_MIN = 10`분, `lib/db.ts:4768`). 유예가 지나면 서버가 403 `MEDIA_DELETE_WINDOW_EXPIRED` 를 주니 그 문구를 그대로 보여 주고 로컬만 지우지 않는다(서버 기록이 정본).
  - 실패한 항목만 달력 항목과 전송함에 [전송] 버튼이 남는다. `uncertain`(결과 불명) 은 지금 규칙 유지(자동 재전송 금지 · 사람이 누름).
- 제작 기록 §7 원칙 유지: 위젯 테스트 통과≠실기기 정상 · 문구는 원본 글자 그대로 · 함수 이름으로 동작 단정 금지.

## 1. 참고 원본 — 웹 워크 캘린더 (읽기만)
경로: `기존_조달청모듈/safetymonitor/apps/dashboard-web/`
| 무엇 | 파일 | 옮길 것 |
|---|---|---|
| 캘린더 본체 | `app/components/DemoDashboard.tsx` 2448~2990행(주간 일정표·미니 월간·`WEEK_START_HOUR=0`·`WEEK_END_HOUR=24`·`WEEK_HOUR_PX=44`), 4043~4300행(구글 캘린더식 레이아웃: 좌상단 미니 월간 + 메인 주간 격자, 선택은 날짜 숫자에 원형, 주 행 높이 균등, 격자만 스크롤) | 구조·규칙. 웹 CSS 를 베끼지 말고 Material3 로 같은 배치 |
| 사진 배치 규칙 | 같은 파일 주석: 사진은 촬영 시각 위치(시각 못 읽으면 종일 띠), 미디어 블록은 사진/영상별 건수 표기, 첫 렌더는 07시로 스크롤 | 그대로 |
| 가드 테스트(=명세) | `lib/2026-08-20-calendar-google-layout.guard.test.ts`, `...-week-grid.guard.test.ts`, `...-tab-and-author-id.guard.test.ts` 의 `test("…")` 제목들 | 제목 하나가 규칙 하나. 앱 테스트 이름도 같은 뜻으로 |
| 조회 API | `app/api/calendar/media/route.ts` GET `?from=YYYY-MM-DD&to=YYYY-MM-DD` — 앱 JWT(owner/admin/worker) 허용, 응답 = `listCalendarMedia` | 달력에 보이는 범위(주 단위)를 가져와 로컬 기록과 합친다 |
| 썸네일/원본 | `app/api/calendar/media/download-url/route.ts` GET `?id=` | 서버 사진은 이 URL 로 그림. 캐시는 기기 캐시 디렉터리, 7일 |
| 삭제 | 같은 `media/route.ts` DELETE `?id=` (`mediaWriteScope` 로 본인/권한 판정, 10분 유예) | 위 해석 |
| 앱 쪽 기존 모델 | `data/models/CalendarMedia.kt`, `data/OutboxController.kt`, `ui/record/*`, `ui/outbox/*`, `data/record/RecordSession.kt` | 재사용. 중복 모델 만들지 말 것 |

## 2. 만들 것
### 2-1. 기록 탭 = 워크 캘린더 (`ui/record/RecordCalendarScreen.kt` 신규, `RecordScreens.kt` 정리)
- 가로 866dp(레일 80dp 제외 · `tablet-screen-metrics`): 왼쪽 미니 월간(날짜 이동 · 오늘=반투명 원 · 선택=채운 원 · 선택이 오늘보다 우선) + 오른쪽 주간 격자(00~24시 · 격자만 스크롤 · 첫 렌더 07시). 세로(폰·분할창)는 미니 월간을 위로.
- 격자에는 **로컬 기록**(미전송·전송 중·실패·불명)과 **서버 기록**(GET from/to)을 한 시간축에 놓는다. 같은 사진이 양쪽에 있으면(clientOperationId 또는 sourceKey 일치) 서버 것 하나로 보이고 상태만 로컬에서 가져온다.
- 블록 표기: 촬영 시각 위치 · "사진 n · 음성 m" 건수 · 상태 배지(기기 보관/전송 중/실패/불명/완료). 시각 없는 것은 종일 띠.
- 날짜를 고르면 그 날 목록(오른쪽 격자 위 또는 시트) → 항목을 누르면 **사진 상세**(기존 `LocalPhotoDetail` 재사용 · 서버 사진은 읽기 전용 상세 + 주석·메모·음성 추가는 허용).
- [서류 스캔]·[사진 촬영] 은 달력 화면의 FAB 두 개로. 촬영 뒤에는 상세로 들어갔다가 닫으면 달력으로 돌아온다(탭 본문에 상세가 남지 않게 — 결정 3).
- 미확인 배지·토스트·헤더 아이콘은 만들지 않는다(웹 가드 "캘린더 진입점은 탭 하나뿐").

### 2-2. 자동 전송 (`data/OutboxController.kt`, `FieldCoordinator`, 신규 `data/live/ConnectivityWatcher.kt`)
- 사진 상세가 닫힐 때(뒤로·탭 전환·`onStop`) 그 묶음을 `waiting` → 즉시 `sendBundle`. 온라인 판정은 기존 `markOnline` 에 더해 **`ConnectivityManager.registerDefaultNetworkCallback`** 으로 네트워크 복귀 시 `waiting`·`failed(네트워크 사유)` 를 자동 재시도. (오늘 실측: Wi-Fi 를 바꿔도 앱이 요청을 하나 보낼 때까지 "오프라인" 띠가 남았다 — 이걸 고친다.)
- `failed` 는 자동 재시도 대상에서 빼고(네트워크 사유만 예외) 항목에 [전송] 버튼. `uncertain` 은 현행 유지.
- 전송 순서·중복 방지·7일 정리·`outbox:v1` 호환은 현행 그대로.

### 2-3. 전송함 = 이력 (`ui/outbox/OutboxScreen.kt`)
- 제목·설명을 "전송 이력"으로. 검토 문구·검토 동작 제거. 완료(서버 확인 시각·작업 ID)·실패([전송] 버튼)·불명(사람 확인)·전송 중만 보여 준다. 기존 `HoldBundle` 검토 UI 는 지운다(코드도 — 남기면 두 벌).

### 2-4. `AndroidManifest.xml`: `MainActivity` 에 `android:launchMode="singleTask"`.
- 오늘 실측: adb 로 띄운 인스턴스 위에 런처 아이콘으로 한 번 더 뜨며 두 개가 쌓였고, 뒤로가기가 위 것을 닫자 옛 로그인 화면이 드러났다. 재현 테스트는 계측으로(두 번째 `startActivity` 뒤 `Hist` 하나).

### 2-5. 문구
- 새 문구는 한국어 경어, 기존 톤 유지("전송 전 기록은 기기에 보관 · 전송한 기록은 관제웹에서 봅니다" 는 "기록은 저장되면 자동으로 전송됩니다 · 실패한 것만 [전송]을 눌러 주세요" 로).

## 3. 테스트
- JVM: 달력 배치 계산(주 경계·종일 띠·건수 묶음·로컬/서버 합치기·상태 우선순위) · 자동 전송 상태기계(닫힘→waiting→sending→completed / failed 는 수동 / 네트워크 복귀 재시도 / uncertain 불변) · 삭제 유예 403 처리.
- androidTest: 달력 렌더·날짜 선택·상세 열고 닫기→달력 복귀·FAB 두 개·singleTask.
- screenshotTest: `RecordCalendarPreview`(866×1385 · 고정 날짜 2026-09-27 · 로컬 2건+서버 1건) · `OutboxHistoryPreview`.
- 기존 테스트가 "전송 버튼"·"검토" 를 전제로 하면 새 규칙에 맞게 고친다(지우지 말고 이름·의도 갱신).

## 4. 문서·완료
- `README.md` 2c 절, `plan-draft/stage2c-verification.md`(실행한 검사·미확인 구분), `../../../plan-draft/astra-done.txt` 에 덧붙이기. Gradle·네트워크 금지. 못 돌려본 것은 "미확인".
