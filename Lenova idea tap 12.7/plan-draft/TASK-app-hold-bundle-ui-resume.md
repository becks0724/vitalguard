# TASK-app-hold-bundle-ui — 재개 지시서 (2026-09-18)

어제(9/17 18:06) 네 작업이 중간에 끊겼다. **lib 변경은 그대로 남아 있고 커밋되지 않았다.** 처음부터 다시 하지 말고 아래 "남은 일"만 해라.
원 지시서 `TASK-app-hold-bundle-ui.md` 와 설계서 `SPEC-r7-hold-until-send.md` 는 그대로 유효하다. 먼저 둘을 읽고, 그 다음 `git diff -- lib` 로 네가 어제 바꾼 내용을 다시 파악해라.

## 확인된 현재 상태 (claude 가 오늘 09:45 측정)

- `git status --short -- .` : lib 11개 파일 M(+561/−899), `test/support/record_fixture.dart` 신규(미추적). 테스트 파일은 아직 하나도 안 고쳤다.
- `dart analyze` (프로젝트 전체): **lib 는 오류 0**. test 에 8건 — `PhotoDetail(media:)` → `photoId:` 변경 때문. 파일: `capture_time_test.dart:70`, `comment_time_test.dart:56`, `common_states_test.dart:511`, `record_recovery_test.dart:64`.
- `flutter test` : **+464 −85**. 실패 85건의 전체 목록은 같은 폴더 `TASK-app-hold-bundle-ui-failed-tests.txt` (형식 `파일|테스트명`, `loading …` 5줄은 컴파일 실패로 못 불러온 파일).
  - 파일별: record_editor_ink_test 49 · voice_comment_test 20 · settings_test 4 · record_input_test 3 · capture_site_id_test 3 · capture_ocr_test 2 · nav_rail 1 · global_alert_strip 1 · site_screen 1 · 로드 실패 5(record_recovery·offline_restore·common_states·comment_time·capture_time).
- 원 지시서 **§8 죽는 코드 제거는 아직 안 했다.** lib 에 남아 있는 것(grep 결과):
  - `field_contracts.dart:49-52` `media`·`events`·`labels`·`image`, `:72-73` `updateComment`·`deleteComment`, `:137-138` `calendarEvents`·`calendarLabels`, `:147` `loadPeriod`
  - `field_coordinator.dart:46-48,74-75,521-582` (loadPeriod 구현·`calendar:*` 캐시·`_clearView` 필드), `:673,676` (editComment/removeComment 구현)
  - `live_gateway.dart:655,665` updateComment/deleteComment (+ media/events/labels/image 구현)
  - `mock_gateway.dart` 의 대응 구현, `CalendarEvent`·`CalendarLabel` 모델
  - `OutboxController.load()` 의 1회성 legacy 정리(`calendar:`·`photo:`·`published:` 키 remove)는 **이미 넣었다** — 건드리지 마라.

## 남은 일 (이 순서로)

1. **§8 죽는 코드 제거**. 위 목록 각각을 `rg` 로 lib·test 참조를 세고, UI 참조가 0인 것만 지워라. test 쪽 참조는 3번에서 같이 지운다. `outbox_controller.dart` 는 S1 파일이니 **한 줄도 바꾸지 마라**.
2. `dart analyze` 로 lib 오류 0 확인. (`dart` 래퍼가 Flutter SDK 캐시 갱신 권한 문제로 실패하면 어제처럼 SDK 안의 dart 실행 파일을 직접 써라.)
3. **§9 테스트**. 실패 목록 85건을 파일별로 새 흐름에 맞춰 고치거나, 옛 흐름(서버 캘린더·댓글 수정/삭제·서버 사진 상세·편집기 sent 재편집·음성 전송 버튼·편집기 자체 전송)만 검증하던 케이스는 삭제해라. SPEC §8 의 11항목 중 아직 없는 케이스는 신규로 써라. `flutter test` 는 네가 못 돌리니 `dart analyze` 로 test 까지 오류 0 인지만 확인해라. 실패 판정은 claude 가 돌려서 다시 준다.
   - 잉크 편집기 49건: 펜 조작·확대·굵기·툴바 배치 같은 순수 캔버스 테스트는 **마운트 방식(로컬 스텁 `local: true` + 전송함 photo/waiting 항목)** 만 바꾸면 살 것이다. 전송·게시·sent 재편집 계열만 새 규칙(저장=enqueue ink dependsOn, send 없음)으로 다시 써라.
   - 음성 20건: 전송 버튼 → `[음성 저장]`(enqueue only, draftKeys `[key, audioKey]`). 녹음·정지·취소·회전·복구·권한 케이스는 저장 단계 기대값만 바꿔라.
4. **§10 보고**를 답변 마지막에 적어라: `git diff --stat -- .` · `dart analyze` 결과 · 삭제한 코드 목록과 참조 0 근거(rg 명령과 결과 수) · 삭제/수정/신규 테스트 파일과 케이스 수 · 네가 임의로 정한 것 전부 · "미확인".

## 하지 말 것

- `outbox_controller.dart` 수정 · `flutter test`/`flutter build` 실행 · git commit · 지시서에 없는 기능 추가.
