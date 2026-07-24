# B5 — 캘린더 설비 점검 자동 일정 (AED 교환주기) 체크리스트

계획·근거 = [context-notes.md](./context-notes.md).

## 구현
- [ ] 순수 모듈 `app/lib/inspection-schedule.ts` — 마커 타입 + `buildInspectionMarkers(inputs, todayMs)`(dueDays→dueDateKey·severity·라벨) + 단위테스트
- [ ] API `app/api/inspection-schedule/route.ts` — GET(세션 또는 앱JWT)·`from`/`to` 윈도, 등록장비+프리셋+NFC점검+config(loc) 조합(alarm route 패턴 재사용)→마커
- [ ] 캘린더(`DemoDashboard.tsx`) — inspection-schedule 조회 합류(events·media 폴과 함께)
- [ ] 셀 = 점검 예정일에 🔧 점검 칩(심각도색·개수)
- [ ] 선택 날짜 패널 = "설비 점검 예정" 섹션(장비·위치·항목·심각도·D-day, 읽기전용)

## 검증
- [x] tsc 0 · lint 0err · test green — dashboard 239(inspection-schedule 6 신규)·analyzers 46·schemas 21
- [~] 라우트 목 E2E — **미완(환경 제약)**. 헤드리스 dev+목 인증 환경에서 헤더 ExpandableTabs 캘린더 버튼이 구동 안 됨(NOT_FOUND·매초 헤더 재렌더). 크래시(pageerror)는 0. 캘린더 탭은 소스상 무조건 렌더(실 앱 정상). → 유닛 테스트+render-safe 검증으로 대체, 사용자 육안 확인 권장.
- [x] 커밋 + push
- [x] /deploy — 라이브 `00131-5bw`(이후 드래그·CCTV 배포로 `00134-2v9`)·API 401·청크 B5 문자열 5종 확인
- [x] (사용자) 육안 확인 완료 — 8월 예정일에 🔧 점검 칩 + "설비 점검 예정" 패널(AED 패드 D-10 등) 정상

## 후속(같은 트랙에서 추가 배포됨)
- [x] 일정 캘린더 플로팅 드래그 창(`179ece7`→`00132-9xc`) — 딤 제거·헤더 드래그·뒤 대시보드 조작
- [x] CCTV 팝업 드래그+멀티창 최대 4(`77a2348`→`00134-2v9`) — 육안 확인 완료

## 범위
- 이번 = **AED 배터리(48개월)·패드(24개월) 교환 예정일**만. 가스감지기·기타는 고정 교환주기 없어 후속.
- 점검 완료 = NFC 태깅(`aed_inspections`)이 이미 최근 교체로 반영 → 다음 예정일 자동 이동(추가 배선 0).
