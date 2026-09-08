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
- [ ] 워치9 동일 빌드 설치 — 오늘 밤 측정 대상이라 사용자 판단 대기
- [x] **R-17 재현 시험(재시작 경로)** — 16:43:18 재현. 센서는 새 `1.00` 을 안 냈고, **앱 기본값 `worn=true` 가 78 ms 동안 수집을 켰다**(`착용 — 수집 개시` .498 → 실제 `0.00` 도착 .502). 아침 8분 25초와는 다른 짧은 형태 · 가짜 심박 0건(bpm=null)
- [ ] **R-17 재설치 경로 시험** — 아침 15:05:55 의 `1.00` 은 센서가 실제로 낸 값이었다. `adb install -r` 로 재현하는지 확인 · **프로덕션 오염 위험이라 사용자 승인 필요**
- [ ] ⚠ **워치8 `screen_off_timeout` 원복** — 시험용으로 15000 → 600000 으로 올려 둔 상태(16:42). 끝나면 15000 으로 되돌린다(R-14 ⑥ 전례)
- [ ] R-17 구간(15:05:55~15:14:20 · EMP-admin3470) 프로덕션 표본·알림 확인
