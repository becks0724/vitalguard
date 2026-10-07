O-01~O-04 구현 보고 (2026-09-14)

전송 상태 탭(destination 3)을 실제 목록으로 교체했다. 사진·잉크본·음성 댓글의 대기/처리 중/실패/결과 불명/재로그인 필요/완료를 계정과 작성 당시 현장별로 표시한다.

중요한 남은 계약: 제공된 서버 계약은 POST /api/app-media뿐이다. 작업 ID로 결과를 조회하는 GET 경로·응답은 제공되지 않아 LiveGateway에 조회 엔드포인트를 임의로 만들지 않았다. OperationLookupGateway/OperationCheck 확장 지점과 등록/미등록/불명 분기는 구현했다. 현재 라이브에서는 결과 불명을 유지하고, 관제웹에서 미등록을 확인한 뒤 같은 작업을 명시적으로 재시도한다. 지원하지 않는 재조회 버튼은 노출하지 않는다. 조회 능력이 제공되면 결과 불명 직후 조회를 우선하며, 미등록 확인 후에도 자동 POST하지 않는다.

작업 ID와 영속 보관

- OutboxController.enqueue에서 UUID v4를 한 번 생성한다. 원래 전송 바이트를 먼저 쓰고, 같은 UUID·파일 키·폼 필드·작성 계정·현장명·종류·작성 시각·상태·영수증을 원장에 저장한 뒤에만 POST한다.
- LocalStore의 계정별 키: `outbox:v1`(JSON 원장), `outbox-file:<UUID>`(원래 전송 파일), `outbox-preview:<UUID>`(잉크 PNG 미리보기).
- 실제 저장소는 기존 DeviceLocalStore다. 앱 dataPath 아래 `accounts/<계정 인코딩>/entries/<키 인코딩>/value`에 저장하며 `.pending` 파일을 flush한 뒤 rename하는 기존 원자 교체 방식을 사용한다. MemoryStore도 같은 계정별 계약을 따른다.
- 기존 잉크 `annotation:<draftId>` 및 음성 `voice-comment-draft:<mediaId>`에 `clientOperationId`를 추가한다. 초안 복원 시 큐의 상태가 전송 결과의 기준이다.
- 잉크 편집 revision/음성 recordingRevision을 영속화한다. 새 버전은 새 UUID다. 전송 작업 생성 직후 초안 링크 저장 전에 종료해도 같은 sourceKey와 스냅숏으로 기존 작업을 찾는다.
- 기존 작업의 재시도는 큐의 파일과 메타데이터를 직접 사용한다. UUID를 재생성하지 않는다. 앱 종료 당시 sending은 동일 ID의 uncertain으로 복원한다.
- multipart에서 clientOperationId 누락은 HTTP 전에 거절한다. 응답의 clientOperationId 일치와 deduplicated boolean을 검사하며 deduplicated:true는 완료로 처리한다.

최종 문구

- 기기 보관: `로컬 저장됨 · 서버 미전송` (목록 대기는 `· 대기` 추가).
- 진행: `로컬 저장됨 · 처리 중`.
- 실패: `로컬 저장됨 · 전송 실패`.
- 결과 불명: `로컬 저장됨 · 서버 결과 불명`.
- 실제 완료: `전송 완료 · 서버 확인됨`.
- 모의 완료: `모의 전송 완료 — 실제 서버로 보내지 않았습니다`.
- 기존 중복: `같은 작업이 이미 서버에 있습니다. 서버 확인됨.` (완료 상태).

재시도·O-02·O-04 위치

- 공통 전송/재시도: lib/data/outbox_controller.dart의 send. 전송 상태 화면의 전송/같은 작업 재시도 버튼, 기존 잉크 저장 및 음성 댓글 전송에서 사용한다. 명시적 401 갱신 시에도 같은 필드를 재사용한다.
- N-4: verify의 confirmed/absent/unknown 분기. 결과 불명과 중단된 sending은 send 진입을 차단한다. 현재 라이브의 수동 미등록 확인은 confirmAbsent 경로다.
- O-02: OutboxPhase.reauthenticate 및 outbox_screen.dart의 재로그인 필요 필터·안내·다시 로그인 버튼. 원장은 작성 계정에 보존되고, 같은 계정으로 다시 로그인한 뒤 재개한다.
- O-04: OutboxController.account/items/_owned에서 현재 인증 계정만 조회·전송한다. fields와 siteName은 작성 당시 값으로 고정한다. outbox_screen.dart에서 현장 필터와 그룹을 표시한다.
- 현장 정보의 일별 스냅숏 id를 현장 ID로 바꾸어 쓰지 않았다. 원본/촬영 메타데이터의 siteId를 유지한다. 옛 초안에 현장명이 없으면 `작성 현장명 미기록`으로 표시한다.

