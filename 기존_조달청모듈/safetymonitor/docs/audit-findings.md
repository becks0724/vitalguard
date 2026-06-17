<!-- 코드베이스 종합 Audit 결과·수정 추적 (2026-06-03 세션17) -->
# SafetyMonitor — 코드베이스 종합 Audit 결과 / 수정 트래커

> 2026-06-03 세션17. 사용자 요청으로 전체 코드베이스를 9차원 멀티에이전트 Workflow + adversarial 검증으로 스캔한 결과와, 그에 따른 수정 체크리스트.
>
> **산출물**. PDF [audit-report-20260603.pdf](./audit-report-20260603.pdf) · HTML 소스 [audit-report-20260603.html](./audit-report-20260603.html) · 본 트래커(수정 진척용).
>
> **원칙**. audit 자체는 **read-only(파일 무수정·보고 전용)**. 모든 발견은 `file:line` + 실제 코드 인용 + adversarial 검증을 거침.

---

## 지금까지 작업 (Audit 수행)

- **범위**. dashboard-web(Next.js) · backend/infrastructure(AWS CDK) · worker-phone(Flutter) · worker-watch-poc(watchOS) · packages(analyzers/schemas) · scripts. 제외 = node_modules · cdk.out · .next · build 산출물.
- **방식**. 9차원(타입안전성·보안·정확성·성능·아키텍처·테스트·의존성·dead code·문서일관성)을 독립 finder 서브에이전트로 병렬 스캔 → 발견사항별 adversarial 에이전트가 인용 코드를 재확인해 false positive 제거 → severity 재조정.
- **3회 Workflow로 완주**. ① 1차: 9차원 중 보안·정확성·dead code 3개만 구조화 출력 성공, 나머지 6개는 finder가 탐색 예산 소진 후 StructuredOutput 미호출로 실패. ② 2차: 실패한 6개 재실행(효율·출력 강제 지침 추가) → 테스트·의존성·문서 성공, 타입안전성·성능·아키텍처는 **검증 에이전트가 전원 실패해 결과 유실**. ③ 3차: 유실된 3개 차원을 **finder 자체검증 방식**(별도 verify 단계 제거 — 한 에이전트가 인용 코드 재확인 후 확정분만 보고)으로 메움 → 안정 완주.
- **PDF 작성**. HTML 보고서 작성 → Chrome 헤드리스 `--print-to-pdf`로 변환 → **AppleSDGothicNeo(한글)+Menlo(코드) 서브셋 임베드 검증**(한글 정상 출력), 6쪽 972KB.

## 현재 상태 (결과)

- **확정 23건** (중복 1건 제거 후) · **false positive 10건+ adversarial 제거**.

| Severity | 건수 |
|---|---|
| 🔴 CRITICAL | **0** |
| 🟠 HIGH | **0** |
| 🟡 MEDIUM | **5** |
| ⚪ LOW | **18** |

- **핵심 판정**. CRITICAL/HIGH 0은 결함 부재가 아니라 **프로토타입 스코프**(세션마다 회전하는 추측불가 임시 터널 · 합성/직원 데이터 · dev `127.0.0.1` 바인딩) 때문. "실서비스라면 HIGH"인 항목(PII 미인증 노출·기본 관리자 비밀번호)이 실제 실행 경로 기준으로 MEDIUM 강등 → **발표 후 실서비스화의 첫 관문이 MEDIUM 5건에 모임**.
- **양호 항목(검증됨)**. ✅ performance **CLEAN**(모든 useEffect cleanup·Flutter dispose·prepared statement 재사용) · analyzers 순수성 OK(I/O 없음) · 순환참조 0 · backend↔dashboard 계층 침범 0 · Swift force-unwrap/`try!`/`as!` 0 · Dart `!` 전부 `== null ||` 가드.
- **코드 변경 0**. main 여전 `ahead 53` + 미커밋 audit 산출물 3파일(`docs/audit-report-20260603.pdf`·`.html`·본 파일).

## 다음 할 일 (우선순위별 수정 체크리스트)

> **✅ 2026-06-03 수정 완료** — 그룹 A·C·정확성·테스트·위생 전부 적용. 검증: 전체 `tsc` 통과 + 테스트 **38/38**(analyzers 15·schemas 9·dashboard 14). 미커밋 코드 변경을 커밋 예정.
> **남은 사용자 액션(코드 외)**: ① `.env.local` `ADMIN_PASSWORD` 를 `safety2026`(audit 노출)에서 강한 값으로 회전 ② 데모 SOS 보호자 연락/지도 필요 시 `.env.local` `MOCK_VITAL_EXPOSE_PII=true`(신뢰 환경 한정) ③ Flutter 재빌드 전 `flutter pub get`(geolocator 핀 제거 반영).

