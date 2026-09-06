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

## R-09b · 2단계 실행 기록 (09-05) — 변이 러너는 `packages/*/src` 에 눈이 멀다

- **0단계 ③ 답.** `VitalSampleSchema` 는 `z.object` 기본(미등재 키 strip). 워치가 서버보다 먼저 `fgsRevivedAt` 을 보내면
  **거부가 아니라 무음 손실**이다 — 생체는 살고 표식만 사라진다. 서버 먼저 배포하는 이유는 사고 방지가 아니라 **관측 손실 방지**다.
  가드 `배포 순서의 근거` 가 이 동작을 고정한다(동작이 strict 로 바뀌면 그 가드가 먼저 빨개진다).
- **★ `scripts/mutate-guard.sh` 를 `packages/schemas/src/vital-stream.ts` 에 걸면 두 변이가 전부 "검출 실패 · 약한 단언(L-104)" 으로 나온다 — 거짓이다.**
  dashboard-web 테스트는 `@safetymonitor/schemas` 를 **`dist/`** 로 읽는다(`package.json` exports → `./dist/index.js`). 러너는 src 를 바꾸고
  재빌드하지 않으므로 변이가 테스트 바이너리에 **닿지 않는다.** 러너의 ② 검사("sed 가 파일을 바꿨나")는 통과하니 화면에는 ③ 검출 실패로만 보인다 —
  **미적용과 약한 단언이 같은 관측**을 낸다([[L-108]]① 의 형태). 판별은 대상을 `dist/vital-stream.js` 로 바꿔 다시 걸면 된다 — 그러자 두 변이 모두 검출(fail 1 · fail 2).
  ⚠ `dist/index.js` 는 re-export 뿐이라 거기 걸면 ② 미적용으로 나온다(이것은 러너가 옳게 잡는다). 검출 후 `pnpm run prepare:packages` 로 dist 를 다시 만든다.
  → 러너 자체에 "대상이 `packages/*/src` 면 경고 + dist 안내" 를 넣을 자리다. **이 트랙에서 고치지 않았다**(범위 밖) — `/retro` 후보로 남긴다.

## R-11 · 3단계 실기 종합 — 워치9 (09-05 21:3x~21:4x · SM-L355N · 충전기 100% · 미착용)

**접속 런북.** 워치 Wi-Fi 는 화면이 꺼지면 잠들어 adb 가 끊긴다. 순서 = 무선 디버깅 토글 off→on(리스너 재바인드·mDNS 재광고)
→ `adb pair [fe80::…%en0]:<페어링포트> <코드>` → `adb mdns services` 의 `_adb-tls-connect` 포트로 `adb connect`
→ **즉시** `svc power stayon true` + `settings put global wifi_sleep_policy 2`(충전 중이라 화면 유지가 곧 Wi-Fi 유지).
⚠ 페어링 창의 `192.0.0.4` 는 464XLAT CLAT 내부 주소라 링크 너머에서 안 닿는다 — 경로는 **IPv6 링크로컬만** 유효.
광고된 포트가 RST 면 광고가 낡은 것 → 스캔(128병렬)하지 말고 토글한다(스캔은 판정을 오염시킨다).

**관측 ① — `am crash` 는 이 기기에서 정지를 재현하지 못한다.** 21:34:06 크래시 → `Scheduling restart … in 1000ms` → 21:34:33
새 pid 로 `수집 시작`·`isForeground=true`. **크래시된 FGS 의 OS sticky 재기동이 백그라운드여도 승격에 성공했다.**
R-07 의 "am crash = 09-02 경로 그대로" 는 이 기기에서 **틀렸다** — 재현은 패키지 교체·프로세스 완전 사망 쪽이다.

