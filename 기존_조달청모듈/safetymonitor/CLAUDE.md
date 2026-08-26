# CLAUDE.md — SafetyMonitor

## 프로젝트 개요

**SafetyMonitor (가칭 `IndusView`)** — 산업 현장 작업자 생체 모니터링. Apple Watch + Android Wear 작업자 단말 ↔ 관제 웹 대시보드 + 모바일 보조 앱. KOSHA 산업안전보건법의 "실시간 위험성 평가" 의무 디지털 지원.

> **발표용 프로토타입 한정이 아니다.** 발표(2026-07-07)는 첫 검증 마일스톤이고 목표는 **최종 상용화·현장 실사용**이다(2026-06-07 방향 전환). 따라서 모든 결정 기준에 "데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다.

HealthPattern (개인용 HealthKit 패턴 앱) 의 분석 알고리즘 *로직만* 이식했다. HealthKit·SwiftUI 종속 코드는 미사용. 외부 서버 0건 정책은 본 프로젝트에서 **폐기**(관제 자체가 서버 필수).

상세 [plan](docs/plan.md) · [checklist](docs/checklist.md) · [context-notes](docs/context-notes.md) · [progress](docs/progress.md) · 상용화 갭·로드맵 [gap-analysis](docs/commercialization-gap-analysis.md) · [roadmap](docs/commercialization-roadmap.md)

## 현재 상태 (Status — 새 세션 시작 시 먼저 읽기)

> **보존 규칙 (2026-08-22).** 이 절의 트랙 전문은 **최근 3건까지**만 둔다. 넘으면 그 자리에서
> `docs/claude-md-archive-<날짜>.md` 로 옮기고 아래 아카이브 목록에 한 줄 더한다.
> 로그가 파일의 90%를 넘겨 세션 컨텍스트를 잡아먹은 전례가 두 번 있다(08-19 · 08-22).