### A. 공개 터널 노출 전 필수 — PII 차단
- [x] **M1** GET `/api/mock/vital`에 인증 적용 또는 PII 필드(전화·좌표·이름) strip — `route.ts:12-19`
- [x] **M2** `.env.local`에 `ADMIN_PASSWORD` 설정 + 코드 fallback fail-closed, `.env.example` 빈 placeholder화 — `admin-auth.ts:5-7`
- [x] **L3** 세션 토큰을 비밀번호 평문에서 분리(opaque 세션 id + TTL 또는 단기 JWT) — `login/route.ts:39-41`

### B. 빠른 정확성 패치
- [x] **L2** weather route `workerCount` 가드 — raw 파라미터 `null` 체크(1줄) — `weather/route.ts:92-97`
- [x] **L1** sticky `latestByWorker` max-ts 가드(ts 역행 시 skip) — `store.ts:78-113`

### C. 단일 source 복구 (발표 전 권장)
- [x] **M5** `DemoDashboard.tsx`의 `heartRateStatus/spo2Status/coreTempStatus/overallStatus` 삭제 후 `lib/severity.ts` import → `THRESHOLDS` 단일 source 복원 — `DemoDashboard.tsx:160-180`
- [x] **M4** dashboard `tsconfig.json`을 `"extends": "../../tsconfig.base.json"`로(또는 `noUncheckedIndexedAccess: true` 명시) — `tsconfig.json`

### D. 테스트 부채
- [x] **M3** dashboard-web 테스트 러너 도입 + `store.ts` 테스트(리맵·reserved null·sticky/비-sticky) — `store.ts`
- [x] **L4** `packages/schemas/src/vital-stream.test.ts` 추가(경계값) → no-op `test` 스크립트 실동작화
- [x] **L5** `lib/severity.test.ts` 추가(caution 밴드 경계 40/41/50/110/130 등)

### E. 위생 (저위험 일괄)
- [x] **L6~L11** dead code 6건 제거 또는 "미연결 스캐폴딩" 주석 — `SafetyMonitorLogo`·`SEVERITY_TEXT_CLASS`·`persistedByWorker`·`ADMIN_ID_HINT`·`connectMqtt`(+`mqtt_client`)·`schemas/worker.ts`
- [x] **L12** `pubspec.yaml`에서 `geolocator_android/_apple` 직접 핀 제거
- [x] **L17/L18** 타입 캐스트 정리 — `db.ts:436` `| undefined` 캐스트 · `vital/route.ts:53` `catch (error: unknown)`
- [x] **L13~L16** 문서 갱신 — CLAUDE.md `# turbo` 주석·backend README stale(현재 git M)·"4 worker"→5·CLAUDE.md 코드 트리 미존재 경로 표기
- [x] audit 산출물(PDF/HTML/본 파일) **커밋 여부 결정**(또는 PDF만 `.gitignore`)

---

## 발견사항 전체 목록

### 🟡 MEDIUM (5)

| ID | 차원 | 제목 | 위치 |
|---|---|---|---|
| M1 | 보안 | 미인증 GET `/api/mock/vital` 이 보호자 전화·GPS·이름 PII를 공개 터널로 유출 | `apps/dashboard-web/app/api/mock/vital/route.ts:12-19` |
| M2 | 보안+의존성 | 기본 관리자 자격증명 `admin/safety2026`(소스 fallback + `.env.example` 실동작값) → PII export 게이트 | `apps/dashboard-web/lib/admin-auth.ts:5-7` |
| M3 | 테스트 | 핵심 수신 게이트 `store.ts` 테스트 0건(sticky merge 회귀 함정) | `apps/dashboard-web/app/api/mock/store.ts:29-119` |
| M4 | 타입안전성 | dashboard `tsconfig`가 base 미상속 → `noUncheckedIndexedAccess` 누락(최대 런타임 표면 배열 인덱스 미검사) | `apps/dashboard-web/tsconfig.json` |
| M5 | 아키텍처 | vital 임계 분류 로직이 `DemoDashboard.tsx`에 매직넘버(130/40/110/50, 88/92)로 중복 → `THRESHOLDS` 단일 source 우회(HR/SpO₂). `overallStatus` 동명 두 구현 거동 상이 | `apps/dashboard-web/app/components/DemoDashboard.tsx:160-180` |

### ⚪ LOW (18)

