# 워치 FGS 하트비트 — 체크리스트 (2026-09-05)

목표 = **뒤에서 죽은 수집 서비스가 사람 없이 ≤10분 안에 되살아난다.** 근거·결정 = [context-notes.md](./context-notes.md) R-01~R-09.

성공 기준(R-07) — 시계 화면이 맨 앞인 상태에서 `am crash` → 사람 개입 없이 **10분 + 승격** 안에
ⓐ `VgRestart` `하트비트 소생` 로그 ⓑ DB vitals 행 재개 ⓒ 그 행의 `fgsRevivedAt ≠ null`. **셋 다.**
대조군 = 같은 조작을 현 빌드에서 1회(되살아나지 않음을 기록).

★ 첫 관문은 코드가 아니라 **R-03 전제 판정**이다 — allow-while-idle 배달에 FGS 면제가 붙지 않으면 이 트랙은 2겹(면제) 뒤로 물러난다.

## 0단계 — 착수 전

★ **기기 = 워치9 우선(09-05 사용자 지적).** 처음엔 "정지가 관측된 기기" 라서 워치8을 적었는데, R-03 은 기기 빌드마다 성립해야 하고
워치9가 주 수집기라 워치9에서 안 되면 워치8 결과는 의미가 없다. 워치9는 adb 로 잡혀 있고 충전기 위·미착용이라 끊는 비용도 지금이 가장 낮다.
워치8은 2차 표본. ⚠ 조건 둘 — ⓐ 충전 중이면 Doze 가 꺼져 10분 조절은 시험되지 않는다(면제 여부만 시험됨) → 방전·미착용 상태에서 1회 더.
ⓑ 미착용 중 배터리 표본은 `WornMarker.idleBattery` 라 `fgsRevivedAt` 이 안 실린다 → 판정은 로그로, DB 표식은 착용 뒤 첫 생체 표본에서.

- [ ] **Q-1 판독** — 워치9 설치 직후 `logcat -s VgRestart VgCollector:W` 에서 `MY_PACKAGE_REPLACED` 경로가 거부되는지 직접 본다(설치 자체가 실험). 보조 = 워치8 `logcat -d -s VgRestart` 에 09-03 07:52 `MY_PACKAGE_REPLACED — 수집 서비스 자동 시작` 이 있는가.
      있음 → 면제 경로도 거부됐다(ⓑ · R-03 위험 상향). 없음 → 리시버가 안 돌았다(ⓐ/ⓒ). 버퍼 없으면 3단계 재현에서 함께 본다.
- [ ] **대조군 1회** — 현 빌드 워치9, 시계 화면 맨 앞, `adb shell am crash com.vitalguard.vitalguard_app` → 10분 관찰 → DB vitals 미재개 확인.
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
- [x] push — 이 세션이 담당([WATCH.APP])이나 `git push` 가 분류기에 막혀 사용자가 `!` 로 실행(368e95d..e528423 · pre-push typecheck 통과)
- [x] `/deploy` → **`00352-zvn`** · digest 0e1464cc 대조 일치 · 아카이브 1599/1599 · 라우트 5종 ok · 사후 90초 0/0 · run-log·CLAUDE.md 기록
- [ ] 라이브 확인 — 서빙 digest 대조 ✓ · `fgsRevivedAt` 실물 확인은 **워치9 착용 뒤 첫 생체 표본**으로(프로덕션에 시험 표본을 curl 로 넣지 않는다 · L-04 계열) → 3단계

## 3단계 — 실기 검증 (R-03 판정 · R-07 절차)

- [x] 워치9 Release 빌드(21:15·v2 서명)·설치(21:36·21:43 2회) — **사용자 승인 · 미착용 시간**(워치8 은 2차)(09-03 내 설치가 7분 정지를 만들었다)
- [x] 로그인(QR)·승격 확인 · stayon+wifi_sleep_policy 로 접속 유지(앱이 TOP 이면 실험이 아니다)
- [x] am crash → **이 기기는 sticky 재기동 성공**(정지 재현 안 됨 · R-11①) → 재현은 교체 경로로 전환
- [x] 교체 경로 START 성공(R-11②) + 라이브 REARM(R-11③) + 알람 FGS 허용목록(R-11④) → **R-03 닫힘(행위+구조)**. 진짜 알람 소생 장면은 자연 관측(4단계)으로
- [x] **판정 = R-03 성립**(면제 붙음 · 2겹 불필요)
- [x] DB(00352-zvn) — 새 빌드 표본 적재 확인 · fgsRevivedAt 전부 null(소생 전이라 정상) · HRV 잔여물 0건(R-11⑤) · 소생 첫 행 관측은 24h 대기
- [x] 밤샘 관찰(9.6h) — `fgsRevivedAt` 0 = 서비스 사망 0 · 연속성 최대 공백 4분 · 옛 빌드 워치8 대조 29분/부재 9건(R-13)

