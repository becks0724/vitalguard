# 클라우드 브릿지 — OCR 미디어 → 캘린더 (컨텍스트 노트)

작성일 2026-06-26.

## 데이터 플로우 (요청)
App OCR → 클라우드(이미지/미디어) + PostgreSQL(로그기록) → 관제웹 캘린더.
- 앱이 OCR로 추출한 텍스트 + 이미지/미디어를 날짜에 매칭해 업로드.
- 관제웹 캘린더에서 날짜별로 미디어를 보고, 관리자가 설명을 기입.

## 단계 분할
- **Phase 1 (이번)** — 스토리지 백엔드와 무관한 토대. `calendar_media` 테이블 + db CRUD + `/api/calendar/media`(GET/POST/PATCH/DELETE) + 캘린더 UI(날짜 셀 미디어 배지 + 선택일 미디어 섹션 + 관리자 설명 편집). 더미 media_url로 검증.
- **Phase 2** — 실제 오브젝트 스토리지 연동(프리사인 업로드 URL 발급). **스토리지 백엔드 결정 필요**(GCS 서울 권장 — 이미 GCP/Cloud Run이라 동일 프로젝트·최소 통합). R2/네이버는 상용/국내데이터 대안.
- **Phase 3** — 앱 OCR → 프리사인 업로드 → 등록 API(앱 토큰 인증).
- **Phase 4** — 썸네일/영상 처리 고도화.

## Phase 1 설계 결정
- **스토리지 비종속 스키마** — `storage_provider`/`storage_key`/`media_url`/`thumbnail_url`를 모두 둠. Phase 1은 `media_url`만 채워 렌더 검증, Phase 2에서 provider/key 채움.
- **date_key (YYYY-MM-DD)** — 캘린더 `toDateKey`와 동일 키로 매칭(이벤트/날씨와 동일 규칙).
- **인증** — GET/POST/PATCH/DELETE 모두 `verifyBasicAuth`(관리자 세션 토큰). 캘린더 fetch는 `Authorization: Bearer ${getSessionToken()}` 동봉(기존 대시보드 폴링과 동일). Phase 3에서 앱 업로드용 토큰 경로 별도 추가.
- **캘린더 영속 이원화 유지** — 개인 일정=localStorage, 공유 미디어=서버/DB. 셀에서 미디어 배지는 날씨 아이콘(우상단)·이벤트 점(하단)과 구분되는 표식 사용.

## 제약/주의
- 기존 `.runtime/photos`(로컬 디스크)는 Cloud Run 휘발성 — 절대 재사용 안 함. 미디어는 Phase 2의 클라우드 스토리지로.
- DB는 캠퍼스 공용 Postgres(`project-db-campus.smhrd.com/vitalguard`, 운영과 동일). 스키마는 멱등 생성이라 추가 안전.

## 검증 결과 (2026-06-26, 통과)
- tsc=0, next build=0(`/api/calendar/media` 동적 라우트 등록).
- Playwright 실 API+DB 왕복 — 미디어 2건 POST → GET 2건 확인 → 캘린더 셀 배지 2개 + 선택일 '현장 미디어' 섹션 표시 + OCR 노출 → 설명 PATCH가 DB에 반영 확인 → 테스트 행 DELETE로 정리(잔여 0). 페이지 에러 없음, 다크모드 가독성 양호.

## Phase 1.5 — UX 개편 + 댓글 (2026-06-26, 통과)
사용자 요청 6건 반영.
1. 날짜 클릭 = **선택만**(일정등록 폼 미오픈). `handleDateClick`에서 `setFormDate` 제거.
2. 선택 날짜의 일정·미디어를 하단 선택영역에서 확인.
3. 선택영역에 **(+) 일정 추가** 버튼 → `setFormDate(selected)`로 폼 오픈.
4. 문구 "현장 미디어" → **"현장 이미지/미디어"**(섹션·셀 배지 title).
5. 미디어 카드 **제목/내용 분리** — `title` 컬럼 신설(ALTER 포함), 제목(굵게) + "OCR 인식 내용" 박스.
6. 관리자 단일 설명 → **댓글 스레드**(`calendar_media_comment`): 작성자 이름·식별자(사번 대용 username)·시각 표시, 저장 후 회색 본문 + 수정/삭제 아이콘, 신규 입력 컴포저. **작성자는 인증 세션(getSession)에서 서버가 도출**(클라이언트 신뢰 X). users.name 조회, env 관리자는 "관리자". 작업자 댓글은 Phase 3에서 author_role로 유입 가능.

- API 추가 — `/api/calendar/media/comment`(POST/PATCH/DELETE), media GET이 각 미디어에 `comments[]` 번들.
- 검증 — tsc=0, build=0, Playwright 전수(클릭=선택 폼0 / +버튼 폼1 / 문구 / 제목·OCR라벨 / 시드댓글·작성자 / UI 댓글추가) 통과.
- 데모 시드 6건(제목·샘플 댓글 4개) 유지 — `site_id=DEMO-SEED`, ID `/tmp/seed_ids.txt`.

