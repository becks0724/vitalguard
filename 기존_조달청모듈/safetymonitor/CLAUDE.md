# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**SafetyMonitor (가칭 `IndusView`)** — 산업 현장 작업자 생체 모니터링 컨셉. Apple Watch + Android Wear 작업자 단말 ↔ AWS IoT Core 백엔드 ↔ 관제 웹 대시보드 + 모바일 보조 앱. KOSHA 산업안전보건법의 "실시간 위험성 평가" 의무 디지털 지원.

> **이 프로젝트의 목표는 발표용 프로토타입 *한정이 아니라* — 발표(2026-07-07)를 첫 검증 마일스톤으로 삼아 *최종 상용화·현장 실사용*까지 가는 것이다 (2026-06-07 방향 전환).** 따라서 — ① 발표까지는 *데모를 깨지 않는 선*에서 상용화 친화적 선택을 우선하고, ② AWS 실배포·유료 계정·멀티테넌트 같은 큰 전환은 *발표 직후* 착수하며, ③ 모든 결정 기준에 "데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다. 제품 전반 상용화 갭 분석·단계별 로드맵은 [docs/commercialization-gap-analysis.md](docs/commercialization-gap-analysis.md), 잠금·배터리 심층은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md), 성격 재정의 상세는 [docs/context-notes.md](docs/context-notes.md) 참조.

HealthPattern (개인용 HealthKit 패턴 앱) 의 분석 알고리즘만 이식. HealthKit·SwiftUI 종속 코드는 미사용. 외부 서버 0건 정책은 본 프로젝트에서 **폐기** (관제 자체가 서버 필수).

상세는 [docs/plan.md](docs/plan.md) · [docs/checklist.md](docs/checklist.md) · [docs/context-notes.md](docs/context-notes.md) · [docs/progress.md](docs/progress.md) 참조. 잠금·백그라운드 생체 모니터링 상용화 해결책은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md) 참조.

## 현재 상태 (Status — 새 세션 시작 시 먼저 읽기)

