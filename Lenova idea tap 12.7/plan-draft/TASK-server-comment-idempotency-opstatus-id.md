# 작업 지시 — 서버: 텍스트 댓글 멱등키 + 작업 조회에 행 id (S0)

작성: Claude / 수신: 코덱스(astra) / 2026-09-17
근거: `SPEC-r7-hold-until-send.md` §6 — 태블릿 앱이 촬영 뒤 사진·잉크·메모·음성을 **묶음으로 한 번에** 보내게 바뀐다.

---

## ⛔ 작업 경로

```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/기존_조달청모듈/safetymonitor/apps/dashboard-web
```

⛔ 커밋·배포 금지 · 새 패키지 금지(`npx`·`npm install` 금지) · `verifyBasicAuth`·`ensureSchema` 의 다른 DDL 수정 금지
⛔ 다른 라우트·`lib/db.ts` 의 다른 함수 손대지 말 것 · 앱 폴더(`Lenova idea tap 12.7/app/**`) 금지
⚠ 이 트리는 팀원과 공유한다. 시작 전 `git status --short` 를 찍어 두고, **네 변경 외의 미커밋 파일은 건드리지 마라.**

---

## 1. `POST /api/calendar/media/comment` — `clientOperationId` 멱등 (`app/api/calendar/media/comment/route.ts:76`)

지금 본문은 `{ mediaId, body }` 뿐이고 `insertCalendarMediaComment` 를 `clientOperationId` 없이 부른다(`lib/db.ts:5003`).
컬럼 `calendar_media_comment.client_operation_id` 와 부분 유일 인덱스는 **이미 있다**(`db.ts:1099-1101`). 음성 댓글(app-media)은 이미 이 키로 멱등이다.

바꿀 것:
1. 본문에 선택 항목 `clientOperationId?: string` 을 받는다. 검증은 **app-media 와 같은 규칙**(`app/api/app-media/route.ts` 의 ID 규칙을 찾아 같은 함수를 쓰거나 동일하게: 문자열·1~128자·`trim()` 결과가 원문과 같아야 함). 규칙 위반은 400.
2. 있으면 `insertCalendarMediaComment({ ..., clientOperationId })` 로 넣되, **같은 키가 이미 있으면(23505) 기존 행을 200 으로 돌려준다** — `deduplicated: true`. 텍스트 댓글은 업로드가 없으므로 `insertAppMediaWithUpload` 경로가 아니다. 23505 를 잡아 `SELECT ... WHERE client_operation_id = $1` 로 기존 행을 읽어 돌려주는 헬퍼를 `lib/db.ts` 에 더해라(기존 헬퍼가 재사용 가능하면 그것을 써라 — 확인하고 보고).
   ⚠ 기존 행의 소유 검사: 다른 사람의 키와 충돌하면 그 행을 돌려주면 안 된다. app-media 가 하는 방식(`listOwnedAppMediaOperationIds` 의 소유 판정 기준)을 읽고 **같은 기준**으로 판정해, 남의 키면 409 로 거부해라.
3. 응답: `{ ok: true, comment, clientOperationId, deduplicated }`(키가 있을 때) / 없을 때는 지금 그대로 `{ ok: true, comment }`.
4. 없을 때의 동작(멱등키 없이 삽입)은 **한 치도 바뀌면 안 된다.**

## 2. `GET /api/app/admin/operation-status` — `registered` 에 행 id (`app/api/app/admin/operation-status/route.ts`)

지금은 `{ clientOperationId, status: 'registered' | 'not_registered' }` 만 준다. 앱은 사진이 결과 불명이었다가 `registered` 로 확인되면 **그 사진의 서버 id** 가 있어야 딸린 잉크·메모·음성을 보낼 수 있다.

바꿀 것:
1. `listOwnedAppMediaOperationIds(operationIds, principal)`(`lib/db.ts:4881` 부근)가 지금 `client_operation_id` 만 돌려준다. **행 id 도 함께** 돌려주게 바꿔라(`calendar_media.id` / `calendar_media_comment.id`). 반환 타입이 바뀌면 호출부를 전부 맞춰라(호출부를 grep 해서 보고).
2. 응답의 `registered` 항목에 `id: string` 을 더한다. `not_registered` 는 그대로.
3. 소유 검사 기준은 그대로.

## 3. 검증

1. 타입 검사·lint·테스트를 돌리고 **숫자로** 보고(기준선 **2067**). 명령은 `pnpm typecheck` · `pnpm lint` · `pnpm test`(package.json 확인).
2. 테스트를 더해라(기존 라우트 테스트 파일 패턴을 따라):
   - ⓐ 댓글 POST 에 `clientOperationId` → 201/200 + `clientOperationId` 회신
   - ⓑ 같은 키로 두 번 → 두 번째는 200 + `deduplicated: true` + 같은 `comment.id`, 행 1개
   - ⓒ 키 없이 두 번 → 행 2개(기존 동작 회귀)
   - ⓓ 키 형식 위반(공백·129자·빈 문자열) → 400
   - ⓔ 남의 키 → 409
   - ⓕ operation-status: `registered` 응답에 `id` 가 있고 그 값이 실제 행 id 와 같다 · `not_registered` 에는 `id` 없음 · 댓글 표의 작업도 `id` 를 준다

## 4. 끝나면 답변에 적어라 (`astra-done.txt` 는 내가 적는다)

- 바꾼 파일과 줄 수(`git diff --stat`)
- 소유 판정에 쓴 기준과 그 근거(함수·줄)
- `listOwnedAppMediaOperationIds` 호출부 목록과 각각 어떻게 맞췄는지
- 테스트 결과(숫자)
- 네가 임의로 정한 것 전부