- **라이브** = `vitalguard-dashboard-00322-dqf` (커밋 `9939534` · 08-26 22:2x · 서빙 digest
  `sha256:3f893618…` **대조 일치** · env 28개 유지 · HTTP 200 · 라우트 5종 ok ·
  검증 **1221/1221 @ 아카이브**(= 워킹트리 1231 − `ARCHIVE_SKIP` 10)).
  **★ 칼만 신선도 게이트** — `00321` 에서 판정을 칼만으로 옮기며 내가 만든 구멍을 막았다.
  서버는 심박이 끊겨도 마지막 추정치를 계속 내려보낸다 — 실측에서 EMP-6861 은 **심박 32분
  공백인데 행(피부온·배터리)은 3분 전까지** 들어왔다. **행 신선도로는 안 걸린다.**
  ⚠ 이건 이관이 만든 **새 성질**이다 — 종전 손목 기반 판정은 값이 행과 함께 와서 자동으로
  신선했다. 칼만은 서버가 따로 계산해 주므로 행보다 임의로 늙는다.
  수리 = `freshCoreTemp(workerId)` 게이트를 판정·표시 7곳 전부에. 낡으면 `undefined` →
  판정·표시·PSI 가 함께 "모름". 유효기간 10분은 **전송 주기에서 파생**(갤럭시 120초 기준
  5배 여유 — 정상 수집이면 결코 안 걸리고 스트림이 죽으면 곧바로 걸린다 · 표류 γ·√10 ≈ 0.07℃).
  라이브 실증 = 번들에 `let r=H-Date.parse(a.lastHrTs);if(Number.isFinite(r)&&!(r>6e5))return a.tempC`.
  ⚠ **사후 관찰 5xx 1건은 이 배포가 만든 것이 아니다**(L-94 절차로 기각) — `/api/gaspod/config`
  이고 내 커밋은 그 라우트를 안 건드린다(참조 0건). 같은 500 이 `00314`·`00318` 에도 있다.
  리비전별 전체 5xx = 00318 **28건** · 00319 2건 · **00322 1건**(최근 중 최저).
  ⚠ 별건 — `gaspod/config` 500 자체는 미해결로 남아 있다(내 트랙 아님).
  **★ 체온 체계를 갈아엎었다 — 판정은 심박 칼만, 손목값은 "체온"이라 부르지 않는다.**
  ① **저체온 오독 수리(가장 급했던 것)** — 같은 날 오전 `00319` 에서 내가 실시간 표 열을
     `체온 추정`→`체온` 으로 바꾼 것이 결함이었다. 그 값은 손목 피부온이고 체온이 아니다 —
     **실측 240점 중 8점(3%)이 35.0℃ 미만, 최저 34.12℃.** "체온 34.1" 은 저체온증으로 읽히고
     멀쩡한 작업자를 후송시킨다. 같은 시각 칼만은 37.34~37.36℃(심박 70~101bpm)로 전부 정상.
     ⚠ **위험을 위쪽만 보면 안 된다** — 나는 38.9(고열)만 걱정했다. 고열은 "덥나 보다" 로
     끝나지만 저체온은 조치를 부른다. 옆 세션(6c)이 사용자 제보를 받아 짚어 줬다.
     수리 = 헤더 `손목온도` · 주값 **중립색** · 부라인 `체온 {칼만}` 에만 판정색 ·
     워밍업 전 `심박 누적 중`(빈칸은 "센서 고장"으로 읽힌다).
     ★ **색을 손목 숫자에 걸면 라벨을 고쳐도 같은 오독이 난다** — 가드 ⑧ 이 셀 안
     `STATUS_CLASS[` **개수가 정확히 1**임을 단언한다(창 기반이면 숫자 뒤에 감싸는 변이를 놓친다).
  ② **판정 기준 이관** — 라이브 4곳이 `coreTempStatusC(칼만)` 를 쓴다. `coreTempStatus(손목)` 는
     행 단위 경로 전용으로 남았다. 근거 = 발열 구간 상승 칼만 +0.019℃ vs 손목 +0.841℃(40배) ·
     corr(주변온) 0.055 vs 0.565 · 민감도 정상(합성 심박 83→37.098 · 120→37.997 · 160→39.267).
     ★ 2026-08-12 가드가 "추정치 판정 미주입"을 걸어 뒀으나 같은 주석이 **"판정 연동은 실사용
     관찰 후 별도 결정"** 이라 적어 뒀다 — 그 관찰이 나왔고 사용자가 결정했다.
  ③ **임계 37.5/38.0 → 38.0/38.5** — 37.5 는 임상 발열 기준이라 작업 맥락에 안 맞았다.
     관측모델이 심박 100bpm 을 37.489℃ 로 놓는데 작업 중 심박 100 은 정상이다.
     7일 경보율: 칼만+37.5 = **42%** → 칼만+38.0 = **0%**(같은 창 칼만 최대 37.903·열스트레스자 0).
  ④ 실측 체온 차트에서 참고선·점 강조 제거(점의 54~57%가 주의 이상이었다) + 탭 툴팁.
  ⚠ **남은 것 — 행 단위 경로 5곳**(`dangerMetrics` 경보 · export csv/xlsx · preview · SQL params)은
     단일 행에 심박 이력이 없어 칼만을 못 만든다. 임계 상향만 적용돼 **경보 전이가 7일 20→13회로
     줄 뿐 안 없어진다**. 6c 설계 = "파생을 호출자로 올린다"(`dangerMetrics(s, coreTempC?)`) —
     호출부가 POST 마다 도는 `addSample` 이라 성능 판단 후 별건.
  라이브 실증 = 번들에 `"SpO₂","손목온도"` · `손목온도 (℃)` · `심박 누적 중` 실재 ·
  통제군 `체온 추정` 잔존 1건은 전부 **`심부체온 추정`**(사고 조사 뷰·CSV — 다른 기능).