**관측 ② — ★ Q-1 판정 완료.** 패키지 교체 경로에서 리시버는 **돌고**, 결정은 token 에 정확히 따른다.
```
21:36:55 (token 없음) VgRestart: MY_PACKAGE_REPLACED — 자동 시작 안 함 (자격=false 권한=true)   ← DROP
21:43:53 (token 있음) VgRestart: MY_PACKAGE_REPLACED — 수집 서비스 자동 시작 → pid 22474 · isForeground=true   ← START 성공
```
즉 **token 있는 교체 경로가 콜드 스타트에서 FGS 승격에 성공한다 — 거부(mAllowStartForeground false)가 안 난다.**
따라서 09-03 워치8 의 7분 정지는 이 기기족에서 "교체 경로 FGS 거부(ⓑ)" 가 **아니다.** 워치8 고유이거나 sticky 레이스(ⓒ)다 — 워치8 2차 표본에서 가른다.

**관측 ③ — 라이브 REARM.** 리시버에 HEARTBEAT 직접 브로드캐스트(`am broadcast -n …/RestartReceiver`) →
`21:46:10 VgRestart: 하트비트 — REARM (running=true 자격=true 권한=true)`. 결정 로직·배선이 기기에서 실제로 돈다. 서비스는 REARM 에 안 흔들린다.

**관측 ④ — ★ R-03 구조 증거 + 알람 위생.** `dumpsys alarm` 의 우리 알람 =
`tag=*walarm*:com.vitalguard.wear.HEARTBEAT · ELAPSED_WAKEUP · window=0 · exactAllowReason=policy_permission(USE_EXACT_ALARM) · F=9(STANDALONE|ALLOW_WHILE_IDLE)`
그리고 **`idle-options: temporaryAppAllowlistType=0(FOREGROUND_SERVICE_ALLOWED) · ReasonCode=302(ALARM_MANAGER_WHILE_IDLE) · Duration=10000ms`.**
OS 가 배달에 FGS 시작 임시 허용 10초를 붙인다는 것을 OS 자신이 적었다. **중복 없음** — 단일 PendingIntent(`PI:f1d8575`),
[Add] 세 줄(21:37→21:43→21:44)은 재무장 교체(FLAG_UPDATE_CURRENT 정상), 대기 1개.

**★ R-03 행위 결론(종합).** 진짜 알람이 "서비스가 죽은 순간" 에 발화하는 장면은 이 기기에서 **강제로 못 만든다**
(sticky 가 늘 되살리고, FG 프로세스는 force-stop 없이 못 죽이는데 force-stop 은 알람을 취소한다). 대신 두 증거가 그 경로를 닫는다 —
ⓐ **행위** = 교체 경로의 콜드 스타트 FGS 승격이 실제로 성공한다(관측 ②, START 분기와 **동일 코드**). ⓑ **구조** = 하트비트 알람이
같은 FGS 허용 목록을 배달에 달고 온다(관측 ④). START 분기의 결정·DROP 은 단위 시험이 덮는다. force-stop+수동 브로드캐스트는
**허용 목록이 없는** 경로라 실패해도 반증이 못 되므로(L-108 — 판별 못 하는 시험) 쓰지 않았다.

**관측 ⑤ — 파이프라인·표식 (프로덕션 00352-zvn · vital_samples EMP-6861).** 새 빌드 표본이 실제 적재된다 —
21:34~21:46 사이 미착용 배터리 행(100%·status 5)과 착용 전이 표식. **`fgsRevivedAt` 은 전부 null(키 없음)** —
아직 하트비트 소생이 없었으니 옳다(실제 소생 시 채워진다). **HRV 잔여물(237.94/146) 행 0건** — 24ac667 수리가 유지된다
(worn:true 전이 표식들의 hrv·mvar 모두 null = 깨끗한 전이, 벗음-얼어붙은-창 아님).

**남은 것.** ⓐ **자연 관측** — 하트비트 armed 상태로 두고 24h `vital_samples` 에서 `fgsRevivedAt` 등장 = 실제 사망→소생 횟수(관제 첫 가시 숫자).
ⓑ 워치8 2차 표본 — 09-03 정지가 ⓑ(교체 거부)인지 ⓒ(sticky 레이스)인지. ⓒ HRV 수리 실착용 확인 — IBI 쌓은 뒤 벗어 237.94 재발 0 (단위 시험은 이미 통과).

