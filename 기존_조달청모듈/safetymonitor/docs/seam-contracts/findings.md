# 이음새 A·B·H·K 심층 조사 — 합의를 계약으로

2026-08-21 · 기준 커밋 `1c6f461` · 발주 = "합의만 진행된 파이프라인 확인 → 계약이 필요한 부분 확인 →
합의→계약 방안 모색" (docs/seams.md 표의 A·B·H·K).

방법 = 각 이음새의 **양끝 코드를 전수로 읽고**(보내는 쪽 키 조립부 · 받는 쪽 키 해석부), 그 키가
가드 테스트에 등장하는지를 따옴표 포함 정확 매칭으로 쟀다. ⚠ 이 측정은 *"그 키 문자열이 가드
파일에 등장하는가"* 까지다 — 등장한 가드가 양끝을 실제로 잇는지는 표본으로만 확인했다(L-98①).
0건 판정에는 통제군을 붙였다.

---

## 요약 — 네 이음새의 합의/계약 실태

| # | 이음새 | 합의 표면 | 계약(강제) 현황 | 구멍 |
|---|---|---|---|---|
| A | 워치→폰 | 문자열 키 26개 (샘플 22 + 봉투 4) | 사건별 가드 8계열이 키 12개를 고정 | **핵심 키 9개 무가드** + 봉투 `sentAt` 쓰기 전용 |
| B | Swift→Dart | 채널명 2 + 메서드 12 + 이벤트 키 15 + status 키 15+ | **0** — 어느 것도 가드 없음 | 표면 전체 |
| H | 관제웹→스토리지 | 프리사인 2단 프로토콜(발급 key → 등록 storageKey) | 인증만. 프로토콜 자체는 무검증 | 업로드 다리 **레포 안 호출자 0** · 등록이 임의 key 수용 · 고아 대사 부재 |
| K | 서버→텔레그램 | `sendTelegramMessage(text)` 자유 문자열 | 관문 경로는 타입이 계약 · 직접 발신 3곳은 각자 가드 | **네 번째 발신 지점은 아무것도 못 잡는다** |

---

## A. 워치 → 폰 (WCSession)

### 실측 — 키 대장

보내는 쪽 = `VitalWatch/WatchStreamer.swift` 배치 조립부(약 :395-500 · 커밋 기준). 받는 쪽 =
`Runner/VitalPipeline.swift ingest()`(:113-230) + `Runner/PhoneReceiver.swift updateSnapshot()`.

```
봉투(4)   type("hrBatch") · seq · sentAt · samples
샘플(22)  ts bpm ae stp flt bat sst sar seAt seBy srAt srN mv
          hrv rhr whr rr pe dl spo2 spo2Ts still
```

- 폰이 읽는 것 = 샘플 22개 전부 + 봉투 3개. **`sentAt` 만 아무도 안 읽는다**(아래).
- 이산 6종 키 목록(`pe dl rhr whr rr hrv`)은 **세 벌**이다 — 워치 `discreteInputs` 정의 ·
  워치 `ContentView.discreteLine` 표시 순서 · 폰 `PhoneReceiver.discreteKeys`. 전부 손복사.

### 가드 커버리지 (키 문자열 등장 기준)

```
고정돼 있음(12)  flt spo2Ts pe dl bat mv seAt seBy srAt srN sst sar
                 — 전부 2026-08-14 이후 "사건 → 사건별 가드" 로 생긴 것
무가드(9+봉투)   bpm* ae stp still hrv rhr whr rr spo2 · 봉투 4개 전부
```

*`bpm` 은 가드 3파일에 등장하나 배치 충돌·세션 계측의 **앵커**로 쓰인 것이지 양끝 키 대조가 아니다.
`spo2` 등장 3파일은 관제웹 차트 가드라 이 이음새와 무관하다.

⟹ 구조가 정확히 뒤집혀 있다. **최근에 사고를 낸 필드는 고정돼 있고, 가장 오래되고 가장
하중이 큰 필드(bpm·ae·stp·이산 6종)는 아무것도 안 지킨다.** 오래됐다는 것이 안전하다는 뜻이
아니라 — 사고가 났을 때 가드를 만들었다는 뜻일 뿐이다.

### 발견 A-1 — 봉투 `sentAt` 은 쓰기 전용이다 (L-91 형태)

