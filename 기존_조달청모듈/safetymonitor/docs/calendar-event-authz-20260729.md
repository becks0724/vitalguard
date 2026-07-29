# 일정 캘린더 — 수정·삭제 권한 (2026-07-29)

관제웹 일정 캘린더의 일정 수정·삭제를 **작성자 본인과 총괄 관리자(owner)** 로 제한하고,
사용자가 실제로 보는 목록에서 바로 수정·삭제할 수 있게 한다.

## 1. 계획 — 무엇을 왜

### 배경 (리서치 결과)

| 발견 | 내용 |
|---|---|
| 기능 부재가 아님 | 수정·삭제는 `ScheduleEventFormModal` 안에 이미 있다(`DemoDashboard.tsx:1409-1425`). 다만 "일정 추가" 버튼으로만 열리는 모달 안이라 **도달 경로가 없다** |
| 서버 권한 0 | `POST`(업서트)·`DELETE` 모두 `verifyBasicAuth` 만 — 로그인한 아무 관리자나 **남의 일정을 덮어쓰고 지울 수 있다**. `created_by` 는 저장만 되고 대조되지 않는다 |
| 업서트가 구멍 | id 를 클라가 만들고(`DemoDashboard.tsx:2311`) 서버가 그대로 신뢰 → "신규 등록"으로 위장한 남의 일정 덮어쓰기가 성립한다 |
| 라벨도 무방비 | `PUT /api/calendar/labels` 는 **전체 교체**인데 게이트가 없다. 라벨을 지우면 그 라벨을 쓰던 남의 일정이 조용히 첫 라벨로 밀린다 |
| 실 DB | `calendar_event` 2건 · `created_by` NULL **0건** → 사진 때와 달리 백필 불필요. `users` 9명 중 `role='owner'` **0명**(owner 세션은 env 계정 직접 로그인만) |
| 소비처 | iOS·Flutter 앱은 `/api/calendar/events` 를 **호출하지 않는다**(grep 0건). 깨질 외부 클라이언트 없음 |

같은 계열 IDOR 을 07-27 에 캘린더 **사진**에서 이미 고쳤다(`lib/media-scope.ts`). 일정에는 적용이 안 됐다.

### 설계

**권한 규칙** — 작성자 본인(`created_by` = 세션 username) 또는 owner(총괄 관리자).

`owner` 로 매핑한 근거 = 관제웹 UI 가 이미 `owner` 를 **"총괄 관리자"** 로 표기한다(`DemoDashboard.tsx:4874`).
`job_title`("총괄책임자" 텍스트)은 **쓰지 않는다** — 본인이 자유 편집 가능한 필드라 권한 근거로 삼으면 자가부여 구멍이 된다.

**규칙을 합치지 않는다** — `comment-scope`(username↔author_id)·`media-scope`(사번↔worker_id)와 모양은 같으나 대상이 다르다.
`lib/media-scope.ts` 상단 주석이 남긴 경고 그대로, 한 함수로 묶으면 한쪽을 고칠 때 다른 쪽이 조용히 따라 바뀐다. → `lib/calendar-event-scope.ts` 신규.

**소유권은 SQL WHERE 로** — 먼저 SELECT 해서 비교하면 그 사이 행이 바뀌고(TOCTOU) 왕복도 는다.
업서트는 `ON CONFLICT (id) DO UPDATE … WHERE <소유권>` 으로 갱신 분기에만 조건을 건다.

**화면은 판정을 복제하지 않는다** — GET 응답이 항목별 `canEdit` 를 내려주고 화면은 받아쓰기만 한다.
07-27 에 화면이 `role === "owner"` 로 버튼을 감췄던 것이 한 번 만에 어긋나 제보를 낳았다.

**응답 코드는 사진과 다르게 간다** — 사진은 rowCount 0 을 404 로 덮어 id 존재 여부를 숨겼다.
일정은 **목록이 전원에게 공개**라 존재를 숨길 실익이 없고, 404 는 사용자가 원인을 오해한다 → **403 + 사유 문구**.

### 함께 고치는 보완사항 (사용자 승인)

1. 삭제 확인 다이얼로그 — 즉시 삭제 + 낙관적 반영이라 오클릭 복구 불가였다.
2. 서버가 `canEdit` 내려주기 — 위 설계 참조.
3. 라벨 PUT 권한 게이트 — 전체 교체이고 소유자 개념이 없어 **owner + `admin_access` 보유자**(사용자 결정).
   게이트는 관리자 메뉴와 같은 축인 기존 `hasAdminMenuAccess` 를 재사용한다. 새 권한 축을 만들면
   owner 가 부여·회수할 지점이 둘로 갈라진다. 현재 해당자 = env owner + 4명(admin3470·admin0740·admin7276·shulover7276).
