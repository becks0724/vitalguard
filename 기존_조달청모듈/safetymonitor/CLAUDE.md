# CLAUDE.md — SafetyMonitor

## 프로젝트 개요

**SafetyMonitor (가칭 `IndusView`)** — 산업 현장 작업자 생체 모니터링. Apple Watch + Android Wear 작업자 단말 ↔ 관제 웹 대시보드 + 모바일 보조 앱. KOSHA 산업안전보건법의 "실시간 위험성 평가" 의무 디지털 지원.

> **발표용 프로토타입 한정이 아니다.** 발표(2026-07-07)는 첫 검증 마일스톤이고 목표는 **최종 상용화·현장 실사용**이다(2026-06-07 방향 전환). 따라서 모든 결정 기준에 "데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다.

HealthPattern (개인용 HealthKit 패턴 앱) 의 분석 알고리즘 *로직만* 이식했다. HealthKit·SwiftUI 종속 코드는 미사용. 외부 서버 0건 정책은 본 프로젝트에서 **폐기**(관제 자체가 서버 필수).

상세 [plan](docs/plan.md) · [checklist](docs/checklist.md) · [context-notes](docs/context-notes.md) · [progress](docs/progress.md) · 상용화 갭·로드맵 [gap-analysis](docs/commercialization-gap-analysis.md) · [roadmap](docs/commercialization-roadmap.md)

## 확인된 상태 기록 (최신 기록: 2026-10-07 · 현재 라이브는 조회로 확인)

> **보존 규칙 (2026-08-22).** 이 절의 트랙 전문은 **최근 3건까지**만 둔다. 넘으면 그 자리에서
> `docs/claude-md-archive-<날짜>.md` 로 옮기고 아래 아카이브 목록에 한 줄 더한다.
> 로그가 파일의 90%를 넘겨 세션 컨텍스트를 잡아먹은 전례가 두 번 있다(08-19 · 08-22).

- **라이브** = `vitalguard-dashboard-00413-xb8` (커밋 `fb820d97` · 10-07 13:3x · [WATCH.APP] 배포 · 서빙 digest
  `sha256:4e6c2d16…` **대조 일치** · env 33(00412 와 줄마다 같음) · 트래픽 자동 추종 · 치환 `_AI_URL`·`_CAM03_GATE` 있음 ·
  검증 **2140/2140 @워킹트리(= fb820d9) · 루트 pnpm test** · 라우트 5종 ok · CCTV번들 ✅ 1/17 · 사후 90초 5xx 0 · DB 문구 셋 0).
  00412 대비 **동작이 바뀐 곳은 팀원 관제웹 5커밋**이다(`45482633..fb820d97` · 관제웹 21파일).
  ```
  3cbebb95  GET /api/app/admin/profile 신설 — 현장 앱 본인 프로필(마스킹) · db.ts 읽기 전용 호출 경로 · SQL 문장 같음
            라이브 실측: 토큰 없이 401 {"action":"reauth"} · 통제(없는 경로) 404
  b11219dd  기상청 강수·기존 풍속 위험 신호를 태블릿 효과용으로 노출
  b9ecf44b  기상 신호·가스포드 실내값·예보 노출 (/api/weather ok)
  6ee2cffb  현장 채팅 의도 목록에 분류 설명(LLM 의도 프롬프트용)
  2d2269c9  의존성 보안 수정 — 감사 high 5건(brace-expansion·sharp 핀 상향 · source-map-js 패치 · braces 는 패치 없어 예외)
  ```
  **변경 기능 화면 확인은 변경 주인(팀원) 몫**이다. 롤백 대상 = 00412-98v. CCTV 칸은 10-07 젯슨 반납으로 영상이 안 나온다(코드 그대로 · 사용자 결정 · `cctv-ai/최종-구현-기록-20261007.md`).

