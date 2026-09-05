# 워치 FGS 하트비트 — 컨텍스트 노트 (2026-09-05)

트랙 = **뒤에서 죽은 수집 서비스가 사람 없이 되살아나는 경로를 만든다** (제안서의 "1겹").
체크리스트 = [checklist.md](./checklist.md). 형제 트랙 = [wear-battery](../wear-battery/context-notes.md)(08-31 전류 실측) ·
[watch-collect-control](../watch-collect-control/) · `RestartReceiver`(09-01 부팅·재설치 복구).

## R-01 · 착수 근거 — 무엇이 관측됐고 무엇이 관측되지 않았나

**관측된 정지(근거).**
- 09-02 워치8 — tick 스레드 사망 → OS 가 START_STICKY 로 서비스 재기동 → 백그라운드라 `startForeground` 거부
  (`ForegroundServiceStartNotAllowedException` · `mAllowStartForeground false`) → **앱이 통째로 또 죽음.** 같은 크래시 8건 · 219초 무음.
  → `90f74b2` 가 `giveUpForeground`(stopSelf + START_NOT_STICKY)로 크래시를 막았다. **막은 자리에 정적이 남았다** — 다음 기동은 사람·재부팅·재설치.
- 09-03 워치8 — `pm install -r` 직후 07:52:48→07:59:28 **7분간 vitals 0행**(섀도 행만). 로그 `FGS 승격 거부(백그라운드 시작) — 크래시 대신 물러선다` +
  `W AlarmManager: Unrecognized alarm listener`. 사람이 앱을 열자 대기 14건이 손실 없이 올라갔다. **열지 않았으면 무한.**

**관측되지 않은 것 — ⚠ 09-05 오독 정정.** 워치9 09-05 10:53–18:52 batterystats 를 처음엔 *"FGS 가 23분만 살았다"* 로 읽었다. 틀렸다.
batterystats 는 UID 를 **한 순간 한 프로세스 상태**로만 센다(TOP > FOREGROUND_SERVICE 우선).
```
Foreground activities  7h33m34s   ← 앱 화면이 맨 앞(앰비언트 포함)
Foreground services       23m07s   ← 시계 화면으로 돌아가 서비스만 남은 시간
합                     7h56m41s ≈ 배터리 구동 7h59m05s
센서 구독              7h41m50s · 2회   ← 엔진이 내려간 적 없다
```
즉 **오늘 워치9 8시간엔 무음 정지가 없었다.** 이 트랙의 근거는 위 09-02·09-03 워치8 실측이다. 오늘 수치를 근거로 끌어오지 않는다.

## R-02 · 왜 "하트비트 알람"인가 — 지금 구조의 구멍은 알람이 프로세스 안에 산다는 것

현 tick 은 `AlarmManager.OnAlarmListener`(`CollectorService.kt:512`) — **프로세스 안 콜백**이다. 프로세스가 죽으면 리스너도 사라진다.
09-03 로그의 `Unrecognized alarm listener` 가 그 순간이다. 그래서 죽은 뒤 아무것도 앱을 다시 깨우지 않는다.

`PendingIntent.getBroadcast` 알람은 **AlarmManagerService 에 산다.** 프로세스가 죽어도 시각이 오면 OS 가 리시버를 위해 프로세스를 새로 띄운다.
이미 있는 `RestartReceiver` 가 받으면 되므로 새 컴포넌트가 필요 없다. 리시버는 이미 `token + canStartHealthFgs` 조건을 가진다.

한 알람이 두 일을 한다 — **감지**(서비스가 없다) + **소생**(다시 올린다). 제안서의 ①과 ③이 여기서 합쳐진다.

## R-03 · ★ 전제 — allow-while-idle 알람 배달에 FGS 시작 면제가 붙는가 (실기 미확인)

