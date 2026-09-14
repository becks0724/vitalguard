# 서버 잉크 벡터 작업 결과 — 2026-09-13

구현과 로컬 검증을 마쳤다. **라이브 `calendar_media.created_at` 전수 캐스팅 검사는 접속 제한으로 미완료**다. 따라서 작업 지시의 모든 검증을 완료한 상태는 아니다. 캐스팅 불가 행이 없다는 판단이나 잘못된 날짜의 보정 정책을 임의로 넣지 않았다.

## 구현

- `app/api/app-media/route.ts`: 기존 업로드에 `application/json`/`.json`과 `mediaType: "ink"`를 추가했다. 원본 연결 필수, JSON 파싱, 최상위 정수 `v`, 파일 크기를 검사하고 받은 바이트 그대로 저장한다. 사진·영상·녹음과 기존 인증·신원 귀속 동작은 유지한다.
- `lib/db.ts`: 원본의 `annotationId`는 `created_at::timestamptz DESC, id DESC LIMIT 1`로 최신 잉크 한 건을 가리킨다. 원본만 목록에 내보내고 이전 잉크 행은 덮어쓰지 않는다.
- `lib/db.ts`: `MEDIA_DELETE_WINDOW_MIN = 10`. 소유권 조건으로 대상 행을 잠근 뒤 원본의 생성시각을 DB 시각과 비교한다. 허용된 원본과 연결된 잉크 전부를 한 트랜잭션에서 삭제하고, 실제 삭제된 행의 저장 키들을 커밋 후 반환한다. 잉크 단독 삭제는 생성시각 캐스팅·삭제 유예·동반 삭제를 적용하지 않는다.
- `app/api/calendar/media/route.ts`: 없음·타인 소유는 404, 본인 원본의 삭제 유예 경과는 403으로 구분한다. 성공한 삭제가 반환한 객체 전부를 정리한다. 목록의 `canDelete`에도 DB가 계산한 유예 여부를 반영한다.
- 기존 삭제 가드를 새 반환형에 맞췄고, 실행형 회귀 테스트 33건을 추가했다.

## 필수 보고

### 1. `created_at` 캐스팅 실패 가능 행

**미확인.** 로컬 환경변수와 확인한 환경 파일에 `DATABASE_URL`이 없었다. 기존 GCP 인증으로 라이브 서비스 설정을 읽으려 했지만 접속이 완료되지 않았고, GCP HTTPS 도달 확인은 DNS `ENOTFOUND`로 실패했다. 별도 DB 관리 화면을 사용할 수 있는 연결도 없었다.

다음 쿼리는 행을 수정하지 않고 전체 `created_at::timestamptz`를 실제로 평가한다. 성공 시 두 건수를 보고하고, 오류가 발생하면 날짜 처리 정책을 정하기 전에 해당 오류를 확인해야 한다.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT count(*) AS total_rows,
       count(created_at::timestamptz) AS castable_rows
FROM calendar_media;
ROLLBACK;
```

라이브 스키마 초기화 함수는 실행하지 않았고, 라이브 DDL·데이터 변경은 수행하지 않았다. 캐스팅 오류를 무시하거나 현재 시각으로 대체하는 처리는 추가하지 않았다.

### 2. 잉크 크기 상한

**2,097,152바이트(2 × 1024 × 1024, 안내 문구 2MB).** 기존 `/api/app-media`와 `putObject`에는 파일 크기 상한이 없었다. 잉크 파일만 제한하며 이 값까지 허용하고 1바이트라도 초과하면 413을 반환한다. UTF-8 바이트 수 기준이고, JSON 파싱·객체 저장 전에 검사한다. 기존 `request.formData()`가 multipart 본문을 읽은 뒤 파일 크기를 검사하는 구조는 유지했다.

### 3. 기존 중복 방지 계약

**미디어 업로드 재전송용 계약은 없다.** `app/api/app-media/route.ts`가 요청마다 저장 키와 행 ID에 서로 다른 `crypto.randomUUID()`를 발급하고, `insertCalendarMedia`는 일반 INSERT를 수행한다. `calendar_media.id` 기본 키는 있지만 재전송 시 같은 ID를 재사용하는 계약은 아니다. 멱등키·해시 중복 제거·업서트를 새로 추가하지 않았다.

### 4. 반환형 변경과 함께 고친 호출부 전부

프로덕션 호출부는 **1곳**, `app/api/calendar/media/route.ts`의 `DELETE`다. 다음 반환형을 분기하고 성공 시 `files` 전체를 순회하도록 바꿨다.

```ts
type DeleteCalendarMediaResult =
  | {
      status: "deleted";
      files: { storageProvider: string | null; storageKey: string | null }[];
    }
  | { status: "not_found" }
  | { status: "delete_window_expired" };
