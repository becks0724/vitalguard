# VitAlGuard 주의 6건 해답 (2026-07-03)

> **원칙**: 본 문서는 **제안만** 담습니다. 어떤 코드도 적용되지 않았고, DB의 기존 데이터는 일절 변경·삭제되지 않았습니다.
> 기존 행을 지우거나 바꾸는 조치는 전부 **⚠️ 팀 승인 필요** 로 분리 표기했으며, 그 외 제안은 "신규 행에만 효과" 또는 "읽기 경로만 변경"이라 기존 데이터를 훼손하지 않습니다.
>
> - 기준 코드: `origin/main` `b7cb738` (2026-07-03 라이브 00051-8dx 배포 기록 시점)
> - 근거 수집: 라이브 DB 읽기 전용 조회(information_schema/pg_catalog/SELECT) + 배포 스냅샷 코드 대조
> - 품질 검증: 6건 각각을 독립 에이전트가 실제 코드에 대조해 반박 시도(적대적 검증) → 발견된 함정을 본문 "함정" 절에 반영

## 우선순위 요약

| # | 문제 | 권장 조치 핵심 | 데이터 영향 |
|---|---|---|---|
| 2 | `uq_vs_worker_ts` 인덱스가 코드 DDL에 없음 | 코드에 인덱스 선언 추가 + `persistSample`만 `ON CONFLICT DO NOTHING` + 중복 시 알림 로직 skip | 없음 (신규 삽입 경로만) |
| 3 | 시뮬레이터 GPS(샌프란시스코) 혼재 | 수집단(persistSample 내부)에서 한국 bbox 밖 좌표만 NULL 처리, 원본은 raw_json에 보존 | 없음 (신규 행만) |
| 4 | 워커 ID 파편화 | 별칭 등록(운영 조치) + 집계 SQL에 별칭 접기(LEFT JOIN) | 없음 (조회 시점 접기) |
| 6 | worker-day가 UTC 날짜 기준 | 집계식만 KST 변환으로 교체 (51→54로 정정됨) | 없음 (읽기 경로만) |
| 1 | 미디어 댓글 고아 8건 | 삭제를 단일 CTE로 원자화 + FK `NOT VALID` (기존 고아는 보존) | 없음 (고아 정리는 별도 승인) |
| 5 | `captured_at` 형식 혼재 (Z / +09:00) | 정렬은 가드된 `::timestamptz` 캐스트, 쓰기는 **+09:00 형식으로** 정규화 (UTC-Z 금지 — UI가 문자열 슬라이스) | 없음 (기존 행 그대로) |

---

## #1. `calendar_media_comment` 고아 8건

**현상** — 삭제된 미디어 3건(`0f768cc6…` 4개, `dfbf8bf7…` 2개, `f03e269e…` 2개)의 댓글 8행이 잔존.
**원인** — 두 갈래:
1. `deleteCalendarMedia`(`lib/db.ts:1767-1768`)가 미디어 행만 삭제, 댓글 미정리.
2. 댓글 POST(`app/api/calendar/media/comment/route.ts:50`)가 미디어 존재 확인 없이 INSERT → 삭제 직후 달린 댓글도 고아가 됨. FK 제약 자체가 없어 DB가 막지 못함.

**해답 (권장 순서)**

1. **[코드] 삭제 원자화** — 트랜잭션 헬퍼가 없으므로(`q()`는 Pool에 문장 단위 전송, `lib/db.ts:435-442`) 단일 CTE 문장으로 처리. 한 문장 = 암묵적 단일 트랜잭션이라 절반만 지워지는 사고가 없고, rowCount가 바깥 DELETE(미디어) 기준이라 기존 ok/404 시맨틱(`app/api/calendar/media/route.ts:134-135`)이 유지됩니다.

   ```ts
   // lib/db.ts deleteCalendarMedia 교체안
   export async function deleteCalendarMedia(id: string): Promise<boolean> {
     const { rowCount } = await q(
       `WITH del AS (DELETE FROM calendar_media_comment WHERE media_id = $1)
        DELETE FROM calendar_media WHERE id = $1`,
       [id],
     );
     return rowCount > 0;
   }
   ```

   ⚠️ **정책 확인 필요**: 현재는 미디어를 지워도 댓글(작성자·시각 기록)이 남습니다. 위 변경은 "미디어 삭제 = 댓글 스레드도 삭제"라는 보존 정책 변경이므로, 산업재해 증빙 보존 관점에서 팀 확인 후 적용하십시오.