## 4단계 — 기록

- [ ] context-notes 에 Q-1 답 · R-03 판정 · 공백 실측치 추가
- [ ] `기존_조달청모듈/safetymonitor/CLAUDE.md` 워치 상태 줄 갱신(팀원이 보는 유일한 상태)
- [ ] 메모리 `worn-marker-server-gate-pending` 의 "FGS 백그라운드 거부" 항에 이 트랙 결과 한 줄
- [ ] 별도 트랙 후보로 남기는 것 — 2겹(배터리 최적화 면제 · R-03 실패 시 승격) · 배터리 바닥 46.3 mAh/h(R-08 · 앱 밖)

## 후속 (09-06 · R-14)

- [x] Q-2 답 — 워치9 는 Doze 면제 목록에 있었다(08-29 ADB 등록) → A/B 두 번째 혼입으로 기록(R-14 ⑤)
- [x] 워치9 디버그 설정 원복 — `stay_on_while_plugged_in` 0 · `wifi_sleep_policy` 는 기본값이라 무효였음(정정)
- [x] ELI5 아티팩트 2건 링크를 context-notes 에 기록(R-14 ⑧)
- [ ] **밤샘 구성요소 덤프는 충전 전에** — 아침 탈착 직후 핫스팟 합류 → `dumpsys batterystats`(11:26 리셋으로 오늘 밤 것은 소실)
- [ ] 오늘 밤 깨끗한 측정 — 워치 Wi-Fi 끔 · 무선 디버깅 끔 · LTE 단독(R-14 ⑦)
- [ ] 워치8 결정 판정을 두 밤으로 — ⓐ 새 빌드만 ⓑ 새 빌드 + 면제(R-14 ⑤)
- [ ] LTE 비용 A/B(캐던스 2분 vs 5분 · 또는 배치 전송) — batterystats 가 모뎀을 안 재므로 같은 기기 밤 두 번(R-14 ③) · 설계 판단

## 후속 (09-07 · R-15 · 워치8 실기)
- [x] 워치8 adb 무선 연결 — IPv6 링크로컬로만 됨(`192.0.0.5` 는 워치 내부 clat · 맥에서 불가)
- [x] **Q-2 확정** — 워치8 은 Doze 면제 **미등록**(전수 grep 0건) → R-12·R-13 A/B 는 2요인 비교 확정(R-15 ②)
- [x] 워치8 밤샘 배터리 창 확보(14h42m · 리셋 전) — 단 **로그아웃·미수집 유휴** 분모(R-15 ③)
- [x] **LTE 모뎀 실측** — 워치8 프로파일엔 `mobile_radio` 가 잡힌다: 66.6 mAh = 전체 85.0 의 78%(R-15 ④)
- [x] QR 로그인 6회 실패 원인 확정 — 화면 타임아웃 15초, 폴링이 화면과 함께 죽음(R-15 ⑤)
- [ ] **워치8 로그인(EMP-admin3470)** — 승인을 15초 안에 끝내거나 승인 중 화면을 다시 깨운다(R-15 ⑦)
- [ ] QR 수리 착수 여부 — `code`·`secret` 을 액티비티 필드로 올려 재개(서버는 이미 받아 준다 · R-15 ⑥) · **secret 수명 변경이라 사용자 승인 필요**
- [ ] onStop 인지 서스펜드 정지인지 logcat 으로 가르기(adb 붙었으니 가능 · R-15 ⑤)
- [ ] 워치8 수집 상태 밤샘 재측정 — 이번 85 mAh 는 유휴라 수집 비용과 비교 불가(R-15 ③)

