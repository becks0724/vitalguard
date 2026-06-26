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

## 다음(Phase 2) — 결정/자격증명 필요
- 스토리지 백엔드 확정(GCS 서울 권장: 동일 GCP 프로젝트·최소 통합). 버킷 생성 + 서비스계정 키 또는 워크로드 자격 → `.env`/Cloud Run 시크릿.
- 프리사인 업로드 URL 발급 API(`POST /api/calendar/media/upload-url`) + 등록 API에 storage_provider/storage_key 채움.
- 앱(Phase 3): OCR → 프리사인 PUT 업로드 → 등록 API(앱 토큰).
