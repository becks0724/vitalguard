# 현장 구획(반경 100m) 이탈 알림 — 체크리스트

계획 = 작업자 GPS 가 현장 구획 원(지도 모드의 레드라인 원과 동일 중심·반경)을 벗어나면
관제 웹에 경보 팝업 + `alerts` DB 이력을 남긴다. 판정은 히스테리시스(GPS 지터 방어)로 안정화한다.
사용자 결정(2026-07-22) = 히스테리시스 + 화면 원과 동일 중심 채택, 알림 대상은 관제 웹(앱 푸시는 별도 트랙).

- [x] 순수 판정 모듈 `app/lib/geofence.ts` — 히스테리시스 상태머신 + 거리(m) 유틸
- [x] 단위 테스트 `app/lib/geofence.test.ts` — 경계 플리커 미발화·연속 초과 발화·복귀 후 재발화·비정상 입력
- [x] `lib/db.ts` `AlertType` 에 `"geofence"` 추가 (DDL 은 TEXT 라 마이그레이션 불필요)
- [x] `POST /api/alerts` 신규 — 세션 게이트, 구획 이탈 종류만 기록 허용 (SOS/낙상/생체는 서버 addSample 기록 유지)
- [x] `/api/alerts/ack` 허용 종류에 `geofence` 추가
- [x] `GeofenceAlertModal` 신규 — 앰버 주의 톤(사이렌 없음), 작업자·이탈 거리·지도 링크·확인/닫기
- [x] `DemoDashboard` 배선 — 구획 중심 단일 소스 승격 + 판정 effect + 팝업 우선순위(SOS>낙상>생체>이탈) + 복귀 시 ack 해제
- [x] 알림 이력 모달에 `구획 이탈` 라벨·톤·아이콘 추가
- [x] `/verify` — tsc 0 · lint 0 · test 전체 green
- [x] 커밋 + push (origin 전진 확인 후) — `9196a54` · origin 동기
- [x] `/deploy` + 라이브 검증 — `00111-b48`(digest a1068baf) · 루트 200 · POST 무인증 401 · 청크 문자열 6종 · 라이브 라우트 목 E2E PASS
