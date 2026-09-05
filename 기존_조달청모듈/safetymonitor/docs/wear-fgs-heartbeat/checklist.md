# 워치 FGS 하트비트 — 체크리스트 (2026-09-05)

목표 = **뒤에서 죽은 수집 서비스가 사람 없이 ≤10분 안에 되살아난다.** 근거·결정 = [context-notes.md](./context-notes.md) R-01~R-09.

성공 기준(R-07) — 시계 화면이 맨 앞인 상태에서 `am crash` → 사람 개입 없이 **10분 + 승격** 안에
ⓐ `VgRestart` `하트비트 소생` 로그 ⓑ DB vitals 행 재개 ⓒ 그 행의 `fgsRevivedAt ≠ null`. **셋 다.**
대조군 = 같은 조작을 현 빌드에서 1회(되살아나지 않음을 기록).

★ 첫 관문은 코드가 아니라 **R-03 전제 판정**이다 — allow-while-idle 배달에 FGS 면제가 붙지 않으면 이 트랙은 2겹(면제) 뒤로 물러난다.

## 0단계 — 착수 전

- [ ] **Q-1 판독** — 워치8 `logcat -d -s VgRestart` 에 09-03 07:52 `MY_PACKAGE_REPLACED — 수집 서비스 자동 시작` 이 있는가.
      있음 → 면제 경로도 거부됐다(ⓑ · R-03 위험 상향). 없음 → 리시버가 안 돌았다(ⓐ/ⓒ). 버퍼 없으면 3단계 재현에서 함께 본다.
- [ ] **대조군 1회** — 현 빌드 워치8, 시계 화면 맨 앞, `adb shell am crash com.vitalguard.vitalguard_app` → 10분 관찰 → DB vitals 미재개 확인.
      ⚠ 수집을 실제로 끊는다. **사용자 승인 뒤 · 미착용 시간에.** `force-stop` 금지(알람까지 취소 · R-07).
- [x] `parseResilientVitalSample` 에 미등재 키를 넣으면 — **무음 strip**(거부 아님). 서버 선배포의 이유는 관측 손실 방지(R-09b). 가드로 고정.

## 1단계 — 워치 코드 (기기 영향 없음 · 단위 테스트로 닫는다)

`CollectorService.kt`
- [x] `HEARTBEAT_MS = 10 * 60_000L` · `ACTION_HEARTBEAT` · `EXTRA_FROM_HEARTBEAT` 상수(companion · 숫자는 상수 한 곳에만)
- [x] `heartbeatIntent(ctx)` — `PendingIntent.getBroadcast(ctx, 요청코드, Intent(ctx, RestartReceiver::class.java).setAction(ACTION_HEARTBEAT), FLAG_IMMUTABLE or FLAG_UPDATE_CURRENT)`
      명시 컴포넌트 · 매니페스트 intent-filter **추가 안 함**(R-05)
- [x] `armHeartbeat(ctx)` — `canScheduleExactAlarms()` → `setExactAndAllowWhileIdle(ELAPSED_REALTIME_WAKEUP, now+HEARTBEAT_MS, pi)` · 없으면 `setAndAllowWhileIdle`(R-04)
      companion 에 둔다 — 서비스와 리시버가 **같은 함수**를 부른다(`canStartHealthFgs` 와 같은 이유)
- [x] `onStartCommand` 승격 **성공** 경로 끝에서 `armHeartbeat` · `giveUpForeground` 에서는 **건드리지 않는다**(살아 있어야 소생이 온다)
- [x] `onDestroy` 에서 **cancel 하지 않는다** — 죽음을 넘어 살아야 하는 알람이다. 로그아웃 뒤 남은 알람은 리시버가 token 없음을 보고 재무장 안 해 자연 소멸(R-06)
- [x] `@Volatile fgsRevivedAtMs: Long?` — `intent.getBooleanExtra(EXTRA_FROM_HEARTBEAT)` 일 때만 `= now` · `CollectorEngine` 람다 · `SampleBuilder` 두 갈래(측정 있음/stillSec 단독) 모두 `v["fgsRevivedAt"] = IsoMs.format(it)`

`RestartReceiver.kt`
- [x] 순수 판정 함수 `heartbeat(running, hasToken, canStartFgs): REARM | START | DROP`
      running → REARM · !hasToken → DROP(재무장 안 함) · hasToken && canStartFgs → START(+재무장) · hasToken && !canStartFgs → REARM(사람이 열면 권한을 묻는다)
- [x] `onReceive` — `ACTION_HEARTBEAT` 분기 · START 시 `startForegroundService(intent.putExtra(EXTRA_FROM_HEARTBEAT, true))` · 로그 한 줄 `하트비트 소생`
- [x] 기존 `shouldRestart` 는 그대로(부팅·재설치 경로 불변)