- (직전) **라이브** = `vitalguard-dashboard-00412-98v` (09-29 23:04 · 팀원 설정 재기동 · 서빙 digest `sha256:3e253461…` = 00411 과 같은 이미지 ·
  env 33행 중 `SECRET_ROTATED_AT` 만 다름 · 그 시각 NCP 저장소 비밀 셋 새 버전 · 00410 에 이어 같은 날 두 번째 교체).
  10-07 실측 — 24시간 요청 1,446 · 5xx 0 · ERROR 0 · 트래픽 자동 추종. **도는 코드는 아래 00411 그대로다.**
  코드 배포 = `vitalguard-dashboard-00411-cql` (커밋 `45482633` · 09-29 22:31 · [WATCH.APP] 배포 · 서빙 digest
  `sha256:3e253461…` **대조 일치**(빌드 `83879e79`) · env 33 · 트래픽 자동 추종 · 치환 `_AI_URL`·`_CAM03_GATE` 있음 ·
  검증 **2115/2115 @아카이브(4548263 고정) · 루트 pnpm test** · 라우트 5종 ok · CCTV번들 ✅ 1/17 · 사후 90초 5xx 0 · DB 문구 셋 0).
  00409 대비 **동작이 바뀐 곳은 실시간 수집 표 하나**다([DATA] `3a808b3a` · 관제웹 4파일 · 표시 전용). 서버·저장·경보·내보내기는 그대로다.
  ```
  lib/device-status-row · DemoDashboard   벗은 워치의 10분 배터리 행 = 생체 칸 「--」 넷 → 「미착용 · 배터리 · 충전 상태 · 구간 · N회」 한 줄
                                          충전 안 하는 20% 이하만 주의색 · 순수 착용 표식은 「착용」「벗음」 한 줄 · 원래 행 수 집계는 보존
                                          헤더에 「기기 상태 N」 · ⚠ worn:true 만으로는 표식이 아니다(착용 중 HRV 측정 행도 worn:true)
  ```
  ★ **직전 `00410-lrs` 는 코드 배포가 아니라 설정 재기동이다.** 09-29 22:02 팀원이 NCP 저장소 비밀 셋
  (`NCP_ACCESS_KEY`·`NCP_SECRET_KEY`·`NCP_BUCKET`) 새 버전을 만들고 `SECRET_ROTATED_AT` 을 바꿨다(이미지는 00409 와 같음 ·
  00410 요청 858건 중 5xx 0 · 캘린더 미디어 200). 00411 은 그 env 33줄을 줄마다 그대로 이어받았다(비밀 참조 `latest`). 롤백 대상 = 00410-lrs.
  기능 확인([DATA] 22:4x · 00409 기준선 대비 17/17 청크) — 「기기 상태」 0→2 · 「배터리 부족」 0→1 · 「충전 안 함」 0→1 ·
  「충전기 연결」 0→1 · 「미착용」 3→5 · 통제 「위험 감지 시각」 1→1 · 음성 0→0. DB 최근 80행을 배포된 함수에 넣은 재현에서 헤더
  「생체 31 · 기기 상태 14 · 충격 판정 35」 · 80행 → 72줄. **표 화면 눈 확인은 사용자 몫**(관제 로그인이 필요하다).
  ⚠ main 은 이 라이브보다 관제웹 4커밋 앞선다(10-07 실측 · 19파일 +467/−46 · 전부 팀원) — 다음 배포에 실린다.
  `3cbebb95` 현장 앱 본인 프로필 GET `/api/app/admin/profile`(`db.ts` 는 읽기 전용 호출 경로만 추가 · SQL 문장 같음) ·
  `b11219dd` 강수·풍속 위험 신호 · `b9ecf44b` 기상 신호·가스포드 실내값·예보 · `6ee2cffb` 현장 채팅 의도 설명.

