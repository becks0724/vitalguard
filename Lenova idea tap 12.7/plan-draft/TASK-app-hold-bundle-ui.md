# 작업 지시 — 앱 UI: 촬영 보류 → 로컬 사진 상세 → 묶음 전송, 서버 캘린더·댓글 화면 제거 (S2)

작성: Claude / 수신: 코덱스(astra) / 2026-09-17
근거: `../plan-draft/SPEC-r7-hold-until-send.md` §2·§3·§7·§8 — **먼저 읽어라.** 데이터층(S1)은 이미 들어가 있다:
`OutboxKind.text` · `OutboxEntry.dependsOn/completedAt/draftKeys` · `enqueue(dependsOn:, draftKeys:)` · `dependents()` · `parentOf()` · `sendBundle()` · `discard()` · `purgeExpired()` · `fromOutbox()` · `LocalStore.remove/keys` · `comment(…, clientOperationId:)`. **S1 이 만든 것을 고치지 마라** — 부족하면 보고하고 최소로 더해라.

---

## ⛔ 작업 경로

```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/Lenova idea tap 12.7/app/vitalguard_field
```

⛔ 커밋 금지 · 새 패키지 금지 · 서버 폴더 금지 · `lib/data/outbox_controller.dart` 의 S1 로직 변경 금지
⚠ `flutter test` 는 못 돈다 — `dart analyze` 까지. 테스트는 작성만(`flutter-test-pump-trap` 규칙). 기존 553 + S1 신규가 기준선이다. **삭제되는 화면의 테스트는 지워라**, 남는 화면의 테스트는 새 흐름으로 고쳐라.
⚠ 태블릿 화면 제원: 866dp · 레일 80dp · 액션 독은 한 줄 9개 한계. 버튼은 56dp 이상. 기존 `vg_theme` 상수를 써라.

---

## 1. 촬영 → 보류 (`lib/ui/record/capture_ocr.dart` · `capture_screen.dart`)

- `DeviceCapturePipelinePort.upload()`: `enqueue` 만 하고 **`send` 를 부르지 않는다.** 반환은 `fromOutbox(item)`. `CaptureDeferred` 던지지 않는다 → 파이프라인은 `queued` 로 센다(`uploaded` 는 0). `CaptureRunResult` 에 `queuedIds: List<String>` 를 더해 만든 사진 항목 id 를 돌려줘라.
- `CaptureActionPanel`: 완료 문구를 `'기기에 저장됨 · N건 · 주석·메모를 붙인 뒤 전송'` 으로. **사진 1장이면 곧바로 그 사진의 로컬 상세(§3)로 push**, 여러 장이면 기록 탭 목록으로. `onUploaded` 콜백은 "기록 목록 새로고침" 의미로만 남기거나 제거(호출부 `field_shell.dart` 확인).

## 2. 기록 탭 = 보낼 기록 목록 (`lib/ui/record/record_screens.dart` `RecordHome`)

- 서버 캘린더(월/주 그리드·`loadPeriod`·`media`·`calendarEvents`·`calendarLabels`) **전부 제거**. 데이터 소스는 `controller.outbox.items` 중 `kind == photo && phase != completed`, `createdAt` 내림차순. `AnimatedBuilder(animation: controller.outbox)`.
- 줄: 미리보기(`local.readBytes(owner, entry.bytesKey)` 썸네일 — 크기 조절은 `Image.memory(..., cacheWidth:)`) · 제목(`fields['title']`) · 촬영시각(`fields['capturedAt']` → 기존 `_recordTime`) · 현장(`siteName`) · 딸린 항목 수("주석 1 · 메모 2 · 음성 1") · `statusLabel`.
- 비어 있으면 `'보낼 기록이 없습니다. 촬영한 사진은 여기 모입니다.'` + 촬영 진입. 전송 완료된 것은 여기 **없다**(문구 한 줄: `'전송이 끝난 기록은 관제웹에서 봅니다.'`).
- 오프라인이어도 목록은 그대로(로컬).