기존 잉크 보존 확인

기존 schemaVersion 1, annotation-base 원본, 획 복원·지우개·되돌리기·2 MiB 제한, published 별칭 및 photo PNG 키를 유지했다. 전송 상태 탭에서 보낸 잉크도 같은 별칭과 PNG 캐시를 작성한다. 기존 record_editor_ink_test.dart 8개를 유지하고 재시작 ID/현장 고정 및 새 버전 ID 검증을 보강했으며, 동일 작업 재시도와 전송 상태에서 보낸 게시본 재편집 테스트 2개를 추가했다. 이 확인은 코드 검토와 정적 분석까지이며 Flutter 실행 통과를 주장하지 않는다.

검증

- `/opt/homebrew/share/flutter/bin/cache/dart-sdk/bin/dart analyze`: `No issues found!`, 종료 코드 0. 일반 dart 실행 래퍼가 SDK 캐시 쓰기에 막혀 같은 SDK의 Dart 실행 파일을 직접 사용했다.
- `flutter test`는 사용자 지시에 따라 시도하지 않았다.
- 기준선 305 + 신규 테스트 29 = 예상 334. 이는 실행 결과가 아니다.
- completeError 이후 검증에는 pumpAndSettle을 사용했다. 신규 scrollUntilVisible은 scrollable: find.byType(Scrollable).first를 사용한다.
- 변경 전 사본과 바이트 비교로 alerts_controller, alerts_screen, site/workers/gas 화면 및 관련 테스트가 그대로임을 확인했다. 서버 파일 변경·패키지 설치·커밋은 하지 않았다.

임의 결정

- 주기적/연결 복구 자동 전송을 추가하지 않았다. 오프라인 대기와 명시적 재시도로 구성하고, 언제 다시 보내는지 화면에 안내한다.
- 사진은 촬영 처리 시, 잉크는 저장 시, 음성은 전송 버튼을 눌렀을 때 큐에 등록한다. 편집 중 미확정 획과 전송을 아직 누르지 않은 녹음은 기존 초안 저장을 유지한다.
- 완료 원장과 전송 파일은 자동 삭제하지 않는다. 보존 기간/용량 정리 정책은 새로 정하지 않았다.
- 일정 및 글 댓글 API에 중복 방지 계약을 추정 적용하지 않았다. 이번 큐 작업 종류는 요청한 사진·잉크본·음성 댓글뿐이며, 경보 대응 확인은 큐에 들어가지 않는다.

변경 파일·줄 수

코드/테스트 20개, +1825/−121줄. 아래 수치는 작업 시작 사본 대비 추가/삭제 줄이며, 이 보고서 파일은 별도다.

| 파일 | 추가 | 삭제 | 최종 줄 수 |
|---|---:|---:|---:|
| `lib/data/contracts/field_contracts.dart` | 18 | 0 | 154 |
| `lib/data/field_coordinator.dart` | 23 | 1 | 593 |
| `lib/data/live/live_gateway.dart` | 28 | 3 | 590 |
| `lib/data/mock/mock_gateway.dart` | 32 | 2 | 407 |
| `lib/data/models/server_models.dart` | 12 | 2 | 131 |
| `lib/data/outbox_controller.dart` | 466 | 0 | 466 |
| `lib/ui/outbox/outbox_screen.dart` | 284 | 0 | 284 |
| `lib/ui/record/capture_ocr.dart` | 32 | 2 | 446 |
| `lib/ui/record/capture_screen.dart` | 53 | 21 | 453 |
| `lib/ui/record/record_editor.dart` | 66 | 22 | 833 |
| `lib/ui/record/record_input.dart` | 5 | 1 | 602 |
| `lib/ui/record/voice_comment_draft.dart` | 71 | 13 | 418 |
| `lib/ui/shell/field_shell.dart` | 2 | 26 | 612 |
| `test/capture_ocr_test.dart` | 1 | 1 | 301 |
| `test/ink_upload_test.dart` | 38 | 10 | 251 |
| `test/nav_rail_test.dart` | 2 | 1 | 135 |
| `test/outbox_test.dart` | 509 | 0 | 509 |
| `test/record_editor_ink_test.dart` | 60 | 0 | 419 |
| `test/voice_comment_test.dart` | 42 | 2 | 561 |
| `test/voice_upload_test.dart` | 81 | 14 | 374 |