- (직전) **라이브** = `vitalguard-dashboard-00409-bs4` (커밋 `132f2bf8` · 09-29 10:28 · [WATCH.APP] 배포 · 서빙 digest
  `sha256:f4270c38…` **대조 일치**(빌드 `e7732617`) · env 33 · 트래픽 자동 추종 · 치환 `_AI_URL`·`_CAM03_GATE` 있음 ·
  검증 **2106/2106 @아카이브(132f2bf 고정) · 루트 pnpm test** · 라우트 5종 ok · CCTV번들 ✅ 1/17 · 사후 90초 5xx 0 · DB타임아웃 0).
  00408 대비 **동작이 바뀐 곳은 생체 경보 화면 둘**이다([DATA] `3bbf8374`·`208895b3` · 관제웹 6파일). 서버·판정 조건은 그대로다.
  ```
  ① SosAlertModal · lib/vital-measured-at   팝업 시각 = 표본 도착 시각 → 위험 값을 잰 시각 + 「N분 전」(산소포화도는 최대 30분 벌어진다)
                                            산소포화도 칸 「HH:mm 측정 · N분 전」 · 119·보호자 문자에도 측정 시각
  ② DemoDashboard · lib/spo2-ack-key        산소포화도만 위험인 팝업의 「확인」을 측정 한 건 단위로 브라우저에 기억(`vital-spo2|작업자|측정시각`)
                                            새로고침해도 같은 측정은 다시 안 뜬다 · 새 측정은 열쇠가 달라 다시 운다 · 심박·체온이 함께 위험이면 종전 방식
  ```
  나머지 범위(`45d791d6..132f2bf8` 22커밋)는 이미지 동작 밖이다 — 엣지 49파일(`0c7a894b` 젯슨 실물 맞춤) · 문서 · 이미지 밖 태블릿 앱 폴더 · `.gitleaksignore`.
  사후 DB 문구 셋(새 접속 타임아웃 · 풀 고갈 · 웜 바닥) 0.
  번들 확인([DATA] 09-29 10:4x · 00408 기준선 대비 17/17 청크) — `vital-spo2` 0→1 · `Asia/Seoul` 2→3 · 「 측정」 14→16 ·
  통제 「위험 감지 시각」 1→1 · 음성 0→0. **기능 화면 확인은 다음 실제 산소포화도 경보 대기**(운영 DB 에 시험 행을 못 넣는다 · L-04).

**운영 기록 읽기** — 아래 아카이브는 과거 상태다. 현재 리비전·env·접속 경로는 라이브 조회로 확인한다. 브라우저 CORS·번들 검증, 같은 LAN/Tailscale 제약, 서버 중계 비용·주기, 인증 키 교체·워치 재서명 절차를 변경할 때는 관련 과거 실측을 먼저 확인한다.

**미해결 — 원인 미확정이거나 대기 중**

- **D-3 idleTimeout — 08-22 정식 판정 완료(소멸 아님).** 90s 는 매분 1건 패턴을 못 지웠다(열림 구간
  귀속 실측). 처방 전환 = 웜 바닥(접속 생성을 요청 경로 밖으로 · `00312-qsw`) — 2차 판정 생성 ~99% 감소.
  ⚠ 잔여 = 5초+ 지연 구간 자체는 미해명(캠퍼스 쪽) — 이것은 노출 감소이지 원인 제거가 아니다.
- 🔴 **`cron/absence-check` 5분 행 — 원인 규명 완료 · 수리 보류(사용자 판단 08-26).**
  부재 감시는 **수신이 없어서 발생**하므로 수신 경로에서는 영원히 안 잡힌다(08-18 12.9시간 끊김에
  경보 0건). 그래서 5분 크론이 **유일한 안전망**인데 그것이 24시간 288회 중 **12회(4%) 504** 다
  — 299.98초를 꽉 채우고 Cloud Run 상한에 잘린다. 20:15·20:20·20:25 **3연속 실패**로 15분 공백 실측.
  **★ 범인 = `lastSeenByWorker` 쿼리 한 줄.** `WHERE v.ts::timestamptz > (now() - interval)` 인데
  **`ts` 가 `text`** 라 행마다 캐스트가 붙어 인덱스(`uq_vs_worker_ts`)를 무력화한다.
  ```
  Seq Scan on vital_samples · Rows Removed by Filter: 418,849 · rows=248
  Buffers: shared hit=15,560 read=98,159   ≈ 890MB 를 읽어 2행을 낸다 (한가할 때 0.8~2.5초)
  지연 분포(24h)  1초 미만 119 · 1~10초 155 · 10~60초 1 · 60초 초과 13
  ```
  ⚠ **D-3 의 원인 중 하나일 수 있다** — 5분마다 캐시를 890MB 헤집으면 다른 쿼리의 캐시를 밀어낸다.
  "D-3 는 캠퍼스 네트워크 탓" 이라고만 봤는데 **우리 코드 안에도 원인이 있었다.**
  **처방 후보** = ⓐ `ts` 가 ISO-8601 UTC 라 **글자 순서 = 시간 순서**이므로 캐스트 없이 문자열
  비교로 바꾸면 기존 인덱스를 탄다(한 줄 · 되돌리기 쉬움). ⚠ **착수 전 `ts` 형식 전수 확인 필수** —
  섞여 있으면 조용히 틀린 답을 낸다. ⓑ 컬럼을 `timestamptz` 로(근본이나 41만 행 마이그레이션 ·
  프로덕션 단일 DB · 별도 승인) ⓒ 크론만 `DISTINCT ON` 으로 우회(같은 패턴 다른 쿼리는 그대로).
