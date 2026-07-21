# 데이터 내보내기 OOM 수정 — 컨텍스트 노트 (2026-07-21)

## 진단 (확증 완료)
- 증상: 관리자 데이터 내보내기에서 HTTP 503. 전체+1개월(313,216건) 시 재현.
- Cloud Run 로그 확증: `GET /api/admin/export?...` 직후 `FATAL ERROR: Reached heap limit — JavaScript heap out of memory` → `Container terminated on signal 6` → 503. 같은 순간 `/api/mock/vital`·`/api/gaspod/telemetry`도 503 = **내보내기가 라이브 관제를 순단시킴**.
- 근본 원인: `exportSamples`가 `SELECT *`(raw_json 포함, LIMIT 없음)로 기간 전 행을 메모리 로드. raw_json(행당 1~2KB)은 미리보기/CSV/XLSX 세 소비처 모두 **미사용**인데 실려 옴. 미리보기는 전체 로드 후 마지막 50건만 사용. 과거 6.8만 건 시절엔 통과, 31만 건에서 한계 초과(512Mi).

## 결정과 근거
- **안정성 우선 4단계**: Phase 0 메모리 1Gi 안전판(무코드·즉시 롤백) → Phase 1 저위험(raw_json 제외·미리보기 SQL 푸시다운·UX) → Phase 2 CSV 키셋 스트리밍(근본) → Phase 3 XLSX 상한. 각 단계 독립 커밋·독립 배포·독립 롤백.
- **임계 단일 소스 유지**: SQL 집계에 임계값을 하드코딩하지 않고 `SEVERITY_SQL_PARAMS`(THRESHOLDS + HR_CAUTION 파생)를 쿼리 파라미터로 바인딩. 과거 감사 M5(임계 중복) 재발 방지. HR 주의 110/50은 severity.ts 인라인이던 것을 HR_CAUTION 상수로 추출(동작 불변).
- **XLSX는 상한(A안)**: exceljs 스트리밍 라이터(B안)는 이상치 셀 색칠 재작성 회귀 위험 → 기각. 전체 원본 책임은 스트리밍 CSV가 짐. 상한 5만 건 + 초과 시 안내 행.
- **동시성 가드**: 모듈 스코프 카운터(인스턴스당 1건). maxScale 4라 완전 전역 아님을 인지 — 목적은 "한 관리자의 중복 클릭·다중 관리자 동시 클릭"의 메모리 중첩 방지로 충분.
- **키셋 커서 (ts,id)**: OFFSET 페이지네이션은 후반 페이지 비용 증가 + 삽입 중 중복/누락 위험 → 키셋. `(ts,id) > ($cursor)` 행 비교. 전용 인덱스 `idx_vs_ts_id` 멱등 추가(기존 idx_vs_ts는 단일 컬럼).
- **미리보기 정렬 규약**: 기존 응답이 최근순(DESC)이었으므로 `ORDER BY ts DESC LIMIT 50` 그대로 반환(클라 변경 0). CSV는 기존과 동일 ASC(+id 타이브레이크 추가 — 동일 ts 다건 시 순서 결정화, 기존은 불안정 정렬이라 형식 위반 아님).

## 회귀 검증 앵커 (배포 전 라이브에서 확보)
- 불변 과거 구간 `from=2026-06-30T15:00:00.000Z` `to=2026-07-20T14:59:59.000Z` (KST 07-01 00:00 ~ 07-20 23:59, append-only DB라 불변).
- **베이스라인: totalMatched=181,391 · dangerCount=3,666 · cautionCount=75,544** (구현 전 라이브 TS 로직 산출값).
- 배포 후 같은 호출이 정확히 같은 숫자를 반환해야 SQL 이관 무결 판정.

## 실측이 잡은 결함 — SQL 3치 논리 (2026-07-21)
- 최초 SQL 집계가 total·danger 는 정확한데 **caution=0**. 원인 = `fall_detected = 1` 에서 컬럼 NULL 이면 결과가 false 아닌 **NULL**, `NOT (… OR NULL)` 도 NULL → caution FILTER 전부 탈락.
- TS 미러 테스트(7,875 조합)로는 원리적으로 못 잡는 유형 — JS 에는 3치 논리가 없음. **실 DB 베이스라인 대조가 잡아냄** = "임계 이관은 실데이터 대조 필수" 재확인.
- 수정 = `COALESCE(fall_detected,0) = 1` (manual_sos 동일) → 조건 전체가 항상 확정 boolean. 수정 후 3값 전부 라이브 베이스라인과 정확 일치.

## 함정·메모
- ExportRow 타입은 원래 raw_json 없는 25컬럼 — SELECT * 가 타입보다 넓게 가져오던 것이라 명시 컬럼화는 타입 변경 0.
- pg 풀 statement_timeout 30s — 배치 쿼리(5,000행)는 여유. 과거 전체 SELECT는 이 한계에도 근접했을 것.
- ReadableStream은 `pull()` 패턴 사용 — start에서 전부 enqueue하면 내부 큐가 무한 성장(백프레셔 무시). pull이 highWaterMark 이하일 때만 불려 자연 백프레셔.
- Cloud Run /tmp는 tmpfs(=메모리)라 "임시파일로 우회"는 메모리 절감이 아님 — 스트리밍 직송이 정답.
- Phase 0 gcloud services update는 자동 승인 분류기가 차단(프로덕션 변경) → 사용자 직접 실행로 전환.

## 확장 — CSV v2 결정 (2026-07-21)
- **append-only 규약.** 스트레스 입력 7종+`stress_index`를 기존 22컬럼 **뒤에만** 추가. 중간 삽입은 위치 기반 소비(엑셀 매크로·제출 양식)를 깨므로 금지. 이후 컬럼 확장도 동일 원칙.
- **지수 계산은 보수적.** 행 단위 `computeStressIndex`(population baseline 폴백). 입력이 전무하거나 활동 데이터 없는 심박 단독 행은 calibrating → 빈 칸. 억지 추정으로 채우지 않는다(라이브 실측: 하루 4.8만 행 중 386건 채움 = 워치가 스트레스 입력을 보낸 행만).
- **XLSX 미적용.** 요청 범위가 CSV 한정 — XLSX 시트 확장은 별도 결정.
- **골든마스터에 독립 검산값.** stress_index 기대값 53은 구현 출력 복사가 아니라 사양 수식으로 따로 계산해 넣음 — 배선·계산을 자기참조 없이 검증.

## 병렬 세션 배포 프로토콜 (같은 날 실증)
- 팀원/main-2 세션이 같은 main·같은 Cloud Run 을 공유 — **배포 직전 `git fetch`로 origin 전진 여부 확인** 필수. 전진 발견(`692723e`) → 기존 digest 폐기, pull·재검증·재빌드 후 배포(구식 이미지 배포 = 팀원 변경 롤백 사고).
- main-2는 "우리 배포를 감시 대기"였음 — 병렬 세션 간 서로 대기 교착이 생길 수 있으니 배포 주체를 명시적으로 정할 것.
