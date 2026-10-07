# SPEC R-7 — 전송 보류 묶음: 촬영 → 주석·메모·음성 → 한 번에 전송, 전송 뒤엔 태블릿에서 끝

> 작성 2026-09-17 · 근거: 태곤 님 결정(계약 질문지 Q12) — *"7일로 선택하고 전송이 끝난 사진 원본은 웹에서만 볼 수 있게 하고 더 이상의 노트 메모는 안 되게 해"* + A 방식(열람·주석·댓글 전부) + 전송 전 묶음 흐름까지 이번에.
> 기준 앱 커밋 `5d4b2458` · 서버 리비전 `00392-6dq`.

## 0. 지금 vs 바뀌는 것

| | 지금 | 바뀐 뒤 |
|---|---|---|
| 촬영 직후 | 사진이 **즉시 서버로 전송**된다 | 사진은 **기기에 보류**된다(전송함 `waiting`) |
| 주석·메모·음성 | **서버에 올라간 사진**을 기록 탭(캘린더)에서 열어 붙인다 | **보류 중인 로컬 사진**에 붙인다 |
| 전송 | 항목마다 따로 | 사진 상세의 **[전송]** 한 번 — 사진 → 잉크 → 메모 → 음성 순서로 전송함이 보낸다 |
| 전송 뒤 | 태블릿에서 열람·재편집·댓글 추가·수정·삭제 가능 | **태블릿에서는 끝.** 원본·잉크·음성 바이트를 즉시 지우고 기록 탭에서 사라진다. 열람·추가 메모는 관제웹 |
| 기록 탭 | 서버 캘린더(월/주) + 서버 사진 상세 + 댓글 목록 | **보낼 기록 목록**(보류 묶음) + 로컬 사진 상세 |
| 전송 상태 | 항목별 상태 | 같음 + 묶음 표기, **7일 지난 완료 항목은 자동 삭제** |
| 기기 보관 | 무기한 | 완료 즉시 바이트 삭제 · 메타 7일 · 작업자 생체·위치는 원래 없음 |

## 1. 용어

- **묶음(bundle)** = 원본 사진 1장 + 딸린 항목(잉크 0~1 · 텍스트 메모 0~n · 음성 0~n). 묶음 id = 원본 사진의 전송함 항목 id(`clientOperationId`).
- **딸린 항목** = `dependsOn = <사진 항목 id>` 인 전송함 항목. 서버 참조 필드(`annotationOf` / `commentOf` / `mediaId`)는 **전송 시점에 원본의 서버 id 로 채운다**(기기 보관 필드에는 없다).

## 2. 흐름