## 후속 (09-07 · R-16 · QR 수리 C안 · 사용자 승인)
- [x] 워치9 동일 증상 여부 판정 — 코드 동일(MainActivity 최종 변경 09-01), 차이는 `screen_off_timeout` 15초 vs **60초**뿐
- [x] C안 결정 — QR 화면 동안만 `FLAG_KEEP_SCREEN_ON`(`secret` 수명 계약 무변경)
- [x] 구현 — `DisposableEffect(qrAwake)` 로 QR LOADING·WAITING 동안만 플래그, 벗어나면 즉시 해제
- [x] 빌드·워치8 설치(15:05:50) · 단위 테스트 344건 통과(가드 2건은 범위를 좁혀 유지)
- [x] 실기 검증 ⓐ 44초까지 `Awake` ⓑ `15:20:03 QR 로그인 성공 worker=EMP-admin3470`(QR 시작 후 285초) ⓒ `업로드 5건 · 잔여 0`
- [x] 회귀 확인 — QR 을 벗어난 뒤 15:20:50 `mWakefulness=Dozing`(앰비언트 정상)
## 09-08 · 워치9 e481e99 설치 실행계획 (17:30 · 사용자 확정)

**성공 기준(셋 다 충족해야 완료).**
① 워치9이 `e481e99` 로 돌고 EMP-6861 로 로그인돼 수집 재개 ② **가짜 표본 프로덕션 유입 0건**
③ 18:30 이후 관제웹 장우진 행에 `체온 누적 N/30` 이 **한 줄로** 표시(00363-tt2 라이브 실측 · [WATCH.DESIGN] 몫)

**★ 큐 가설은 기각됐다([WATCH.DESIGN] DB 실측 · 16:3x). 대신 더 나쁜 사실이 나왔다.**
내가 세운 가설 = *"가짜 표본은 로그아웃 중 큐에 쌓였다가 로그인 순간 나간다"*(R-17 5표본과
`업로드 5건` 의 건수 일치가 근거였다). **데이터가 정반대를 보였다.**
```
ts 15:05:46 → 수신 15:05:44   심박 85  worn true
ts 15:07:47 → 수신 15:07:45   심박 89  worn true
ts 15:09:47 → 수신 15:09:46   심박 91  worn true
ts 15:11:48 → 수신 15:11:46   심박 89  worn true
ts 15:13:49 → 수신 15:13:47   심박 94  worn true
```
`received_at` 은 서버 DEFAULT 가 찍는다(`db.ts:326` · `vitalSampleColumns` 는 `phone_received_at` 만 싣는다)
⟹ 진짜 도착 지연이고, **−2초는 시계 오차**다. 큐 가설이 예측하는 모양(`ts 15:05~15:14 · 수신 전부 15:20 대`)은 **0건**.
2분 배치 5개에 하나씩 나뉘어 8분에 걸쳐 **라이브로** 나갔다. 건수 일치는 우연이었다.
⚠ 심박값도 정정한다 — 내가 앞서 적은 `HR 151 2건` 은 틀렸다. **실제는 85·89·91·89·94** 다.

**⟹ 그 8분 동안 워치는 로그인 상태였다. 그리고 코드가 그 이유를 설명한다.**
`ConfigStore.kt:12` 는 `getSharedPreferences("vg-upload", MODE_PRIVATE)` 다 — **`install -r` 이 지우지 못한다**
(앱 데이터는 uninstall·`pm clear` 로만 지워진다). `clearSession()` 호출자는 **둘뿐**이다.
`CollectorService.kt:416` 90분 미착용 자동 로그아웃 · `MainActivity.kt:171` 수동 로그아웃.
⟹ **"설치가 세션을 지운다" 는 이 체크리스트의 종전 서술(115행)은 `install -r` 에는 성립하지 않는다.**
아침 워치8 의 15:20 QR 로그인은 설치 때문이 아니라 그 뒤의 별도 로그아웃 때문이었다.

**⟹ 안전 구간은 없다. 세션이 살아 있으면 생성 후 ~2분 안에 프로덕션으로 나간다.**
그러므로 막을 자리는 전송도 로그인 타이밍도 아니고 **생성 하나뿐**이다.
⚠ 먼저 로그아웃해 두는 우회는 쓰지 않는다 — 일괄방출 기구가 실재하기 때문이다([WATCH.DESIGN] 실측:
워치8 오늘 `수신 08:56:00 · 37행 · ts 폭 28분`, `수신 11:21:51 · 16행 · ts 폭 11분` — 둘 다 로그아웃/첫 기동 창에 붙는다.
`db.ts` `uq_vs_worker_ts` 주석도 *"재전송·backlog flush 중복 방지"*). 로그아웃은 유입을 없애는 게 아니라 **로그인 시점으로 미룬다.**

