# 무동작 라벨 — 체크리스트

2026-08-28. 근거와 결정은 [context-notes.md](./context-notes.md).
서버·앱 **무변경** — 화면이 이미 받는 `motionStillSec` 에 라벨만 붙인다.

## 0. 선행 확인 (완료)

- [x] 이 질문을 다룬 트랙이 있는가 — **있었다.** `vital-absence-triage`(08-15~20) · `mv` 기각 ·
      `수신 중` 결정. 오늘 실측 3건이 그 기록의 재현임을 확인하고 context-notes 에 대조표로 남김
- [x] `mv` 소수점 실험 — **철회**(08-19 착용 바닥 1 = 책상 최소). 재서명 창 목록에 안 올림
- [x] 화면이 `motionStillSec` 을 받는가 — 스키마 `:85` optional · store 병합 `{...older,...newer}` ·
      `redactPii` 는 보호자·좌표만 제거 · `/api/monitor/vital` 은 `app/vital/route` GET 재수출

## 1. 순수 함수

- [x] `lib/vital-still.ts` — `STILL_LABEL_MS`(300s) · `STILL_LABEL` · `stillLabel(sample, stale, tone)`
- [x] 단위 시험 6건 — 문턱 양옆 · stale 이면 없음 · normal 아니면 없음 · 값 없음/NaN 이면 없음 · 라벨 넉 자

## 2. 화면 (라벨만 · 판정 불변)

- [x] 상태 칸 — `수신 중` 자리에서만 `무동작` + 경과. `연결끊김` 칸과 같은 2줄 모양
- [x] title — "N분째 움직임 없음. 착용 중인지·의식이 있는지 확인하세요"
- [x] `workerStatus`·`WorkerStatus`·`WSTATUS_TONE`·`effectiveTone`·`gateStaleVitals` **무변경**
      (08-20 가드 `wear-honest-label` 이 `workerStatus` 본문을 그대로 요구한다 — 통과 확인)

## 3. 가드 (L-113)

- [x] `lib/2026-08-28-still-label-only.guard.test.ts` — 5건
  - ① 판정 함수들이 `still` 을 모른다 (`workerStatus`·`overallStatus`·`effectiveTone`·`gateStaleVitals` 본문 + 시그니처)
  - ② 라벨은 `STILL_LABEL` 한 곳 — 화면에 `"무동작"` 리터럴 없음 + 값이 `수신 중`·`연결끊김`·`심박끊김` 과 다름
  - ③ 상태 칸에서 stale 분기가 먼저다 + 함수도 stale 에 undefined
  - ④ 문턱이 착용 정지 실측(137.5s)의 1.5배 위 · `absence-check`(10분) 이하
  - ⑤ `주의`·`위험`·`대기` 를 덮지 않는다 + 화면이 실제 톤·stale 을 넘긴다
- [x] **변이 시험 10종 전부 검출** — 5절. ★ 첫 회차에 1종이 뚫렸다(아래)

## 4. 검증

- [x] `/verify` 3종 — tsc 0 · lint 에러 0(경고 2건은 기존) · **test 1456/1456 @ 워킹트리**(직전 라이브 1439 + 신규 17)
- [x] 커밋 — 이 파일과 함께(코드·시험·가드·문서 한 커밋 = 한 문장)
- [x] 배포 — `vitalguard-dashboard-00335-5nw` (20:5x · digest `d69c13eb…` 서빙 대조 일치 · commit-sha 라벨
      = `APPROVED_AT 66f69a0` · 1456/1456 @ 워킹트리 · 라우트 5종 ok · 사후 90초 5xx 0). 옆 세션 셋 조율·보류.
      `APPROVED_AT` 은 승인=HEAD 라 **no-op**(PINNED 비고 워킹트리 검증) — 고정 경로 실배포 완주는 아직 없음
- [x] 번들 착지 — 라이브 `app/page-7df4635…js` 에 `무동작` 1 히트(통제군 `수신 중` 1)
- [x] 라이브 실측 ① 벗음 → `무동작` — **21:31:32 화면에 `무동작 / 5분` 확인**(21:31:46 `6분`). 심박 89~91bpm 은 그대로 표시,
      신호·톤·집계 무변경(판정 불변 확인). 경과 = 워치 카운터 그대로(바닥 배치 21:25:47 → 300s 도달 21:30:5x).
      ★ 첫 시도(21:17 책상 위)는 **실패가 아니라 조건 미충족** — 타이핑 진동으로 `still` 이 30~90초마다 리셋(최장 61s ·
      `mv` 5~52). 바닥으로 옮기니 `mv` 1~2 로 끊김 없이 쌓임. 라벨은 "안 움직인 시간" 만 말한다는 설계가 그대로 드러난 것