2. **[DB] FK를 `NOT VALID`로 추가** — 기존 고아 8행은 **건드리지 않고** 신규 행부터 강제. PG14는 `ADD CONSTRAINT IF NOT EXISTS`가 없으므로 **initSchema에 넣지 말고 수동 1회 마이그레이션**으로 실행(초기화 배치에 넣으면 에러 시 `ensureSchema` 메모이즈가 풀려 앱 DB 레이어 전체가 재시도-실패 루프에 빠짐, `lib/db.ts:113-121`).

   ```sql
   -- 수동 1회 실행 (기존 데이터 무손상, off-peak 권장: SHARE ROW EXCLUSIVE 잠깐 잡음)
   ALTER TABLE calendar_media_comment
     ADD CONSTRAINT fk_cmc_media
     FOREIGN KEY (media_id) REFERENCES calendar_media(id)
     ON DELETE CASCADE NOT VALID;
   ```

3. **[코드] 댓글 POST의 FK 위반 처리** — FK가 생기면 삭제된 미디어에 대한 댓글 INSERT가 23503 에러 → 현재 코드는 잡지 않아 500. `insertCalendarMediaComment` 호출부에서 `e.code === '23503'` 을 잡아 404("미디어 없음")로 응답.

4. **⚠️ 팀 승인 필요 (이번 범위 밖)** — 고아 8행 정리와 `VALIDATE CONSTRAINT`:

   ```sql
   -- (a) 보존용 아카이브 조회(내보내기) 후
   SELECT * FROM calendar_media_comment cc
    WHERE NOT EXISTS (SELECT 1 FROM calendar_media m WHERE m.id = cc.media_id);
   -- (b) 팀 승인 후 삭제 + 검증
   DELETE FROM calendar_media_comment cc
    WHERE NOT EXISTS (SELECT 1 FROM calendar_media m WHERE m.id = cc.media_id);
   ALTER TABLE calendar_media_comment VALIDATE CONSTRAINT fk_cmc_media;
   ```

**검증** — 스테이징에서: 미디어 삭제 → 댓글 동반 삭제 확인 / 삭제된 media_id로 댓글 POST → 404 확인 / 고아 카운트 쿼리 0 유지 확인.

---

## #2. `uq_vs_worker_ts` UNIQUE 인덱스가 라이브 DB에만 존재

**현상** — 라이브: `UNIQUE INDEX uq_vs_worker_ts ON vital_samples(worker_id, ts)` (pg_indexes로 이름·컬럼 실측 확인). 코드 `initSchema`(`lib/db.ts:170-171`)에는 비유니크 `idx_vs_worker_ts`뿐. 중복 방지는 "INSERT가 23505로 터지고 `store.ts:129` catch가 삼키는" 에러 기반 dedup에 의존.
**위험** — 새 환경 재구축 시 인덱스가 재생성되지 않아 중복 적재가 조용히 허용됨. 또 dev 환경처럼 이미 중복이 쌓인 DB에 무턱대고 유니크 인덱스를 만들면 실패함.

**해답**

1. **[코드] 인덱스 선언을 initSchema 대형 배치 *밖*의 별도 쿼리로 추가** — 배치 안에 넣으면 실패 시 배치 전체 롤백 → 그 환경의 모든 쿼리가 죽습니다. 별도 실행 + 실패는 경고 로그로 강등:

   ```ts
   // initSchema() 끝부분, 대형 pool.query 배치 "다음"에 별도 실행
   try {
     await pool.query(
       `CREATE UNIQUE INDEX IF NOT EXISTS uq_vs_worker_ts ON vital_samples(worker_id, ts)`,
     );
   } catch (e) {
     // 기존 중복 행이 있는 환경(구 dev DB 등)에서는 생성 실패 — 앱은 계속 뜨게 하고 경고만.
     console.warn("[schema] uq_vs_worker_ts 생성 실패(중복 존재?):", (e as Error).message);
   }
   ```

   사전 점검(읽기 전용): `SELECT worker_id, ts FROM vital_samples GROUP BY 1,2 HAVING COUNT(*) > 1;` — 라이브는 인덱스가 이미 있으므로 0행이며 `IF NOT EXISTS`로 no-op. (라이브 인덱스명이 정확히 `uq_vs_worker_ts`임은 이번 감사에서 실측 확인됨 — 이름이 다르면 두 번째 인덱스를 만들며 락을 잡으니, 다른 환경 적용 전 반드시 `pg_indexes` 확인.)

