# TASK — 메인 앱(Compose) 2a단계: 전송함·촬영·보낼 기록·전송 상태 · 2026-09-26

## 0. 범위
- 프로젝트 `tablet-app/app/vitalguard_field_android/` (1단계 골격 통과 · 커밋 86fffe2f). **이 폴더 안에서만 수정.** Flutter 앱·파일럿·다른 파일은 읽기만. **Gradle 실행 금지.**
- 2a = R-7 「전송 보류 묶음」의 데이터층 + 촬영/스캔 + 보낼 기록 목록 + 로컬 사진 상세 + 전송 상태 탭. **주석 편집기(잉크)·메모/음성 입력·녹음기·세션 복구는 2b**(별도 지시서) — 이번엔 자리만.
- 설계 원문: `plan-draft/SPEC-r7-hold-until-send.md` 전체(§2 흐름 · §3 로컬 스텁 · §4 전송함 · §8 테스트). 원칙: "로컬 저장됨"≠"전송 완료", 결과 불명은 재전송이 아니라 조회부터, 자동 전송·자동 재전송 없음, 오프라인에선 [전송] 비활성.

## 1. 원본 (Flutter `app/vitalguard_field/`) — 그대로 옮긴다
| 무엇 | 파일 | 옮길 때 |
|---|---|---|
| 전송함 | `lib/data/outbox_controller.dart`(873줄) — `OutboxKind`(photo/ink/voice/text)·`OutboxPhase` 6종·`OutboxEntry`(JSON 왕복 `schemaVersion 1`, `statusLabel`·`kindLabel` 문구)·`OutboxController`: `_load`(sending→uncertain 복구)·`load`(purgeExpired + legacy 키 1회 정리)·`enqueue`(딸린 항목 참조 필드 금지·부모 siteId 복사·같은 sourceKey/내용이면 재사용·uuid v4·bytes 먼저 저장 뒤 원장 교체)·`dependents`·`parentOf`·`bundleCompleted`·`send`(N-3·N-4 규칙 전부: 부모 미완료면 sendBundle, receipt id 없으면 대기 문구, 오프라인 문구, sending 저장 실패 시 HTTP 금지, 결과 불명 판정, 401/403/404 문구)·`sendBundle`(단일 비행)·`_cleanupBundle`·`discard`·`purgeExpired(7일)`·`verify/verifyUncertain(30초 자동 조회 제한·50개 배치·503/통신 실패는 absent 아님)`·`_cacheInkReceipt`·`confirmAbsent` | Kotlin 클래스 하나 + `StateFlow<List<OutboxEntry>>`·`checking`·`lookupMessage`·`loadError`. 직렬화는 원본과 **같은 JSON 키**(기존 기기 원장 호환). 순차 큐는 Mutex. 순수 로직은 Android 의존 없이(JVM 테스트) |
| 로컬 스텁·시각 | `lib/data/models/record_origin.dart` — `fromOutbox`·`annotationFields`·`asKstIso`·`calendarDate`·`inkUploadSizeError` | 그대로 |
| 게이트웨이 나머지 | `lib/data/live/live_gateway.dart` — `upload`(app-media multipart: 잉크 JSON/JPEG/PNG 판정·`clientOperationId` 필수·boundary·60초·응답 `media`+`clientOperationId` 일치+`deduplicated`)·`_multipart`(voice 문구 분기)·`addComment`·`voiceComment`(10 MiB·`commentOf`·`audioMs`)·`lookupOperations`(1~128자·50개·응답 검증·오류 문구)·`captureAddress`(`/api/app/address` `display`) | `LiveGateway` 에 구현. `HttpUrlConnectionTransport` 를 multipart 로 확장(스트리밍 아님, 바이트 한 번에) |
| 컨트롤러 | `field_coordinator.dart` 의 `photoBytes`(로컬 전용)·`publish`·`comment`·`voiceComment`·`captureAddress`·`lookupOperations`·`operationLookupAvailable`·`ackAlert` 는 3단계 | `FieldController`/`FieldCoordinator` 에 추가. 전부 `_authorized(writing=true)` 규칙 |
| 촬영 | 파일럿 `app/pilot-compose-capture/app/src/main/kotlin/com/vitalguard/field/pilot/capture/*`(CaptureModels·CaptureNative·CapturePipeline·DeviceCapturePipelinePort·TaskAwait)와 `ui/CameraScreen.kt`·`CameraRoute.kt` | 메인 앱 패키지 `com.vitalguard.field.capture`·`ui.capture` 로 **옮겨 넣고**: `saveLocal` → `outbox.enqueue(kind=photo, bytes=jpeg, fields, siteName)`; `serverAddress` → `controller.captureAddress()`(실패는 기기 추정 폴백); 작업자 이름/ID = JWT 사용자 `name`/`workerId`(없으면 `-`); `siteId` = `controller.site.site_id`(없으면 생략, 다른 사진 것 빌리지 않기); 원본 파일은 finally 삭제. `CaptureActionPanel` 은 Flutter `capture_screen.dart` 의 문구·키 그대로(`document-scan`·`photo-capture`·`scanner-not-ready`·`capture-status`) |
| 보낼 기록·사진 상세 | `lib/ui/record/record_screens.dart` — `RecordHome`(목록: 미리보기 72dp·제목·촬영시각·현장·"주석 n · 메모 n · 음성 n"·상태, 빈 문구, loadError 재열기, 하단 `ActionDock` 안 `CaptureActionPanel`)·`PhotoDetail`(가로 1000dp 이상 2단, 미리보기·상태·메시지·오프라인/불명/재로그인 안내·시각·주소·좌표·"원문 OCR 보기"·딸린 항목 카드(잉크 미리보기/메모 본문/음성 길이·[지우기])·하단 [주석 그리기][메모·음성 붙이기][전송][삭제] 각 최소 160×64dp·삭제 확인 대화상자 문구·완료되면 목록으로 자동 복귀) | 2a 에서 [주석 그리기]·[메모·음성 붙이기] 는 **활성 조건은 원본대로 계산하되 누르면 스낵바 "다음 단계(2b)에서 옮깁니다"**. `clearLocalRecordDrafts` 키 목록은 그대로 |
| 전송 상태 | `lib/ui/outbox/outbox_screen.dart` — 안내 4줄·"서버 상태 다시 조회"·30초 안내·필터 칩(전체/대기/진행/실패/결과 불명/재로그인 필요/완료)·작성 현장 칩·그룹별 카드(종류·제목·딸림 표시·상태·메시지·현장 ID·작업 ID·불명 안내·버튼: 서버 상태 재조회/같은 작업 재시도/관제웹 미등록 확인 후 재시도(대화상자 문구)/전송/다시 로그인)·화면 진입·전경 복귀 자동 조회·전경 복귀 시 purgeExpired | 문구·키(`outbox-list`·`outbox-lookup-all`·`outbox-lookup-message`·`outbox-<id>`·`outbox-status-<id>`) 그대로 |
| 실행 묶음 위치 | `lib/ui/shell/action_dock.dart`·`lib/data/action_placement.dart`(계정별 `settings:action-side`, 기본 right, 폭 min(480, 90%), 시스템 제스처 인셋 런타임 반영, 높이 50% 넘으면 안쪽 스크롤) | `ActionDock` 컴포저블 + `ActionPlacement`(설정 화면 토글은 4단계, 2a 는 읽기만) |
| 셸 연결 | `field_shell.dart` — 기록 탭은 자체 내비게이션 스택(목록→상세→카메라), 뒤로가기는 스택 먼저, 탭 전환 시 스택 유지, 수신 바 문구는 이미 1단계 | 기록 탭에 `NavHost`(navigation-compose) |
| 모의 | `lib/data/mock/mock_gateway.dart` 의 upload/comment/lookup 시나리오 | `MockGateway` 확장(모의 전송 완료 문구 `mockCompletedLabel`) |
| 테스트 | `test/outbox_test.dart`·`outbox_bundle_test.dart`·`hold_bundle_contract_test.dart`·`record_contract_test.dart`·`operation_lookup_test.dart`·`capture_ocr_test.dart`·`capture_site_id_test.dart`·`capture_time_test.dart`·`hold_bundle_ui_test.dart`(목록·상세·전송·삭제 부분만; 편집기·입력 부분은 2b) | JVM 으로 옮기고(어느 Dart 테스트인지 주석), UI 는 androidTest(mock 주입: 촬영 대신 `enqueue` 로 사진을 심어 목록·상세·전송·삭제 확인) + 프리뷰 스크린샷 2(보낼 기록·사진 상세) |