Android 12+ 백그라운드 FGS 제한의 면제 목록에 알람은 원칙적으로 없다. 그러나 AOSP `AlarmManagerService` 는 **allow-while-idle 알람과 alarm-clock 알람을 배달할 때**
`BroadcastOptions.setTemporaryAppAllowlist(…, TEMPORARY_ALLOW_LIST_TYPE_FOREGROUND_SERVICE_ALLOWED, REASON_ALARM_MANAGER_WHILE_IDLE / _ALARM_CLOCK, …)` 을 붙인다.
그 창 안에서 리시버가 `startForegroundService` 를 부르면 승격이 허용된다 — **는 것이 내 지식이다. 이 워치(Wear OS 5 · One UI Watch) 빌드에서 확인한 적 없다.**

그래서 검증 순서가 거꾸로다 — **코드보다 먼저 이 전제를 실기로 판정한다**(체크리스트 3단계가 사실상 첫 관문).
- 성공(`하트비트 소생` 로그 + vitals 재개) → 1겹 성립.
- `mAllowStartForeground false` 재발 → 면제 없음. 1겹은 **2겹(배터리 최적화 면제)을 전제로만** 동작한다. 그때 2겹이 선행 트랙으로 승격된다.

⚠ **Q-1 (미해결).** 09-03 의 `pm install -r` 뒤에는 `MY_PACKAGE_REPLACED` → `RestartReceiver` 경로가 있었다. 그 경로는 면제 대상인데 7분 정지가 났다.
그렇다면 ⓐ 리시버가 안 돌았거나(로그 `자동 시작` 부재) ⓑ 리시버가 올렸는데도 거부됐거나(면제가 이 빌드에서 안 먹음) ⓒ OS sticky 재기동이 먼저 와서 거부된 뒤
리시버는 `running` 을 보고 물러났다. ⓑ 라면 R-03 도 같은 이유로 실패할 가능성이 크다. **워치8 로그(`VgRestart`)로 먼저 가른다.** 버퍼가 없으면 3단계 재현에서 함께 본다.

## R-04 · 주기 10분 — 두 제약이 같은 숫자를 낸다

- `setExactAndAllowWhileIdle` 은 idle 중 **앱당 약 9분에 1회**로 조절된다. 그보다 촘촘히 걸어도 미뤄진다.
- 서버 부재 알림 문턱 = `ABSENCE_THRESHOLD_MS = 10 * 60 * 1000`(`apps/dashboard-web/lib/absence-watch.ts:10`).
하트비트 10분이면 **워치의 자가 소생과 서버의 부재 판정이 같은 시간 축**에 선다 — 소생이 이기면 알림이 안 울리고, 지면 울린다. 공백 상한 = **10분 + 승격 소요**.
09-03 대조 = 사람이 열기까지 7분(안 열었으면 ∞).

정확 알람 권한이 없을 때(API 31–32 `SCHEDULE_EXACT_ALARM` 미승인)는 `setAndAllowWhileIdle` 로 물러선다 — 부정확이지만 **allow-while-idle 성질(R-03 면제)은 유지**된다.
tick 의 `setWindow` 후퇴와 같은 이유(`TickAlarmTest` 참조).

## R-05 · 리시버 액션을 넓힌다 — 기존 룰과의 충돌을 어떻게 해소하나

`RestartReceiver` 주석·`RestartReceiverTest.부팅과 앱교체에서만 되살린다` 는 *"액션을 넓히지 말 것 — 다른 액션은 면제가 없다"* 고 못 박고 있다.
이 트랙은 그 룰을 **깨는 게 아니라 좁게 연다** — 넓히는 것은 시스템 액션이 아니라 **자체 액션 하나**이고, 면제는 액션이 아니라 **배달 방식(allow-while-idle)** 에서 온다(R-03).
`SCREEN_ON`·`LOCKED_BOOT_COMPLETED` 등은 여전히 거부한다. 테스트는 "셋에서만" 으로 갱신하고 나머지 부정 단언은 그대로 둔다.