2. **[코드] `persistSample`에만 `ON CONFLICT DO NOTHING` + 중복이면 후속 알림 로직 skip** — ⚠️ 공용 `buildInsert`(`lib/db.ts:445-456`)를 고치면 `weather_log`·`users` 등 다른 호출부 6곳이 매칭 인덱스 부재로 42P10 에러를 냅니다. 반드시 호출부(`lib/db.ts:512-513`)에서만:

   ```ts
   const { text, values } = buildInsert("vital_samples", cols);
   const { rowCount } = await q(`${text} ON CONFLICT (worker_id, ts) DO NOTHING`, values);
   return rowCount > 0; // true = 실제 삽입, false = 중복
   ```

   그리고 `store.ts`(96-130행)에서 반환값이 `false`(중복 재전송)면 `recordAlert`·생체 위험 전이 판정을 **건너뛰고 로그 1줄**만 남기십시오. 이유: 전이 판정은 인스턴스별 in-memory ring 기준이라, 서버 재시작 후 중복 재전송이 오면 "정상→위험 전이"로 오판해 과거 ts의 허위 vital 알림이 새로 삽입될 수 있습니다(기존 예외 기반 경로에서는 발생하지 않던 케이스). skip 처리가 기존 동작과 진짜 동일한 결과를 보장합니다.

**데이터 영향** — 없음. 기존 행 무손상, 신규 삽입 경로만 변경.
**검증** — 동일 (worker_id, ts) POST 2회 → 1행만 존재 + 에러 로그 없음 + alerts 증가 없음.

---

## #3. 시뮬레이터 GPS(샌프란시스코 −122.4) 혼재

**현상** — `EMP-admin7276` 5,271행(감사 시점에도 유입 중), `EMP-worker001` 1,642행, `worker001` 46행이 lon≈−122.4(시뮬레이터 기본 위치). 현장 좌표 캡처와 GPS 평균 표시는 이미 한국 bbox 게이트로 방어됨(서버 `app/api/monitor/site-coord/route.ts:37-42`, 클라 `DemoDashboard.tsx:2982-2987`) — 오염은 `vital_samples` 원본과 내보내기/ML 경로에 남음.

**해답**

1. **[운영] 발신원 처리 방침을 먼저 결정** — 두 갈래이며 **"시뮬레이터에 한국 커스텀 좌표를 넣는 것"은 권장하지 않습니다**. 한국 좌표를 넣으면 오히려 bbox 게이트를 통과해 현장 좌표 평균·일별 캡처를 실제로 오염시킵니다(현재는 SF 좌표라서 걸러지고 있는 것).
   - 해당 발신이 **순수 테스트**라면: 수집단 차단 목록에 워커 ID 추가(기존 `isReservedTestWorker` 메커니즘 확장, `store.ts:27-32` — 현재 패턴은 `EMP-admin7276`을 못 잡음). ⚠️ 실제 사람 계정과 겹치면 안 되므로 팀 확인 후.
   - 해당 발신이 **실사용 워치의 위치권한/시뮬레이터 문제**라면: 단말 설정을 고치는 것이 정도(正道).

