# 수집 경로에서 "mock" 지우기 — 실행 체크리스트 (2026-08-18 착수)

설계·근거는 [plan.md](./plan.md). 이 문서는 **확정된 명칭과 진행 상태**만 담는다.

## 0. 확정 명칭 (사용자 결정 2026-08-18)

계획서 초안은 관제 읽기를 `/api/vital` 로 잡았으나, **사용자 결정으로 `/api/monitor/*` 대칭**을 택했다.
근거 = 이 레포에 관제 전용 네임스페이스가 이미 있다(`monitor/site-coord`·`monitor/slots`·`monitor/track`).
⟹ **앱이 쓰는 것 = `/api/app/*` · 관제가 쓰는 것 = `/api/monitor/*`** 로 축이 갈린다.

### URL

| 현재 | 개명 후 | 용도 |
|---|---|---|
| `POST /api/mock/vital` | **소멸 → 404** | 구 앱 차단(이 작업의 목적 ①) |
| `GET /api/mock/vital` | **`GET /api/monitor/vital`** | 관제 폴링 |
| `GET /api/mock/history` | **`GET /api/monitor/vital/history`** | 생체 이력 |
| `POST /api/app/vital` | 유지 | 수집 — **신규 앱 무변경** |

### 파일

```
app/api/mock/vital/route.ts                   →  app/api/app/vital/route.ts        ★ 본체(GET+POST)
app/api/mock/store.ts                         →  app/api/app/vital/store.ts        ★ 파이프라인 본체
app/api/mock/store.test.ts                    →  app/api/app/vital/store.test.ts
app/api/mock/store.persist-alert.guard.test.ts→  app/api/app/vital/store.persist-alert.guard.test.ts
app/api/mock/vital-batch-limit.test.ts        →  app/api/app/vital/vital-batch-limit.test.ts
(신설)                                        →  app/api/monitor/vital/route.ts     GET 재수출
app/api/mock/history/route.ts                 →  app/api/monitor/vital/history/route.ts
app/api/mock/history/data.ts                  →  app/api/monitor/vital/history/data.ts
app/api/mock/history/real.ts                  →  app/api/monitor/vital/history/real.ts
app/api/mock/history-kst.test.ts              →  app/api/monitor/vital/history-kst.test.ts
app/api/mock/                                 →  삭제
```

**본체와 별칭이 뒤바뀐다** — 지금은 `app/vital/route.ts` 가 `mock/vital/route.ts` 를 재수출하는 껍데기다.
개명 후에는 `app/vital/route.ts` 가 본체이고 `monitor/vital/route.ts` 가 **GET 만** 재수출한다
(POST 를 재수출하지 않는 것이 요점 — 수집 진입점이 하나로 좁혀진다).

`store.ts` 는 수집 파이프라인(`addSample`·`persistSample`·`recordAlert`)이라 **쓰는 쪽(app/vital)** 에 둔다.
관제 경로는 GET 재수출이라 store 를 직접 import 하지 않는다.

### 심볼

`mockStore` → **`vitalStore`**(인메모리 링 버퍼). 경로에서 mock 을 지우면서 코드 안 이름을 남기면 반쪽이다.

⚠ **`MOCK_VITAL_EXPOSE_PII` env 는 건드리지 않는다** — Cloud Run env 에 물려 있어 개명하면 배포에 env 변경이
붙는다(L-41 계열). 이번 범위 밖으로 남긴다.
⚠ `data_mockup`·`dataMockupSamples` 도 그대로 — 그건 실제로 **발표용 목업 데이터**를 가리키는 정직한 이름이다.

## 1. 실행

- [x] **1. 테스트 글롭 재귀 전환** — 선행 완료(`ff58af8` · 2026-08-17). 이것이 최대 리스크였다
      (1단계 깊이 하드코딩이라 파일이 하위로 가면 **실패가 아니라 미실행**).
- [x] **2. 파일 이동 + import 조정** — 완료.
- [x] **3. 가드 경로 + ★ 앵커 이동 — ★ 4개가 아니라 20개 파일이었다**(아래 정정).
- [x] **4. 클라이언트 3줄 + 심볼 개명**(`mockStore`→`vitalStore`·globalThis 키 포함).
- [x] **5. 음성 대조** — 신설 가드 4건을 사본에서 결함 주입 · **각 결함이 자기 가드만 실패**(4/4).
      기존 가드는 `scripts/guard-anchor-audit.mjs`(readFileSync 를 메모리에서 가로채는 방식)로
      **앵커있음 127 · 앵커없음 0** 확인 — 파일을 실제로 비우지 않으므로 공유 트리 안전.
- [x] **6. 검증** — tsc 0 · lint 0err · test **1,006 pass / 0 fail** · `next build` 성공.
      ★ 빌드 라우트 목록에 `/api/mock/*` **0건** · `/api/app/vital`·`/api/monitor/vital`·
      `/api/monitor/vital/history` 3건 등록 확인.
