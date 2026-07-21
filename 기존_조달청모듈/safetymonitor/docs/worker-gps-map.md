# 작업자 GPS 지도 모드 — 구조·결정 기록 (2026-07-21 구축·라이브 `00110-mth`)

작업자 모니터링의 지도 뷰(위성/지적도·마커·생체 툴팁·구획 원) 트랙의 결정과 구조를 보존한다.
커밋 계보 = `ef3be1c`(지도 모드) → `38475d9`(수신 상태 펼침) → `77165ec`(구획 원+줌 버튼 fix) → `86f8fbb`(반경 100m·중심 고정) → `42d652a`(VWorld 연동).

## 1. 구조

```
[작업자 모니터링 헤더]  지도/표 토글 (workerView state · 세션 한정)
   → 표 모드: 기존 12열 표(자동/수동 슬라이딩) 그대로
   → 지도 모드: WorkerGpsMap
[WorkerGpsMap] (app/components/WorkerGpsMap.tsx — 독립 슬리피맵, TyphoonTrack 수학 계승·z18 고줌)
   ├─ 베이스맵 토글 [위성|지적도] (좌상단)
   │    위성   = Esri World_Imagery + Reference 라벨 (키·비용 0 · 브라우저 직결)
   │    지적도 = VWorld 베이스(WMTS Base) + 연속지적도(WMS lp_pa_cbnd_bubun) — /api/vworld-tile 프록시 경유
   ├─ 작업자 마커 = 신호등 톤 점(위험 블링크) + 이름 칩 + 호버 생체 툴팁(심박·SpO₂·손목온도·상태·수신 age)
   ├─ 현장 구획 근사 원 = 레드라인 반경 100m + 라벨 (마커 아래 레이어·이벤트 통과)
   ├─ 수신 상태 칩 "GPS 수신 N / 전체 M" → 클릭 펼침(수신 중=flyTo / 미수신=사유) · 드래그 시 닫힘
   └─ 줌 컨트롤(＋/－/⌂) · 휠 줌(커서 기준) · 드래그 팬
[데이터 배선] (DemoDashboard)
   ├─ workerMapData: 등록 슬롯 × 한국범위 GPS 게이트(fieldCoords 동일 32.5~39.5/123.5~132.5)
   │    제외 사유 4종 = 미접속(샘플 없음) / 가상 작업자 / GPS 미포함(권한·PII 게이트) / 한국범위 밖
   └─ 구획 원 중심 우선순위 = ①주소 지오코딩(siteAnchor·VWorld) → ②서버 캐시 좌표(site_coord_daily) → ③라이브 GPS 평균
```

## 2. 핵심 결정과 근거

- **지도 제공자 = Esri(위성) + VWorld(지적도·지오코더), Naver/Google SDK 미채택.** 판단 요청에 대한 결론 = 국내 정확도 Naver > Google(지오데이터 반출 제한으로 Google 국내 열세·비추천). 다만 마커를 직접 그리는 관제 용도에선 상용 SDK의 라벨 정밀도가 불필요해 **키·비용 0인 Esri 재사용**(태풍 진로와 동일 소스)으로 시작, 지적도·주소 지오코딩은 **VWorld 무료 키**로 해결. Naver 필요 시(로드뷰 등) 타일 교체 가능 구조.
- **주소 → 구획은 3안 검토 후 근사 원(③) 채택**(사용자 결정). ①지적도 필지 자동(키 필요·필지≠공사부지 위험) ②관리자 수동 폴리곤(정확·권장이었음) ③현장 좌표 반경 원(즉시). 이후 VWorld 키 확보로 **중심만 주소 지오코딩으로 승격**(반경 100m 상수 `SITE_CIRCLE_RADIUS_M`).
- **무키 지오코딩 불가 실측** — Nominatim(OSM)은 한국 건물번호 미해석(도로 중심 ~800m 오차), 기존 NCP 키는 Maps 미활성(401). → VWorld 지오코더가 "중앙로 196 → 금남로3가" **건물 단위 정확**(도로명 실패 시 지번 재시도·주소별 6h 캐시).
- **VWorld 키는 서버 전용** — 클라 비노출. 지오코딩 = `/api/site-geocode`(로그인 세션 게이트 = 쿼터 남용 방지), 타일 = `/api/vworld-tile`(공개 지도 타일이라 무인증 — 레이더 프록시 선례, 1일 캐시로 쿼터·부하 절감). **연속지적도 WMS는 등록 도메인 Referer 검증 필수**(실측 — 없으면 INCORRECT_KEY) → 프록시가 Referer 부착.
- **마커 데이터는 표와 동일 소스** — workerStatus(활동 게이트 포함 worst-of)·signalLevel·직급 오버라이드 재사용, 지도 전용 판정 로직 없음(임계 단일 소스 유지).
- **미수신도 명단·사유로 노출** — "몇 명 빠졌는지"가 아니라 "누가 왜 안 보이는지"를 관제자가 즉시 알게(펼침 패널). GPS 0명일 때 placeholder 에도 명단 표시.

## 3. 실측이 잡은 함정

- **지도 컨테이너 `setPointerCapture`(드래그 팬)가 내부 버튼 클릭을 삼킴** — 줌 버튼(＋/－/⌂)이 무반응이었고 E2E 줌 연동 검증이 적발. 지도 위 오버레이 컨트롤은 반드시 `onPointerDown={e => e.stopPropagation()}`.
- **dev-browser(QuickJS) `route.fulfill` 은 응답 미완결**(요청 pending) — 라우트 목 E2E는 `~/.dev-browser/node_modules/playwright-core` 직접 구동으로 전환(worker-map-e2e 패턴).
- **합성 위험 생체값은 경보 모달을 실제로 발화**(정상 동작이 테스트 방해) — ESC(dismiss=ack)로 닫고, vital ack 는 ts 재발화 특성이 있어 위험 워커 ts 고정.
- 반경 원 미터→픽셀 = `156543.03392·cos(lat)/2^z` — 줌 1단당 픽셀 반경 정확히 2배 변화로 검산(307↔154px).

## 4. 운영 메모

- **반경 조정** = [DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx) `SITE_CIRCLE_RADIUS_M`(현 100m) 상수 1줄.
- **원 중심은 현장정보 주소를 따라감** — 관리자 메뉴에서 주소 저장 시 자동 재지오코딩(6h 캐시). 주소 위치(금남로3가)와 작업자 기기 실위치가 다르면 원·마커가 떨어져 보이는 것이 정상.
- **VWORLD_KEY** = `.env.local` + Cloud Run 시크릿(17종째·사용자 stdin 등록). 미설정 배포에선 위성 모드·기존 기능 정상, 지적도 타일 503·주소 중심만 폴백.
- 키 유효기간 만료 시 VWorld 마이페이지에서 연장 필요(만료 시 지적도·주소 중심이 조용히 폴백됨 — 지오코드 응답 `configured:false` 확인).

## 5. 남은 확장 후보 (착수 전 결정 필요)

1. **필지 경계 폴리곤 레드라인** — VWorld 데이터 API(GetFeature·LP_PA_CBND_BUBUN geomFilter=POINT)로 주소 필지 폴리곤을 받아 원 대신/병행 표시. 공사부지가 다필지면 수동 폴리곤(②안)이 정답.
2. **현장 환경 역지오코딩** — GPS→지역명 표기(이전 검토 항목)가 VWorld 로도 가능해짐(NCP Maps 불필요).
3. 지도 모드 영속화(localStorage)·다크/라이트 라벨 톤 튜닝 — 필요 시.