2. **[코드] 수집단 좌표 가드는 `persistSample` 내부에서만** — `raw_json`을 **원본 sample로 먼저 직렬화한 뒤** cols의 좌표만 NULL 처리해야 합니다. `store.ts`에서 sample 객체를 건드리면 (a) raw_json 포렌식이 사라지고 (b) null이 in-memory ring으로 흘러가 `SosAlertModal.tsx`의 `latitude!.toFixed(6)`(79-81·263행)이 TypeError로 SOS 모달을 깨뜨립니다(`null !== undefined`가 true라 가드 통과).

   ```ts
   // lib/db.ts persistSample 내부 (483-484행 자리) — 신규 행에만 적용
   const inKoreaBbox =
     sample.latitude != null && sample.longitude != null &&
     sample.latitude >= 32.5 && sample.latitude <= 39.5 &&
     sample.longitude >= 123.5 && sample.longitude <= 132.5;
   // cols.raw_json = JSON.stringify(sample) 는 원본 그대로 유지
   cols.latitude  = inKoreaBbox ? sample.latitude  : null;
   cols.longitude = inKoreaBbox ? sample.longitude : null;
   ```

   bbox 상수는 site-coord 라우트·DemoDashboard와 공용 상수로 추출해 3곳이 어긋나지 않게.

3. **[코드/분석] 과거 행은 수정하지 말고 조회 시 마스킹** — ⚠️ 단순 `WHERE longitude BETWEEN 123.5 AND 132.5` 필터는 **NULL 좌표 행 전체를 떨어뜨려**(SQL NULL 시맨틱) 정상 무-GPS 샘플과 ML 학습행(낙상 피처는 유효)까지 숨은 손실을 냅니다. 행을 버리지 말고 좌표만 가리십시오:

   ```sql
   SELECT ...,
     CASE WHEN latitude BETWEEN 32.5 AND 39.5 AND longitude BETWEEN 123.5 AND 132.5
          THEN latitude  END AS latitude,
     CASE WHEN latitude BETWEEN 32.5 AND 39.5 AND longitude BETWEEN 123.5 AND 132.5
          THEN longitude END AS longitude
   FROM vital_samples ...
   ```

4. **⚠️ 팀 승인 필요 (이번 범위 밖)** — 과거 SF 좌표 행의 일괄 정정(UPDATE)은 기존 데이터 변경이므로 제안만 남기고 실행하지 않습니다.

**검증** — SF 좌표 샘플 POST → DB 행의 lat/lon NULL + raw_json에 원좌표 보존 / SOS 모달 정상 / 내보내기 CSV에 SF 좌표 부재.

---

## #4. 워커 ID 파편화 (동일 인물 다중 ID)

**현상** — 전 팀원 1인이 `EMP-7276`·`EMP-worker7276`·`WORKER7276`·`worker7276`·`EMP-admin7276`로 분산. 별칭은 `EMP-6861→EMP-admin6861` 1건뿐. worker-day(51)·고유 작업자(13명) 집계 부풀림.

**동작 방식 정정(중요)** — 별칭은 표시 시점 접기(`store.ts` `mergeLatestByWorker`, 별칭 접기는 186행)뿐 아니라 **수신 시점에도** `resolvePrimaryWorkerId`(`store.ts:50-73`, 15초 캐시)로 접혀 **이후 유입되는 `vital_samples`/`alerts` 행이 primary ID로 저장**됩니다. 즉:
- 별칭 등록 즉시: 라이브 카드 병합 + **미래 데이터가 primary로 적재**(사실상 비가역 — 잘못 등록하면 히스토리 재작성 없이는 못 되돌림).
- 과거 행: secondary ID 그대로 남음 → 집계 접기는 별도 코드 수정 필요.

**해답**

1. **[운영] 별칭 등록** — 기존 관리자 UI/`POST /api/admin/worker-alias`(참고: owner 전용이 아니라 **승인된 admin 세션이면 가능** — `verifyBasicAuth`, `lib/admin-auth.ts:142-164`)로:
   - `worker7276`, `WORKER7276`, `EMP-7276`, `EMP-worker7276` → `EMP-admin7276`
   - `worker001` → `EMP-worker001`
   - ⚠️ `EMP-9001`(표시명 Worker7276)과 `김태곤`(→`EMP-admin3470`?)은 **팀이 본인 확인 후** 등록 — 수신 시점 접기 때문에 오등록은 미래 데이터의 귀속을 영구히 바꿉니다.
   - 설정 행 삽입일 뿐 `vital_samples`는 무변경. 별칭 삭제는 표시/미래분만 원복되고, 잘못된 별칭이 살아있던 동안 적재된 행은 그대로임을 운영 문서에 명시.

