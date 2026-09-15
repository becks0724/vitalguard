# N-3 앱 미디어 중복 방지 계약

2026-09-14 태곤 님 승인. 앱 O 전송 상태·재시도 화면의 필수 선행 계약.
적용 엔드포인트: `POST /api/app-media` (`multipart/form-data`).

## 앱이 보낼 값

- 선택 문자열 필드 **`clientOperationId`**: 앞뒤 공백 없는 1~128자, 필드는 한 번만 전송한다.
  새 전송 작업을 만들 때 **UUID v4**를 생성하고 파일·메타데이터와 함께 전송 큐에 영속 저장한다.
- 최초 전송, 자동/수동 재시도, 타임아웃 후 재전송, 앱 재시작 후 큐 복구 모두 **같은 ID**를 사용한다.
  네트워크 요청을 만들 때마다 UUID를 새로 만들면 중복 방지가 작동하지 않는다.
- 새 사진, 새 잉크본, 새 음성 댓글은 각각 **새 UUID**를 사용한다. 같은 사진의 잉크 수정본도 새 작업이다.
  서로 다른 사용자·단말·종류·원본 사이에서 ID를 재사용하지 않는다.
- 재시도에는 기존 파일과 메타데이터를 함께 보낸다. 특히 `capturedAt`, `dateKey`,
  `annotationOf`/`commentOf`를 보존한다. 이 API는 파일 없는 상태 조회 API가 아니다.
- 인증 방식은 기존대로다. 잉크는 원본 소유권이 확인되는 앱 JWT,
  음성 댓글은 작성자 신원이 있는 앱 로그인 JWT가 필요하다.

```text
POST /api/app-media
Authorization: Bearer <앱 로그인 JWT>
Content-Type: multipart/form-data; boundary=<클라이언트가 생성>

clientOperationId=6a430471-65f2-4f67-897c-8bbefc980cab
file=<원래 파일 바이트>
dateKey=2026-09-14
capturedAt=2026-09-14T12:00:00+09:00
```

사진은 기존 이미지 파일, 잉크는 최상위 정수 `v`가 있는 JSON 파일과 `annotationOf=<원본 ID>`,
음성은 m4a/aac 파일과 `commentOf=<원본 사진 ID>`를 보낸다. 음성 길이는 선택 필드 `audioMs`다.
작업 ID에 별도 HTTP 헤더나 snake_case 별칭은 제공하지 않는다.

## 성공·재시도 처리

최초 성공은 HTTP **200**, 사진/잉크는 다음 형식이다.

```json
{"ok":true,"media":{"id":"서버 행 ID","client_operation_id":"작업 ID"},"clientOperationId":"작업 ID","deduplicated":false}
```

중복도 HTTP **200**이며 `deduplicated`만 **true**가 된다. `media`는 기존 행의 전체 결과다.
위 예제에서는 행의 나머지 필드를 생략했다. 서버 행 ID·저장 키·생성 시각을 다시 만들거나
재전송된 메타데이터로 덮어쓰지 않는다. 음성 댓글은 `media` 대신 기존 `comment` 전체 행을 반환한다.
새 응답 메타데이터는 camelCase, 기존 행 객체는 기존 DB snake_case 표현을 유지한다.

앱은 `ok: true`이면 전송 완료로 처리하고 반환된 `media.id` 또는 `comment.id`를 저장한다.
`deduplicated: true`는 “이미 전송 완료됨”을 표시할 수 있는 성공 신호다.
응답을 받지 못했거나 전송이 실패하면 같은 작업 ID로 재시도한다.

필드를 아예 보내지 않으면 기존 동작을 유지한다. 응답 상위 구조는 `{ok, media}` 또는
`{ok, comment}`이며, 동일 파일을 두 번 보내도 두 행이 생긴다.
빈 값·공백·128자 초과·중복 필드·파일 형태의 작업 ID는 **400**이다.
잘못된 ID를 키 미전송으로 처리하여 중복 방지를 생략하지 않는다.
기존 파일 검증·인증·권한 검사는 중복 요청에도 적용한다.

## DB·스토리지 계약

컬럼: 두 테이블의 nullable **`client_operation_id TEXT`**.
아래 DDL은 `lib/db.ts`의 `ensureSchema → initSchema`에만 추가했다.
배포 후 기존 스키마 초기화 경로에서 적용하며 별도 라이브 DDL 실행은 하지 않는다.

```sql
ALTER TABLE calendar_media ADD COLUMN IF NOT EXISTS client_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calmedia_client_operation_id
  ON calendar_media(client_operation_id) WHERE client_operation_id IS NOT NULL;

ALTER TABLE calendar_media_comment ADD COLUMN IF NOT EXISTS client_operation_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_calmedia_comment_client_operation_id
  ON calendar_media_comment(client_operation_id) WHERE client_operation_id IS NOT NULL;
```

기존 행·키 미전송 행은 NULL로 남아 부분 인덱스에서 제외된다.
사진·잉크는 `calendar_media`의 동일 키 공간, 음성 댓글은 `calendar_media_comment`의 키 공간이다.
앱은 종류를 포함한 모든 새 작업에 별도의 UUID를 발급한다.
중복 판정은 해당 행이 보존되는 동안 유효하며, 삭제된 행에 대한 별도 영구 작업 이력은 만들지 않는다.

작업 ID가 있는 요청의 처리 순서:

1. 기존 행 조회에서 발견하면 즉시 반환한다. PUT·INSERT를 생략한다.
2. 없으면 전용 DB 연결에서 `BEGIN → INSERT → 파일 PUT → COMMIT`을 실행한다.
   PUT 동안에는 미커밋 행이 일반 조회에 보이지 않는다.
3. 동시 INSERT의 패자는 DB 유일 인덱스에서 대기한다. 승자 커밋 후 해당 인덱스의
   `23505`를 받으면 `ROLLBACK`하고 연결을 반환한 뒤 새 조회로 기존 행을 반환한다.
   **패자는 PUT을 호출하지 않으므로 중복에 따른 고아 파일이 생기지 않는다.**
4. PUT 실패는 502이고 INSERT도 롤백된다. 같은 ID의 다음 요청이 다시 저장할 수 있다.
   PK 충돌 등 다른 DB 오류는 중복 성공으로 바꾸지 않는다.

이 방식은 파일 업로드 동안 DB 연결·트랜잭션을 유지한다.
키가 없는 요청은 기존 `PUT → INSERT` 순서다.
검증은 실제 함수 원문에 모의 SQL·스토리지를 주입하며 라이브 DB/스토리지에 접근하지 않는다.