- 앞선 배포 = `00320-jxs`(`4456bd4` · 배터리 충전카운터 µAh 서버분 — `battery_charge_uah` 열 생성
  확인 · 값 진위는 6c 판정 완료: 기준선 308,552µAh@66% → 첫 적재 299,847µAh@64%) →
  `00319-fzn`(`ed4604e` · 아래 3건).
  **실측 체온 3건**(전부 dashboard-web).
  ① `bbbf72a` `kysely@0.29.5` 제거 — 임포트 0건 유령 의존성(08-25 팀원 커밋에 동승해 들어옴).
  ② **`fcbb7b7` 실측 체온 복원** — 08-13 에 손목온도 탭·열을 내린 근거("Apple 실시간 미개방")가
     갤럭시(Wear OS)로 깨졌는데 화면만 그대로였다. DB 엔 쌓이는데 관제웹은 추정만 보여 줬다.
     추세 차트 `체온(실측)` 탭 신설(`skinTempC` → REAL_METRICS) · 실시간 표 열 `체온 추정`→`체온`.
     ⚠ **실측과 추정을 한 칸·한 선으로 합치지 않는다** — 추정은 심박 파생이라 센서가 죽어도
     계속 나온다. 표는 `≈` 로 가르고 차트는 탭을 나눈다.
  ③ **`ed4604e` 안전 신호등 전원 연결 상태** — 이상자만 말하고 수신 중인 사람을 침묵했다.
     원인이 둘이었다(문구가 안 만들고 + `summaryLines` 가 2줄로 잘랐다) — 한쪽만 고치면 반쪽이다.
     작업자 행만 `maxLines: 4`.
  라이브 실증 = 번들에 `skinTempC:{name:"체온(실측)"…#fb7185}` · `연결 정상\xb7생체 정상 범위` ·
  `이상 ".concat(e)]` 실재 · kysely 0건.
  ⚠ **미니파이 표기 변형에 두 번 속을 뻔했다** — `·`→`\xb7`, 숫자→`15e4`. 리터럴 grep 0건을
  "안 실렸다" 로 읽지 말 것([[L-108]] 계열).
- **연결끊김 문턱 출처별 분리** — 애플 60초 · **갤럭시 150초**. `f4aea6e` 로 `00315-mw2` 에 처음
  실렸고 이후 세 번의 배포를 거쳐 **`00318` 까지 생존 확인**(08-25 22:40 실측 — 라이브 번들에
  `"wearos_data_vitalguard"===e?15e4:6e4` 실재 · 앱 색 토큰 74개 전부 해석(빈 값 0) ·
  라우트 5종 ok · HTTP 200). 문턱은 취향이 아니라 **워치 전송 주기의 함수**다(애플 30초 배칭 /
  갤럭시 120초 배칭). 정의 = `lib/vital-age.ts staleThresholdMs()`.
  ⚠ **문턱을 여기저기 적지 않는다** — 관문 넷(`isStale`·`signalLevel`·지도·`app/me/vitals`)이
  전부 이 함수 하나를 쓴다. 특히 `app/me/vitals` 는 자기 상수를 따로 들고 있었다([[L-115]]).
  ⚠ 갤럭시 주기(`CollectorService.FLUSH_INTERVAL_MS` = 120초)를 바꾸면 **가드가 빨개진다** —
  계약은 `문턱 ≥ 주기+20초` 이고 `문턱 ≤ 주기×2`(2026-08-25-stale-threshold-by-origin.guard).
  ⚠ **관측 항목** — 갤럭시 심박 실측 간격이 114~144초라 150초 문턱까지 **여유 6초**다. 꼬리가
  더 길어지면 오탐이 난다. 착용 연속 창에서 다시 잰다.