1. **촬영/스캔** → `CapturePipeline.upload()` 는 **enqueue 만**(전송 없음). 결과는 `queued` 로 집계. 사진 1장이면 곧바로 그 사진의 로컬 상세로 들어간다. 스캔 여러 장이면 기록 탭 목록으로.
2. **기록 탭(RecordHome)** = 이 계정의 전송함 중 `kind=photo && phase != completed` 항목 목록(최신 순). 서버 호출 없음. 각 줄: 미리보기·제목·촬영시각·현장·딸린 항목 수·상태.
3. **로컬 사진 상세(PhotoDetail)** = `outbox-file:<id>` 바이트 표시 + 딸린 항목 목록(잉크 미리보기 / 메모 본문 / 음성 길이) + 버튼 **[주석 그리기] [메모·음성 붙이기] [전송] [삭제]**. 삭제는 전송 전(`waiting`·`failed`)에만, 사진 삭제 = 딸린 항목도 삭제.
4. **주석(RecordEditor)** — 원본은 **로컬 스텁** `CalendarMedia`(§3). 저장 = 잉크 항목 enqueue(`dependsOn`) **전송 없음**. 편집기 안의 전송·`sent` 재편집 경로는 없앤다. 리비전마다 새 작업(기존 규칙)이되 **이전 리비전 잉크 항목은 대체**(같은 묶음에 잉크는 1개).
5. **메모·음성(RecordInput / VoiceCommentDraft)** — 텍스트 = 새 kind `text`(bytes = UTF-8 본문) enqueue(`dependsOn`), 음성 = kind `voice` enqueue(`dependsOn`, `commentOf` 없음). **전송 버튼 없음**(묶음 전송으로 일원화). 전송 전에는 다시 열어 고치거나 지울 수 있다.
6. **[전송] = `outbox.sendBundle(photoId)`** — 순서: 사진 → (사진 `completed` 확인) → 딸린 항목을 만든 순서대로. 각 항목은 기존 `send()` 규칙(N-3·N-4) 그대로. 사진이 `uncertain`/`failed`/`reauthenticate` 면 딸린 항목은 `waiting` 유지 + 문구 "원본 사진 결과 확인 후 전송됩니다". 자동 전송·자동 재전송은 여전히 **없다**.
7. **원본 서버 id 확보** — `사진.receipt['id']`. 사진이 결과 불명이었다가 `operation-status` 로 `registered` 가 되면 서버가 함께 주는 `id` 를 receipt 로 삼는다(서버 S0 변경). 없으면 딸린 항목은 계속 대기.
8. **완료 정리** — 묶음의 모든 항목이 `completed` 가 된 순간: `outbox-file:*`·`outbox-preview:*`·`photo:*`·`published:*`·해당 초안 키 전부 삭제, `completedAt` 기록. 메타(receipt 포함)는 전송 상태에 남는다.
9. **7일 만료** — 앱 시작(전송 원장 load)·전경 복귀 시 `purgeExpired()`: `completedAt + 7일 < now` 인 항목 삭제(잔여 키 포함). **1회성 정리**: 예전 버전이 남긴 `calendar:*`·`photo:*`·`published:*` 키를 계정 폴더에서 전부 삭제.
10. **복구(RecordSession)** — 재로그인 뒤 열려 있던 편집기/입력은 로컬 스텁으로 복귀. 그 묶음이 이미 완료·삭제됐으면 세션만 닫는다.
11. **오프라인** — 촬영·주석·메모·음성 전부 로컬. [전송] 은 온라인일 때만 활성. 기존 원칙.

## 3. 로컬 스텁 `CalendarMedia`

전송함 사진 항목 → `CalendarMedia.fromOutbox(entry)`:
`{ id: entry.id, date_key, captured_at, title, site_id, ocr_text, road_address, latitude, longitude, media_url: null, thumbnail_url: null, local: true }` (값은 `entry.fields` 에서).
`FieldController.photoBytes(media)` 는 **로컬 전용**이 된다: `local.readBytes(owner, 'outbox-file:${media.id}')`, 없으면 `ApiFailure('원본이 기기에 없습니다')`. 서버 다운로드 경로(`media_url`·`gateway.image`) 삭제.

## 4. 전송함 변경 (`outbox_controller.dart`)

- `OutboxKind` 에 `text` 추가. `kindLabel` '메모'.
- `OutboxEntry` 에 `dependsOn: String?`, `completedAt: DateTime?` 추가(JSON 왕복, `schemaVersion` 1 유지 — 없는 필드는 null).
- `enqueue(... dependsOn:)`. 딸린 항목의 `fields` 에 참조 필드를 **넣지 않는다**(전송 시 합성). `siteId` 는 사진 항목 것을 복사.
- `sendBundle(photoId)` §2-6. `send(item)` 은 딸린 항목이면 부모 `completed` 가 아닐 때 **부모부터 보낸다**(전송 상태 화면의 재시도 버튼도 같은 동작).
- 전송 시 참조 합성: ink → `annotationFields(부모 receipt)`(기존 함수 재사용, `annotationOf` = 서버 id) · voice → `commentOf` = 서버 id · text → `field.comment(서버 id, 본문, clientOperationId: item.id)`.
- `discard(id)`: `waiting`/`failed` 만. 사진이면 딸린 항목도. 바이트·미리보기·초안 키 삭제.
- `_cleanupBundle`, `purgeExpired()`, 1회성 legacy 정리.
- 조회(`lookupOperations`)가 `registered` + `id` 를 주면 `receipt = {'id': id}` 로 저장(기존엔 receipt 없이 completed).

## 5. LocalStore 확장

`Future<void> remove(String accountId, String key)` · `Future<List<String>> keys(String accountId)` — `DeviceLocalStore`(디렉터리 걷기: 키는 base64url 을 80자 단위로 쪼개 하위 폴더로 만든 구조라 `value` 파일까지 재귀로 내려가 조각을 이어 붙여 복원) · `MemoryStore`.