- **cctv-ai 과금 확인.** 관제웹 서버 폴러가 `min-instances 0` 을 무력화하고 24/7 깨우고 있었다(P1-1).
- **fall-poller DB 도달 1건**(08-20 19:40). 카메라 0대인데 도달. 미해명 · 원인 단정 금지.
- **EventChannel 이 왜 끊기는가** — 미지수. 지금까지 한 것은 피해 제거였다.

**대기 중인 창 · 묶어야 할 것**

- **재서명 — 만료일은 문서가 아니라 프로파일에서 확인한다**(마지막 기록은 2026-09-03 만료이고 이미 지났다).
  워치 코드 변경은 재서명 창에 묶는다 — 워치 재설치가 수집 세션을 끊고 자동 재개되지 않는다.
  `watch_device_model` 은 `413942c` 부터 수집에 실린다(`Watch6,18`).
  ⚠ **새 함정** — 재발급 프로파일에서 **워치가 빠질 수 있다**(발급 시점에 `disconnected` 면 제외).
  만료일만 보면 통과로 보이고 워치 설치에서만 죽는다. 절차·검증은
  [apps/vitalguard_app/SETUP.md](apps/vitalguard_app/SETUP.md) "재발급 프로파일에서 워치가 빠진다".
- **08-26 앱 묶음 잔여 2건**(둘 다 폰(Runner) 쪽 = 재설치 비용 0초라 재서명 창을 기다릴 이유가 없다).
  ⓐ 응답 본문 읽기 6곳 중 `VitalPipeline:287` — 아직 `dataTask` 가 본문을 `_` 로 버린다.
  ⓑ `NSMotionUsageDescription` — **전제 재확인 필요.** 코드에 `CMAltimeter` 가 없고 워치의
  `CMMotionManager`(deviceMotion)뿐인데 그 API 는 이 키를 요구하지 않는다. 넣을 근거부터 확인한다.