- ⚠ **실측 체온의 임계선은 아직 신뢰하지 말 것**(08-26 실측 · 6c 제기·이 세션 재현).
  그 "실측" 에 **기기 발열이 섞인다.** 주변온으로 가르면 두 집단이다 — 오염 의심(주변온≥33)
  n=91 피부온 평균 37.58 / 깨끗(<33) n=81 평균 36.69, **0.89℃ 차**이고 상단(38.86)은 오염 쪽.
  판별 근거 = 주변온 최댓값 38.45℃(8월 실내 공기일 수 없다 — 센서가 공기가 아니라 기기 표면을
  읽는다) · corr(피부온, 주변온) 0.563 · 08-25 앱 재설치만으로 피부온 −2.4℃.
  **결과 — 손목 스케일 임계(주의 37.0·위험 37.5 = 심부 37.5/38.0 − offset 0.5)에서 차트 점의
  54%(위험 23.1% + 주의 30.8%)가 주의 이상으로 칠해진다.** 경보 피로 수준이다.
  ★ 이것은 이번 배포의 회귀가 **아니다** — `coreTempStatus(skinTempC)` 는 표 행·카드·신호등 톤이
  이미 쓰던 경로이고, 차트는 그 미보정을 새 표면에 드러냈을 뿐이다. 되돌려도 표에 남는다.
  ⚠ **자동 판별로 승격 금지**(6c 실패 실측) — 피부온−주변온 격차를 빼면 발열은 조금 빠지지만
  **생리 신호가 함께 사라진다**(corr(HR) 0.255 → 0.014) 분산은 오히려 커진다(SD 0.927 → 1.260).
  주변온 센서도 기기 열을 읽기 때문이다. 지금 근거가 허용하는 것은 **사람이 눈으로 읽는 정성
  규칙**까지다 — "두 선이 나란히 오르면 기기 발열, 피부온만 오르면 진짜 체온"(R-25).
  ⚠ **`thresholds.ts` 주석의 "Health Connect BODY_TEMPERATURE 라 보정 과대" 는 갤럭시에 해당
  없다**(이 세션이 한 번 헛짚었고 6c 가 정정·코드로 재확인). 갤럭시는 삼성 Health Sensor SDK
  직결(`SamsungTrackerSource.kt:91` `SKIN_TEMPERATURE_CONTINUOUS` → `OBJECT_TEMPERATURE`)이고
  `androidx.health.connect` 의존은 **0건**이다. 이름 그대로 피부온이다.
  재보정 시 = **깨끗한 표본(주변온<33) 80건만으로** 다시 잡는다(오염이 섞이면 임계가 끌려간다).
- 앞선 배포 = `00313-s5c`(출처 신설) → `00314-bj4`(적재 관문 수리) → `00315-mw2`(문턱 분리 +
  팀원 웹 4건 — 색 토큰 채널값화 `fc2d5c7`·보조금 정합 보드·미확인 알림 종·테마 토글). 관문은
  넷이다(스키마·분류·**적재**·컬럼) — `00313` 이 적재를 빠뜨려 실기에서
  `{"accepted":1,"persistFailures":1}` 가 났다([[L-115]]).
- 08-21 저녁~08-22 배포 4회 = `00309`(좌측 패널 오토리사이징 `d2cbb21`·`8771eef`) → `00310`(순환 0
  리팩터 + 그래프 게이트) → `00311`/`00312`(D-3 웜 바닥 1·2차 — DB 접속 생성 ~99% 감소).

**미해결 — 원인 미확정이거나 대기 중**

- **D-3 idleTimeout — 08-22 정식 판정 완료(소멸 아님).** 90s 는 매분 1건 패턴을 못 지웠다(열림 구간
  귀속 실측). 처방 전환 = 웜 바닥(접속 생성을 요청 경로 밖으로 · `00312-qsw`) — 2차 판정 생성 ~99% 감소.
  ⚠ 잔여 = 5초+ 지연 구간 자체는 미해명(캠퍼스 쪽) — 이것은 노출 감소이지 원인 제거가 아니다.
- **cctv-ai 과금 확인.** 관제웹 서버 폴러가 `min-instances 0` 을 무력화하고 24/7 깨우고 있었다(P1-1).
- **fall-poller DB 도달 1건**(08-20 19:40). 카메라 0대인데 도달. 미해명 · 원인 단정 금지.
- **EventChannel 이 왜 끊기는가** — 미지수. 지금까지 한 것은 피해 제거였다.

