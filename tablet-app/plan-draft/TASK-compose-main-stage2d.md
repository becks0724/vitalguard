# TASK — 메인 앱(Compose) 2d단계: 서버 기록 상세의 첨부 수·댓글 목록 · 부수 요청 401 은 세션을 잠그지 않음 · 2026-09-27

프로젝트 `tablet-app/app/vitalguard_field_android/` (2c 통과 · 커밋 6af6a9fe) 안에서만 수정. Gradle·네트워크 금지. 이전 지시서 규칙 유지.
실기기(태블릿, 라이브 서버 리비전 00408 — `download-url` 이 앱 JWT 를 받음) 실측 결과 두 가지를 고친다.

## 1. 서버 기록 상세가 서버 첨부를 반영하지 않는다
- 실측: 서버 기록(오늘 11:08, calendar_media `4e575891…` + 잉크 `8e03f3f9…`(annotation_of 로 연결) + calendar_media_comment 4행(글 3 · 음성 1 `audio_ms=7744`))을 열면 화면이 **"주석 0 · 메모 0 · 음성 0"** 이고 댓글 카드가 **1건("산업 안전")만**, 시각은 `2026-09-27T03:00:02.862Z` UTC 원문 그대로다. 달력 블록은 "사진 1 · 음성 1" 로 음성은 셌다.
- 고칠 것: (a) 서버 기록의 주석 수 = 같은 날 `annotation_of == 이 사진 id` 인 ink 행 수, 메모 수 = `audio_storage_key` 없는 댓글 수, 음성 수 = `audio_storage_key` 있는 댓글 수 — 로컬 첨부와 합산(중복은 clientOperationId 로 제거). (b) 댓글 목록은 서버 댓글 전부(글·음성 구분, 음성은 길이 `audio_ms` 와 재생 버튼 — 재생 URL 은 `download-url?id=` 가 아니라 댓글의 `audio_url`/`audio_storage_key` 로 얻는 경로를 서버 소스 `기존_조달청모듈/safetymonitor/apps/dashboard-web/app/api/calendar/media/comment/route.ts` 와 `CalendarVoiceComment.tsx` 에서 확인하고, 앱 JWT 로 안 되면 "미확인"으로 적고 재생 버튼은 비활성+사유 문구). (c) 시각은 기기 시간대(Asia/Seoul)로 `2026-09-27 12:00:02` 형식 — 다른 화면과 같은 포맷터를 쓴다. (d) 잉크 리비전이 있으면 상세 사진 위에 "주석본 보기" 토글(2a/2b 의 로컬 잉크본 표시와 같은 UI).
- 서버 응답 필드는 `GET /api/calendar/media?from&to` 의 실제 응답(`listCalendarMedia`, `lib/db.ts`)을 읽고 맞춘다. 댓글을 목록 GET 이 안 주면 어떤 API 가 주는지 서버 소스에서 찾고, 없으면 없다고 적는다(임의 API 만들지 말 것).

## 2. 부수 요청의 401 로 세션 전체를 잠그지 않는다
- 실측: 배포 전 `download-url` 이 401 을 주자 상세를 여는 순간 앱이 "다시 로그인해 주세요"로 갔다. `FieldCoordinator.authenticationRejected` 가 401/403/`action=reauth` 를 전부 잠금 사유로 본다.
- 고칠 것: 잠금은 **세션 자체의 판정**(`me`·`refresh`·로그인 필수 쓰기 경로에서 `action == "reauth"` 또는 401)에서만. 사진/썸네일/댓글 조회 같은 부수 요청의 401/403 은 그 항목만 "권한 없음 · 다시 로그인하면 다시 시도합니다" 상태로 두고 세션은 유지. 어느 호출이 "세션 판정"인지 목록으로 README 에 적는다. 서버가 실제로 주는 `action` 값(reauth/none)은 2c 배포 실측: 무토큰 → `reauth`, 틀린 토큰 → `none`.
- 테스트: JVM — 부수 요청 401 은 authStage 불변 + 항목 상태만 변경 / `me` 401 은 잠금 유지 / refresh 실패 규칙 불변. 기존 잠금 테스트는 지우지 말고 의도 갱신.

## 3. 문서·완료
- `README.md` 2d 절, `plan-draft/stage2d-verification.md`, `../../../plan-draft/astra-done.txt` 덧붙이기. 못 돌린 것은 "미확인".