## 2. 수용 기준
1. 촬영/스캔 → 전송함 `photo/waiting`, 서버 호출 0회. 사진 1장이면 상세로, 여러 장이면 목록으로.
2. 상세 [전송] → 사진 → (완료 확인) → 딸린 항목 순서. 사진 결과 불명이면 딸린 항목 대기 문구. 완료 즉시 바이트·미리보기·초안 키 삭제, 메타는 남고 목록에서 사라짐.
3. 전송 상태: 필터·그룹·조회·재시도·미등록 확인 흐름이 원본 문구 그대로. 재로그인 필요 항목의 [다시 로그인] = `signOut()`.
4. 오프라인: 촬영·보관은 되고 [전송]·[재시도] 비활성, 문구 원본대로.
5. 기존 Flutter 앱이 남긴 기기 원장(`outbox:v1`) JSON 을 그대로 읽는다(같은 키·같은 필드). 단 저장 경로 루트는 새 앱 것.
6. 회전·탭 전환에 스택·스크롤 유지.

## 3. 문서
- `README.md` 에 2a 절(구조·범위·2b 로 넘긴 것·미확인). `plan-draft/astra-done.txt` 에 덧붙이기(기존 유지). 못 돌려본 것은 "미확인". Gradle·네트워크 금지. 문구 변경 금지.