## R-12 · 밤샘 A/B (09-05 22시 → 09-06 06:15) — 옛 빌드 워치8 vs 새 빌드 워치9, 같은 밤·같은 서버

**설정.** 워치9 = EMP-6861 · 새 빌드(하트비트+HRV 수리) · 21:58 착용. 워치8 = EMP-admin3470(김태곤) · 옛 09-03 빌드(하트비트 없음) · 00:54 착용(09-04 18:44 배터리 4% 사망 → 충전 재기동 · BOOT 리시버가 token 유지로 자동 재개). 둘 다 수면 중.

**결과(06:15 기준).**
```
                 심박 최대 공백   심박 건수/캐던스          부재 알림              배터리
워치9 새 빌드    2분             03시 이후 97건 · 시간당 30  0건                    100→30% · 8.3h · 8.4%p/h
워치8 옛 빌드    29분            03:34 이후 28~29분마다 5분 몰림  6건(자동해제 5 · 05:57 건 열림)  100→76% · 5.1h · 4.7%p/h
```
워치8 세부 — 03:15(+4) 03:30(+8) 04:02(+28) 04:30(+28) 04:58(+28) 05:33(+29) 06:01(+28). 05:00:42·05:02:43·05:04:43 처럼 **정상 2분 tick 세 건 → 25분 침묵**의 30분 주기.
= Doze 유지보수 창의 모양. 옛 빌드 tick(`setExact` ELAPSED_REALTIME_WAKEUP · allow-while-idle 아님)이 Doze 에서 창으로 묶여 배달된다.
서버 부재 알림은 공백마다 발화 · 자동해제("수집이 멎어 있었음") — 09-04 낮의 3건과 같은 종류.

**해석과 유보.** 새 빌드 워치9는 밤새 2분 캐던스를 한 번도 놓치지 않았다. 가장 그럴듯한 원인 = 하트비트의 10분 allow-while-idle 알람이 앱을 주기적으로
깨워 Doze 배칭에서 tick 을 끌어낸다(REARM 자체가 깨움). **그러나 두 기기가 다르다**(44mm/40mm · OS 빌드) — 차이 전부를 하트비트에 귀속할 수 없다.
**결정적 판정 = 워치8에 새 빌드를 얹는 같은-기기 전후 비교**(다음 단계). 배터리는 연속성의 값이다 — 새 빌드가 1.8배 빠르게 쓴다(LTE 기상 3배).

**Q-2(미해결).** 새 빌드에서도 tick 은 여전히 `setExact`(allow-while-idle 아님)인데 워치9는 Doze 배칭을 안 받았다. 하트비트 깨움만으로 설명되는지,
워치9가 애초에 deep Doze 에 안 드는지(09-05 낮 실측 deep doze 19%)는 `dumpsys deviceidle` 로 밤 상태를 봐야 안다. 워치8 새 빌드 설치 뒤에 함께 본다.
**개선 후보(미착수).** tick 을 `setExactAndAllowWhileIdle` 로 — 단 Doze 중 앱당 9분 조절이라 2분 캐던스는 못 지킨다. 연속 2분이 목표면 FGS + 하트비트 조합이 현실적 상한.

## R-13 · 밤샘 관측 종합 (09-05 21:58 → 09-06 07:36 · 두 워치)

```
                 심박      최대 공백   5분 초과 공백   부재 알림      배터리                     소생  HRV잔여물
워치9 새 빌드    286건     4분         0              0건            100→21% · 9.6h · 8.2%p/h   0     0(★미시험)
워치8 옛 빌드     84건     29분        9              9건(8 자동해제·1 열림)  100→73% · 6.4h · 4.3%p/h   —     —
```
- **워치9 fgs_rows=0** — 서비스가 밤새 한 번도 죽지 않았다(소생 불필요). 하트비트의 START 분기는 밤새 안 탔고 REARM 만 돌았다.
  연속성은 완벽(평균 간격 2.0분 · 4분 공백 1회 = tick 1회 누락). 즉 **오늘 밤 관측된 하트비트의 값은 "되살림"이 아니라 "안 죽음"** 이다.