추가 테스트 전체 목록

1. `test/ink_upload_test.dart` — deduplicated:true 잉크 응답도 같은 작업의 완료 영수증이다
2. `test/ink_upload_test.dart` — 작업 ID 없는 multipart는 HTTP 전에 차단한다
3. `test/outbox_test.dart` — 재시도는 같은 UUID·원본 바이트·메타데이터를 사용한다
4. `test/outbox_test.dart` — 401 자동 인증 갱신에도 같은 작업 ID와 파일을 쓴다
5. `test/outbox_test.dart` — 새 컨트롤러 복원 뒤에도 UUID와 원래 파일·현장을 유지한다
6. `test/outbox_test.dart` — DeviceLocalStore 새 인스턴스도 디스크의 같은 ID·파일·현장을 복원한다
7. `test/outbox_test.dart` — 보관 뒤 호출자의 배열·메타데이터 변경은 원본에 영향을 주지 않는다
8. `test/outbox_test.dart` — 새 사진·새 잉크본·새 음성은 서로 다른 UUID이고 원본 연결을 보존한다
9. `test/outbox_test.dart` — 큐 링크를 저장하기 전 종료해도 동일한 편집 스냅숏은 기존 UUID를 찾는다
10. `test/outbox_test.dart` — deduplicated:true는 실패가 아니라 서버 확인된 완료다
11. `test/outbox_test.dart` — 결과 불명은 서버 재조회가 우선이며 미등록 확인 후에도 자동 POST하지 않는다
12. `test/outbox_test.dart` — 서버 재조회가 등록을 확인하면 POST 없이 완료로 바꾼다
13. `test/outbox_test.dart` — 재조회 결과가 불명인 작업은 재시도 호출과 재시작에서도 POST하지 않는다
14. `test/outbox_test.dart` — 앱 종료 당시 sending은 같은 ID의 결과 불명으로 복원한다
15. `test/outbox_test.dart` — 재로그인 필요 항목을 보관하고 다른 계정에는 표시·전송하지 않는다
16. `test/outbox_test.dart` — 다른 계정으로 전환한 뒤 도착한 응답은 이전 계정에만 보관한다
17. `test/outbox_test.dart` — 로컬 영속 저장 실패는 큐 생성과 HTTP 전송을 막는다
18. `test/outbox_test.dart` — 전송 중 연타는 하나의 POST만 허용한다
19. `test/outbox_test.dart` — 경보 대응 확인은 오프라인에서도 전송 큐 항목을 만들지 않는다
20. `test/outbox_test.dart` — 로컬 저장됨과 서버 전송 완료를 분리하고 작성 현장으로 묶는다
21. `test/outbox_test.dart` — 실패 응답 뒤 같은 작업 재시도 버튼으로 복구한다
22. `test/outbox_test.dart` — 모의 완료는 실제 서버로 보내지 않았다는 문구를 표시한다
23. `test/outbox_test.dart` — 재로그인 필요 필터와 현장 필터는 현재 계정의 항목만 표시한다
24. `test/outbox_test.dart` — 결과 불명 항목은 재조회 뒤에도 사용자 실행 전 재전송하지 않는다
25. `test/outbox_test.dart` — 전송 상태 탭 destination 3에서 실제 목록이 열린다
26. `test/record_editor_ink_test.dart` — 잉크 명시적 실패 재시도는 같은 ID·JSON·원본 연결로 전송한다
27. `test/record_editor_ink_test.dart` — 전송 상태에서 잉크를 보내도 기존 게시본 별칭·PNG·획 복원이 유지된다
28. `test/voice_comment_test.dart` — 새 음성 댓글은 내용이 같아도 새 UUID이고 원본 commentOf는 유지한다
29. `test/voice_upload_test.dart` — deduplicated:true 음성 응답은 실패가 아닌 완료다