## 6. 서버 변경 (dashboard-web · S0)

1. `POST /api/calendar/media/comment` 본문에 `clientOperationId?: string` — app-media 와 같은 규칙(1~128자·trim 불변). 있으면 `insertCalendarMediaComment(clientOperationId)` 로 멱등 삽입: 23505 면 기존 행을 200 으로 돌려주고 `deduplicated: true`. 응답 `{ ok, comment, clientOperationId?, deduplicated? }`.
2. `GET /api/app/admin/operation-status` — `registered` 항목에 **행 id** 를 함께 준다: `{ clientOperationId, status: 'registered', id }`. 소유 검사(`listOwnedAppMediaOperationIds`)는 그대로.
3. 그 외 계약 변화 없음. app-media(사진·잉크·음성) 동일.

## 7. 앱에서 없어지는 것

- 서버 캘린더: `loadPeriod`·`media`·`calendarEvents`·`calendarLabels`·`calendar:*` 캐시·게이트웨이 `media/events/labels/image`.
- 서버 사진 열람·댓글 목록·댓글 수정/삭제(`editComment`·`removeComment`·`updateComment`·`deleteComment`·PATCH/DELETE 라우트 호출).
- 편집기의 자체 전송·`sent` 재편집. 음성 초안의 자체 전송·`confirmAbsent` 흐름은 묶음 전송의 결과 불명 처리로 흡수(전송 상태 화면의 기존 미등록 확인·재시도 유지).
- 계약서 §1-4 의 GET 3개·PATCH/DELETE 는 "앱이 더 이상 부르지 않음" 으로 갱신.

## 8. 테스트(앱)

기존 553 기준. 삭제되는 UI 의 테스트는 지우고, 아래를 새로 넣는다.
1. 촬영 → 전송함 `photo/waiting`, 서버 호출 0회
2. 로컬 스텁으로 편집기·입력이 열리고 잉크/메모/음성이 `dependsOn` 으로 쌓인다(참조 필드 없음)
3. `sendBundle`: 사진 → 잉크 → 메모 → 음성 순서, 각 요청의 `annotationOf`/`commentOf`/`mediaId` = 사진 receipt id, 메모의 `clientOperationId` = 항목 id
4. 사진 `uncertain` → 딸린 항목 `waiting` 유지·전송 0회; 조회 `registered`+`id` → 이어서 전송
5. 사진 4xx `failed` → 딸린 항목 대기; 재시도 시 같은 ID
6. 묶음 완료 즉시 바이트·미리보기·초안 키 삭제, 메타는 남음
7. `purgeExpired`: 7일 지난 완료 항목 삭제 / 6일은 유지 / legacy `calendar:*`·`photo:*`·`published:*` 삭제
8. 기록 탭 목록 = 보류 묶음만, 완료된 사진 없음, 서버 호출 0
9. 삭제: 사진 삭제 → 딸린 항목 함께 / `uncertain`·`completed` 는 삭제 불가
10. 재로그인 복구: 로컬 스텁으로 편집기 복귀 / 묶음 없으면 세션 닫힘
11. 오프라인: 촬영·주석·메모 보관, [전송] 비활성

## 9. 단계

| 단계 | 담당 | 내용 |
|---|---|---|
| S0 | astra(dashboard-web) | §6 서버 2건 + 테스트 |
| S1 | astra(앱) | §3·§4·§5 데이터층 + `comment(clientOperationId)` + 조회 `id` + 게이트웨이 정리 + 테스트 |
| S2 | astra(앱) | §2 UI: 촬영 보류·기록 탭·로컬 상세·편집기/입력/음성 로컬 모드·전송 상태 묶음 표기·복구 + 테스트 |
| 검증 | claude | analyze·test·release 빌드·설치·실기기(촬영→주석→메모→음성→전송→관제웹 확인→기기 잔여 0) · 서버 배포(S0) |

## 10. 하지 않는 것
- 서버 원본·댓글 삭제 창(061 유예) 변경 — 관제웹 몫
- 다중 현장 전환 UI — 별건
- 경보 ack uuid — 신 DB 전환 시