- [x] 라이브 실측 ② 다시 차고 움직임 → `수신 중` 복귀 — 착용 21:51:20 → 심박 복귀 21:52:10(50초) → **21:52:31 화면 `수신 중 · 86bpm`** ✅
      (그 사이 21:32 에 벗은 심박이 스스로 끊겨 `심박끊김 3분` 이 먼저 떴다 — stale 우선 가드 ③ 라이브 확인)
      (번들 grep 이 답한 질문은 "코드가 실렸나" 이지 "화면에 뜨나" 가 아니다 · L-118⑥ — ①② 로 그 질문에 답했다)

## 5. 변이 시험 기록 (`scripts/mutate-guard.sh` · 기준선 PASS · 복원 cmp OK)

| # | 대상 | 변이 | 결과 |
|---|---|---|---|
| 1 | DemoDashboard | `workerStatus` 가 `motionStillSec > 300` 을 낙상 분기에 OR | ① fail 1 |
| 2 | DemoDashboard | `{still.label}` → `{"무동작"}` 리터럴 | ② fail 1 |
| 3 | DemoDashboard | 상태 칸 stale/still 분기 순서를 맞바꿈 | ③ fail 1 |
| 4 | DemoDashboard | 화면이 톤 대신 `"normal"` 고정을 넘김 | ⑤ fail 1 |
| 5 | vital-still | `STILL_LABEL = "수신 중"` | ② fail 1 (값 대조) |
| 6 | vital-still | `STILL_LABEL_MS = 120_000` | ④ fail 1 |
| 7 | vital-still | 톤 게이트 제거(`if (stale)` 만) | ⑤ fail 1 |
| 8 | vital-still | stale 게이트 제거(`if (tone !== "normal")` 만) | ③ fail 1 |
| 9 | worker-signal | `effectiveTone` 인자에 `still?: boolean` 추가 | **첫 회차 뚫림 → 보강 후 ① fail 1** |
| 10 | worker-signal | `gateStaleVitals` 가 `motionStillSec > 300` 이면 비움 | ① fail 1 |

★ **#9 가 첫 회차에 뚫렸다.** 시그니처를 "선언부 ~ 첫 `{`" 로 잘랐는데 `opts: { stale?: … }` 의
중괄호가 먼저 걸려 **변이 지점을 한 글자도 안 읽었다**([[L-104]] — 초록이 답한 질문이 내가 묻던
질문이 아니었다). 소괄호 대응(`sigEnd`)으로 인자 목록 끝까지 읽도록 고친 뒤 10/10.
같은 헬퍼 결함을 `stale-kind` 가드가 08-28 오전에 `indexOf("\n}")` 로 밟았다 — **경계 문자를
찾는 헬퍼는 대응으로만 쓴다**가 두 번째 사례다.
⚠ 그리고 ③ 의 앵커도 첫 실행에서 깨졌다 — JSX 주석 `{/* 10 상태 */}` 에 걸었는데 `stripComments`
가 지운다. 코드(`WSTATUS_TONE[wstatus.tone]`)로 옮겼다. 주석은 앵커가 못 된다.

## 6. 남긴 것 (이 트랙 밖)

- [ ] **라벨의 민감도** — 책상 위(가장 흔한 벗음 자세)에서는 타이핑 진동으로 5분이 안 찬다(21:17~21:25 최장 61s). 5분 문턱은
      "5분간 정지" 가 아니라 "5분간 무진동" 이다. 그 조건이 현장에서 라벨을 얼마나 자주 침묵시키는지는 현장 데이터가 있어야 잰다(0c 지적)
- [ ] **`벗음 의심` 표시 라벨(D)** — 심박 평평함 ∧ 정지. 근거·오탐률 = context-notes 08-28 밤 절. 만들지 닫을지 **사용자 결정 대기**.
      라벨 확인 대기 2건(08-22 14:05~14:40 · 08-19 10:25~10:45)이 오면 벗음 분모 7→9 로 표를 다시 그린다

- [ ] `ts = sentAt` 뭉개짐 — `watch-delivery-lag` 9절 결정(측정 시각) 미적용. 오늘 30행 재현.
      `still` 축은 영향 없지만 행 신선도 계산은 영향 받는다. 그 트랙 소관
- [ ] 선행 트랙 §5 "알림 정책" — 여전히 열림. 착용 감지 없이는 99.99% 를 못 만든다