## 3. 로컬 사진 상세 (`PhotoDetail` 를 로컬 전용으로 개작)

- 입력: `OutboxEntry photo`(또는 id). 표시: `photoBytes(fromOutbox(photo))`.
- 딸린 항목 목록(`outbox.dependents(photo.id)`): 잉크 → `outbox-preview:<id>` 미리보기 · 메모 → 본문(`utf8.decode(readBytes(bytesKey))`) · 음성 → `voiceTime(fields['audioMs'])`. 각 항목에 상태·`[지우기]`(`discard`, `waiting/failed` 만 활성).
- 버튼(액션 독): **[주석 그리기]** → `RecordEditor(original: fromOutbox(photo))` · **[메모·음성 붙이기]** → `RecordInput(media: fromOutbox(photo))` · **[전송]** → `outbox.sendBundle(photo.id)`(오프라인이면 비활성 + 문구) · **[삭제]** → 확인 다이얼로그 후 `discard(photo.id)`(딸린 항목 동반, `waiting/failed` 만).
- 전송 뒤: `bundleCompleted` 면 화면을 닫고 목록으로(그 사진은 목록에서 사라진다). 사진이 `uncertain`/`failed` 면 상태·문구를 보여 주고 머문다. 재시도는 같은 [전송] 버튼(`sendBundle(retry: true)` — `uncertain` 은 전송 상태 탭의 "미등록 확인·재시도" 흐름을 안내하고 여기서는 누르지 못하게).
- 완료된 사진은 어떤 경로로도 이 화면을 열 수 없다(목록에 없고, 딥링크 없음).

## 4. 주석 편집기 (`record_editor.dart`) — 로컬 모드만

- `original.json['local'] == true` 가 아니면 `ArgumentError`(서버 원본은 더 이상 없다).
- 이미지 로드는 `photoBytes(origin)`(S1 이후에도 `photo:` 캐시를 먼저 보므로 로컬 스텁에는 `photo:` 가 없다 → **`photoBytes` 를 로컬 전용으로 바꿔라**: `outbox-file:<id>` 읽기, 없으면 `ApiFailure('원본이 기기에 없습니다')`. 서버 다운로드 경로(`media_url`·`gateway.image`·`media()` 재조회) 삭제 — `field_coordinator.dart:596~`).
- 저장 = `enqueue(kind: ink, bytes: encodeInk, fields: {'siteId': ?origin.site_id}, dependsOn: origin.id, sourceKey: 'annotation:$draftId:$revision', annotationDraftId: draftId, previewBytes: png, draftKeys: ['annotation:$draftId'])`. **`annotationFields(origin)` 을 여기서 쓰지 마라**(참조는 전송 시 S1 이 합성한다). **`send` 호출 없음.** 같은 묶음에 잉크는 1개 — 이전 리비전 항목이 `waiting/failed` 면 `discard` 하고 새로 만든다(`uncertain/completed` 면 저장 거부 + 문구).
- `status == 'sent'` 재편집 경로·`receipt`·`published:`/`photo:` 쓰기(`597~606`)·`syncOperation` 의 sent 분기 삭제. 남는 상태는 `draft` 뿐(전송은 상세 화면 몫).
- 툴바 문구: 저장 버튼 라벨 `'주석 저장'`. 저장 후 상세로 돌아간다.

## 5. 메모·음성 (`record_input.dart` · `voice_comment_draft.dart`) — 로컬 모드만

- `RecordInput(media: 로컬 스텁)`, `editing` 제거(댓글 수정 없음).
- 텍스트 저장 = `enqueue(kind: text, bytes: utf8.encode(composed), fields: {'siteId': ?media.site_id}, dependsOn: media.id, sourceKey: 'comment-draft:${media.id}:$revision', draftKeys: ['comment-draft:${media.id}:new'])`. `controller.comment()` 직접 호출 **삭제**. 메모는 여러 개 가능(저장할 때마다 새 항목). 저장 후 초안 비움.
- 음성: `VoiceCommentDraft.send()` → `enqueue(kind: voice, bytes, fields: {'audioMs', 'siteId'}, dependsOn: mediaId, sourceKey: '$key:recording:$recordingRevision', draftKeys: [key, audioKey])` 만 하고 **전송하지 않는다.** `confirmAbsent`·`status == 'uncertain'` 분기·`[음성 댓글 전송]` 버튼 → `[음성 저장]`. 저장 후 초안 비움.
- STT·후보 선택·미리듣기·다시 녹음·취소는 그대로.