- **지하주차장 재촬영** — 좌표 수정을 검증할 유일한 자리다(실외는 고치기 전에도 통과한다).
- **C-1 `seBy=0` 대기**(창 5일) · **B-1 배터리 판정**(6.5%↓ 유지 / 8%↑ 연장 / 사이 = 안 갈림).
- **상세** [docs/progress.md "Quick Summary"](docs/progress.md#quick-summary-30초-안에-읽기) 우선 확인.

**트랙 기록 아카이브**
- 09-09 ~ 09-27 배포 기록 16건(00365~00408 · 00404 는 09-27, 00405·00407 은 09-29, 00408 은 10-07 에 맨 위로 더함) → [claude-md-archive-20260925-prompt-audit.md](docs/claude-md-archive-20260925-prompt-audit.md) · 과거 실측 원문 보존
- 09-09 ~ 09-17 트랙(00367~00397) → [claude-md-archive-20260925.md](docs/claude-md-archive-20260925.md) (보존 규칙 「최근 3건」 초과분)
- 08-31 ~ 09-08 트랙(00345~00363) → [claude-md-archive-20260910.md](docs/claude-md-archive-20260910.md) (최근 이동분이 파일 위쪽)
- 08-26 ~ 08-31 트랙(00322~00344) → [claude-md-archive-20260831.md](docs/claude-md-archive-20260831.md) (최근 이동분이 파일 위쪽)
- 08-13 ~ 08-21 트랙 27건 → [claude-md-archive-20260822.md](docs/claude-md-archive-20260822.md) (`B-01`~`B-27`)
- 08-12 이전 트랙 23건 → [claude-md-archive-20260819.md](docs/claude-md-archive-20260819.md) (`A-01`~`A-23`)
- 05-21 ~ 07-21 및 운영 노트 → [claude-md-archive-20260723.md](docs/claude-md-archive-20260723.md)

## 환경

- **작업자 폰 앱 — Flutter (Dart 3.x)** · iOS 빌드용 Xcode 26.4+ · Android 빌드용 Android Studio + JDK 17
- **워치 — watchOS 앱 있음**(`apps/vitalguard_app/ios/VitalWatch`). `HKWorkoutSession` 상시 세션으로
  백그라운드 수집 → `WCSession` 5초 배치로 폰에 전달.
- **인프라 — GCP**. Cloud Run(`vitalguard-dashboard` · region `asia-northeast3`) + Cloud Build +
  Secret Manager + Cloud Scheduler, DB 는 외부 PostgreSQL(`DATABASE_URL`). 배포 = `scripts/deploy-dashboard.sh`.
  ⚠ `backend/infrastructure`(AWS CDK IoT 스택)는 **아무 코드도 참조하지 않는 잔재**다 —
  pnpm 워크스페이스 멤버로만 남아 있고 마지막 커밋이 2026-06-17 이다. 배포·운영과 무관.
- 외부 의존성 — Flutter 공식 패키지 외 신규 추가 시 사전 합의.
  ⚠ `@aws-sdk/client-s3` 가 있으나 **AWS 가 아니라 네이버 클라우드 Object Storage(S3 호환)**
  어댑터다(`lib/storage.ts`). 이름만 보고 AWS 를 쓴다고 읽지 말 것.

## 빌드 / 테스트 / 검증

```bash
# 전체 모노레포 명령(build·test·lint·typecheck)은 루트 package.json scripts 참조.
# 패키지 단독
pnpm --filter @safetymonitor/analyzers test
pnpm --filter @safetymonitor/dashboard-web dev

# 배포(관제웹) — 원자화 스크립트 한 호출(전제·가드·되돌리기는 스크립트 주석에 있다).
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
- **★ 워치 앱이 수집의 시작점이다**
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
- **담당자 지정 위험구역(지도에 원을 그려 진입 경보)** — 2026-09-08 팀 결정으로 **제거**. `danger_zone` 표·`/api/danger-zones`·
  `danger_zone` 경보 종류·지도 배치 UI 전부 삭제(신 DB 도 069 로 표·kind 제거). 영상 기반 위험구역 침입(vision-ppe-plan)은 별개 개념이다.

## Flutter 앱 관례 (`apps/vitalguard_app`)

상태관리 프레임워크·계층 디렉터리 규범은 없다 — `pubspec.yaml` 에 riverpod 0건이고 `lib/` 는 평면 구조다.

- **★ 생체 데이터는 Dart 를 거치지 않는다.** 수집·큐·업로드는 전부 Swift(`Runner`)가 전담한다 —
  백그라운드에서 Flutter 엔진은 안 깨어나도 `WCSessionDelegate` 는 깨어나기 때문이다.
  Dart 는 UI 와 로그인만 맡고 표시용 스냅숏만 `EventChannel`(`vital_stream.dart`)로 받는다.
- **임계·색은 관제웹에서 가져온다.** 폰에서 새로 정하면 두 화면이 다른 판정을 말한다.
  `theme.dart` = 관제웹 `globals.css` 와 1:1(색 토큰 단일 소스) · `vital_range.dart` = 관제웹 `severity.ts` 에서 옮긴 것.
- ⚠ **폰에는 활동 게이트가 없다** — 관제웹은 `isWorking()` 으로 작업 중 심박을 완화하는데 폰의
  걸음·층은 누계라 rate 를 못 낸다. 그래서 화면에 **`안정 기준`** 을 적는다.
- `lib/` 는 평면 구조다(계층 디렉터리 없음). 한국어 주석 허용 · `async/await` 우선 · `const` 위젯 적극 활용.
- 새 기능에는 위젯 테스트를 함께 쓴다. CI 가 push 마다 `dart analyze` + `flutter test` 를 돌린다.
