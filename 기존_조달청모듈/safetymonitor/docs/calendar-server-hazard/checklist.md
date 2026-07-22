# 캘린더 서버 승격 + 위험작업 기상 경고 — 체크리스트

계획·결정 근거는 [context-notes.md](./context-notes.md).

## ① 일정·라벨 서버 DB 승격

- [ ] DB — `calendar_event`·`calendar_label` 테이블 (ensureSchema 멱등 CREATE)
- [ ] DB 함수 — listCalendarEvents(범위)·upsertCalendarEvent·deleteCalendarEvent·listCalendarLabels·replaceCalendarLabels
- [ ] API `/api/calendar/events` — GET(세션 또는 앱 JWT)·POST 업서트(세션)·DELETE(세션)
- [ ] API `/api/calendar/labels` — GET(세션 또는 앱 JWT)·PUT 전체교체(세션)
- [ ] 클라이언트 — localStorage 로드/저장 → 서버 우선 로드 + 변경 시 서버 반영(라벨은 디바운스)
- [ ] 클라이언트 — localStorage 기존 일정·라벨 1회 마이그레이션(서버 빈 경우만, 플래그 영속)
- [ ] 클라이언트 — 기존 60초 미디어 폴에 일정·라벨 재조회 합류(다중 관리자 동기화)
- [ ] 문서 — app-dashboard-read-contract 에 events/labels GET 추가

## ② 위험작업 태그 + 기상 충돌 경고

- [ ] `/api/weather` daily 파라미터 확장 — wind_gusts_10m_max·precipitation_sum → daily7 응답 포함(DB 폴백 경로도 타입 정합)
- [ ] 순수 모듈 `app/lib/calendar-hazard.ts` — 위험작업 5종 정의 + evaluateHazardWeather(작업유형, 일 예보) → 경고/null
- [ ] 단위테스트 `calendar-hazard.test.ts` — 유형×임계 경계 매트릭스 + 결측 입력 null
- [ ] DB — calendar_event.hazard_type 컬럼(멱등 ALTER) + 라우트 검증
- [ ] 폼 모달 — 위험작업 선택(없음 + 5종 라디오 칩)
- [ ] 캘린더 셀 — 위험작업×악천후 겹침 ⚠ 배지(주의 amber/위험 red)
- [ ] 선택 날짜 일정 목록 — 경고 라인(예보값 + 법정 기준 근거) + 참고 면책 문구
- [ ] 주간 일정(Plan) — 경고 아이콘 표시

## 검증

- [ ] tsc 0 · lint 0err · pnpm test 전체 green(신규 테스트 포함)
- [ ] 라우트 목 E2E(L-02·L-04) — 일정 LOAD/SAVE 배선 + 위험작업 경고 렌더(프로덕션 DB 무쓰기)
- [ ] 커밋 2건(① 서버 승격 / ② 위험작업 경고) + origin 동기 push
- [ ] /deploy — 빌드·배포·라이브 검증