## 6. 전송 상태 (`lib/ui/outbox/outbox_screen.dart`)

- 항목 줄에 묶음 표기: 딸린 항목은 `'원본 사진 <제목> 에 딸림'`, `text` 는 라벨 `메모`. 딸린 항목의 재시도 버튼은 `send(item, retry: true)` 그대로(S1 이 부모부터 보낸다).
- 안내 문구에 한 줄 추가: `'전송 완료 항목은 7일 뒤 자동으로 지워집니다. 원본은 관제웹에서 봅니다.'`
- 전경 복귀(`didChangeAppLifecycleState resumed`) 때 `outbox.purgeExpired()` 호출(이미 있는 훅에 얹어라).

## 7. 복구·셸 (`lib/ui/shell/field_shell.dart:60~80`)

- `RecordSession` 의 저장 media 가 로컬 스텁이면 그대로 복귀. 그 사진 항목이 전송함에 없거나 `completed` 면 세션을 닫고 복귀하지 않는다. `editing` 분기 삭제.

## 8. 죽는 코드 제거 (네 변경으로 참조가 0이 되는 것만)

- `FieldController`: `loadPeriod`·`media`·`calendarEvents`·`calendarLabels`·`editComment`·`removeComment`. `field_coordinator.dart` 의 구현·`calendar:*` 캐시·`_clearView` 의 관련 필드.
- `FieldGateway`/`live_gateway.dart`/`mock_gateway.dart`: `media`·`events`·`labels`·`image`·`updateComment`·`deleteComment`. `CalendarEvent`·`CalendarLabel` 모델은 참조가 0이면 삭제.
- **1회성 legacy 정리**: `OutboxController.load()` 안(S1 의 `purgeExpired` 호출 옆)에 `keys(owner)` 로 접두사 `calendar:`·`photo:`·`published:` 키를 전부 `remove` — 이건 S1 파일에 **더하는 것만** 허용.
- 삭제 전 `grep` 으로 참조 0 을 확인하고 목록을 보고해라. 의심스러우면 남기고 "미확인" 으로.

## 9. 테스트 (작성만)

- 삭제: 서버 캘린더·댓글 수정/삭제·사진 상세(서버)·편집기 sent 재편집·음성 전송 버튼 테스트
- 수정/신규(SPEC §8): 1 촬영→`photo/waiting`·서버 0회 · 2 로컬 스텁으로 편집기/입력 열림·`dependsOn` 항목 생성·참조 필드 없음 · 8 기록 탭 = 보류만·서버 0회 · 9 상세의 [삭제] 동반 삭제 · 10 재로그인 복구 · 11 오프라인 [전송] 비활성 · 상세 [전송] 후 완료 시 목록에서 사라짐
- `record_recovery_test.dart`·`record_editor_ink_test.dart`·`record_input_test.dart`·`voice_comment_test.dart`·`voice_upload_test.dart`·`ink_upload_test.dart`·`capture_ocr_test.dart`·`capture_site_id_test.dart`·`widget_test.dart`·`nav_rail_test.dart` 를 새 흐름에 맞춰라.

## 10. 끝나면 답변에 적어라 (`astra-done.txt` 는 내가 적는다)

- 바꾼 파일과 줄 수(`git diff --stat`) · `dart analyze` 결과
- 삭제한 코드 목록과 각각의 참조 0 확인 근거
- 삭제/수정/신규 테스트 파일 목록과 케이스 수
- 네가 임의로 정한 것 전부 · "미확인"
