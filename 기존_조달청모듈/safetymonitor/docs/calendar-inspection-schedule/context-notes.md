# B5 — 캘린더 설비 점검 자동 일정 — 컨텍스트 노트

## 배경·왜
캘린더 트랙 후속 추천 1순위. AED 본체 배터리·전극패드는 실측 불가라 **교환 주기로만 관리**(48/24개월).
`lib/aed-status.ts`가 이미 `battDueDays`/`padDueDays`(주기×30 − 최근교체 경과일)를 계산한다.
이걸 **오늘 + dueDays = 교환 예정일**로 환산해 캘린더에 자동 표출하면, 수동 등록 없이 점검 캘린더가 완성된다.

## 결정
- **재사용** = `aed-status.ts`(D-day·심각도 단일 소스)·`aed-devices.ts`(레지스트리)·alarm route의 DB 조합 패턴
  (등록장비 `aed_registered_device` + 프리셋 `AED_DEVICES` + NFC 점검 `aed_inspections` + config `aed_config` loc 오버라이드).
- **순수 모듈** `inspection-schedule.ts` — I/O 없음, `todayMs` 주입(테스트 가능). dueDays→dueDateKey(KST)·severity·라벨.
  날짜 환산은 `todayMs + dueDays*86400000` 을 KST(+9h) 기준 YYYY-MM-DD 로.
- **API** `/api/inspection-schedule?from=&to=` — 조회는 세션 또는 앱JWT(캘린더 events/labels GET과 동일 게이트),
  `from`/`to` 윈도 필터. 등록장비+실/데모 프리셋 전부 대상(alarm route와 동일 조합).
- **읽기 전용** — 자동 파생 마커. 사용자 편집 불가(일정 이벤트와 별개 레이어). NFC 점검 태깅 시
  `aed_inspections`에 최근 교체가 쌓여 다음 예정일이 자동 앞당겨짐 = "점검→완료→다음 일정" 자동(추가 배선 0).
- **표출** — 셀엔 🔧 점검 칩(심각도색·개수, 날씨/미디어/위험 배지와 구분되는 렌치 아이콘). 상세는 선택 날짜
  패널 "설비 점검 예정" 섹션(장비·위치·항목·심각도·D-day). 셀 과밀 방지 위해 셀은 요약, 패널이 상세.
- **심각도** = `aedCycleSev`(dueDays<0 경과=danger·≤90 임박=caution·그외 normal). 캘린더엔 **임박·경과만** 강조,
  먼 미래(normal)도 예정일엔 표시(달 이동 시 노출).

## 범위 밖(후속)
- 가스감지기·기타 설비 = 고정 교환주기 데이터 없음(가스는 실측 방전곡선) → 이번 제외.
- 마커에서 AED 탭/NFC 점검 페이지로 딥링크 = 후속(선택).

## 진행 로그
- 2026-07-24 계획·구현 착수(Opus 트랙 — 기존 패턴 재사용 소규모 기능).