- **워치8 옛 빌드** — 03:34 이후 28~29분 주기 Doze 배칭 지속(06:29·06:43·07:15 도 같은 모양). 부재 알림 9건이 매 공백을 잡았고 07:15 건은 07:36 시점 열림(워치가 공백 중).
  R-12 의 유보 그대로 — 기기 차이(44/40mm·OS) 때문에 차이 전부를 하트비트에 귀속 못 함. **결정 판정 = 워치8 새 빌드 전후.**
- **배터리 = 연속성의 값.** 새 빌드 8.2 vs 옛 4.3 %p/h. 낮 12.8 보다는 완만(수면 · 화면 유지 없음).
- **★ HRV 잔여물 미시험** — residue_new=0 이지만 워치9를 아직 벗지 않았다(07:36 worn=true). 잔여물은 **벗음 6~20분 뒤** 나는 현상이라 실제 시험은 아침 탈착 뒤다.
  → **09-06 07:58 탈착으로 시험 완료 · 수리 유지.** 표식 07:58:47 뒤 21분(08:19까지) worn=true 0건 · hrvSdnnMs 0건. 남은 행 = 10분 미착용 배터리 3건(16→27→35% 충전). 09-05 지문(+1.6/+7.7/+13.7분 · 237.94/146) 부재. 단위 시험 + 실착용 양쪽 닫힘.
- **★ 워치9 vital 알림 07:12 = SpO₂ 86**(위험 88 미만 · 미확인). HR 63 · 정지 121초 · 피부온 35.6℃ · 착용. 어젯밤 91 의 두 잡음 가설(움직임·차가운 손목)이
  **이 값엔 해당 안 됨.** 남는 후보 = 수면 중 팔 눌림(손목 압박 → 정맥 울혈 → 저값 · 수면 손목 산소포화도의 고전적 잡음) 또는 실제 야간 저산소. 기기로는 못 가른다 —
  **손가락 산소포화도계 동시 측정**이 유일한 판정. 관제 문턱(주의 92/30s · 위험 88)이 단발 표본에 걸려 있어 거짓 경보 노출은 R-11⑤·SpO₂ 검토 그대로.
- 워치8 로그인은 09-04 사망 → 충전 재기동에서도 유지됐다(BOOT 리시버 자동 재개 · 23:30 첫 행 · 부팅 표본 배터리 8%).

**다음 후보.** ① 워치8 새 빌드 설치 → 같은-기기 전후로 Doze 공백 소멸 여부(결정 판정). ② 워치9 탈착 뒤 HRV 잔여물 0 확인.
③ SpO₂ 단발 저값 거르기(피부온·정지·최근 3회 중앙값) — 설계 판단 필요. ④ Q-2(왜 워치9는 배칭을 안 받나 · `dumpsys deviceidle`). → **R-14 ⑤ 에서 답(면제 등록돼 있었다 · A/B 의 두 번째 혼입).**

## R-14 · 워치9 세부 배터리 사용량 (09-06 · 어제 추적 기반) — 밤샘 실기 통계는 소실, 남은 세 정본으로 분해

**① 실기 밤샘 통계는 없다.** `dumpsys batterystats` 는 "마지막 충전 이후" 만 들고 있고, 11:26 완충 탈거에서 리셋됐다
(`Start clock time: 2026-09-06-11-26-41` · 32분치). `dumpsys batteryusagestats` 는 38바이트(저장소 없음) · `/data/system/battery-usage-stats/` 없음(무루트).
→ **룰. 밤샘 구성요소 덤프는 아침 탈착 직후, 충전기에 올리기 전에 뜬다.** 리셋은 만충 뒤 탈거 순간이다. 남은 정본은 셋 —
DB `battery_charge_uah`(µAh · 2분) · `dumpsys netstats`(시간 버킷 · 충전과 무관) · `dumpsys wifi` 상태기 로그.