2. **[코드] 과거 행 집계 접기** — `listAllWorkers`(`lib/db.ts:553-568`)와 `auditWorkerDays`(`lib/db.ts:586-623`)에 LEFT JOIN 접기. `countsByWorker`는 별도 쿼리가 아니라 `listAllWorkers` 재사용(`store.ts:142-149`)이므로 **이것만 고치면 자동 해결**:

   ```sql
   SELECT COALESCE(a.primary_worker_id, v.worker_id) AS worker_id, ...
     FROM vital_samples v
     LEFT JOIN worker_alias a ON a.secondary_worker_id = v.worker_id
    GROUP BY COALESCE(a.primary_worker_id, v.worker_id)
   ```

3. **[코드·후속] 남는 원시 ID 경로** — `exportSamples`의 워커 필터(`lib/db.ts:1028`, `WHERE worker_id=$1`)는 secondary로 저장된 과거 행을 놓침 → `OR worker_id IN (SELECT secondary_worker_id FROM worker_alias WHERE primary_worker_id=$1)` 보강. `worker_profile`(직책 오버라이드)이 secondary 키로 남아 있으면 매칭이 끊기므로 primary 키로 재등록(운영).

4. **[공지]** 접기 적용 후 worker-day·고유 작업자 수치가 **줄어듭니다**(중복 해소로 인한 정정) — 데이터 유실로 오독하지 않게 팀에 사전 공지.

**데이터 영향** — 없음(과거 행 재작성 금지 유지; 접기는 조회 시점).
**검증** — 별칭 등록 후 `/api/mock/vital`의 countsByWorker 키가 primary로 접히는지, worker-day 감소 폭이 별칭 수와 부합하는지.

---

## #5. `calendar_media.captured_at` 형식 혼재 (Z ↔ +09:00)

**현상** — 11행 중 6행 `…Z`(UTC), 5행 `…+09:00`(KST). 원인: 프리사인 경로는 Z, `app-media` 릴레이 폴백 `nowKstIso()`(`app/api/app-media/route.ts:47-49`)는 `+09:00` 생성. 정렬은 `listCalendarMedia`(`lib/db.ts:1628-1639`)의 **텍스트** `ORDER BY captured_at`. 현재 11행은 우연히 순서가 맞지만(실측 확인), Z행이 KST 오전 +09:00행보다 늦은 실제 시각인 조합이 오면 즉시 어긋나는 **잠재 결함**입니다.

**해답 — ⚠️ "UTC-Z로 정규화"는 금물** (적대적 검증에서 확인): UI가 `capturedAt.slice(11,16)` 등 **문자열 슬라이스로 시각을 그림**(`DemoDashboard.tsx` 820·822·2240·2315행, `formatKoreanTime` 781행). UTC-Z로 통일하면 화면 시각이 9시간 이르게, 00~09시(KST) 촬영분은 날짜까지 전날로 표시됩니다. 따라서:

1. **[코드] 읽기 경로: 가드된 캐스트로 정렬만 교정** (기존 데이터 무변경) — 무가드 `::timestamptz`는 클라이언트가 보낸 임의 텍스트(라우트가 형식 검증 없이 통과시킴, `app-media/route.ts:119`·`calendar/media/route.ts:86`)에 22007을 던져 그 달 캘린더 GET 전체를 500으로 만들 수 있으므로 반드시 정규식 CASE 가드:

   ```sql
   ORDER BY date_key ASC,
     (CASE WHEN captured_at ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'
           THEN captured_at::timestamptz END) ASC NULLS LAST,
     created_at ASC
   ```

   (오프셋 없는 값은 세션 TZ에 따라 해석이 흔들리므로 가드에서 제외 → NULLS LAST로 뒤로.)

2. **[코드] 쓰기 경로: `+09:00` 형식으로 정규화** — 단일 관문 `insertCalendarMedia`에서, 파싱 가능하면 KST 벽시계로 변환해 `YYYY-MM-DDTHH:mm:ss+09:00`으로 저장(정렬은 캐스트로 동일하게 맞고, 슬라이스 기반 UI가 무수정으로 계속 정확). 파싱 불가·오프셋 없음이면 **NULL 저장 또는 400 거절** — 쓰레기 입력 구멍을 관문에서 봉쇄.

