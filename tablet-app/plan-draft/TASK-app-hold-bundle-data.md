# 작업 지시 — 앱 데이터층: 전송 묶음(bundle)·텍스트 메모 항목·완료 정리·7일 만료 (S1)

작성: Claude / 수신: 코덱스(astra) / 2026-09-17
근거: `../plan-draft/SPEC-r7-hold-until-send.md` §1·§3·§4·§5·§8 — **먼저 읽어라.**

---

## ⛔ 작업 경로

```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/tablet-app/app/vitalguard_field
```

⛔ 커밋 금지 · 새 패키지 금지 · `lib/ui/**` 수정 금지(UI 는 다음 단계 S2) · 서버 폴더 금지
⛔ **기존 동작을 바꾸지 마라.** 이 단계는 "새 능력을 더하는" 단계다. 기존 테스트 **553 건이 그대로 통과**해야 한다(테스트 수정은 시그니처 변경으로 불가피한 것만).
⚠ `flutter test` 는 네 샌드박스에서 못 돈다(소켓 차단). **`dart analyze` 까지만** 네가 돌리고, 테스트는 작성만 해라 — 내가 돌린다. 그래서 **테스트가 한 번에 통과하도록** `test/flutter-test-pump-trap` 규칙을 지켜라: `completeError` 뒤엔 `pumpAndSettle`, `scrollUntilVisible` 은 `.first`.

---

## 1. `LocalStore` 확장 (`lib/data/contracts/field_contracts.dart:81`)

```dart
Future<void> remove(String accountId, String key);
Future<List<String>> keys(String accountId);
```
- `DeviceLocalStore`(`lib/data/live/device_services.dart`): 파일 배치는 `accounts/<base64url(계정)>/entries/<base64url(키) 를 80자씩 '/' 로 쪼갠 경로>/value` 다(`_file()` 참고). `keys()` 는 `entries/` 아래를 **재귀로 걸어 `value` 파일까지 내려간 뒤 경로 조각을 이어 붙여 base64url 디코드**한다. 디코드 실패 조각은 건너뛴다. `remove()` 는 `value` 파일과 **비게 된 상위 폴더**를 지운다(`entries/` 자체는 남긴다). 둘 다 `_pending` 직렬화를 탄다(기존 write 와 같은 규칙).
  → 경로 조각 ↔ 키 변환은 **순수 함수로 분리**해 단위 테스트가 되게 해라(채널 없이).
- `MemoryStore`(`lib/data/mock/memory_store.dart`): 맵 삭제·키 목록.

## 2. 전송함 (`lib/data/outbox_controller.dart`)

### 2-1. 모델
- `OutboxKind.text` 추가 — `kindLabel` `'메모'`. bytes = UTF-8 본문.
- `OutboxEntry` 에 `final String? dependsOn;` `DateTime? completedAt;` `final List<String> draftKeys;`(기본 `const []`) 추가. `toJson`/`fromJson` 왕복(없으면 null / 빈 목록). `schemaVersion` 1 그대로.
- `enqueue(... String? dependsOn, List<String> draftKeys = const [])`. 딸린 항목(`dependsOn != null`)의 `fields` 에 `annotationOf`·`commentOf`·`mediaId` 가 들어오면 **ArgumentError** — 참조는 전송 시 합성한다(§2-3).
- `CalendarMedia fromOutbox(OutboxEntry photo)` 를 `lib/data/models/record_origin.dart` 에 top-level 함수로: SPEC §3 의 json(`local: true`). `photo.kind != OutboxKind.photo` 면 ArgumentError.

### 2-2. 묶음 조회
- `List<OutboxEntry> dependents(String photoId)` — `dependsOn == photoId`, `createdAt` 오름차순.
- `OutboxEntry? parentOf(OutboxEntry item)`.
- `bool bundleCompleted(String photoId)` — 사진과 딸린 항목 전부 `completed`.

### 2-3. 전송
- `send(item)` 은 그대로 두되, **딸린 항목이면** 부모가 `completed` 가 아닐 때 `sendBundle(parent.id, retry: retry)` 로 넘긴다. 부모가 없으면 `failed` + 문구 `'원본 사진 항목이 없습니다'`.
- 전송 직전 참조 합성(기기 보관 `fields` 는 바꾸지 않는다):
  - `ink` → `annotationFields(CalendarMedia(parent.receipt!))`(기존 함수, `record_origin.dart`) 에 항목 `fields` 를 덮어쓴다(항목 필드 우선). 결과에 `clientOperationId` 는 항목 id.
  - `voice` → `field.voiceComment(parent.receipt!['id'], bytes, durationMs: fields['audioMs'], clientOperationId: item.id, siteId: item.siteId)`.
  - `text` → `field.comment(parent.receipt!['id'], utf8.decode(bytes), clientOperationId: item.id)`. 결과 `receipt = result.json`, `deduplicated = result.deduplicated`.
  - `parent.receipt?['id']` 가 `String` 이 아니면 그 항목은 `waiting` 유지 + 문구 `'원본 사진 결과 확인 후 전송됩니다'`, 전송하지 않는다.