```

기존 테스트 `lib/2026-08-20-media-delete-object.guard.test.ts`도 두 거부 분기와 파일 목록 순회를 확인하도록 변경했다. 신규 `lib/2026-09-13-server-ink-vector.test.ts`는 반환형·라우트·트랜잭션을 실행해 검증한다.

### 5. 구현 시 정한 세부 사항

1. 동일 생성시각의 최신 잉크 선택은 `id DESC`로 정렬한다. 시각은 텍스트 순서 대신 `timestamptz`로 비교한다.
2. 원본 필드명은 `annotationOf`, `annotation_of`, `annotationOfId`, `annotation_of_id` 순서로 검사한다. 기존 `pick`처럼 공백을 제거하고 첫 비어 있지 않은 문자열을 사용한다.
3. `v`는 `Number.isInteger`로만 확인한다. `v: 1`이나 양수로 제한하지 않아 `0`, 음수, 향후 정수 버전도 수용한다. 획·도구·좌표 등 다른 내용은 검사하지 않는다.
4. 2MB는 1,000,000바이트 단위가 아닌 1,048,576바이트 단위로 계산한다. 초과 검사는 원본 연결·JSON 내용 검사보다 먼저 한다.
5. 유예 조건은 지시문의 “10분보다 오래됐으면”에 따라 엄격한 `<` 비교다. 판정 시점에 정확히 10분이면 허용한다. owner에게도 원본 삭제 유예를 동일하게 적용한다.
6. 삭제는 같은 커넥션에서 `BEGIN` → 소유권 조건을 포함한 `SELECT ... FOR UPDATE` → 원본 유예 판정 → 원본·잉크 일괄 `DELETE ... RETURNING` → `COMMIT` 순서다. 잠금 대기 뒤 시작한 판정 쿼리의 `statement_timestamp()`를 사용한다. 오류는 롤백하고 커넥션을 반환한다.
7. 결과 구분자와 목록 필드명은 위 타입처럼 `status`와 `files`로 정했다. 유예 경과 응답에는 `code: "MEDIA_DELETE_WINDOW_EXPIRED"` 및 `삭제 유예 시간(10분)이 지났습니다`를 넣었다. 기존 없음·타인 소유 404 정책은 유지한다.
8. 목록에 DB 계산값 `deleteWindowExpired`를 추가하고 `canDelete`가 소유권과 유예를 모두 보도록 했다. 화면 코드는 변경하지 않았다.
9. 스토리지 삭제는 반환된 목록을 순차 처리한다. 한 객체가 실패하면 기존처럼 경고를 기록하고 성공 응답을 유지하되 나머지 객체 삭제를 계속한다. 제공자·키·스토리지 설정 조건도 유지한다.

## 검증 수치와 한계

| 대상 | 타입 오류 | 테스트 통과 | 실패 | 생략 |
|---|---:|---:|---:|---:|
| dashboard-web | 0 | 1,711 | 0 | 0 |
| schemas | 0 | 41 | 0 | 0 |
| analyzers | 0 | 63 | 0 | 0 |
| 합계 | **0** | **1,815** | **0** | **0** |

- 변경 파일 5개의 ESLint: **오류 0, 경고 2**. 경고는 이번 변경 전부터 있던 `db.ts:179`, `db.ts:1134`의 `console.log`다.
- `git diff --check`: **오류 0**.
- 대시보드는 해당 작업 트리에서 설치된 `tsc --noEmit --incremental false`와 `node --import tsx --test "lib/**/*.test.ts" "app/**/*.test.ts"`를 실행했다. `tsx` CLI 대신 같은 설치본을 Node 로더로 사용했다.
- 공통 패키지는 이 작업 트리의 `node_modules` 연결이 없어 최초 직접 검사가 의존성 누락으로 실패했다. 소스가 바이트 단위로 일치하는 `/tmp` 사본에 이미 설치된 의존성을 연결해 재검증한 결과가 위 표다. 패키지 설치나 소스 변경은 하지 않았다.
- 신규 33건은 업로드·인증·기존 형식 유지·2MB 경계·버전 보존·403/404·소유권·롤백·전체 객체 정리·목록 판정을 검증한다. DB 함수는 원문을 실행하되 DB 응답을 대체하고 SQL을 검사한다. 실제 PostgreSQL 통합 검증으로 보고하지 않는다. 임시 로컬 PostgreSQL도 공유 메모리 생성 권한 제한으로 초기화하지 못했다.
- 실행 로그와 기준 사본: `/tmp/server-ink-vector-20260913/`. 라이브 조회 준비에 사용한 임시 GCP 인증 사본은 삭제했다.

## 보존 확인

`verifyBasicAuth`가 있는 `lib/admin-auth.ts` 전체가 작업 전 사본과 동일하다. `DemoDashboard.tsx`, 기존 달력 가드 변경, CCTV 라우트·테스트도 작업 전 사본과 동일하다. `db.ts`의 기존 `ensureSchema`/스키마 구간과 선행 `annotation_of` 변경을 보존했다. 업로드의 선행 녹음 지원도 유지했다.

커밋·배포·`npx`·`npm install`은 수행하지 않았다. 앱 코드·관제웹 화면·신규 DB 트랙은 수정하지 않았다.
