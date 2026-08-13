# 사고 조사 뷰 — 체크리스트 (2026-08-13 착수)

목적 = 산업재해 발생 시 **발생 시점 전후의 생체 데이터로 보고자료를 만드는** 조사 도구 + 사고 구간 보존 마킹.
사용자 결정(08-13) = ① 사고 조사 뷰 착수 ② **보존 = 사고 구간 3년**(KOSHA 축·전체 원시 데이터는 현행 무삭제 유지).

## 설계 요점 (근거 = context-notes.md)

- 사고 등록(incidents 테이블) = 조사 앵커 + **3년 보존 마킹의 단일 원장**. 원시 데이터 삭제 정책 도입 시 이 테이블 구간 선제외가 룰.
- 조회 창 = 사고 시각 **전후 대칭**(기본 24h = 전 12h·후 12h), hours ∈ {6,12,24,48}.
- 시계열 = 심박(버킷 평균)·SpO₂(측정점)·활동 에너지(버킷 합)·심부체온 추정(60s 버킷 → 칼만 재계산·창 시작 90분 전 심박부터 당겨 워밍업 공백 최소화) + 이벤트(alerts: SOS·낙상, 대응 시각 포함).
- 추정 체온 7일 상한과 무충돌 — 조사 창 ≤48h(모델 검증 범위 안·특정일 상세는 상한의 취지 밖).
- 인증 = `hasAdminMenuAccess`(기존 admin/export 라우트와 동일 게이트). UI = 관리자 모달 안 탭.

## Phase 1 — 서버 코어

- [x] `lib/db.ts` — `incidents` 테이블(3년 보존 주석·인덱스) + `insertIncident`/`listIncidents` + `activeEnergyBucketSums` + `alertsBetween`
- [x] `lib/incident-report.ts` — 순수 헬퍼(창 계산·hours 화이트리스트·CSV 직렬화)
- [x] `app/api/admin/incidents/route.ts` — GET(목록)/POST(등록·검증)
- [x] `app/api/admin/incidents/data/route.ts` — GET(시계열 4종+이벤트+메타)
- [x] 단위 테스트(순수 헬퍼) + 가드(보존 주석·인증 게이트·추정 재계산 경로)

## Phase 2 — UI

- [x] `app/components/IncidentReview.tsx` — 등록 폼·사고 목록·조사 패널(차트 4종+이벤트 타임라인)·CSV 내보내기
- [x] `AdminExportModal.tsx` — 탭 전환([산업재해 자료]·[사고 조사]) 최소 연결

## Phase 3 — 검증·기록

- [x] verify 3종(tsc·lint·test) + 가드 음성 대조
- [ ] 라이브 배포(사용자 /deploy) + 등록→조회→CSV 실측
- [x] 보존 정책 명문화 — db.ts 주석·context-notes(체크리스트 겸)·CLAUDE.md Status(트랙 종료 시)