## Phase 2 — 스토리지 백엔드 = Cloudflare R2 (2026-06-27)

사용자 결정 — 백엔드 **R2**(egress 영구 무료, S3호환). 접근 모델 **프리사인 GET(비공개 버킷)**. 이번 범위 **서버 API/어댑터만**(관리자 업로드 UI 없음, 앱 업로드는 Phase 3).

### Phase 2a 완료 (코드, 자격증명 무관)
- `lib/storage.ts` — R2 S3호환 어댑터. `presignUpload(key, contentType)`(PUT 10분) · `presignDownload(key)`(GET 1시간) · `isR2Configured()`. 클라이언트 지연 생성(빌드 시 env 불필요). region='auto', endpoint=`https://<accountId>.r2.cloudflarestorage.com`.
- `POST /api/calendar/media/upload-url` — 관리자 인증 + R2 미설정 시 503. contentType 화이트리스트(jpg/png/webp/heic/mp4/mov)만, 키=`calendar-media/{dateKey|undated}/{uuid}.{ext}`. 반환 `{ok, provider:"r2", key, uploadUrl}`.
- `GET /api/calendar/media` — `storage_provider=r2`+`storage_key` 행은 표시 시점에 `presignDownload`로 만료형 URL 발급(실패 시 기존 media_url 유지). 리터럴 media_url(더미/시드)은 그대로.
- 의존성 `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` 추가. 검증 tsc=0, next build=0(신규 라우트 등록 확인).
- 등록 API(POST)는 무변경 — 앱이 `storageProvider:"r2"`+`storageKey`만 보내면 됨(mediaUrl 생략, 조회 시 발급).

### Phase 2b 남음 (자격증명 + 라이브 — 사용자 R2 셋업 필요)
- R2 버킷(비공개) + API 토큰(Object R/W, 버킷 스코프) 생성.
- env 키 4개를 `apps/dashboard-web/.env.local`에 기입 — `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET`. (공개 베이스 URL 불필요 — 프리사인 방식.)
- Cloud Run 시크릿 4개 등록(argv 미노출, 파일 경유) → 배포 → 라이브 업로드 1건 왕복 검증.

### Phase 3 (별도) — Flutter 앱
- OCR → `upload-url`로 프리사인 PUT → 등록 API(앱 토큰 경로 추가 필요).

## Phase 2 정정 — 스토리지 백엔드 R2 → 네이버 Object Storage (2026-06-30)

사용자 결정 — 백엔드를 **R2 → 네이버 클라우드 Object Storage**(S3 호환)로 변경. ("미디어는 구글 클라우드" 요청 → 질의 끝에 **Naver Object Storage** 로 확정.)

- `lib/storage.ts` — R2 어댑터를 **NCP Object Storage** 로 교체. 엔드포인트 `https://kr.object.ncloudstorage.com`·리전 `kr-standard`·`forcePathStyle`. `isR2Configured()`→`isStorageConfigured()`, env `R2_*`→`NCP_ACCESS_KEY`/`NCP_SECRET_KEY`/`NCP_BUCKET`(+선택 `NCP_ENDPOINT`/`NCP_REGION`). 함수 시그니처(`presignUpload`/`presignDownload`)·동작 동일.
- 라우트 provider 문자열 `"r2"`→`"naver"`(upload-url 반환·media GET 프리사인 조건). S3 호환이라 코드 변경은 어댑터+문자열 수준.

## Phase 3 (이번) — 앱 업로드 계약 정의 (2026-06-30)

팀원 iOS 앱(OCR/촬영 완성)이 미디어 업로드는 **미구현** → 내가 서버 계약을 정의하고 문서화([app-media-upload-contract.md](app-media-upload-contract.md)).

- **앱 인증 = 공유 토큰** `APP_UPLOAD_TOKEN`(env). 앱은 `Authorization: Bearer <토큰>`. `admin-auth.ts` `verifyAppUploadToken`(미설정 시 fail-closed, 세션 토큰과 비충돌).
- **업로드 2엔드포인트만 앱 토큰 허용** — `POST /api/calendar/media/upload-url`·`POST /api/calendar/media`. GET/PATCH/DELETE 는 관리자 세션 전용 유지.
- **날짜/시간** — 캘린더 배치=`dateKey`(KST), 시각 표시=`capturedAt` HH:MM(앱은 KST 로컬 ISO `+09:00` 로 전송, UTC `Z` 금지). 표시부([DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx) 선택일 미디어 섹션)는 이미 `captured_at` HH:MM 노출 → 추가 변경 없음.

### Phase 2b 남음 (자격증명 + 라이브 — 서버 운영자 셋업)
- NCP Object Storage 버킷(비공개) + API 인증키 생성 → `.env.local` 에 `NCP_*` 3개 + `APP_UPLOAD_TOKEN`.
- Cloud Run 시크릿 등록(argv 미노출) → 배포 → 라이브 업로드 1건 왕복 검증(`upload-url` 200·PUT 200·등록 후 캘린더 표시).
