# 캘린더 일정 — 라벨 커스터마이징 + 시작/종료 시간 (컨텍스트 노트)

작성일 2026-06-26. 대상 파일 `apps/dashboard-web/app/components/DemoDashboard.tsx`(헤더 캘린더 팝업 영역).

## 요청
1. 일정 라벨을 고정 4개(중요일정·발주계획·착수계획·기타)가 아니라, **추가/삭제·이름·색상 커스터마이징** 가능하게.
2. 시간을 단일 값이 아니라 **스케줄 시작/종료 시간** 둘 다 설정 가능하게.

## 확정 설계 (사용자 선택, 모두 추천안)
- 라벨 범위 — 추가/삭제까지 자유(동적 라벨).
- 색상 — 프리셋 8색 팔레트(라이트/다크 가독성 보장 Tailwind 토큰). 자유 HEX 아님.
- 저장 — localStorage 영속화(커스텀 라벨 + 등록 일정 둘 다). 기존엔 일정이 인메모리라 새로고침 시 소멸했음.

## 핵심 결정·근거
- **데이터 모델 리팩터**. `ScheduleLabel`(고정 유니온 `red|yellow|green|blue`) → 동적 라벨.
  - `LabelColor` = 8색 팔레트 키. `LABEL_COLOR_META[color]` = chip/dot/band/swatch Tailwind 클래스(라이트+다크).
  - `ScheduleLabelDef = { id, name, color }`. 기본 4개 `DEFAULT_LABELS`.
  - `CalendarEvent.label`(색키) → `CalendarEvent.labelId`(정의 ID 참조). 렌더 시 `findLabelDef(labels, labelId)`로 해석, 삭제된 라벨은 slate 폴백("삭제된 라벨")으로 안전 렌더.
- **`type: ScheduleType("plan"|"important")` 제거**. 전수조사 결과 저장만 되고 렌더엔 안 쓰임(유일 소비처는 시간 힌트 `red ? "(권장)":"(선택)"`뿐). 동적 라벨에서 "red=중요" 전제가 무의미 → `scheduleTypeFromLabel`·`normalizeScheduleLabel`과 함께 정리(내 변경이 만든 미사용 코드 제거, 가이드라인 3).
- **시간 모델** `time?` → `startTime?` + `endTime?`. `formatScheduleTime(event)`가 "오전 9:00 ~ 오전 11:00"/단일/빈 문자열 처리. 정렬은 `startTime` 기준. 종료는 선택(시점 일정 허용). 종료<시작 검증은 생략(단순성).
- **시간 입력 UI 재사용**. 기존 `ScheduleTimePicker`(오전/오후 + 단일 입력)를 그대로 두 번(시작/종료) 렌더 — 컴포넌트 무변경, 외과적.
- **프레젠테이션 컴포넌트** `ScheduleLabelDot`·`CalendarEventChip`은 전역 META 인덱싱 대신 호출부가 해석한 `color: LabelColor`를 prop으로 받음. 호출부(모두 `HeaderCalendarPopup`/`ScheduleEventFormModal` scope, `labels` 접근 가능)에서 `findLabelDef(...).color` 전달.
- **하이드레이션 안전**. 기존 ACCIDENT/SLIDEMODE 패턴과 동일하게 state는 기본값으로 초기화하고 mount useEffect에서 localStorage 로드. `hydrated` 가드로 로드 전 기본값이 저장소를 덮어쓰지 않게 함.
- **storage key** `safetymonitor.calendar-labels.v1`, `safetymonitor.calendar-events.v1` (기존 `safetymonitor.<name>.vN` 관례).

## 검증 결과 (2026-06-26, 모두 통과)
- `tsc --noEmit` = exit 0.
- `next build`(프로덕션, Cloud Run과 동일 컴파일) = exit 0, DemoDashboard 포함 전체 정상.
- Playwright 라이브 E2E(로그인→캘린더→폼) — UI 존재(일정 라벨/라벨 편집/시작 시간/종료 시간 전부 True), 라벨 추가 후 5행, 색 스와치 40=5×8, 시간 입력 2(시작/종료), 일정 추가 후 제목·커스텀 라벨·"~" 시간범위 표시, 다크모드 가독성 양호.
- localStorage 영속 — 새로고침 후 커스텀 라벨("안전점검", violet)·일정(labelId 참조, 09:00~11:30) 모두 유지 확인.

## 주의
- dev 서버 콜드 컴파일이 이 머신에서 매우 느림(첫 네비게이션/API 30~120s+). 잔여 `next dev` 프로세스 정리 후 정상화. E2E 시 단일 네비게이션 + sessionStorage 시드(`add_init_script`)로 우회.
- dev 서버 가동 중 `next build`를 같은 `.next`에 돌리면 dev 청크가 깨짐("Cannot find module './NNNN.js'"). 빌드 후엔 `.next` 삭제 + dev 재기동.

---

# 추가 기능 — 날짜별 날씨 아이콘 (2026-06-26)

## 요청·결정
- 각 날짜 셀에 날씨 상태를 작은 아이콘으로 표시. "기상청 API 연결" 요청이었으나 `.env.local`의 `KMA_SERVICE_KEY`가 비어 있어(미발급) 즉시 불가. 사용자 확정 = **기존 Open-Meteo 7일 예보(daily7) 재사용**.

## 구현
- `HeaderCalendarPopup`에 `lat/lon/workerCount` prop 추가 → 호출부에서 `fieldCoords` 전달(WeatherStrip과 동일 좌표원).
- 팝업 오픈 시 `/api/weather?lat=&lon=&workers=`(서버 캐시 엔드포인트)에서 `daily7.time[]/weatherCode[]` → `weatherByDate(dateKey→코드)` 맵.
- 각 날짜 셀 우상단에 `WeatherIcon name={weatherIconKey(code)}`(absolute, h-3.5). `weatherLabel`을 WeatherStrip에서 export해 title/aria-label 재사용.

## 제약(불가피)
- 예보 창 = 오늘~+6일만 아이콘. 과거·먼 미래·예보창 밖은 아이콘 없음.
- 위치 의존 — 작업자 GPS 좌표(`fieldCoords`)가 있어야 동작. 가상작업자(VW-*)는 GPS 없음 → 폰 미연동 시 아이콘 없음(기존 WeatherStrip과 동일 전제).

## 검증 결과 (모두 통과)
- tsc=0, next build=0.
- Playwright(GPS 작업자 1명·슬롯·고정 daily7 주입) — 6월 뷰에서 예보 5일(06-26~06-30) 아이콘 정확 렌더, 라벨 맑음/대체로 맑음/구름 조금/흐림/비, 다음 달(07-01·02) 미표시, 다크모드 가독성 양호.