- **★ 2026-07-24 — [진단 전용·코드변경 0·배포 0] 관제웹 낙상 오탐 원인규명 + 팀원앱 수정요청 핸드오프**. (증상) 낙상 아닌데 "낙상 긴급 알람" 팝업 반복(장우진 `EMP-admin6861`). (라이브 증거 — `/api/mock/vital` GET) latest.fallDetected=None(현재 낙상 아님)이나 recent(80)에 `fallDetected=true` **5건**(12:52~12:59 KST=03:5x UTC)·zoneHazards 0(CCTV 경로 아님). 팝업 표시시각 12:57:30/12:59:40 vs 현재 16:34 = **약 3.5시간 지난 과거 이벤트**. (근원1 — 팀원앱) `apps/VitAlGuard-iOS-WatchOS-App`(양지후) — [Shared.swift:94](../../apps/VitAlGuard-iOS-WatchOS-App/Phone/Shared/VitAlGuardShared.swift) `"fallDetected": reason=="fall"||reason=="fall_demo"` + [PreviewApp.swift:3537 `checkReceiverConnection`](../../apps/VitAlGuard-iOS-WatchOS-App/Phone/Sources/VitAlGuardPreviewApp.swift)가 **연결확인과 낙상경보 동일 POST 경로** → reason "fall"이면 단순 연결확인에도 fallDetected가 실림. 호출부 `:14266 confirmFallEmergency`·`:14432` 긴급버튼. **git blame 전부 `df59857c`(mayeramschel/양지후, "chore(release): sync VitAlGuard 7.3 (73)", 07-22)** — 레드박스 `3796a12`(release 7.6·챗봇/UI/위치권한)는 낙상코드 **미변경**. `fall_demo`는 정의만·호출부 0(잠재결함). (근원2 — 관제웹 우리쪽) [DemoDashboard.tsx:3736 `lastFallByWorker`](apps/dashboard-web/app/components/DemoDashboard.tsx)에 **신선도 게이트 부재**(표 `fallRecent`는 5분창인데 팝업 트리거는 나이 무관) → stale 샘플이 ring(최근80)에 잔류·재발화, ts별 localStorage ack이라 닫아도/다른 브라우저서 재팝업. worker-watch-poc(별개 PoC앱)도 동일 auto-escalation(20초 무응답→fallDetected) 설계. (산출물) 레포 루트 `낙상-오탐-수정요청-양지후.md` 핸드오프 작성(미커밋). (현재상태) 코드/배포 변경 0·라이브 그대로. (다음) ① (양지후) 앱 수정 — 연결확인/낙상 경로 분리·`fall_demo` 게이트·낙상 1회 전송·5건 연속 재전송(21초 간격) 원인 점검 ② (우리) 팝업 트리거에 신선도 게이트 추가(fall/SOS 공통)·필요시 ack 서버공유 ③ 즉시완화 = 해당 워치 워크아웃(생체수집) 정지 시 알림 멎음. **(Status 일시 4개 — 다음 코드 세션에서 최하단 CCTV 8분할 항목 아카이브 이동)**
- **★ 2026-07-24 — 내 정보에 보호자 등록 항목 추가(이름/관계 분리) + 알람 본인 보호자 표출 · 라이브 `00135-hhw`→`00136-kn4`→**`00137-vl7`** · 커밋 `81718d0`·`3224a9d`**. (요청) 낙상 긴급 알람의 '보호자 미등록'을 등록 항목 부재로 보고 → 대시보드 '내 정보 수정'에 보호자 등록 추가(사용자 선택 = **본인 계정 스코프**). ① **보호자 등록**(`81718d0`→`00136-kn4`) — [MyProfileModal](apps/dashboard-web/app/components/MyProfileModal.tsx)에 '보호자 연락처(선택)' 섹션 신설 + `users` 테이블 `guardian_name`/`guardian_phone` 컬럼(ALTER ADD IF NOT EXISTS·멱등) + [updateUserProfile](apps/dashboard-web/lib/db.ts)·[/api/admin/profile](apps/dashboard-web/app/api/admin/profile/route.ts) GET/POST(DB·로컬데모) 배선. **알람 표출** = [DemoDashboard](apps/dashboard-web/app/components/DemoDashboard.tsx) `withMyGuardian` — 알람 작업자 사번(employeeId)이 **로그인 회원 본인 사번과 일치하고 샘플에 보호자가 없을 때만** SOS/낙상/생체 알람에 주입(폰 발신값·DEMO_GUARDIANS 우선·크로스멤버 노출 0). ② **이름/관계 입력 분리**(`3224a9d`→`00137-vl7`) — 단일 '이름 / 관계' 입력을 **이름(텍스트) + 관계(select)**로 분리, 관계 프리셋 7종(배우자·자녀·부모·형제자매·친척·지인·**기타**)·'기타' 선택 시 직접입력. 신규 순수모듈 [lib/guardian.ts](apps/dashboard-web/lib/guardian.ts)(parseGuardian/composeGuardian) — 저장값은 **"이름 (관계)" 단일 문자열 유지**(DB컬럼·API·알람 배선 무변경·DEMO_GUARDIANS 포맷 동일·하위호환 왕복복원). (검증) 각 배포 tsc0·lint0err(4warn 기존)·**test239→247**(guardian parse/compose 왕복 신규 8건)·라이브(루트200·rev100%·서빙 digest 일치·page 청크 신규마커 FOUND·구 마커 GONE). L-09: 00136은 빌드~배포 사이 origin 전진했으나 델타=docs-only(앱코드0)라 코드동일 이미지 배포·00137은 HEAD==BUILT 무레이스. (현재상태) **라이브 `00137-vl7` = main `3224a9d`(guardian 커밋) 정합**·origin push 동기·cctv-ai OFF. DB 스키마 = users 2컬럼 추가(멱등 첫쿼리). (다음) ① (사용자 육안) 내 정보 보호자 이름/관계·기타 직접입력 토글 + 저장 후 알람 '김보호 (배우자)' 표출 — **사번 일치 필수**(장우진 폰 EMP-6861/워치 EMP-admin6861 두 ID면 병합 또는 사번 정합 필요) ② (선택) 관제자가 남의 작업자 보호자를 대신 등록하는 per-worker 오버라이드(worker_profile 패턴)는 미구현 — 필요 시 후속 ③ (연계) 병렬 세션 낙상 오경보 근본수정(`bd6fc2a`)과 동일 팝업 출처.
- **★ 2026-07-24 — 작업자 지도 VWorld 항공사진(위성) 레이어 추가 — z19 확대 · main `c83f3b8` · 라이브 `00134-2v9`→**`00135-hhw`****. (요청) 관제 작업자 지도(위성)에서 확대가 부족 — 네이버지도로 교체 가능한지 문의(네이버가 위성 고배율·위치 세분화 가능하다는 판단). (판정) 현 지도는 외부 라이브러리 없는 **커스텀 슬리피맵**(`<img>` 타일+자체 좌표수학)이라 네이버는 공개 타일 URL 無·자체 JS SDK 강제·타일 추출 ToS 위반 → 소스 한 줄 교체가 아니라 [WorkerGpsMap.tsx](apps/dashboard-web/app/components/WorkerGpsMap.tsx) 913줄 전면 재작성+NCP 키·도메인등록·과금 필요. **대안 = 이미 배선된 VWorld에 항공사진 레이어 추가**(사용자 선택). (수정 · `c83f3b8` · 3파일) ① [lib/vworld.ts](apps/dashboard-web/app/lib/vworld.ts) — Satellite(jpeg)·Hybrid(라벨 png) WMTS 헬퍼 추가 ② [api/vworld-tile](apps/dashboard-web/app/api/vworld-tile/route.ts) — kind `satellite`/`hybrid` 추가·상한 z19·URL 맵 정리 ③ WorkerGpsMap — 베이스맵 토글 **위성/항공/지적도 3분할**(항공=Satellite+Hybrid 오버레이)·모드별 확대상한(sat18/air19/cad18)·전환 시 줌 클램프로 Esri 공백타일 방지·출처 표기 3분기. **정직한 한계** = 배경 확대는 필지/건물 시각 맥락만↑, 마커 정밀도는 폰 GPS 오차(5~20m)가 지배(사용자에 명시). (검증) tsc0·lint0err(4warn 기존 injection-test)·**test239**·사전 VWorld 엔드포인트 프로브(z18/**z19** 실타일 image/jpeg·z20 미제공 XML→z19 캡 확정). ★L-09 = BUILT==HEAD `c83f3b8` 대조 후 배포 — 배포직전 병렬세션 5파일(admin/profile·DemoDashboard·MyProfileModal·db·demo-members) 미커밋 수정했으나 **전부 tarball 업로드(15:03:18) 이후**(mtime 15:05~15:08)라 내 이미지 무오염 확인. (현재상태) **라이브 `00135-hhw` = main `c83f3b8` = origin 동기**·프록시 실동작(satellite/hybrid z17·**z19** 200·base 회귀 200·bogus 400·VWORLD_KEY 보존)·cctv-ai OFF. 클라 '항공' 토글 DOM은 지도청크가 LoginGate 인증뒤 로드라 비인증 grep 불가(Playwright 미설치)→**사용자 육안 확인 완료**. (다음) ① (사용자 육안 완료) 위성/항공/지적도 3토글·항공 z19 확대 ② (선택) 항공 z20 프로브 재시도(현재 국내 상한 z19)·지도·팝업 드래그 위치 localStorage 기억 ③ (이월) 캘린더 **B6** 일정 완료 체크+담당자·**B7** 반복 일정·위험구역×캘린더 위험작업 자동 연동 ④ (이월) 텔레그램 봇 토큰 재발급·CCTV zone hazard 텔레그램 편입.
- **트랙**. 프로토타입 (D0~D4). 발표 후 로드맵 (M0~M9) 은 격하 보관.
- **현재 위치**. **D1 ~99% + D2 ~92% + D3 ~78% + D4 UI 폴리싱 진행** — iPhone **2대 install 완료** (BECKS 장우진/EMP-6861 + YJH 양지후/EMP-1024) + **Galaxy worker_phone install 완료** (김동현/EMP-2222). **Cyён iPhone 16 install 차단** (Apple Developer team `F2P5ZFP65Q` 디바이스 한도) → 발표 폰 구성 **iPhone 2대 + Galaxy 1대**. **2026-05-28 관제 웹 대폭 확장** = 다크/라이트 모드, 실시간 미수신 메트릭 차트 비활성화, SQLite DB 영속화, 관리자 메뉴 CSV/XLSX, 현장환경 weather_log, 온도 위험도 offset 0.5, worker-phone 자동 재연결, git baseline. **2026-05-29 관제 웹** = VitAlGuard 라이트/다크 CI 로고, Coinbase/VitAlGuard 톤 레이아웃, 히어로 최종 문구 `OPEN SAFETY · NEVER ALONE`, 현장정보/수신요약/WeatherStrip 정렬, 관리자 현장정보 localStorage+서버 DB `site_info_daily` KST 일 1회 snapshot, XLSX 시트1 현장정보·시트2 생체데이터·시트3 현장환경, CSV 현장정보 블록 포함. **현재 공유 네트워크 전체 종료 상태**(2026-06-12 세션37 — dev/cloudflared/CCTV :8000 OFF). 마지막 active cloudflared URL = `channels-respect-absolute-watches.trycloudflare.com`(세션37 발급 후 종료; quick tunnel 은 세션마다 만료 → 재기동 시 **새 URL 발급·회전**, 폰 인앱·워치·이 문서 갱신 필요). **CCTV AI 영상 = 2026-06-27부터 라이브는 Cloud Run AI 서버([cctv-ai/](cctv-ai/), `cctv-ai-569797426568.asia-northeast3.run.app`, **⏸ 현재 OFF(CCTV 보류·과금 0)** — `--min-instances 0 --ingress internal`(리비전 `00017-nld`, 외부 404 차단 → 안 깨고 과금 0·삭제 아님). **재개(ON)**: `gcloud run services update cctv-ai --region asia-northeast3 --min-instances 1 --ingress all`. ─ 기능 최종 `00015-pp4` 구성 보존: **CAM-01 YOLOv8n 객체+속도(로테르담 건설현장 부감 고정캠 클립·차량 한글검출·주차라 속도 거의 비표시)·CAM-03 Hexmon PPE+낙상 듀얼소스(번들 클립 기본 + 폰 라이브 `/cam3/capture`→`/cctv/ingest3` override·3초 폴백, stats3 `fall_count` 노출)**·CAM-02 합성·한글 라벨, `--cpu 4 --memory 4Gi --no-cpu-throttling --min-instances 1 --max-instances 1 --update-env-vars YOLO_IMGSZ=800,PLAYBACK_FPS=6,OMP_NUM_THREADS=1,MKL_NUM_THREADS=1`(재개 시 상시 과금). **관제웹 MJPEG 연결 OK·안정(429 해소).** ★ **핵심: `OMP/MKL_NUM_THREADS=1`(torch 스레드 제한)이 CPU 기아 429 해결** — 추론 2코어+HTTP 2코어 보장 → 단일 인스턴스로 **MJPEG 대시보드+폰 override 동시 양립**(과거 max↑ 는 콜드스타트 처닝으로 더 불안정). 상세는 [docs/progress.md](docs/progress.md) ★CCTV 섹션)로 연동 — 대시보드가 build-arg `NEXT_PUBLIC_AI_CCTV_API`로 그 URL을 빌드타임 주입. 로컬 dev 는 `.env.local`의 동일 키 또는 코드 폴백 `http://localhost:8000`. (옛 `/ai-cctv` 프록시·`safetymonitor-cctv-demo` 로컬기동 방식은 대체됨.)** **dev 서버는 세션18부터 `0.0.0.0:3000` LAN 바인딩**(발표 PC·내 폰 브라우저 접속용; 조원 차단은 `scripts/lan-firewall.sh` pf 허용목록 — sudo 필요·미적용 상태). Mac LAN IP `192.168.219.221`. **현장위치 GPS 화면 표시 ON** — `.env.local MOCK_VITAL_EXPOSE_PII=true`(GET 응답에 GPS·보호자 노출, SOS 모달 현장위치/지도용). **2026-05-29 세션4 — 워치 PoC 물리 §4 잠금 검증 PASS** (BECKS Apple Watch Ultra, iPhone 잠금 15분 워치 null 0%/폰 null 98% → 워치 워크아웃 세션이 잠금 우회 실증). **2026-05-29 세션5 — 워치 PoC 기능 확장** = 낙상(Core Motion)·SpO₂(anchored) 센서 + 인앱 URL/작업자 편집 + 스트레스 입력 7종 + 파스텔 카드 UI. **★ 워치 재설치 완료 + 실측 검증** — EMP-9001 신규 빌드가 SpO₂ 92·안정심박 100·활동에너지·낙상 accelG 5.45·배터리 70·작업자명 장우진 수신(store age 1s) → 센서/스트레스/인앱설정 전부 실기기 동작 확인. 앱 아이콘·헤더 로고 커밋 `65e13bf`. 블로커(세션32 정정) = Galaxy Health 권한 **해결**(stale APK 재빌드 — "Step 2 데이터 타입별 권한 미수행" 추정은 틀렸음, 권한 3종 이미 granted=true) — **워치 fresh 데이터도 해결**(세션32 이어서, 착용+"계속 측정"→Samsung Health→HC 동기화 라이브, 관제 웹 EMP-8888 김동현 hr 94~99 연속 수신·DB 2분 65건·코드 변경 0). 남은 것: 관제 웹 최종 QA + 관리자 저장/내보내기 회귀, 손목온도 freshness 필터 결정, Galaxy Health Connect 권한, 2 iPhone 최신 release 재install, 스트레스 baseline 축적(07-07), 워치 배터리 풀시프트 측정, D4 리허설
- **상세**. [docs/progress.md "Quick Summary"](docs/progress.md#quick-summary-30초-안에-읽기) 우선 확인
- **이전 세션 히스토리(2026-05-21~2026-07-21 및 운영 노트)** — 토큰 절감을 위해 [docs/claude-md-archive-20260723.md](docs/claude-md-archive-20260723.md) 로 이동(2026-07-23 다이어트, 내용 무손실). 누적 핵심 결정 (a)~(cn) 은 [docs/key-decisions.md](docs/key-decisions.md). 새 세션 항목은 이 목록 맨 위에 추가하되 **최신 3개만 유지**하고 밀려난 항목은 아카이브로 옮긴다.

## 환경

- 모노레포 — pnpm workspaces (TypeScript 영역) + 별도 Flutter 프로젝트 (`apps/worker-phone/`)
- TypeScript 5.x strict
- Node.js LTS
- **작업자 폰 앱 — Flutter (Dart 3.x)** · iOS 빌드용 Xcode 26.4+ · Android 빌드용 Android Studio + JDK 17
- **워치 — 앱 미작성**. Apple Watch / Galaxy Watch 모두 페어 폰의 HealthKit / Health Connect 로 데이터 query
- 웹 — Next.js 15 + Tailwind + shadcn/ui
- 인프라 — AWS CDK (TypeScript) · Region `ap-northeast-2` (서울)
- 외부 의존성 — AWS SDK · Flutter 공식 패키지 (`health` · `mqtt_client` 등) 외 신규 추가 시 사전 합의

## 빌드 / 테스트 / 검증

```bash
# 전체 모노레포
pnpm install
pnpm build                          # pnpm -r --filter=./packages/* --filter=./apps/dashboard-web build
pnpm test                           # pnpm -r --filter=./packages/* --filter=./apps/dashboard-web test (analyzers + schemas + dashboard)
pnpm lint

# 패키지 단독
pnpm --filter @safetymonitor/analyzers test
pnpm --filter @safetymonitor/dashboard-web dev

# 인프라
cd backend/infrastructure
pnpm cdk diff --profile dev
pnpm cdk deploy --profile dev

# 작업자 폰 앱 (Flutter — iOS + Android 단일 코드베이스)
cd apps/worker-phone
flutter pub get
flutter doctor                      # 환경 점검 (iOS · Android toolchain)
flutter test                        # 단위 테스트
flutter run -d "iPhone 16"          # iOS 시뮬레이터 실행
flutter emulators --launch SafetyMonitor_API_35
flutter run -d SafetyMonitor_API_35 \
  --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital
flutter build ios --simulator       # iOS 빌드 검증
flutter build apk --debug \
  --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital

# AWS 보류 중 local/mock receiver
pnpm dev:web                        # http://localhost:3000
pnpm mock:publish                   # 4 worker mock vital 5초 간격 publish
```

## 코드 구조 — 큰 그림 (M1 진입 후 채움)

> ⚠️ 아래 트리는 **목표(미래) 구조** — 발표 후 로드맵 항목을 포함한다. 현재 디스크에 **존재하지 않는 경로**: `apps/dashboard-mobile/`, `backend/lambdas/*`, `packages/thresholds/`, `docs/architecture.md`, `docs/HealthPattern-reference/`, `.github/workflows/`. 현존 = `apps/{dashboard-web,worker-phone,worker-watch-poc}` · `backend/infrastructure` · `packages/{analyzers,schemas}`.

```
06.safetymonitor/
├── apps/
│   ├── worker-phone/               Flutter 작업자 폰 앱 (iOS + Android 단일 코드)
│   ├── dashboard-web/              Next.js 관제 대시보드 (PC)
│   └── dashboard-mobile/           관제자 모바일 보조 (M7 — Flutter / RN / 네이티브 결정)
├── backend/
│   ├── infrastructure/             AWS CDK (IoT · Auth · Data · Lambda 스택)
│   └── lambdas/
│       ├── vital-ingest/           IoT Rule → Timestream/DDB 적재
│       ├── hazard-detect/          vital → analyzers → HazardEvent
│       └── notify-fan-out/         HazardEvent → APNs·FCM·SES·Slack
├── packages/
│   ├── analyzers/                  공통 위험 감지 5종 (TS) — HealthPattern 이식
│   ├── thresholds/                 임계값 상수 (KOSHA + 의료 reference)
│   └── schemas/                    공통 데이터 스키마 (Zod)
├── docs/
│   ├── plan.md                     비전 · MVP · 아키텍처 · 마일스톤
│   ├── checklist.md                M0~M9 체크박스
│   ├── context-notes.md            의사결정 기록
│   ├── compliance.md               KOSHA · 개보법 · 근로계약
│   ├── architecture.md             데이터 흐름 상세
│   └── HealthPattern-reference/    HealthPattern docs 사본 (참고용)
└── .github/workflows/              CI (lint · build · test)
```

데이터 흐름. **Apple Watch / Galaxy Watch (생체 센서)** → **페어 폰 (Flutter `worker-phone` 앱 — HealthKit/Health Connect query)** → MQTT/TLS → AWS IoT Core → IoT Rule → Lambda (vital-ingest → hazard-detect → notify-fan-out) → DynamoDB/Timestream → WebSocket → 웹 대시보드 / APNs·FCM → 관제자 모바일.

## HealthPattern 과의 정책 차이 (혼동 방지)

| 항목 | HealthPattern | SafetyMonitor |
|---|---|---|
| 사용자 | 단일 (본인) | 다수 + 관제자 |
| 외부 서버 | **0건 (정책)** | **필수 (AWS)** |
| 클라우드 | M7 한정 Apple 인프라 예외 | AWS 전면 |
| 인증 | 없음 | Cognito + 멀티 테넌트 |
| ML | 금지 | 1차 금지 · 2차 검토 |
| 다국어 | 금지 | 금지 (동일) |
| 외부 패키지 | 0건 | AWS SDK + 필요 시 |

HealthPattern 의 코드·정책을 본 프로젝트에 그대로 적용하면 안 됨. 분석 알고리즘 *로직* 만 차용.

## 핵심 관례 — 모르면 함정

- **단말 코드는 최소 분석만 — 본 분석은 서버 사이드**
  - 낙상처럼 즉시성 필수인 것만 폰 단말 (Flutter) 에서 detection. 나머지 (심박 이상·SpO₂·고립 등) 는 vital 만 publish 하고 분석은 Lambda 가 수행
  - 사유. `packages/analyzers` (TS) 가 단일 source. Flutter 단말도 가능하면 raw 송신만 하고 분석은 Lambda 위임 → drift 위험 제거

- **워치 앱 미작성 — 폰이 HealthKit / Health Connect 로 query**
  - 워치 (Apple Watch / Galaxy Watch) 는 *생체 센서* 로만 사용. 별도 watchOS App / Wear OS App 미작성
  - Flutter 폰 앱이 `health` 패키지 + platform channel 로 페어 워치의 HR · SpO₂ · 가속도 query
  - SOS 버튼·연결 상태 UI 는 *폰 화면* 에 (워치 화면 미사용)
  - 사유. 1인 개발 + 발표 임팩트 측면에서 워치 OS 별 2개 네이티브 부담 회피 ([context-notes.md 2026-05-21 "단말 아키텍처 정정"](docs/context-notes.md))

- **`packages/analyzers` 는 순수 함수 — I/O 금지**
  - 입력. 정규화된 vital 시계열. 출력. HazardEvent 후보
  - Lambda·웹·모바일 어디서든 호출 가능해야 함
  - AWS SDK · fetch · DB 호출 절대 금지

- **AWS Cost — 매주 확인 + 알람 단계화**
  - 월 알람 $50 / $100 / $200 단계
  - Free Tier 만료 12개월 후 IoT Core (메시지당 $1/M) · Timestream (스토리지) 부터 증가
  - 비용 폭증 1순위. Timestream 쿼리 (full scan 주의), CloudWatch Logs retention 무제한 방치

- **인증서 keystore — 디바이스별 격리 + 회수 절차 필수**
  - 작업자 퇴사 / 단말 분실 시 인증서 revoke 워크플로우 (Cognito 사용자 + IoT Thing 비활성화 동시)
  - 베타 시작 전 revoke 1회 모의 훈련 필수

- **개인정보 — 명시적 동의 없이 수집 절대 금지**
  - 작업자 onboarding 시 동의서 (디지털 서명 + 동의 철회 권리) → DynamoDB 별도 저장
  - 동의 철회 시 데이터 익명화 cron 자동 실행
  - 사고 데이터는 익명화 불가 (KOSHA 3년 보존) — 동의서에 명시 필수

- **알림 deduplication — 동일 워커·동일 type 5분 윈도우**
  - Lambda `hazard-detect` 에서 DynamoDB conditional write 로 5분 dedup key 체크
  - `danger` severity 는 dedup 미적용 (생명 우선)

- **한국어 단독 — 영문 라벨 추가 금지**
  - 로그·UI·문서 모두 한국어. 영어는 코드 식별자·API field name 만
  - 사유. HealthPattern 정책 계승 + KOSHA 보고서 한국어 의무

## 의도적 비범위 (out of scope)

손대지 말 것. 사용자가 명시적으로 결정함 ([docs/context-notes.md](docs/context-notes.md) 2026-05-21).

### 프로토타입 (현 시점) 비범위 — 발표 후로 이연
- **워치 앱 (watchOS App / Wear OS App)** — 워치는 생체 센서로만 사용. 폰 앱이 HealthKit/Health Connect query
- **멀티 테넌트** — 시연용 worker 2~4명 (실기기 2 + mock 1~2). 단 조직 1개·관제자 1명·멀티 테넌트 X 유지
- **Cognito 인증** — dev 데모는 인증 stub 또는 로컬 토큰
- **APNs / FCM / SES / Slack 알림** — 데모는 웹 alert 만
- **위험 감지 5종 중 고립** — 낙상·심박이상·SOS·**SpO₂·고온** 5종 시연. 고립은 발표 후
- **KOSHA PDF 리포트 / AuditLog 인프라** — 슬라이드 언급만, 구현 X
- **App Store / Play Store 배포** — Xcode 개발자 모드·실기기로 시연
- **베타 협력사 운용 / 법률 자문 / 도메인 정식 확보 / GitHub Organization / 의료기기 인증 검토** — 발표 후

### 영구 비범위 (프로토타입·프로덕션 공통)
- 머신러닝 / 자율 학습 — 2차 이후. 1차는 규칙·통계만
- 영상 (CCTV) 통합 — 2차
- 자동 119 연계 — 2차. 1차는 관제자 수동 호출
- 다국어 — 한국어 단독. 영문 fallback 추가 금지
- 의료기기 인증 (MFDS) — 산업 안전 보조 정보 범주로 한정. 진단·치료 주장 절대 금지
- iOS·Android 외 OS — 1차는 두 OS만
- 자체 단말 OEM — 기존 Apple·Samsung 단말 활용

## Flutter Project Guidelines

> ⚠️ **현 시점 (2026-05-27) 적용 상태** — `apps/worker-phone/` 은 아직 이 가이드라인을 따르지 않음. Riverpod 미도입 (의존성 없음), `lib/` 는 `models/ + services/ + main.dart` 평면 구조. **발표 (2026-06-04, D-8) 전까지 리팩토링 금지** — 신규 작성 코드부터 점진 적용, 기존 코드 대규모 이동은 발표 후 로드맵으로 이연.

### State Management
- Riverpod 2.x 사용
- Provider 직접 사용 금지

### Folder Structure
```
lib/
├── core/         # 공통 유틸, 상수
├── data/         # API, 로컬DB
├── domain/       # 모델, 유스케이스
├── presentation/ # 화면, 위젯
└── main.dart
```

### Code Style
- 한국어 주석 허용
- async/await 우선, .then() 지양
- const 위젯 적극 활용

### Testing
- 새 기능 추가 시 widget test 함께 작성
- 통합 테스트는 `integration_test/` 폴더