워치가 배치마다 `sentAt`(전송 시각)을 싣는데 폰의 두 수신부 어디에서도 읽지 않는다
(`VitalPipeline.swift:117` 의 `sentAt` 은 **폰이 새로 찍는** 수신 시각이고 워치 값과 무관).
통제군 = 같은 파일들이 `payload["samples"]` 는 같은 표기로 읽는다 — 조회가 눈먼 것이 아니다.

의미 = 워치→폰 **순수 전달 지연**을 잴 유일한 재료가 버려지고 있다. 08-14·08-18 전달 지연
트랙이 그 값을 `ts − heart_rate_measured_at`(측정→수신, 워치 내부 배칭 5초 포함)으로 우회
추정해야 했던 이유가 이것이다.

처방은 결정 사항이다 — ⓐ 읽는 경로를 만들거나(진단 status 화면에 "마지막 배치 전달 지연" ·
4중주 필요) ⓑ 워치에서 빼서 합의 표면을 줄인다. **L-101② 에 따라 읽는 곳을 지목하지 못하면
ⓑ가 규율에 맞다.** 어느 쪽이든 워치 코드 변경 = 바이너리 변경 = C-1 표본 리셋이므로
**08-26 재서명 창에 묶는다**(단독 설치 금지).

### 방안 — 합의→계약

① **키 전수 가드 1본(권장 · 즉시 가능).** 워치 쓰기 쪽(`pendingSamples[…]["k"]` · 조립 리터럴)과
폰 읽기 쪽(`s["k"] as?`)에서 키 집합을 추출해 **집합으로 대조**한다. 한쪽에만 있는 키가 생기면
빨강. 이산 6종 목록 세 벌의 동일성도 같은 가드에 넣는다. 선례 = `site-radius` 가드(Swift·TS 를
숫자로 묶음). ⚠ 함정 둘 — 주석·문자열 오염(L-83 · 추출 후 표본 검산 필수) · 스캔 바닥이 비면
조용히 통과(L-79 · 추출 건수 > 0 을 함께 단언).

② **공유 상수 파일(진짜 계약 · 큰 수술).** 같은 언어·같은 Xcode 프로젝트라 A 는 네 이음새 중
유일하게 **컴파일러 계약이 가능**하다 — `PayloadKeys.swift` 를 두 타깃 멤버십으로 두면 오타가
빌드 실패가 된다. 대가 = pbxproj 편집 + 두 파일 전반의 리터럴 치환(안정 파이프라인에 큰 diff).
①을 먼저 깔고, 워치를 크게 손대는 다음 기회에 얹는 것이 맞다.

⚠ 한계를 정직하게 — WCSession 은 plist 직렬화라 수신측에서 숫자가 전부 NSNumber 로 온다.
키 이름은 가드로 잡아도 **타입 어긋남은 실기기 경로에서 조용히 관대하다**(Int→Double 캐스팅이
크로스 프로세스에서만 성공). 타입까지 계약하려면 ②뿐이다.

## B. 폰 Swift → Dart (Flutter 채널)

### 실측 — 표면 전수

```
채널명(2)      vitalguard/stream (EventChannel) · vitalguard/bridge (MethodChannel)
메서드(12)     login logout ownVitals captureMedia listMedia deleteMedia addComment
               updateComment deleteComment updateMediaDescription vitalsSnapshot status
이벤트 키(15)  type seq channel bpm measuredAtMs spo2 spo2AtMs stillSec steps flights
               discreteCounts discreteValues · pending uploadOk authRejected
status 키(15+) loggedIn workerId loginId name pending baseURL lastVitalAtMs lastVitalAgeSec
               watchBatteryPct photoAddAuth appVersion appBuild builtAtMs + 위치 진단 키들
```

양끝 대조(오늘 수작업) = 현재 **어긋남 0** — Dart `VitalStreamEvent.fromMap` 이 읽는 15개 키
전부 Swift 가 내보내고, 그 역도 성립한다(`batteryPct` 는 이벤트에 일부러 없음 — status 폴링
전용, 주석으로 명시돼 있어 결함 아님).

### 발견 B-1 — 이 표면 전체에 가드가 0개다

`vitalguard/stream`·`vitalguard/bridge`·`measuredAtMs`·`stillSec`·`discreteCounts` 등 어느
문자열도 가드 테스트에 등장하지 않는다(통제군 = 같은 검색이 Dart 위젯 테스트 5파일은 잡는다 —
그것들은 Dart 쪽 혼자만 고정한다). 08-20 에 EventChannel 이 하루 두 번 끊겨 화면이 얼었던
바로 그 자리이고, 키 하나가 어긋나면 **서버는 정상 수신 중인데 폰 화면 값만 조용히 빈다** —
표의 "깨지면 보이는 모습" 그대로, 잡을 장치가 하나도 없다.