테스트 (`src/test/kotlin/com/vitalguard/wear/`)
- [x] `RestartReceiverTest.부팅과 앱교체에서만 되살린다` → 하트비트 액션 포함으로 갱신 · `SCREEN_ON`·`LOCKED_BOOT_COMPLETED`·null 부정 단언 **유지**(R-05)
- [x] `heartbeat()` 표 4행 단언(REARM/START/DROP/REARM)
- [x] 새 `HeartbeatAlarmTest`(11건) — 소스 판독 가드(`TickAlarmTest` 수법 · 주석 걷어낸 본문):
      ① `getBroadcast` 로 예약(리스너형 아님) ② `AllowWhileIdle` 두 갈래 모두 존재 ③ `ELAPSED_REALTIME_WAKEUP`
      ④ `onDestroy` 본문에 하트비트 cancel 없음 ⑤ **배선** — `onStartCommand` 의 `return START_STICKY` 앞에 `armHeartbeat(` 호출(등장 횟수 아님 · L-123④)
- [x] `SampleBuilder` — `fgsRevivedAt` 두 갈래 실림(`HrReviveTimestampTest` 병렬) · null 이면 키 없음
- [x] `./gradlew :wear:testDebugUnitTest` **340/340 초록**(JAVA_HOME=Android Studio jbr · 리포트는 `apps/vitalguard_app/build/wear/test-results/`) · **변이 1회** — `armHeartbeat(` 호출 삭제 → ⑤ 빨감 확인 → 복원(L-113)
- [x] 커밋 `feat(wear): 하트비트 알람` — 새 테스트는 `git add` 뒤 pathspec 커밋(`git commit -- <경로>` 는 추적 파일만 받는다) (공유 index 우회 · 남의 미커밋 2건 제외)

## 2단계 — 서버 (워치 설치보다 먼저 배포 · R-06)

- [x] `packages/schemas/src/vital-stream.ts` — `fgsRevivedAt: z.string().datetime().optional()` (주석 = 시각인 이유 · 없음도 지문 · 판정 무유입)
- [x] 스트립 허용목록에 `"fgsRevivedAt"` 등재(안 하면 생체 샘플 전체 거부)
- [x] 가드 `apps/dashboard-web/lib/2026-09-05-fgs-revived-at.guard.test.ts` — ⓐ 정상값 파싱 생존 ⓑ 깨진 값 스트립·샘플 생존 ⓒ `ExportRow` 미포함 ⓓ 판정/경보/화면 소스 무유입 ⓔ 워치 `SampleBuilder` 가 같은 키를 두 갈래로 싣는가(L-115 양 끝)
- [x] 음성 대조 — 허용목록 제거 → fail 1 · 스키마 키 개명 → fail 2(러너 대상 = `dist/vital-stream.js` · R-09b)
- [x] `/verify` 4종(typecheck·lint·graph·test) 초록 → 커밋 `feat(schemas): fgsRevivedAt`
- [ ] **담당 세션에 push·/deploy 요청**(직접 push 안 함 · L-125) — 커밋 3건 `37f5026`·`51059e2`·`f884068` + 서버 1건 + 문서 1건
- [ ] 라이브 확인 — 서빙 digest 대조(L-33) · `fgsRevivedAt` 포함 표본 curl 1건이 200 + 스트립 통지 없음

## 3단계 — 실기 검증 (R-03 판정 · R-07 절차)

- [ ] 워치8 Release 빌드·설치 — **사용자 승인 · 미착용 시간**(09-03 내 설치가 7분 정지를 만들었다)
- [ ] 설치 직후 앱을 한 번 열어 승격 확인 → 버튼으로 **시계 화면으로 복귀**(앱이 TOP 이면 실험이 아니다)
- [ ] `adb shell am crash com.vitalguard.vitalguard_app` → `logcat -s VgCollector:W` 에 `FGS 승격 거부 … 물러선다` 확인(재현 성립)
- [ ] ≤10분 대기 — `VgRestart` `하트비트 소생` / 혹은 `mAllowStartForeground false` 재발
- [ ] **판정** — 소생 성공 → R-03 성립 · 거부 재발 → **면제 없음 → 2겹으로 전환**(이 트랙 보류 · 노트에 기록)
- [ ] 성공 시 DB — 재개 첫 행의 `raw_json->>'fgsRevivedAt'` ≠ null · 정지~재개 공백(분) 기록 · 부재 알림이 울렸는지(10분 축 경합 · R-04)
- [ ] 24시간 관찰 — `fgsRevivedAt` 값 변화 횟수 = 하루 실제 사망 횟수(관제에 처음 보이는 숫자)

## 4단계 — 기록

- [ ] context-notes 에 Q-1 답 · R-03 판정 · 공백 실측치 추가
- [ ] `기존_조달청모듈/safetymonitor/CLAUDE.md` 워치 상태 줄 갱신(팀원이 보는 유일한 상태)
- [ ] 메모리 `worn-marker-server-gate-pending` 의 "FGS 백그라운드 거부" 항에 이 트랙 결과 한 줄
- [ ] 별도 트랙 후보로 남기는 것 — 2겹(배터리 최적화 면제 · R-03 실패 시 승격) · 배터리 바닥 46.3 mAh/h(R-08 · 앱 밖)