**타임라인.**
```
~17:25  [준비·사용자] 워치9 착용 유지. 폰 준비(QR 승인용). 워치8은 건드리지 않는다(배터리 측정 중)
 17:30  ① 워치9 벗음 → 충전기에 올리지 않고 **센서면(뒷면)이 위를 보게** 테이블에 둔다
           ★ 이것이 오염 차단의 전부다 — PPG 가 피부·크래들을 못 읽으면 가짜 HR 이 안 난다
        ② 무선 디버깅 연결 (아래 명령)
 17:32  ③ pm install -r → 즉시 logcat 관측 (Q-1 · R-17 재설치 경로를 이 설치로 겸한다)
 17:40  ④ 로그인 상태 확인 — `install -r` 은 세션을 안 지운다(코드 확인). 지워져 있으면 그때만 QR 재로그인(EMP-6861)
 17:45  ⑤ 설정 2종 확인 → 충전기로 이동. **착용하지 않는다**
 18:30  ⑥ 마지막 심박(≈17:30)에서 60분 경과 → 착용 재개하면 칼만 리셋
        ★ 이때 QR 재로그인 **불필요** — 자동 로그아웃 문턱이 90분이라 60분은 아래다([WATCH.DESIGN] 지적 · 코드 확인
          `CollectorService.kt:394` "미착용이 90분 이상 이어지면 자격을 지운다")
 ⛔19:00  **착용 재개 마감.** 넘기면 자동 로그아웃이 터져 QR 재로그인이 필요해지고,
          그 뒤 생성분은 일괄방출 경로를 타 유입 시점이 로그인으로 밀린다(오늘 밤 관측을 흐린다)
          ⚠ `offBodySince` 도 ConfigStore(SharedPreferences)라 설치를 건너 살아남는다 — 시계는 계속 간다
          ⚠ **정정(내 오독 · [WATCH.DESIGN] 지적 · 코드 재확인).** *"설치 직후 기본값 `worn=true` 가 앵커를 리셋한다"* 는 **틀렸다.**
            `CollectorService.kt:408` 의 리셋은 `if (offBody.observed && offBody.worn)` 이라 **`observed` 게이트 뒤**에 있고
            `OffBodySource.kt:40` `observed` 기본값이 `false` 라 재시작 직후엔 그 분기에 못 들어간다(주석에 의도가 명시돼 있다).
            `:295` 도 `if (config.offBodySince == 0L)` 이라 이미 찍힌 앵커를 안 덮는다 — *"앵커는 최초 1회만"*.
            ⟹ **고칠 것이 없다. 없는 버그를 등재하지 않는다.**
          ★ **다만 앵커를 되돌리는 경로는 따로 있다(내가 확인).** `:288-291` 콜백의 `if (wornNow) { …; config.offBodySince = 0L }`
            에는 `observed` 게이트가 없다 — 콜백 자체가 관측이기 때문이다. 그래서 **센서가 실제로 `1.00` 을 내면**
            (아침 워치8 의 8분 25초가 그 모양) 앵커가 0 으로 지워지고, 뒤이어 `0.00` 이 올 때 **그 늦은 시각으로 다시 찍힌다.**
            ⟹ 마감은 **앞당겨지지 않고 뒤로만 밀린다.** 그러므로 **19:00 은 어느 경우에도 안전한 하한**이고 그대로 쓴다.
            (`AUTO_LOGOUT_OFF_BODY_MS = 5_400_000L` · `shouldAutoLogout` 은 `>=` 경계 포함 — 둘 다 확인)
 18:35~ ⑦ 라벨 발현 구간(0/30 → 30/30 까지 60~90분) · [WATCH.DESIGN] 육안 확인
```

**명령(연결).** mDNS 가 죽은 포트를 광고하므로 `dns-sd` 가 아니라 아래로 후보를 전부 받는다.
```
adb mdns services                      # 같은 기기가 포트를 둘 광고하면 뒤엣것이 살아 있다(09-08 실측 2회)
adb connect '[fe80::…%en0]:<포트>'      # 폰 핫스팟은 NAT64 라 IPv4(192.0.0.x) 불가
```