**대기 중인 창 · 묶어야 할 것**

- **재서명 08-26.** `TimeToLive` 7일이 발급일 기준이라 만료(08-27 10:09 KST) 직전에 한다.
  ⚠ 워치 코드 변경은 반드시 이 창에 묶는다 — 워치 재설치는 세션을 끊고 **자동 재개되지 않는다**.
- **08-26 앱 묶음** = B-2 정확도 선택 + `±NNm` · `NSMotionUsageDescription`(없으면 `CMAltimeter`
  크래시) · 응답 본문 읽기 6곳 중 `VitalPipeline:287` · **워치 하드웨어 모델 `wdm`**(`413942c` —
  소스·가드·빌드 완료, 설치만 남음. 설치 후 확인 = `SELECT DISTINCT watch_device_model` 에
  `Watch…,…` 꼴이 뜨는가. 종전 값 `Apple Watch` 는 판별력 0 이라 되살린 것이 아니다).
- **지하주차장 재촬영** — 좌표 수정을 검증할 유일한 자리다(실외는 고치기 전에도 통과한다).
- **C-1 `seBy=0` 대기**(창 5일) · **B-1 배터리 판정**(6.5%↓ 유지 / 8%↑ 연장 / 사이 = 안 갈림).
- **상세** [docs/progress.md "Quick Summary"](docs/progress.md#quick-summary-30초-안에-읽기) 우선 확인.

**트랙 기록 아카이브**
- 08-13 ~ 08-21 트랙 27건 → [claude-md-archive-20260822.md](docs/claude-md-archive-20260822.md) (`B-01`~`B-27`)
- 08-12 이전 트랙 23건 → [claude-md-archive-20260819.md](docs/claude-md-archive-20260819.md) (`A-01`~`A-23`)
- 05-21 ~ 07-21 및 운영 노트 → [claude-md-archive-20260723.md](docs/claude-md-archive-20260723.md)

## 환경

- **작업자 폰 앱 — Flutter (Dart 3.x)** · iOS 빌드용 Xcode 26.4+ · Android 빌드용 Android Studio + JDK 17
- **워치 — watchOS 앱 있음**(`apps/vitalguard_app/ios/VitalWatch`). `HKWorkoutSession` 상시 세션으로
  백그라운드 수집 → `WCSession` 5초 배치로 폰에 전달. ⚠ 구 "워치 앱 미작성" 관례는 **구 스택
  (worker-phone) 한정**이고 신규 앱에는 해당하지 않는다(2026-08-11 정정).
- **인프라 — GCP**. Cloud Run(`vitalguard-dashboard` · region `asia-northeast3`) + Cloud Build +
  Secret Manager + Cloud Scheduler, DB 는 외부 PostgreSQL(`DATABASE_URL`). 배포 = `/deploy`.
  ⚠ `backend/infrastructure`(AWS CDK IoT 스택)는 **아무 코드도 참조하지 않는 잔재**다 —
  pnpm 워크스페이스 멤버로만 남아 있고 마지막 커밋이 2026-06-17 이다. 배포·운영과 무관.
- 외부 의존성 — Flutter 공식 패키지 외 신규 추가 시 사전 합의.
  ⚠ `@aws-sdk/client-s3` 가 있으나 **AWS 가 아니라 네이버 클라우드 Object Storage(S3 호환)**
  어댑터다(`lib/storage.ts`). 이름만 보고 AWS 를 쓴다고 읽지 말 것.

## 빌드 / 테스트 / 검증

```bash
# 전체 모노레포 명령(install·build·test·lint)은 package.json scripts 참조. 검증 일괄 = /verify
# 패키지 단독
pnpm --filter @safetymonitor/analyzers test
pnpm --filter @safetymonitor/dashboard-web dev

# 배포(관제웹) — 원자화 스크립트 한 호출. 상세는 .claude/commands/deploy.md
scripts/deploy-dashboard.sh

# 작업자 폰·워치 앱 (Flutter + iOS/watchOS 네이티브)
cd apps/vitalguard_app
flutter pub get
dart analyze                        # ⚠ flutter analyze 는 한글 경로에서 크래시한다
flutter test                        # 위젯 테스트
# 실기기 설치·서명·워치 타깃은 apps/vitalguard_app/SETUP.md 참조(Xcode 없이 devicectl 경로 포함).
# 위 세 명령은 CI(.github/workflows/verify-app.yml)가 push 마다 그대로 돌린다.

# AWS 보류 중 local/mock receiver
pnpm dev:web                        # http://localhost:3000
pnpm mock:publish                   # 4 worker mock vital 5초 간격 publish
```

## 코드 구조 — 현재 실체

- `apps/dashboard-web` Next.js 15 관제 대시보드(Cloud Run 배포 대상) · `apps/vitalguard_app` Flutter 폰 앱 + iOS(`Runner`)/watchOS(`VitalWatch`) 네이티브
- `packages/analyzers` 위험 감지·추정 순수 함수(I/O 금지) · `packages/schemas` 공통 데이터 스키마(Zod)
- `cctv-ai` CCTV AI 서버 + 젯슨 엣지 스크립트 · `ml/ppe-detection` PPE 탐지 학습 자산 · `scripts/deploy-dashboard.sh` 배포 원자화 · `docs/` 트랙별 checklist·context-notes

**데이터 흐름(실제).**

```
Apple Watch (HKWorkoutSession 상시 세션 · 5초 배치)
  └─ WCSession ─▶ iPhone (Runner/VitalPipeline · 디스크 큐 · 실패 시 재시도)
       └─ HTTPS POST /api/app/vital (앱 JWT) ─▶ Cloud Run (Next.js route handler)
            ├─▶ PostgreSQL  vital_samples / alerts / incidents
            ├─▶ 판정(analyzers) → recordAlert → 텔레그램
            └─▶ 관제 웹 GET /api/monitor/*
Cloud Scheduler ─▶ /api/cron/absence-check (5분) — 부재는 수신 경로로 감지되지 않는다
```

⚠ **세 시각을 구분한다** — `heart_rate_measured_at`(워치 측정) · `ts`(폰 수신) · `received_at`(서버 도착).
하나로 뭉치면 "워치는 계속 쟀는데 전달만 끊긴" 구간이 유실로 오독된다.

## HealthPattern 과의 정책 차이 (혼동 방지)

| 항목 | HealthPattern | SafetyMonitor |
|---|---|---|
| 사용자 | 단일 (본인) | 다수 + 관제자 |
| 외부 서버 | **0건 (정책)** | **필수** |
| 클라우드 | M7 한정 Apple 인프라 예외 | GCP (Cloud Run + 외부 PostgreSQL) |
| 인증 | 없음 | 자체 `users` 테이블 + 앱 JWT (멀티 테넌트는 미도입) |
| ML | 금지 | 도입됨 (PPE·낙상) — 단 게이트 미통과 축은 판정에 안 올린다 |
| 다국어 | 금지 | 금지 (동일) |
| 외부 패키지 | 0건 | 필요 시 추가(사전 합의). ⚠ `@aws-sdk/client-s3` 는 AWS 가 아니라 네이버 클라우드 어댑터다 |

HealthPattern 의 코드·정책을 본 프로젝트에 그대로 적용하면 안 됨. 분석 알고리즘 *로직* 만 차용.

## 핵심 관례 — 모르면 함정
- **단말 코드는 최소 분석만 — 본 분석은 서버 사이드**
  - 낙상처럼 즉시성 필수인 것만 단말에서 detection. 나머지는 원시값만 올리고 판정은 서버가 한다
  - 사유. `packages/analyzers` (TS) 가 단일 source — 단말에 복제하면 drift 가 생긴다
- **★ 워치 앱은 있다(구 관례 폐기)**
  - ⚠ **`HKWorkoutSession` 상시 세션 구조가 폰 생존의 핵심이라 뺄 수 없다** — 다만 부작용이 둘 있다.
    ① 벗어도 PPE 센서가 계속 돌아 **그럴듯한 심박이 이어진다**(미착용 판별 불가 · 2026-08-19 확정)
    ② 활동에너지가 정지 상태에서도 계상돼 "저활동" 판정을 못 쓴다
  - 워치 재설치는 세션을 끊고 **자동 재개되지 않는다** — 사람이 워치에서 [시작] 을 눌러야 한다
- **`packages/analyzers` 는 순수 함수 — I/O 금지**
  - 입력. 정규화된 vital 시계열. 출력. 판정 결과
  - 서버 라우트·웹·단말 어디서든 호출 가능해야 함
  - fetch · DB 호출 절대 금지
  - ⚠ 빌드 산출물(`dist`)을 import 하므로 **소스를 고쳤으면 재빌드해야 반영된다** —
    안 하면 `undefined` 가 조용히 흘러 값이 틀리는 게 아니라 **사라진다**
- **비용 — 상시 과금 지점을 켜 둔 채 방치하지 않는다**
  - `cctv-ai` 는 `--min-instances 1 --no-cpu-throttling` 이라 **켜 두면 상시 과금**이다. 시험 후 반드시
    `--min-instances 0 --ingress internal` 로 되돌린다(삭제 아님 · 과금 0)
  - Cloud NAT 게이트웨이 + 고정 IP + 데이터 처리(`$0.045/GiB`)도 상시 과금이다
  - DB 는 외부 PostgreSQL 이라 GCP 청구서에 안 잡힌다 — **용량 한계는 따로 본다**(보존 정책 미수립)
- **개인정보 — 명시적 동의 없이 수집 절대 금지**
  - ⚠ **동의서·철회·익명화는 아직 미구현**이다(코드 0건). 상용 전 필수 과제이고, 지금 상태를
    "구현돼 있다"로 읽지 말 것
  - 사고 데이터는 익명화 불가 (KOSHA 3년 보존) — 동의서에 명시 필수
  - **국외 이전 최소화** — 텔레그램은 국외 서비스라 **생체 수치를 싣지 않고** 이름은 마스킹한다(예 `장○진`)
  - `incidents` 는 append-only 원장이라 삭제 API 를 만들지 않는다(보존 정책 도입 시 선조회·선제외)
- **자격 회수 — 사람이 나가면 끊을 수단이 있어야 한다**
  - 작업자 퇴사·단말 분실 시 `users.status` 를 `rejected` 로 내려 로그인을 막는다
  - ⚠ **발급된 앱 JWT 는 그것만으로 안 죽는다** — 즉시 무효화하려면 `APP_JWT_SECRET` 을 회전해야
    하고, 그러면 **전 작업자가 재로그인해야 한다**(2026-08-11 실측). 개별 폐기 수단은 없다
  - ⚠ env 관리자(`admin`) 비밀번호는 배포 환경변수라 **앱에서 못 바꾼다** — Secret Manager
    새 버전 + **새 리비전**까지 가야 반영된다(리비전을 안 갈면 옛 값이 그대로 산다)
- **알림 deduplication — DB 자연키가 막는다**
  - `alerts` 는 `ON CONFLICT (worker_id, type, ts) DO NOTHING` — 같은 사건은 한 번만 원장에 남는다
  - 환경 경보는 `env_alert_state` 의 **단계 전이**로 판정한다(같은 단계가 이어지면 재발송 안 함)
  - ⚠ **원장을 우회해 알림만 보내지 않는다** — 온열 알림이 `recordAlert` 를 안 거쳐 **발동 이력을
    아무도 못 본** 전례가 있다. 문구를 직접 만들더라도 기록은 건너뛰지 않는다(가드로 고정)
- **한국어 단독 — 영문 라벨 추가 금지**
  - 로그·UI·문서 모두 한국어. 영어는 코드 식별자·API field name 만
  - 사유. HealthPattern 정책 계승 + KOSHA 보고서 한국어 의무

## 의도적 비범위 (out of scope)

손대지 말 것. 사용자가 명시적으로 결정함 ([docs/context-notes.md](docs/context-notes.md) 2026-05-21).

> ~~취소선~~ 로 폐기 표시돼 있던 넷(워치 앱 · 알림 미구현 · 머신러닝 금지 · CCTV 통합)은
> 2026-08-22 에 걷어냈다. 넷 다 **지금은 구현돼 있다.** 이력은 아카이브에 있다.

### 프로토타입 (현 시점) 비범위 — 발표 후로 이연
- **멀티 테넌트** — 조직 1개·관제자 1명 유지. `org_type` 은 회사 표기용이지 테넌트 격리가 아니다.
- **Cognito 인증** — 미도입 유지. 실제 = 자체 `users` 테이블 + 앱 JWT(`APP_JWT_SECRET`).
- **위험 감지 5종 중 고립** — 여전히 미구현(코드 0건). 낙상·심박이상·SOS·SpO₂·고온만.
- **KOSHA PDF 리포트 / AuditLog 인프라** — 슬라이드 언급만, 구현 X
- **App Store / Play Store 배포** — Xcode 개발자 모드·실기기로 시연
- **베타 협력사 운용 / 법률 자문 / 도메인 정식 확보 / GitHub Organization / 의료기기 인증 검토** — 발표 후

### 영구 비범위 (프로토타입·프로덕션 공통)
- **ML 판정 노출 기준** — PPE 탐지(`ml/ppe-detection` · YOLO26s 6차)와 낙상 ML 을 학습·배포했다.
  ⚠ **게이트를 통과하지 못한 축(안전조끼·안전화)은 화면·경보 어디에도 올리지 않는다**(가드로 고정).
- 자동 119 연계 — 2차. 1차는 관제자 수동 호출
- 다국어 — 한국어 단독. 영문 fallback 추가 금지
- 의료기기 인증 (MFDS) — 산업 안전 보조 정보 범주로 한정. 진단·치료 주장 절대 금지
- iOS·Android 외 OS — 1차는 두 OS만
- 자체 단말 OEM — 기존 Apple·Samsung 단말 활용

## Flutter 앱 관례 (`apps/vitalguard_app`)

⚠ **종전의 Riverpod + `core/data/domain/presentation` 4계층 규범은 폐기한다(2026-08-19).**
도입된 적이 없고(`pubspec.yaml` riverpod 0건) 참조 대상이던 `apps/worker-phone/` 도 삭제됐다.
지키지 않는 규범을 문서에 두면 다음 사람이 그것을 기준으로 판단한다.

- **★ 생체 데이터는 Dart 를 거치지 않는다.** 수집·큐·업로드는 전부 Swift(`Runner`)가 전담한다 —
  백그라운드에서 Flutter 엔진은 안 깨어나도 `WCSessionDelegate` 는 깨어나기 때문이다.
  Dart 는 UI 와 로그인만 맡고 표시용 스냅숏만 `EventChannel`(`vital_stream.dart`)로 받는다.
- **임계·색은 관제웹에서 가져온다.** 폰에서 새로 정하면 두 화면이 다른 판정을 말한다.
  `theme.dart` = 관제웹 `globals.css` 와 1:1(색 토큰 단일 소스) · `vital_range.dart` = 관제웹 `severity.ts` 에서 옮긴 것.
- ⚠ **폰에는 활동 게이트가 없다** — 관제웹은 `isWorking()` 으로 작업 중 심박을 완화하는데 폰의
  걸음·층은 누계라 rate 를 못 낸다. 그래서 화면에 **`안정 기준`** 을 적는다.
- `lib/` 는 평면 구조다(계층 디렉터리 없음). 한국어 주석 허용 · `async/await` 우선 · `const` 위젯 적극 활용.
- 새 기능에는 위젯 테스트를 함께 쓴다. CI 가 push 마다 `dart analyze` + `flutter test` 를 돌린다.