- `Future<void> sendBundle(String photoId, {bool retry = false})`: 사진이 `completed` 가 아니면 `send(사진, retry: retry)` → 여전히 아니면 딸린 항목 전부에 위 문구를 적고 저장 후 반환. 사진이 `completed` 면 딸린 항목을 `createdAt` 순으로 `completed` 가 아닌 것만 `send(…, retry: retry)`. 하나가 실패해도 **다음 항목은 계속** 보낸다. 끝나면 `_cleanupBundle(photoId)`.
- `completed` 로 바뀌는 모든 곳에서 `completedAt = DateTime.now()`(send 성공·조회 `registered`).
- 자동 전송·자동 재전송은 추가하지 않는다(N-3·N-4 그대로).

### 2-4. 조회에서 행 id
- `OperationCheck.receipt` 를 `lookupOperations` 가 채운다: 서버가 `registered` 와 함께 `id` 를 주면 `{'id': id}`. `live_gateway.dart:40~` 파서에 `id` 는 **선택**(없으면 지금처럼). mock 도 같은 형태.
- 조회 결과 처리(`outbox_controller.dart:480~`)에서 `registered` 면 `item.receipt ??= check.receipt`, `completedAt` 기록.

### 2-5. 정리
- `_cleanupBundle(photoId)`: `bundleCompleted` 일 때만. 묶음의 모든 항목에 대해 `outbox-file:<id>`·`outbox-preview:<id>`·`draftKeys` 를 `local.remove`. 사진 receipt id 로 `photo:<서버id>`·`published:<서버id>` 도 제거. 메타는 남긴다. **`_cacheInkReceipt` 는 `dependsOn` 이 있는 항목에는 호출하지 않는다**(재편집 없음).
- `Future<void> discard(String id)`: `waiting`·`failed` 만 허용(그 외 `StateError`). 사진이면 딸린 항목도 같은 규칙으로 함께(딸린 항목 중 하나라도 허용 밖이면 전체 거부). 바이트·미리보기·`draftKeys` 제거 후 원장에서 항목 삭제·저장.
- `Future<int> purgeExpired({Duration keep = const Duration(days: 7), DateTime? now})`: `completed && (completedAt ?? createdAt) + keep < now` 인 항목을 삭제(바이트·미리보기·초안 키 포함) → 삭제 수 반환. `load()` 끝에 한 번 호출한다.

## 3. 컨트롤러·게이트웨이

- `FieldController.comment(String mediaId, String text, {String? clientOperationId})` — 시그니처 확장(호출부 `lib/ui/**` 는 손대지 않는다: 선택 인자라 컴파일된다). `MediaComment` 에 `clientOperationId`·`deduplicated` 가 이미 있으니 그대로 채운다.
- `FieldGateway.addComment(token, mediaId, text, {clientOperationId})` — live: 본문 `{'mediaId', 'body', 'clientOperationId': ?clientOperationId}`, 응답에서 `clientOperationId`·`deduplicated` 읽기(음성 댓글 파서와 같은 방식). mock: 같은 키 두 번이면 같은 행 + `deduplicated: true`.
- `field_coordinator.dart` 의 `comment()` 는 `_authorized(..., writing: true)` 그대로.

## 4. 테스트 (작성만 · 내가 돌린다)

- `test/local_store_keys_test.dart`(신규): 경로 조각↔키 순수 함수 왕복(한글 키·80자 넘는 키·잘못된 조각) · MemoryStore keys/remove
- `test/outbox_bundle_test.dart`(신규): SPEC §8 의 3·4·5·6·7·9 를 데이터층에서 — mock 컨트롤러로
  · 사진→잉크→메모→음성 순서와 각 요청의 `annotationOf`/`commentOf`/`mediaId` = 사진 receipt id, 메모 `clientOperationId` = 항목 id
  · 사진 uncertain → 딸린 항목 전송 0회·문구 · 조회 `registered`+`id` 후 `sendBundle` 이어짐
  · 사진 4xx → 딸린 항목 대기 · 재시도 같은 ID
  · 묶음 완료 즉시 바이트·미리보기·draftKeys 삭제 · 메타 잔존
  · `purgeExpired` 7일 경과 삭제 / 6일 유지
  · `discard` 사진→딸린 항목 동반 / `uncertain`·`completed` 거부
  · 딸린 항목 enqueue 에 참조 필드 넣으면 ArgumentError
- `test/record_contract_test.dart` 또는 적절한 계약 테스트: 텍스트 댓글 본문에 `clientOperationId` 실림 · 조회 응답 `id` 파싱
- 기존 테스트는 시그니처 변경으로 깨지는 것만 고쳐라.

## 5. 끝나면 답변에 적어라 (`astra-done.txt` 는 내가 적는다)

- 바꾼 파일과 줄 수(`git diff --stat`)
- `dart analyze` 결과
- 새 테스트 파일과 케이스 수
- `_cacheInkReceipt`·`_save`·`_serial` 등 기존 경로에 손댄 곳과 이유
- 네가 임의로 정한 것 전부 · 확신 없는 것("미확인")
