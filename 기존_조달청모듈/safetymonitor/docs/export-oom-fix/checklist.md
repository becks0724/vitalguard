# 데이터 내보내기 OOM 수정 — 체크리스트

배경: DB 31만 건 성장으로 내보내기(미리보기·CSV·XLSX)가 전체 로드 → Node 힙 OOM → 컨테이너 사망(503) + 라이브 수집 순단. 진단 근거는 context-notes 참조.

## Phase 0 — 안전판 (코드 무변경)
- [ ] Cloud Run `--memory 1Gi` 상향 (분류기 차단 → 사용자 직접 실행 대기)
- [ ] 상향 후 리비전·메모리 검증

## Phase 1 — 저위험 수정
- [x] `exportSamples` SELECT * → ExportRow 25컬럼 명시 (raw_json 제외)
- [x] `severity.ts` HR_CAUTION 상수 추출 + SEVERITY_SQL_PARAMS (단일 소스)
- [x] `countSamplesBySeverity` — COUNT(*) FILTER SQL 집계 (임계 파라미터 바인딩)
- [x] `previewRecentSamples` — ORDER BY ts DESC LIMIT 50 푸시다운
- [x] 미리보기 라우트 전환 (+`countOnly=1` 지원, 응답 형태 불변)
- [x] TS↔SQL 판정 경계값 일치 테스트
- [x] UX: 드롭다운 "전체 (DB 누적 N건)" 명시화
- [x] UX: 날짜/작업자 변경 시 "기간 일치 N건" 배지 (디바운스 400ms)

## Phase 2 — CSV 스트리밍
- [x] `iterateExportRows` 키셋 페이지네이션 (ts,id) 커서·5,000행 배치
- [x] `idx_vs_ts_id` 인덱스 멱등 추가
- [x] CSV 라우트 ReadableStream 전환 (pull 백프레셔·BOM·현장정보 블록 보존)
- [x] 순수 CSV 헬퍼 `lib/export-csv.ts` 추출 + 골든마스터(형식 고정) 테스트
- [x] 중간 실패 시 controller.error (부분 파일 침묵 실패 방지)
- [x] 동시성 가드 (내보내기 1건 제한, 초과 429)
- [x] 관측 로그 (시작/완료/행수/소요 ms)

## Phase 3 — XLSX 상한
- [x] 시트2 생체데이터 최근 50,000건 상한 (`exportSamplesCapped`)
- [x] 초과 시 안내 행 삽입 ("전체는 CSV 이용") + x-vital-rows-total 헤더

## 검증 게이트
- [x] tsc 0 · lint 0err · 테스트 전체 통과 (149→164)
- [x] 로컬 실측 (실 DB 읽기 전용): SQL 카운트 = 라이브 베이스라인 일치 · 스트리밍 완주 행수 = COUNT 일치
- [ ] 배포 (cloudbuild.dashboard.yaml `_AI_URL` 보존)
- [ ] 라이브 검증: 불변 구간 미리보기 = 베이스라인(181,391/3,666/75,544) · 전체 기간 CSV 완주 · 다운로드 중 /api/mock/vital 200 · OOM 로그 0
- [ ] 커밋·push (Phase 단위)
