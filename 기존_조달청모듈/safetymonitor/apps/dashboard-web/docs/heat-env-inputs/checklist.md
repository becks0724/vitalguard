# MET·일광 시간 수집 — 체크리스트

목표 = ACGIH/ISO 7243 이 요구하는 입력 2종을 수집 경로에 올린다(판정은 다음 트랙).
성공 기준 = ① DB 에 두 컬럼이 null 아닌 값으로 도착 ② 기존 수집 회귀 0 ③ 값 크기대가 건강 앱과 일치.

결정·근거 = [context-notes.md](./context-notes.md)

> **⚠ 2026-08-15 — 판정 트랙에서 이 문서의 전제 하나가 반증됐다.**
> 성공 기준 ③ *"값 크기대가 건강 앱과 일치"* 는 **활동에너지에 대해서는 참이지만
> 그 사실이 오히려 문제였다** — 건강 앱도 시간당 240~290 cal 로 찍고, 그 값이 상시
> `HKWorkoutSession` 때문에 **앉아 있어도 나온다**. 즉 일치는 했는데 그 값이 활동량을
> 뜻하지 않는다. MET 는 축이 맞으나 **하루 135건으로 희소**하다.
> 활동 축 판정의 확정 사실·결정 = **[heat-activity-axis/](../heat-activity-axis/checklist.md)**

## 1. 워치 (VitalWatch)

- [x] `WatchStreamer.swift` `discreteInputs` 에 2종 추가
  - [x] `physicalEffort` — 단위 kcal/(hr·kg) · key `pe` · maxAge 15분
  - [x] `timeInDaylight` — 단위 분 · key `dl` · maxAge 15분
- [x] `toRead` 권한 집합에 자동 포함(`for input in discreteInputs { toRead.insert(input.type) }`)
- [x] 각 항목에 표준에서의 자리 주석(ACGIH `M` · WBGT 실외 분기 · 소매 가림 한계)

## 2. 폰 (Runner)

- [x] `VitalPipeline.swift` — 짧은 키 파싱 2줄(`pe`·`dl`)
- [x] `guard` 조건에 두 키 추가(둘만 실린 배치가 통째로 버려지지 않게)
- [x] 서버 스키마 이름으로 매핑 — `physicalEffortMet`·`timeInDaylightMin`
- [x] carry-forward 금지 유지(값이 실린 것만 붙인다)

## 3. 계약 (schemas)

- [x] `packages/schemas/src/vital-stream.ts` — 필드 2개(상한 30 / 1440)
- [x] 구간 합 계약 주석(하루 누적 금지 — 걸음·오른층 교훈)
- [x] **dist 빌드**(모노레포 함정 — 소스만 고치면 타입이 안 보인다)

## 4. 서버 (dashboard-web)

- [x] `lib/db.ts` — `ALTER TABLE ADD COLUMN IF NOT EXISTS` 2개
- [x] insert 매핑 2줄(`cols` 객체 키가 INSERT 컬럼을 자동 생성 — 별도 목록 수정 불필요)
- [x] ~~행 타입에 필드 2개~~ → **되돌림.** 손댄 곳이 `ExportRow`(CSV 내보내기 전용)였고 이번 범위는 저장까지다. 넣으면 EXPORT_COLUMNS·CSV 헤더·테스트 픽스처까지 번진다(typecheck 가 잡아줌). 보고서에 필요해지면 별도 트랙.

## 5. 테스트·가드 — 5건 통과

- [x] `lib/2026-08-14-heat-env-inputs.guard.test.ts` — 워치 타입·키 · **폰 guard 조건** · 폰 매핑 · 스키마 상한 · DB 컬럼+insert
- [x] **음성 대조** — 폰 guard 에서 `pe`·`dl` 제거 시 가드 ②만 실패(1건), 복원 시 5/5

## 6. 검증

- [x] `pnpm typecheck && pnpm lint && pnpm test` — **EXIT=0 · 729 pass / 0 fail**(신규 5건 · TS 에러 0)
- [x] **워치 빌드** — 권한 시트 표시·승인 확인(폰 Run 만으로 임베드 전달 성공 · 08-13 함정 미발생)
- [x] 권한 시트에 새 타입 2종 표시 확인
- [x] **실기기 도착 확인 — MET 3건**(14:45~14:46 · `1.7 / 4.5 / 4.7 MET` · 심박 103~107 과 같은 행)
- [x] 기존 수집 회귀 없음(심박 3,416 · 활동 3,213 · 걸음 310 정상)
- [ ] **일광 시간은 미검증** — 흐린 날씨로 조도 부족(실외 판정 안 됨). **결함 아님** — WBGT 관점에서 "복사열 없음"이 맞는 신호다. 맑은 날 재확인.

### ★ 검증 중 발견한 별건 결함 (수리 완료 · `8b73701`)

워치가 40건을 보냈는데 DB 도착 0건이었다. 원인은 **배치 내 ts 중복** — 폰이 배치 전체에 같은 전송 시각을 붙이는데 서버에 `UNIQUE(worker_id, ts)` + `ON CONFLICT DO NOTHING` 이 걸려 있어, **두 번째 항목부터 조용히 버려진다**(에러·로그 없음).

단독 항목으로 보내던 **이산 측정 6종 전체가 유실**되고 있었고(활동에너지·걸음은 심박 항목에 병합돼 살아남음), 오늘 MET·일광 추가로 처음 드러났다. 수리 = 이산 측정도 심박 항목에 병합. 상세 = run-log 2026-08-14 항목.

⚠ **SpO₂ 는 미수리** — `spo2MeasuredAt` 계약 때문에 병합하면 측정 시각이 섞인다. 별도 트랙.

## 7. 배포·기록

- [ ] 서버 분 배포(스키마·컬럼) — 앱보다 **먼저**(앱이 새 필드를 보내도 스트립되지 않게)
- [ ] 배포 전 `git log <직전 라이브>..HEAD` 로 범위 확인
- [ ] run-log · Status · SETUP.md 온열 절 기록

## 범위 밖 (다음 트랙)

- WBGT 근사 산출 · ACGIH TLV 작업–휴식 비율 판정
- 3층 하이브리드 화면(법정 게이트 → PSI → MET)
- 값 도착 관찰 후에 착수한다 — 건강 앱에 값이 있는 것과 우리 쿼리에 도착하는 것은 별개(HRV 교훈)
