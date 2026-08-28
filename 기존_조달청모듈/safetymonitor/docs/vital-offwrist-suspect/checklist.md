# 벗음 의심 라벨 — 체크리스트

2026-08-28. 근거·결정은 [context-notes.md](./context-notes.md). 서버 계산(DB 15분 · 60초 캐시) + 화면 라벨 한 줄. 판정 불변.

## 1. 순수 함수
- [x] `lib/vital-offwrist.ts` — 상수 5개 · `HrPoint` · `windowFlat` · `flatWindowCount` · `offWristSuspect`
- [x] `lib/vital-offwrist.test.ts` (8건) — 평평 15분 → 의심 · 잡음 → 없음 · 희소(120초) → 판정 불가 · 2창만 평평 → 없음 · 경계(=) 포함 · 잡음 뒤 평평 3창 → 의심

## 2. 서버
- [x] `store.ts` `offWristSuspects(aliasMap)` — `recentHeartRates(15)` · 별칭 접기 · 60초 캐시 · 실패 시 `{}`
- [x] `route.ts` GET `offWrist: await offWristSuspects(aliasMap)`

## 3. 화면 (라벨만)
- [x] `MockVitalResponse.offWrist` · `WorkerTableRow` prop `offWrist` · 호출부 전달
- [x] 상태 칸 `still` 분기 안에서만 세 번째 줄 `벗음 의심` + title 보강
- [x] `workerStatus`·`overallStatus`·`signalLevel`·`effectiveTone`·`gateStaleVitals` 무변경

## 4. 가드 (L-113)
- [x] `lib/2026-08-28-offwrist-suspect-label-only.guard.test.ts` (5건)
  - ① 판정 함수 다섯이 `offWrist|OFFWRIST|flatWindow` 를 모른다(본문+시그니처)
  - ② 라벨 리터럴은 lib 한 곳 · 기존 라벨과 다름
  - ③ 화면에서 `still` 분기 안에서만 · stale 분기에 없음
  - ④ 문턱이 전수검사 범위 안(SD 2.0~2.9 · 연속차 ≤ 1.1 · 창 ≥ 3 · 표본 ≥ 30)
  - ⑤ 서버 함수가 경보 경로(`recordAlert|notify|upsertEnvAlertState|telegram`)를 안 부른다 · GET 이 싣는다
- [x] 변이 시험 **12종 전부 검출**(6절) (`scripts/mutate-guard.sh`)

## 5. 검증·커밋
- [x] `/verify` 3종 — tsc 0 · lint 0 err(경고 2 기존) · **test 1469/1469 @ 워킹트리**(1456 + 단위 8 + 가드 5)
- [ ] 커밋(`git commit -- <경로>` · 신규는 `git add -- <신규>`) → 0c 에 SHA
- [ ] 배포 — **0c 전담(L-125③)** · 사용자 결정
- [ ] 라이브 실측 — 워치를 바닥에 15분 이상 두고 `무동작` 아래 `벗음 의심` 이 뜨는지 · 착용 후 사라지는지

## 6. 변이 시험 기록 (`scripts/mutate-guard.sh` · 기준선 PASS · 복원 cmp OK · 12/12)

| # | 대상 | 변이 | 결과 |
|---|---|---|---|
| 1 | DemoDashboard | `const suspect = offWrist`(정지 조건 제거) | ③ fail 1 |
| 2 | DemoDashboard | `{suspect.label}` → `{"벗음 의심"}` 리터럴 | ② fail 1 |
| 3 | DemoDashboard | stale 분기에 `{suspect?.label}` 삽입 | ③ fail 1 |
| 4 | vital-offwrist | `OFFWRIST_SD_MAX = 4` | ④ fail 1 |
| 5 | vital-offwrist | `OFFWRIST_WINDOWS = 1` | ④ fail 1 |
| 6 | vital-offwrist | `OFFWRIST_MIN_SAMPLES = 3` | ④ fail 1 |
| 7 | store | 의심 시 `notifyHeatIfDue()` 호출(경보 경로) | ⑤ fail 1 |
| 8 | route | 응답 키 `offWrist` → `offWristX` | ⑤ fail 1 |
| 9 | worker-signal | `effectiveTone` 인자에 `offWrist?` | ① fail 1 |
| 10 | DemoDashboard | `workerStatus` 본문이 offWrist 로 danger 반환 | ① fail 1 |
| 11 | DemoDashboard | `signalLevel` 본문이 offWrist 로 0 반환 | ① fail 1 |
| 12 | worker-signal | `gateStaleVitals` 인자에 `flatWindow?` | ① fail 1 |

시그니처는 처음부터 소괄호 대응(`sigEnd`)으로 읽었다 — still-label 가드 #9 가 첫 회차에 뚫렸던 자리를 반복하지 않았다.