3. **⚠️ 팀 승인 필요 (이번 범위 밖)** — 기존 Z형식 6행을 +09:00으로 맞추는 일회성 UPDATE(5~6행 규모). 제안만 남깁니다:

   ```sql
   -- 실행 금지 · 참고용: Z 행을 +09:00 표기로 통일
   UPDATE calendar_media
      SET captured_at = to_char(captured_at::timestamptz AT TIME ZONE 'Asia/Seoul',
                                'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
    WHERE captured_at ~ 'Z$';
   ```

**검증** — 혼합 형식 표본으로 달력 정렬이 실제 시각순인지, +09:00 신규 행의 UI 시각·date_key 일치, 쓰레기 `capturedAt` POST가 400/NULL로 처리되는지.

---

## #6. `auditWorkerDays`의 일자 버킷이 UTC 기준

**현상** — `substr(ts,1,10)`(`lib/db.ts:592·596`) = UTC 날짜 버킷. `site_info_daily` 등은 KST(`ymdInKst`, `lib/db.ts:1088-1097`). **실측: UTC 버킷 51 worker-day vs KST 버킷 54** (15:00 UTC 이후 = KST 익일 샘플 28,052행).

**해답**

1. **[코드] 버킷식 교체 — SELECT와 GROUP BY 양쪽 모두** (한쪽만 바꾸면 42803 에러):

   ```sql
   SELECT ((ts::timestamptz AT TIME ZONE 'Asia/Seoul')::date)::text AS day,
          worker_id, MAX(job_title) AS job_title
     FROM vital_samples
    WHERE ts >= $1 AND ts <= $2
      AND worker_id !~ '^(reserved|test|smoke|infra)_'
      AND ts ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'   -- 캐스트 가드
    GROUP BY 1, worker_id
   ```

   - `ts`는 비제약 TEXT라(`lib/db.ts:134`) 미래의 비정상 행 1개가 22007로 API 전체를 죽일 수 있음 → 정규식 가드로 "그 행만 제외"가 안전. (현재 174,936행 전수는 UTC-Z 형식 확인됨. 근본적으로는 `@safetymonitor/schemas`의 `VitalSampleSchema`가 Z-only를 강제하는지 확인하면 가드 생략 가능 — 스키마 패키지는 이번 스냅샷 범위 밖이라 미확인.)

2. **[코드] 기간 기본값도 KST로** — 실제로 `auditWorkerDays`를 먹이는 곳은 `app/api/safety-audit/route.ts:21-22`와 `app/lib/weekly-report.ts:52-54`의 UTC 기본 범위입니다(AdminExportModal의 KST 경계는 preview/export 전용이라 이 경로와 무관). 이 두 곳의 from/to를 KST 일 경계로 맞추면 첫날·마지막날 버킷이 온전해집니다.

3. **[공지] 수치 변동 두 곳** — 대시보드 실집행 검증 51→54뿐 아니라 **주간 검증 보고서**(`buildWeeklyReport`, `app/lib/weekly-report.ts:55`)의 인원 교차검증·판정("이상 없음/검토 필요")도 바뀔 수 있습니다. 팀에 "정정"임을 사전 공지.

**데이터 영향** — 없음 (읽기 경로만).
**검증** — 교체 전후 worker-day를 같은 기간으로 비교(51→54 예상), KST 자정 직후 샘플이 올바른 날짜에 귀속되는지, weekly-report 판정 변화 리뷰.

---

## 공통 적용 순서 제안

1. 즉시(무위험·읽기 경로): #6 버킷식, #5 정렬 가드 캐스트, #4 집계 접기 SQL
2. 코드 배포 1회로 묶기: #2 (인덱스 선언+ON CONFLICT+skip), #3 수집단 가드, #1 삭제 원자화+23503 처리, #5 쓰기 정규화
3. 운영 조치: #4 별칭 등록(본인 확인 후), #3 발신 단말 방침 결정
4. ⚠️ 팀 승인 후 별도 창구: #1 고아 8행 정리+VALIDATE, #5 기존 Z행 통일 UPDATE, #3 과거 SF 좌표 정정

*본 문서의 모든 SQL/코드는 제안 예시이며 어떤 것도 적용되지 않았습니다. 라이브 DB에는 읽기 전용 조회만 수행했습니다.*