4. 수정 시각 표시(`updated_at`) + 수정 시 **날짜 이동**(`dateKey` 전달 배선).

### 진입점

**"선택 날짜 일정"** 목록에만 단다(사용자 결정). "주간 일정"은 한 줄 요약 칩이라 버튼 2개가 들어가면 좁아진다.

## 2. 체크리스트

- [x] `lib/calendar-event-scope.ts` — 권한 범위 단일 지점
- [x] `lib/calendar-event-scope.test.ts` — 회귀 가드(위반을 실제로 만들어 실패 확인)
- [x] `lib/db.ts` — `upsertCalendarEvent`·`deleteCalendarEvent` 에 scope 필수 인자
- [x] `app/api/calendar/events/route.ts` — POST·DELETE 소유권, GET `canEdit`
- [x] `app/api/calendar/labels/route.ts` — PUT owner 게이트, GET `canEdit`
- [x] `DemoDashboard.tsx` — 선택 날짜 일정 목록에 수정·삭제 진입점(`canEdit` 게이트)
- [x] `DemoDashboard.tsx` — 삭제 확인 다이얼로그
- [x] `DemoDashboard.tsx` — 날짜 이동 입력 + "수정됨" 표시
- [x] `DemoDashboard.tsx` — 라벨 편집 UI 를 서버 `canEdit` 로 게이트
- [x] 마이그레이션 경로 403 처리(무한 재시도 방지)
- [x] `/verify` — typecheck 0 · lint 0 error(4 warn 기존) · test **438**(35+50+353, 신규 9) · `next build` SUCCESS
- [x] L-12 가드 확인 — 소유권 절을 실제로 제거해 **9건 중 6건 실패**를 확인한 뒤 복구
- [x] SQL 실증 — 실 테이블 `EXPLAIN` 3건(구문·컬럼 해석) + 세션 로컬 TEMP 클론 동작 12건, **프로덕션 행 수 2 → 2 불변**
- [ ] UI 브라우저 검증 — **미실시**. 로컬 Postgres·Docker 부재로 대체 DB 를 띄울 수 없고, dev 서버는 프로덕션 DB 를 그대로 쓴다(L-04 로 쓰기 금지)
- [x] 배포 — `00173-glm` → **`00174-zv2` 100%** (main `1878022` · digest `25e8396b…`). 라이브 page 청크에서 신규 마커 7종 + `canEdit` 게이트 2개소 실측, 무인증 API 5종 401, 신·구 리비전 4xx 집합 동일(L-11·L-13)
- [ ] 사용자 육안 확인 — 로그인 뒤 화면이라 curl·번들 검증으로는 클릭 동작까지 못 본다

## 3. 컨텍스트 노트 — 결정과 근거

- **일정 수정·삭제의 총괄책임자 = `owner`** (사용자 선택). 결과적으로 등록 관리자 8명은 전원 자기 일정만 다루고, 총괄 권한은 env 계정에만 생긴다.
- **라벨 편집만 `admin_access` 까지 넓혔다** (사용자 결정, 2026-07-29 후속). 일정은 작성자라는 대조 대상이 있어 좁혀도 아무도 막히지 않지만, 라벨은 소유자가 없어 owner 전용으로 두면 등록 관리자 전원이 편집 불가가 된다. 두 축을 일부러 다르게 둔 것이며 합치면 안 된다.
- **`created_by` 는 갱신하지 않는다.** 기존 `DO UPDATE SET` 목록에 이미 없었다 — 수정해도 최초 등록자가 보존된다. 이 성질에 의존하므로 건드리지 않는다.
- **판정 불가는 항상 거부.** scope 를 `{ createdBy } | "moderator"` 유니온 **필수** 인자로 둔다. 선택 인자였다면 호출부가 값을 빠뜨렸을 때 조용히 "전체 허용"으로 떨어져, 지금 고치는 IDOR 이 타입 검사도 통과하며 재현된다(`media-scope` 와 같은 이유).
- **라벨 GET 은 앱 JWT 도 받는다** — `canEdit` 는 관제 세션 owner 일 때만 true. 앱은 읽기 전용이므로 false 가 맞다.
- **localStorage 마이그레이션(`DemoDashboard.tsx:2081`)** 은 같은 POST·PUT 을 재사용한다. 권한 강화 후 403 이 나면 `throw` → 마이그레이션 플래그가 안 찍혀 **팝업 열 때마다 무한 재시도**가 된다. 403 은 "옮길 권한이 없다 = 옮길 필요 없다"로 보고 건너뛴다.
- **범위 밖으로 남긴 것** — 일정 id 를 서버가 발급하도록 바꾸는 것(현행 클라 생성 유지). 권한 WHERE 로 덮어쓰기는 막히므로 급하지 않고, 바꾸면 마이그레이션 멱등성이 깨진다.