부수 = 08-18 에 `flights` vs `flightsClimbed` 키 혼동으로 실측을 한 번 그르친 전례가 있다.
같은 이름 계열이 이음새마다 다른 표기(워치 `flt` → 서버 `flightsClimbed` → 이벤트 `flights`)로
세 번 갈아타는 구조라, 이름 지도 자체가 문서화 가치가 있다.

### 방안 — 합의→계약

**키 전수 가드 1본(A 와 같은 형태·같은 파일에 얹어도 된다).** ⓐ 채널명 리터럴이 Swift·Dart 에서
동일한지 ⓑ `displayEvent`+pipeline emit 이 내보내는 키 집합 ⊇ Dart `fromMap` 이 읽는 키 집합,
그리고 역방향(내보내는데 아무도 안 읽는 키 = 쓰기 전용 검출) ⓒ status 응답 키 ⊇ 설정 화면이
읽는 키. 교차 언어라 컴파일러 계약은 불가 — 가드가 이 이음새의 상한이다.

## H. 관제웹 → 스토리지 (프리사인 2단)

### 실측 — 다리 하나가 휴면이다

```
살아 있는 경로   GET 목록(presignDownload) · download-url(첨부 GET) · DELETE(행→실물)
                 앱 업로드 = /api/app-media (G 이음새 · 서버가 putObject+등록을 한 호출로)
휴면 경로        POST upload-url(프리사인 PUT 발급) + POST /api/calendar/media(등록)
                 — 레포 안 호출자 0 (관제웹 UI 는 업로드 기능 자체가 없다)
```

`/api/cctv/event` 와 같은 부류가 하나 더 있었던 것이다 — **생산자를 레포 안에서 확인할 수 없는
열린 프로덕션 라우트.** 다만 이쪽은 인증(관리자 세션 또는 앱 업로드 토큰)이 걸려 있다.

### 발견 H-1 — 등록 API 가 임의 storageKey 를 수용한다

`POST /api/calendar/media` 는 `storageKey` 를 **문자열이면 그대로** insert 한다. 검증 없음 —
ⓐ 실물 존재 확인 없음(등록만 성공하면 **깨진 이미지 행**이 생긴다) ⓑ 발급 이력 대조 없음
(다른 행이 참조 중인 key 를 재등록할 수 있다 — 그 행을 지우면 실물 삭제가 **남의 참조를
파괴한다**. DELETE 는 자기 행의 key 만 알고, 같은 key 를 참조하는 다른 행은 세지 않는다)
ⓒ key 형식 검사 없음(`calendar-media/…` 프리픽스 밖 임의 경로 등록 가능 — presignDownload 가
버킷 임의 객체를 관제 화면에 띄우는 통로가 된다).

### 발견 H-2 — 고아가 양방향으로 생기는데 대사(對査)가 없다

표의 실패 모습(PUT 성공 + 등록 실패 = 참조 없는 파일)에 더해, DELETE 의 실물 삭제 실패도
`console.warn` 만 남기고 고아가 된다(08-20 실측 — 그 경로로 이미 고아 4개·21.2MB 가 쌓여
있었고 **전부 수작업 전수 대조로만** 찾았다). 수작업이 유일한 회수 수단인 상태.

### 방안 — 합의→계약

① **휴면 확인이 선행이다(읽기 전용·반나절).** 프로덕션 요청 로그에서 `POST …/upload-url` 발생
여부를 잰다. 0건이면 → **봉인**(라우트 제거 또는 410 + 가드)이 최선의 계약이다 — 프로토콜을
강화할 필요 없이 다리를 없앤다. 발생이 있으면 → 생산자를 확인하고 seams.md 에
`/api/cctv/event` 와 같은 ⚠(레포 밖 생산자) 를 단다. **어느 쪽인지 확인 전에는 라우트를
건드리지 않는다.**
② **등록 검증(등록 API 가 살아남는 경우만).** key 형식 정규식 + 버킷 HEAD(실물 존재) +
동일 key 기존 행 검사. 셋 다 등록 시점 1회 왕복이다.
③ **고아 대사 리포트(방향 무관하게 유효).** 버킷 목록 ↔ `calendar_media.storage_key` 전수
대조를 스크립트로 — 08-20 수작업의 기계화. **보고만 하고 지우지 않는다**(자동 삭제는
등록 지연 중인 정상 객체를 죽일 수 있고, 파일 파괴는 사람 결정 사항).