**명령(설치·관측).**
```
adb install -r apps/vitalguard_app/build/wear/outputs/apk/release/wear-release.apk
adb logcat -s VgRestart VgCollector:W VgOffBody   # 설치 직후 즉시. 볼 것 3가지
```
- `MY_PACKAGE_REPLACED` 경로가 거부되는가 → **Q-1 답**(체크리스트 18행)
- `worn` 이 `1.00` 을 내는가·몇 초 지속되는가 → **R-17 재설치 경로 답**(아침 8분 25초의 재현 여부)
- 그 구간에 `bpm` 이 붙는가 → 붙지 않아야 성공(센서면을 위로 둔 효과)
★ **관측은 양쪽에서 동시에.** 내 logcat(생성) + [WATCH.DESIGN] 의 실시간 DB 감시(유입 · `watch9.mjs` 가동 중).
  그쪽 감시기는 **자가 무장**이라 내 알림을 안 기다린다(무장 = 17:20 이후 AND 심박 4분 공백 · 상한 19:30).
  세 상태를 갈라 준다 — 심박행 유입=가짜 생성+전송(force-stop) · 심박 없는 행만=성공 · 아무 행도 없음=수집이 안 붙음(Q-1 신호).
  걸린 행의 `ts` 가 무장 이전이면 일괄방출, 이후면 새로 생성된 것이라 원인까지 갈린다.
  한쪽만 보면 "안 보이는 것"이 생성이 없는 것인지 관측이 눈먼 것인지 안 갈린다.

**설치 후 확인 2종 — 반드시 둘 다**(09-08 실측: 페어링 작업이 `screen_off_timeout` 을 되돌린다).
```
adb shell settings get system screen_off_timeout        # 워치9 기준값 = 60000 (워치8의 15000 아님)
adb shell settings get global stay_on_while_plugged_in  # 0 이어야 한다
```

**중단 기준.** 아래 중 하나라도 나오면 멈추고 사용자에게 보고한다.
- 설치 후 `bpm` 이 붙은 가짜 표본이 관측된다 → **즉시 `am force-stop com.vitalguard.vitalguard_app`** 으로 창을 끊는다
  ⚠ 종전 문안(*"로그인 전에 멈추면 유입 0"*)은 **폐기한다** — 세션이 살아 있어 로그인은 방아쇠가 아니다
- `pm install -r` 후 7분이 지나도 수집이 안 붙는다(09-03 워치8 전례 · FGS 승격 거부)
- QR 승인이 3회 실패한다 → e481e99 수리가 워치9에서 안 먹은 것이므로 원인 규명이 먼저다

**되돌리기.** 직전 빌드는 09-03 판이고 APK 산출물이 남아 있지 않다 —
**롤백하려면 재빌드가 필요하다**(즉시 복구 불가). 그래서 중단 기준을 먼저 정했다.

**남는 위험(수용).** ① `install -r` 직후 무전송 구간(전례 7분) — 어차피 벗은 시각이라 손실 0
② 90분 미착용 자동 로그아웃 — 17:45 로그인 기준 19:15 이므로 18:30 착용이면 여유 45분

- [ ] **워치9 동일 빌드(e481e99) 설치 — 09-08 저녁, 워치9을 어차피 벗는 시각에**([WATCH.DESIGN] 경유 사용자 결정 전달 · ⚠ 착수 전 사용자에게 직접 재확인한다 — 옆 세션 전언은 승인이 아니다)
      - 낮에 안 하는 이유 ① 재설치가 데이터를 끊는다(`context-notes.md:13` 09-03 워치8 `pm install -r` 직후 **7분간 vitals 0행**) + 칼만 세션 리셋
        ② 지금 워치9이 **유일한 온전 데이터원**이다(워치8은 11:16 워밍업 시작이라 ≈12:17 에나 값이 난다)
        ③ 급하지 않다 — 워치9은 QR 실패 증상이 없다(60초 창 > 승인 16~25초)
      - 그래도 넣어야 하는 이유 — 워치9도 **미착용 90분 자동 로그아웃 대상**이고, 7일 실측에서 90분 이상 공백이 **10회**(최장 1,503분) 났다.
        즉 워치9도 주기적으로 QR 재로그인을 거치며 **지금은 60초 창 하나에 기대고 있다** — 승인이 늦으면 워치8과 같은 6/6 실패가 난다.
      - 설치 시 챙길 것 — `pm install -r` 직후 7분 무전송·FGS 승격 거부 전례(`context-notes.md:46` Q-1 미해결) · R-17 계열 기본값 `worn=true` 짧은 수집(78ms) ·
        설치 후 **QR 재로그인 필요**(세션 삭제) · 워치9 `screen_off_timeout` 은 **60000 유지**(워치8의 15000 과 달리 이게 워치9 기준값)
      - 워치9은 나머지 조치 불필요(6시간 대조: 손목온 도달률 100% vs 25.8% · 피부온−주변온 +4.00℃ vs −0.23℃ · Doze 면제 보유 · 밴드 밀착 정상). **빌드만 미결**