- [ ] **7. 배포 후 라이브 실측** — 아래 §3(배포는 사용자 `/deploy` 지시 대기)
- [x] **8. 문서 정정** — `app-dashboard-read-contract.md`(경로 + **"공개" 오기까지**)·
      `app-media-upload-contract.md`·harness e2e 주석(로컬 전용).
      ⚠ 감사·세션 기록(`audit-*.md`·`docs/checklist.md`·`harness/context-notes.md`)의 옛 경로 언급은
      **과거 경위 서술이라 사후 편집하지 않는다**(L-48).

### ★ 정정 — 참조 파일 수가 계획서의 5배였다

계획서 §6 이 "가드 4개"로 적었는데, 실제로는 **20개 파일**이 이 경로들을 참조하고 있었다.
계획서가 `grep "readFileSync.*api/mock"` 만 봤기 때문이고, 실제로는 두 형태가 섞여 있다.

```
슬래시형   readFileSync(resolve(root, "app/api/mock/vital/route.ts"))      ← 계획서가 본 것
세그먼트형 readFileSync(join(ROOT, "app", "api", "mock", "store.ts"))      ← 놓친 것(다수)
```
**⚠ 그리고 그중 하나는 테스트가 아니라 런타임 코드였다** —
`app/api/admin/incidents/data/route.ts:20` 이 `import { aliasIdsOf } from "../../../mock/history/real"`.
사고 조사 데이터 라우트라 놓쳤으면 배포 후 그 화면만 500 이 났다.

**교훈 = 경로 참조를 셀 때 한 가지 표기만 grep 하지 않는다.** 문자열 결합·세그먼트 결합·상대 import 셋을
모두 훑어야 하고, "테스트만 걸릴 것"이라는 전제부터 확인 대상이다.

### import 깊이 변화 (실측 — 이동으로 단수가 바뀌는 것만)

```
app/vital/route.ts    ../store            → ./store          (lib 4단·../../cctv/ingest 는 깊이 동일)
app/vital/store.ts    ../../../lib/*      → ../../../../lib/*
app/vital/vital-batch-limit.test.ts       ../../../lib/app-jwt → ../../../../lib/app-jwt · ./vital/route → ./route
app/vital/store.persist-alert.guard.test.ts  ROOT ../../.. → ../../../..
monitor/vital/history/route.ts  ../../../../lib/admin-auth → ../../../../../lib/admin-auth
monitor/vital/history/real.ts   ../../../../lib/db         → ../../../../../lib/db
app/api/cctv/ingest.ts          ../mock/store              → ../app/vital/store
```
`history/data.ts` = 상대 import 0건 · `history-kst.test.ts` 의 `./history/data` = 깊이 동일.

### 가드 — ★ 계획서가 4개로 적었으나 실제 5개다

```
lib/2026-07-29-worker-id-binding.guard.test.ts:28      readFileSync  vital/route.ts
lib/2026-07-29-hyperclova-secret-boundary.test.ts:26   readFileSync  vital/route.ts
lib/app-auth-diagnosis.test.ts:75                      readFileSync  vital/route.ts
lib/2026-07-30-measured-at.guard.test.ts:19            readFileSync  store.ts        ← 계획서 누락분
lib/client-ip.guard.test.ts:66                         ★ 앵커(endsWith)
```
앞 4개는 파일이 없으면 `readFileSync` 가 던져 **큰 소리로 실패**한다(안전).
**5번 앵커만 조용히 약화될 수 있다** — 스텁으로 남기면 통과하면서 의미가 빈다. 반드시 새 위치로 옮긴다.

## 2. 클라이언트 참조 (3줄)

```
app/components/DemoDashboard.tsx:3914     /api/mock/vital    → /api/monitor/vital
app/components/VitalHistoryPanel.tsx:176  /api/mock/history  → /api/monitor/vital/history
app/components/VitalHistoryPanel.tsx:203  /api/mock/history  → /api/monitor/vital/history
```

## 3. 배포 후 라이브 실측 (필수)

```
POST /api/mock/vital        → 404   ★ 구 앱 차단 확인(이 작업의 목적)
GET  /api/mock/vital        → 404
GET  /api/mock/history      → 404
POST /api/app/vital         → 401   (무토큰 — 게이트 작동)
GET  /api/monitor/vital     → 401   (무세션)
GET  /api/monitor/vital/history → 401
관제 화면 생체 표시 정상 · 신규 앱 수집 무중단(분당 12건)
```
Next.js 거동은 실증돼 있다 — POST export 를 빼면 405, **경로 자체가 사라지면 404**(`/api/radar` 대조).

## 4. 문서 정정 3곳

```
docs/app-dashboard-read-contract.md:14                      ← 커밋 대상
harness/2-verify/e2e/profile_save_dialog_spec.py:55         ← 로컬 전용(커밋 안 됨)
docs/audit-report-*.html                                    ← 로컬 전용(커밋 안 됨)
```