**위조 위험.** 리시버가 `exported=true`(protected broadcast 수신에 필요)라 다른 앱이 명시 인텐트로 자체 액션을 흉내낼 수 있다.
그 결과는 "token 과 권한이 있으면 수집을 켠다" — **부팅 경로와 같은 효과**라 새 피해면이 없다. 표식 `fgsRevivedAt` 이 오염될 수는 있으나 판정·경보에 안 쓴다(R-06). 수용한다.
PendingIntent 는 명시 컴포넌트 + `FLAG_IMMUTABLE` 로 만들어 우리 쪽에서 새는 경로는 없다. 매니페스트 intent-filter 는 **추가하지 않는다**(명시 인텐트라 불필요).

## R-06 · 표식 `fgsRevivedAt` — 시각이고, 컬럼은 없다

- **카운터가 아니라 시각.** `hrLastReviveAt` 과 같은 이유(`vital-stream.ts:206` 원문) — 카운터는 프로세스가 죽으면 0 부터 세어 재설치와 구별이 안 된다.
  두 행의 값이 다르면 그 사이에 소생이 있었다. **없음도 지문**(서비스가 하트비트로 올라온 적 없다).
- **어디에 찍나.** 하트비트 경로로 시작된 `onStartCommand` 만 `@Volatile fgsRevivedAtMs = now`. 액티비티·부팅·재설치 시작은 찍지 않는다 —
  "뒤에서 죽었다가 스스로 살아났다" 만 세는 것이 목적이다. 인텐트 extra 로 경로를 구별한다.
- **어디에 싣나.** `SampleBuilder` 의 `hrLastReviveAt` 과 **같은 두 갈래**(측정 있음 / stillSec 단독). 한쪽만 실으면 미착용 구간의 소생이 안 보인다.
- **서버.** `packages/schemas/src/vital-stream.ts` 스키마 `z.string().datetime().optional()` + **스트립 허용목록 등재**(안 하면 이 필드 하나가 생체 샘플 전체를 거부시킨다 — 허용목록 주석 원문).
  `raw_json` 에 통째로 적재되므로(`db.ts:1173` `JSON.stringify(sample)`) **컬럼 추가 없음** — `hrLastReviveAt` 선례와 같다. `ExportRow` 미포함 · 판정/경보/화면 무유입을 가드로 못 박는다(L-115 양 끝).
- **배포 순서 = 서버 먼저.** 워치가 서버보다 먼저 새 키를 보내면 스트립되거나 거부된다 — 어느 쪽인지는 1단계에서 `parseResilientVitalSample` 로 확인하고 적는다.
  `watch-auto-resume` R-08 과 같은 순서.

## R-07 · 검증 = 재현 실험. 도구 선택이 결과를 가른다

- **`am force-stop` 은 쓰지 않는다** — 앱을 stopped 상태로 만들고 **알람·PendingIntent 를 전부 취소**한다. 하트비트가 살았는지 못 본다(거짓 실패).
- **`am kill` 은 FGS 프로세스를 안 죽인다**(killable 상태만). 거짓 성공.
- **`am crash <pkg>`** — 프로세스를 크래시로 죽인다 → OS 가 START_STICKY 로 재기동 → 백그라운드 거부 → `giveUpForeground`. **09-02 의 경로 그대로**다. 이것을 쓴다.
  전제 = 시계 화면이 맨 앞(앱이 TOP 이면 재기동이 포그라운드 자격을 얻어 거부가 안 난다 — 그러면 실험이 아니다).
- 대조군 = **같은 조작을 현 빌드에서 1회**(사람 없이 되살아나지 않음을 기록). 없으면 성공이 "원래 됐던 것"과 구별이 안 된다([[L-121]]④ 401→200 전이의 논리).
- 성공 기준 = 사람 개입 없이 **≤10분 + 승격** 안에 ⓐ `VgRestart` `하트비트 소생` 로그 ⓑ DB vitals 행 재개 ⓒ 그 행의 `fgsRevivedAt ≠ null`. 셋 다.
- ⚠ 이 실험은 **수집을 실제로 끊는다.** 09-03 에 내 설치가 7분 정지를 만들었다. 사용자 승인 뒤, 미착용 시간에 한다.