- [x] **R-17 재현 시험(재시작 경로)** — 16:43:18 재현. 센서는 새 `1.00` 을 안 냈고, **앱 기본값 `worn=true` 가 78 ms 동안 수집을 켰다**(`착용 — 수집 개시` .498 → 실제 `0.00` 도착 .502). 아침 8분 25초와는 다른 짧은 형태 · 가짜 심박 0건(bpm=null)
- [ ] **R-17 재설치 경로 시험** — 아침 15:05:55 의 `1.00` 은 센서가 실제로 낸 값이었다. `adb install -r` 로 재현하는지 확인 · **프로덕션 오염 위험이라 사용자 승인 필요**
- [x] ⚠ **워치8 `screen_off_timeout` 원복 완료** — 09-08 10:33 `before=600000 → after=15000` 실측. 재연결 시 mDNS 가 죽은 포트(34451)를 계속 광고해 `Connection refused` — `adb mdns services` 가 낸 둘째 포트(35571)로 붙었다. ⚠ **11:2x 에 60000 으로 다시 올라가 있어 재원복**(포트 36887 · [WATCH.DESIGN] 이 발견) — 페어링 작업이 이 값을 되돌리는 것으로 보인다. 워치 작업 후에는 `screen_off_timeout` 과 `stay_on_while_plugged_in` **둘 다** 확인한다
- [ ] R-17 구간(15:05:55~15:14:20 · EMP-admin3470) 프로덕션 표본·알림 확인

## 09-08 · 워밍업 버킷 불일치 (R-18 · 원인 확정 · 수리 미착수)
- [x] **증상** — 같은 순간 워치 화면 12버킷 vs 서버 `coreTempWarmup {buckets:4, needed:30}`([WATCH.DESIGN] 11:23~11:25 실측)
- [x] **알고리즘은 동일** — 워치 `core/CoreTempKalman.kt:56 minuteBuckets`(`floorDiv(tsMs,60_000)` · `MIN_BUCKETS=30`) = 서버 `core-temp-estimator.ts:58`. 여기는 용의자가 아니다
- [x] **원인 = 업로드가 flush 당 심박 1개만 싣는다**
      `CollectorEngine.kt:177` 매 `onHeartRate` 마다 `builder.heartRate(...)` — **뒤 값이 앞 값을 덮는다**(`SampleBuilder.kt:28` 단일 필드)
      `CollectorEngine.kt:183` 같은 순간 `hrLog.addLast(...)` — 이쪽은 전부 쌓인다(워치 화면의 근거)
      `SampleBuilder.kt:43,81` `buildAndReset` 이 1회 소비 후 비움 · `CollectorService.kt:704` `FLUSH_INTERVAL_MS=120_000`
      → **서버 천장 = 2분당 분버킷 1개 = 0.50/분 → 30버킷에 최소 60분.** 워치는 ~1버킷/분 → ~30분. **정확히 2배**
- [x] `heart_rate=null` 행은 버그 아님 — 무동작 단독 전송(`SampleBuilder.kt:105`)·`WornMarker` 별도 경로. "측정된 것만 싣는다" 규칙대로
- [x] **관제웹은 틀린 게 아니라 늦다** — 서버는 받은 것만 센다. 다만 같은 사람 같은 순간에 두 화면이 40분 어긋난다(워치 ~12분 뒤 / 관제웹 ~52분 뒤)
- [ ] **수리 — 사용자 판단 대기.** 권장 ⓐ 한 행에 심박 배열(`heartRateSeries: [{at,bpm}]`) = 행 수 불변(`UNIQUE(worker_id, ts)` 계약 유지) · 무선 깨우기 불변 = **배터리 영향 ~0**
      ⓑ flush 120s→60s = 행·깨우기 2배 → **LTE 배터리 트랙과 충돌, 반대** · ⓒ 서버 문턱 15 = 정확도가 바뀌고 두 화면은 여전히 다름 · ⓓ 워치가 업로드분 기준으로 세기 = 워치가 아는 것보다 늦게 값을 냄
      ⓐ 는 워치 페이로드 키 4종과 같은 규율 — **서버 스키마 먼저 · `.optional()` 만(`.default()` 금지) · 가드 테스트**