**② 밤샘 시간별 소모(DB µAh 차분 · 워치9 EMP-6861 · 455 mAh).** 분모에서 빠진 것([[L-127]]①) — 시간 안 `max−min` 이라 시간 경계 표본 하나(≈2분 · ≈3%)가 빠진다. 잔량% 는 정확.
```
시각(KST)   잔량%     mAh/h   행/h(심박)   우리 앱 전송 경로(netstats 2h 버킷)          상태
22h         100→88    50.9    78(30)       Wi-Fi(BECKS·108-0904-5G) + LTE 혼합           착용 직후 · 화면 조작
23h          88→78    45.6    38(29)       Wi-Fi + LTE 혼합
00h          77→66    50.3    55(30)       Wi-Fi(KT_GiGA_44E5) + LTE 혼합                00:40 까지 화면 켬 기록
01h          66→57    38.1    36(29)       Wi-Fi 주 + LTE 소량
02h          57→50    32.4    34(30)       Wi-Fi + LTE
03h          50→43    30.0    29(29)       LTE 단독(03시 이후 Wi-Fi 버킷 0)               수면
04h          43→36    29.0    40(30)       LTE 단독
05h          36→31    22.0    30(30)       LTE 단독
06h          31→26    23.5    35(29)       LTE 단독
22:00~06:58  100→26   ≈322 mAh / 8.97h = 35.9 mA · 8.2 %p/h(잔량% 기준 · R-13 과 일치)
```
- 심박 캐던스는 밤새 29~30행/h(2분)로 일정한데 소모는 **51 → 22 mAh/h 로 2.3배 준다.** 캐던스가 원인이 아니라는 뜻이다.
- 앞 5시간(32~51)과 뒤 4시간(22~30)의 경계(≈03시)에서 **두 가지가 동시에 바뀐다** — Wi-Fi 연결 종료(③)와 수면 진입(화면 기록 00:40 종료).
  게이지 비선형([[L-127]]④)도 후보. 셋을 이 표본으로는 못 가른다 — **귀속하지 않는다.**
- 그래도 서는 것. **LTE 단독 · 2분 캐던스 · 수면 · 화면 0 = 22~30 mAh/h(4.8~6.6 %p/h).** 현장(저장 Wi-Fi 없음 · 착용 중 화면 거의 안 봄)에 가장 가까운 구간이다.
  R-12·R-13 의 "8.2 %p/h" 는 이 구간 + Wi-Fi/깨어있는 앞 5시간의 평균이다. 현장 예측에는 8.2 가 아니라 **이 구간 값을 쓴다**(단 표본 4시간 · 밤 한 번).
- 같은 밤 워치8(EMP-admin3470 · 옛 빌드 · 40mm) 연속 수집 시간대 01~02h = 13.9~17.0 mAh/h · Doze 배칭 시간대 04~08h = 4~10 mAh/h. 기기·게이지·전송 경로가 다 달라(워치8 netstats 없음) **워치9 와 직접 비교하지 않는다.**

**③ 전송 경로 — 밤의 절반은 Wi-Fi 였다(netstats · uid 10203 · 2h 버킷).** 19~03시 Wi-Fi 4종 SSID + LTE 혼합, **03시 이후 LTE 단독.**
Wi-Fi 상태기 — 09-05 20:18·21:31 `BECKS`(폰 핫스팟 · 디버깅용 수동 접속 uid 1000) → 22:37 `108-0904-5G`, 00:53 `KT_GiGA_44E5`(저장된 집 AP 자동 로밍) → 09-06 11:27 이동으로 끊김.
`clockwork_wifi_setting=on`(항상 켬)인데 낮(09-05 11~19시 · 저장 AP 부재)엔 100% 미연결 · Wi-Fi 소모 0.05 mAh → **Wi-Fi 는 연결됐을 때만 비용이고, 연결은 집에서만 일어난다.** 현장 = LTE 단독.
- 표본 1건 ≈ 2.5 KB↑ 3.5 KB↓ · 8~9 패킷(LTE 2h 버킷 150 KB↑ 210 KB↓ 585 패킷 ÷ 69행). 낮 덤프 라디오 활성 = 193회 · 28m50s → **회당 ≈ 9 s(LTE tail)** → 30회/h × 9 s ≈ 4.5 min/h.
- ⚠ **이 기기의 batterystats 는 LTE 모뎀 전력을 안 잰다** — `Cellular Tx/Rx 0 ms` · 추정 항목에 `cell` 없음(power_profile 미기재). 모뎀은 아래 ④ 의 "미모델 잔여"에 묻힌다.
  LTE 비용을 알려면 **같은 기기 A/B 밤 두 번**(캐던스 2분 vs 5분 · 또는 5건 배치 전송)이 유일하다.