## R-08 · 배터리 "측정 하나" 의 기대치 정정 — 08-31 이 이미 답을 반쯤 냈다

제안서에서 오늘 12.8 %p/h 의 주범 후보를 *"앱 화면을 맨 앞에 두는 설계"* 로 적었다. `wear-battery/context-notes.md`(08-31) 를 열어 보니 이미 재어 놓았다.
```
앱 사망 + 시계 AOD   46.3 mAh/h   ← 시스템 바닥(OS+무선+시계면)
앱 수집 + AOD        64.85        → 앱 ≈18.5 · AOD ≈4.6
수명 환산 워치9      6.9h (AOD 끄면 7.4h)
```
오늘 = 428 mAh / 7.985h = **53.6 mA · 7.7h** — 08-31 과 정합한다. 즉 바닥의 7할이 **앱 밖**이고, 화면 유지 설계를 바꿔 얻을 것은 **약 7%(6.9→7.4h)** 다.
측정은 여전히 한다(FGS 단독으로 수집이 버티는지의 실측이라 이 트랙 3단계와 겹친다). 다만 **배터리 개선의 큰 레버는 아니다** — 그쪽은 별도 트랙(시스템 바닥·LTE 배치·센서 듀티).
모델 6.6%/h(29.3 mA) 는 08-31 에 이미 2배 어긋나 있었다. 오늘이 처음 밝힌 것이 아니다.

## R-09 · 1단계 실행 기록 (09-05)

- 기준선을 별도 worktree 에서 돌리려 했으나 `gradlew` 가 **미추적 파일**이라 worktree 에 없다 — 기준선 없이 편집본으로만 판정했다(340/340 초록이라 선행 실패가 있었다면 보였을 것).
- `git commit -- <경로>` 관용구는 **추적 파일만** 받는다 — 새 파일은 `git add <그 파일>` 뒤 같은 명령에서 pathspec 커밋. `-m` 은 `--` 앞에 와야 한다.
- 변이(L-113) — `onStartCommand` 의 `armHeartbeat(this)` 삭제 → `HeartbeatAlarmTest` 11건 중 **정확히 1건**(`승격에 성공한 시작만 하트비트를 건다`) 빨감. 복원 후 340/340.
- JUnit XML 은 `wear/build/` 가 아니라 **`apps/vitalguard_app/build/wear/test-results/testDebugUnitTest/`** 에 쓰인다(Flutter 루트가 buildDir 을 위로 올린다). `-q` 성공 로그만 보면 "0 tests" 로 오독한다 — 리포트로 건수를 센다.

## R-10 · 운용 규율

- 커밋은 이 세션이 각자 하고 **push·/deploy 는 담당([WATCH.APP]) 세션**에 요청한다([[L-125]]). 서버 배포(2단계)가 워치 설치(3단계)에 선행한다(R-06).
- `git commit -- <경로>` 관용구로 공유 index 를 우회한다([[L-87]]⑤). 워킹트리의 남의 미커밋 2건(`settings.gradle.kts` · `ProbeScreenPreview.kt`)은 건드리지 않는다.
- 테스트 = `apps/vitalguard_app/android` 에서 `./gradlew :wear:testDebugUnitTest`. 가드는 `TickAlarmTest`·`RestartReceiverTest` 의 소스 판독 방식을 따른다(값이 아니라 API 선택을 못 박는다).
- 변이 1회([[L-113]]) — `armHeartbeat()` 호출을 지우면 가드가 빨개지는지 본다. `HrWatchdogTest` 의 "등장 횟수" 함정([[L-123]]④)을 피해 **배선 지점**을 단언한다.
