# 캘린더 서버 승격 + 위험작업 기상 경고 — 체크리스트

계획·결정 근거는 [context-notes.md](./context-notes.md).

## ① 일정·라벨 서버 DB 승격

- [x] DB — `calendar_event`·`calendar_label` 테이블 (ensureSchema 멱등 CREATE)
- [x] DB 함수 — listCalendarEvents(범위)·upsertCalendarEvent·deleteCalendarEvent·listCalendarLabels·replaceCalendarLabels
- [x] API `/api/calendar/events` — GET(세션 또는 앱 JWT)·POST 업서트(세션)·DELETE(세션)
- [x] API `/api/calendar/labels` — GET(세션 또는 앱 JWT)·PUT 전체교체(세션)
- [x] 클라이언트 — localStorage 로드/저장 → 서버 우선 로드 + 변경 시 서버 반영(라벨은 600ms 디바운스)
- [x] 클라이언트 — localStorage 기존 일정·라벨 1회 마이그레이션(라벨은 서버 빈 경우만, 플래그 영속)
- [x] 클라이언트 — 기존 60초 미디어 폴에 일정·라벨 재조회 합류(다중 관리자 동기화)
- [x] 문서 — app-dashboard-read-contract 에 events/labels GET 추가

## ② 위험작업 태그 + 기상 충돌 경고

- [x] `/api/weather` daily 파라미터 확장 — wind_gusts_10m_max·precipitation_sum → daily7 응답 포함(DB 폴백 경로도 타입 정합)
- [x] 순수 모듈 `app/lib/calendar-hazard.ts` — 위험작업 5종 정의 + evaluateHazardWeather(작업유형, 일 예보) → 경고/null
- [x] 단위테스트 `calendar-hazard.test.ts` — 유형×임계 경계 매트릭스 + 결측 입력 null (8건)
- [x] DB — calendar_event.hazard_type 컬럼(멱등 ALTER) + 라우트 검증(5종 외 400)
- [x] 폼 모달 — 위험작업 선택(없음 + 5종 라디오 칩)
- [x] 캘린더 셀 — 위험작업×악천후 겹침 ⚠ 배지(주의 amber/위험 red·worst-of)
- [x] 선택 날짜 일정 목록 — 경고 라인(예보값 + 법정 기준 근거) + 참고 면책 문구
- [x] 주간 일정(Plan) — 경고 아이콘 표시

## A 묶음 — 발효 특보 연동 + 관제 노출 + 등록자 표시

- [x] `calendar-hazard.ts` — evaluateHazardKmaWarnings(발효 특보 type[] ↔ 5종 매핑·주의보/경보) + mergeHazardWarnings(worst-of) + 테스트 3건
- [x] 캘린더 팝업 — /api/kma-warning 조회 합류 + 오늘 일정에 발효 특보 경고 합성(셀·목록·주간 Plan 공통 helper)
- [x] 대시보드 — 오늘 위험작업 폴(120초·events+weather+kma·캘린더 닫힘 시 즉시 재집계) + 통합 신호등 아래 칩(N건·기상 충돌 M건·클릭=캘린더)
- [x] 등록자 — CalendarEvent.createdBy 매핑·폼 모달 행/칩 툴팁 표시·POST 응답 서버 행 반영
- [x] 검증 — tsc0·lint0·**test 200/200** + 라우트 목 E2E PASS(예보 무경고 조건에서 발효 특보 축 경고 증명·칩·등록자) + 배포 **`00115-mnh` 100%**·라이브 검증(루트 200·page 청크 신규 문자열 6종)

## 검증

- [x] tsc 0 · lint 0err · pnpm test 전체 green — 대시보드 **197/197**(신규 hazard 8 포함)
- [x] 라우트 목 E2E(L-02·L-04) — LOAD(GET 배선·셀 렌더)·⚠ 배지·경고 라인/면책·SAVE(POST 본문 hazardType=high_place·Bearer 헤더·낙관적 렌더) **PASS**(합성 데이터만, 프로덕션 DB 무쓰기)
- [x] 커밋 2건(① 서버 승격 / ② 위험작업 경고)
- [x] origin 동기 push (`6a41028`)
- [x] /deploy — 빌드 SUCCESS(digest `04cd33bb…`) → 리비전 **`00114-ckp` 100%** · 라이브 검증(루트 200·events/labels 무인증 401·weather daily7 돌풍/강수 확장 실데이터·서빙 page 청크 신규 문자열 6종 존재)