**④ 낮 덤프 구성요소(09-05 10:53~19:05 · 옛 빌드 · 착용 · 화면 맨 앞 설계) — 실측 441 mAh / 모델 428 / 7h59m = 55 mA.**
```
구성(모델 mAh)                          mAh    비중   근거
우리 앱 u0a203                          99.5   23%   wakelock 63.6(GCoreFlp 13m48s·425회 = FLP 위치 ≈68초마다) · sensors 19.6 · cpu 10.4 · screen 5.8 · fg 6h56m
  └ 센서 구독                                        가속(0xb)·자이로(0x29) 50 Hz 7h42m 연속 · 심박(0xd4) · offbody(0x156) · SDK 가상 1600940398
Samsung Health Service u0a35            29.0    7%   cpu 28.7 · bg 7h35m — 우리 센서 구독이 돌리는 SDK 백엔드 → 실질 앱 귀속
system 1000                             66.1   15%   cpu 53.2(화면 꺼진 채 46.9) · 알람 wakelock 2807회
AOD(ambient_display)                    32.3    8%   앱 아님 · 시계면 7h — R-08 의 "화면 설계 레버 ≈7%" 와 정합
GMS u0a167                               7.0    2%   단 Mobile radio 22m11s(전체 82m 의 27%) — FLP 네트워크 위치·클라우드 동기
logd 1036 · root 0                      16.1    4%
화면 켬 41m15s · 514회 · 손목 올림 490회   45.9 실측(11%)   착용자 행동 · 모델값 5.85
미모델 잔여(≈ LTE 모뎀 + 유휴 바닥)       ≈180   42%   Mobile active 1h22m(17%) · 우리 앱 28m50s(35%) · GMS 22m(27%) · RSRP great 82%
```
- 앱 직접 귀속 = 99.5 + 29.0 ≈ **128 mAh(30%)**. 여기에 우리 앱이 깨우는 라디오 35%·GMS 위치 27% 가 미모델 잔여 안에 더 있다.
- 크기 순 레버 후보(결정 아님 · 설계 판단 필요). ⓐ FLP 위치 68초 주기(wakelock 13m48s + `NetworkLocationScanner` 알람 420회 + GMS 라디오 22m).
  ⓑ 가속·자이로 50 Hz 상시(sensors 19.6 + SDK cpu 29 ≈ 48 mAh · 11%). ⓒ 표본마다 LTE 기상 30회/h(미모델 · 라디오 시간 35%).
  ⓓ 화면 맨 앞 설계는 AOD 32 mAh(8%)·화면 켬은 착용자 행동 — R-08 결론 유지.

