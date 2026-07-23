# 작업자 지도 확장(worker-map-plus) 체크리스트

2026-07-22 착수. 1·2순위 5기능 — ①연결끊김 고스트 마커 ②알림→지도 포커스 ③이동 경로 트레일 ④위험구역 진입 경보 ⑤필지 경계 폴리곤.
결정·근거는 [context-notes.md](./context-notes.md).

## ① 연결끊김 고스트 마커 (지도 false-OK 수정)

- [x] `WorkerMapPoint` 에 `stale` 필드 추가 — `workerMapData` 에서 ageSec ≥ 60(STALE_MS 동일)이면 true + 상태 라벨 "연결끊김"
- [x] 마커 렌더 — stale 시 회색·반투명·점선 링 + 이름 칩에 경과 병기, 툴팁 상태 "연결끊김(마지막 위치)"
- [x] 수신 상태 패널 — stale 을 "연결끊김(마지막 위치)" 그룹으로 분리 표기
- [x] geofence 판정 무영향 확인(이미 ageSec ≥ 60 보류)

## ② 알림 모달 → 지도 포커스

- [x] DemoDashboard `mapFocus` state + 12초 자동 해제
- [x] `SosAlertModal`·`GeofenceAlertModal` 에 옵셔널 `onShowMap` — "관제 지도에서 보기" 버튼(기존 Google Maps 링크 유지)
- [x] `WorkerGpsMap` `focus` prop — 초기 프레이밍보다 우선, focus 변경 시 flyTo(z18) + 펄스 링 표시

## ③ 이동 경로 트레일

- [x] 순수 유틸 `app/lib/track.ts` — 한국범위 게이트 + 균등 다운샘플(마지막 점 보존) + 단위테스트
- [x] db `listWorkerTrack(workerIds, sinceIso, limit)` — 좌표 보유 행만 ts 오름차순
- [x] `GET /api/monitor/track` — 세션 게이트(verifyBasicAuth), 별칭(worker_alias) 포함, mins 기본 30
- [x] 지도 — 마커 클릭 = 트레일 토글, SVG 폴리라인 + 시작점, 활성 칩(이름·30분·해제), 15초 갱신
- [ ] E2E(라우트 목) — 목 트랙 → 폴리라인 렌더

## ④ 위험구역 진입 경보

- [ ] `geofence.ts` `stepZoneEntry`(진입 히스테리시스 미러) + 단위테스트
- [ ] db `danger_zone` 테이블(멱등) + list/create/delete
- [ ] `/api/danger-zones` — GET 세션 / POST·DELETE 권한있음(hasAdminMenuAccess) 서버 강제
- [ ] 지도 — 존 오렌지 원+이름 라벨, 권한있음 전용 "＋구역" 배치 모드(클릭 중심 지정→이름·반경 폼), 라벨 클릭 삭제
- [ ] 판정 effect — 워커×존 상태, fresh 게이트(60초), 진입 확정 시 `POST /api/alerts type=danger_zone` + 팝업
- [ ] 팝업 — GeofenceAlertModal `kind="entry"`(오렌지 톤·구역명), 우선순위 SOS>낙상>생체>위험구역>구획 이탈
- [ ] 알림 이력 — AlertType `danger_zone` + 라벨 "위험구역 진입" + 아이콘/톤(AlertHistoryModal·AdminExportModal)
- [ ] E2E(라우트 목) — 진입 시퀀스 → 팝업 + 이력 POST 1건

## ⑤ 필지 경계 폴리곤

- [ ] VWorld 데이터 API(GetFeature·LP_PA_CBND_BUBUN) 원키 프로브 — 실좌표로 응답 구조 확정
- [ ] `lib/vworld.ts` `fetchParcelPolygon(lat, lon)` — 6h 캐시·graceful
- [ ] `GET /api/site-parcel` — 세션 게이트, 외곽 링 반환
- [ ] 지도 — 폴리곤 레드라인 렌더, 있으면 구획 원은 점선 보조(판정은 원 유지)
- [ ] E2E(라우트 목) — 목 폴리곤 → SVG 렌더

## 공통 검증

- [ ] tsc 0 · lint 0err · 전체 테스트 green(신규 단위테스트 포함)
- [ ] 라우트 목 Playwright E2E(로컬 dev·프로덕션 DB 무접촉)
- [ ] 기능 단위 커밋(5개) + push
- [ ] 배포는 사용자 `/deploy` 대기(분류기 차단 — 빌드 선완료 가능)