## K. 서버 → 텔레그램

### 실측 — 관문은 견고하고, 문은 열려 있다

관문 경로(`recordAlert` → `notifyAlertTelegram` → `formatAlertMessage`)는 네 이음새 중 가장
계약에 가깝다 — `AlertNotifyInput` 타입에 생체 수치 필드 자체가 없고(구조적으로 못 싣는다),
마스킹은 순수 함수 + 테스트, DB 장애 시에도 통지는 나간다(DB-POOL-02 계승).

직접 발신(`sendTelegramMessage` 자유 문자열) 지점 = 정확히 3파일.

```
app/api/app/vital/store.ts:610      온열 경고   → recordAlert(notify:false) 동반 · 가드 있음
app/api/cron/absence-check:82,124   감시 공백   → recordAlert 동반 · absence-ledger 가드 있음
lib/env-alert-notify.ts:88          환경 경보   → env_alert_state 단계 전이 원장
```

### 발견 K-1 — 네 번째 발신 지점을 잡는 장치가 없다

세 가드는 전부 **자기 파일 안**만 본다. 새 코드가 `sendTelegramMessage` 를 import 해서 부르면 —
원장 기록 없이, 마스킹 없이, 수치 포함 여부 검토 없이 — **어떤 가드도 빨개지지 않는다.**
표의 "관문을 우회해 보내면 발동 이력이 원장에 안 남는다. 전례가 있다" 는 그 전례(온열 알림)의
재발 방지가 *그 지점에만* 걸려 있다는 뜻이었다. 우회 금지가 계약이 아니라 **지점별 각개 합의**다.

### 방안 — 합의→계약

**발신 지점 허용목록 가드 1본.** `apps/dashboard-web` 전체에서 `sendTelegramMessage(` 호출
지점을 스캔해 **파일 집합이 허용목록과 정확히 같은지** 단언한다(정의부·telegram.ts 제외).
새 발신 지점 = 가드 빨강 = 허용목록에 넣으려면 원장·마스킹·수치 검토를 거치게 된다.
이 가드가 초록이면 보장되는 것 = *"텔레그램으로 나가는 문자열의 발신 지점 집합이 검토된 집합과
같다"* (L-101③ 문장). ⚠ 스캐너 함정 = `client-ip` 가드의 `existsSync` 폴백처럼 스캔 바닥이
비면 0개를 훑고 통과한다(L-79) — 스캔 파일 수 하한을 함께 단언한다.

---

## 합의→계약 가능 상한 지도

```
컴파일러 계약 가능   A 만 (Swift↔Swift · 같은 프로젝트) — 공유 상수 파일
가드가 상한          B (Swift↔Dart) · K (호출 지점 집합) — 교차 언어·자유 문자열
런타임 검증 필요     H (등록 시점 실물 대조) — 상대가 코드 밖(버킷·레포 밖 생산자)
확인이 먼저          H 업로드 다리 (휴면이면 계약이 아니라 철거가 답)
```

## 우선순위 권고

```
1  B 키 전수 가드 + A 키 전수 가드 (한 커밋 · 실기기 불필요 · 오늘 가능)
   — 어긋나면 가장 조용히 깨지는 두 자리(서버 정상 + 화면만 빈다)를 처음으로 계약화
2  K 발신 지점 허용목록 가드 (작음 · 전례 있는 실패 모드의 일반형 봉쇄)
3  H ① 휴면 확인(프로덕션 로그 읽기 전용) → 봉인 or 생산자 문서화 → 필요 시 ②③
4  A-1 sentAt 처분 결정(빼기 권장 · L-101②) — ⚠ 워치 변경이므로 08-26 재서명 창에만
```

미실행·미검증 = K·H 의 가드·확인은 아직 제안이다. H 의 휴면 여부는 프로덕션 로그를
아직 안 봤다(이 문서는 레포 안 호출자 0 까지만 확정한다).

**진행 기록.** 권고 1(A+B 키 전수 가드)은 2026-08-21 구현됨 — `047b084` ·
`apps/dashboard-web/lib/2026-08-21-app-seam-key-census.guard.test.ts` (7건 · 전체 1166/1166).