**⑤ Q-2 답 — 워치9 는 Doze 면제 목록에 있었다.** `dumpsys deviceidle` → `Whitelist user apps: com.vitalguard.vitalguard_app`.
08-29 19:37 ADB 로 내가 등록했다(`docs/wear-os-port/context-notes.md:1261`). 앱은 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 를 요청하지 않는다(grep 0건)
→ 워치8(09-03 신규 설치 · 김태곤)은 **미등록일 가능성이 크고**, 그 30분 배칭은 정확히 비면제 Doze 의 모양이다.
- **R-12·R-13 A/B 의 두 번째 혼입.** 워치9 와 워치8 은 (하트비트 有·면제 有) vs (無·無) 다. 연속성 차이를 하트비트에만 귀속할 수 없다.
- **결정 판정을 두 밤으로 가른다** — ⓐ 워치8 새 빌드만 ⓑ 워치8 새 빌드 + 면제(`dumpsys deviceidle whitelist +com.vitalguard.vitalguard_app`). ⓐ 에서 배칭이 남고 ⓑ 에서 사라지면 연속성의 주인은 면제(2겹)다. 하트비트(1겹)의 몫은 "죽었을 때 되살림" 으로 좁혀진다(R-13 — 밤새 죽지 않아 아직 미관측).
- R-03 전제("1겹은 2겹 전제") 는 워치9 에서 **이미 충족된 채** 3단계가 돌았다. 작업자 배포용은 앱 안 1회 요청이 있어야 한다(wear-os-port checklist 미결 그대로).

**⑥ 디버그 설정 정리(09-06 12:0x).** `stay_on_while_plugged_in` 1→**0 원복**(`svc power stayon false`).
`wifi_sleep_policy=2` 는 **AOSP 기본값이고 프레임워크가 읽지 않는다** → 어제 "2 로 설정" 조치는 무효였다(정정). Wi-Fi 밤샘 연결의 원인은 수동 핫스팟 접속 + 저장 집 AP 로밍 + 항상 켬 설정이다.
`adb_wifi_enabled=1`(무선 디버깅)은 사용자 토글 — 그대로 둠.

**⑦ 오늘 밤 깨끗한 측정 조건(제안).** 워치 Wi-Fi 끔(또는 폰 핫스팟 끔 + 집 AP 잊기) → LTE 단독 · 무선 디버깅 끔 · 완충 착용 →
**아침 탈착 직후 충전기 전에** 핫스팟 합류 2분 → `dumpsys batterystats` 확보. 그래야 ④ 같은 구성요소 표가 새 빌드·수면 조건으로 남는다.

**⑧ 산출물(ELI5 아티팩트).** 「조용히 멈추는 워치」 https://claude.ai/code/artifact/ae240529-c1c3-4f0a-a870-202eb73110b0 — FGS 무음 정지 대응 3안(재승격 트리거 / 면제 / 사용자 알림).
「두 워치의 밤」 https://claude.ai/code/artifact/6ce39726-83e5-4f59-98a5-39967d5299ec — R-12·R-13 결과(밤 띠 · 성적표 · HRV 수리 · SpO₂ 점). ⚠ §03 의 유보(기기 차이)에 **⑤ 면제 혼입**을 더해 읽는다.
원자료 = 세션 스크래치 `w9-stats.txt`(낮 덤프) · `w9-netstats.txt` · `w9-wifi.txt` · `w9-deviceidle.txt`(세션 종료 시 소멸 · 수치는 이 항에 옮겨 적음).

## R-10 · 운용 규율

- 커밋은 이 세션이 각자 하고 **push·/deploy 는 담당([WATCH.APP]) 세션**에 요청한다([[L-125]]). 서버 배포(2단계)가 워치 설치(3단계)에 선행한다(R-06).
- `git commit -- <경로>` 관용구로 공유 index 를 우회한다([[L-87]]⑤). 워킹트리의 남의 미커밋 2건(`settings.gradle.kts` · `ProbeScreenPreview.kt`)은 건드리지 않는다.
- 테스트 = `apps/vitalguard_app/android` 에서 `./gradlew :wear:testDebugUnitTest`. 가드는 `TickAlarmTest`·`RestartReceiverTest` 의 소스 판독 방식을 따른다(값이 아니라 API 선택을 못 박는다).
- 변이 1회([[L-113]]) — `armHeartbeat()` 호출을 지우면 가드가 빨개지는지 본다. `HrWatchdogTest` 의 "등장 횟수" 함정([[L-123]]④)을 피해 **배선 지점**을 단언한다.