| ID | 차원 | 제목 | 위치 |
|---|---|---|---|
| L1 | 정확성 | 워치 backlog 역순 수신 시 sticky `latestByWorker` ts 역행(신선도 바 오표시, 자가복구·SOS 경로 안전) | `store.ts:78-113` |
| L2 | 정확성 | weather route가 `workers` 파라미터 부재 시 `workerCount=0` 영속(`Number(null)===0`) | `weather/route.ts:92-97` |
| L3 | 보안 | 세션 토큰 = 가역 base64(id:password), 만료 없음 | `login/route.ts:39-41` |
| L4 | 테스트 | `VitalSampleSchema` 테스트 0 + `test` 스크립트가 매칭 0개라 no-op 통과 | `packages/schemas/src/vital-stream.ts:4-31` |
| L5 | 테스트 | dashboard `severity.ts` 미테스트(사용 경로, caution 밴드 41-50 고유·미검증) | `lib/severity.ts:15-61` |
| L6 | dead code | `SafetyMonitorLogo` 컴포넌트 렌더 0 | `DemoDashboard.tsx:1655` |
| L7 | dead code | `SEVERITY_TEXT_CLASS` export 소비 0 | `weather-rules.ts:351` |
| L8 | dead code | `persistedByWorker` DB 함수 호출 0(store.countsByWorker로 대체) | `db.ts:351` |
| L9 | dead code | `ADMIN_ID_HINT` export 사용 0 | `admin-auth.ts:40` |
| L10 | dead code | `connectMqtt` 미호출 → MQTT 분기 도달불가(AWS 보류 스캐폴딩, `mqtt_client` 의존성도 이 경로용) | `vital_publisher.dart:46` |
| L11 | dead code | `WorkerSchema/Worker·HazardType·Severity·HazardEventSchema` 외부 사용 0(미구현 백엔드용 forward 스캐폴딩) | `packages/schemas/src/worker.ts:4-13` |
| L12 | 의존성 | `geolocator_android/_apple` 직접 핀이 umbrella와 중복(직접 import 0) | `pubspec.yaml:39-41` |
| L13 | 문서 | CLAUDE.md `# turbo run build/test` 주석 — turbo 부재, 실제 `pnpm -r --filter` | `CLAUDE.md:205-206` |
| L14 | 문서 | `backend/README.md` 상태 stale(2026-05-27·D2~75%·만료 터널·마감 06-04) ↔ CLAUDE.md(D2~88%·07-07). 현재 git M | `backend/infrastructure/README.md:3` |
| L15 | 문서 | README "4 worker" vs `mock-publish.mjs` 5 worker | `backend/infrastructure/README.md:45` |
| L16 | 문서 | CLAUDE.md 코드구조 트리가 미존재 경로 나열(`dashboard-mobile`·`backend/lambdas/*`·`packages/thresholds`·`.github` 등; "M1 진입 후 채움" 미래 트리) | `CLAUDE.md:243-261` |
| L17 | 타입안전성 | `persistSiteInfoDaily`가 `.get()`(`Row|undefined`)를 비-nullable `SiteInfoRow`로 강제 캐스트(440행은 올바름) | `db.ts:436` |
| L18 | 타입안전성 | `catch (error: any)`(TS 소스 유일 `: any`) → `unknown` 권장 | `vital/route.ts:53` |

### 검증으로 제거된 대표 false positive (10건+)

| 오탐 후보 | 제거 사유 |
|---|---|
| 미인증 POST 무한 적재(DB DoS) | 임시 회전 터널 + 합성 데이터, 실 blast radius 미미 |
| HR/SpO₂ "sustained" 단일샘플 발동 | 분석기 함수 **프로덕션 호출처 0** — 서버측 분석은 발표 후(미도달 경로) |
| SOS 80-window eviction | 실 수신율(1~2/s)로 2s 폴 안에 SOS 샘플 밀림 불가 |
| kma-warning (0,0) fallback | UI가 `undefined` 시 fetch 자체 안 함(미도달) |
| `pnpm test`가 dashboard 제외 | dashboard에 테스트 자체 없어 손실 0 |
| mqtt_client 구조적 dead | 의도된 AWS 로드맵 스캐폴딩(문서화), runtime 영향 0 |

---

## 결론

**CRITICAL/HIGH 0 — 프로토타입으로서 견고**(성능 누수 0·분석기 순수성·계층 분리·null 안전성 양호). 단 "발표 후 실서비스화"의 첫 관문은 **MEDIUM 5건**이며, 이 중 **M5(임계 로직 중복)는 지금도 "THRESHOLDS 단일 source" 문서 보장을 깨고 있어** 발표 전 정리 권장. 공개 터널 시연 시 그 직전 **그룹 A(PII 차단 3건)**가 최우선.
