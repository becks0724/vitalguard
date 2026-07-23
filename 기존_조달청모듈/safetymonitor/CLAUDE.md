# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**SafetyMonitor (가칭 `IndusView`)** — 산업 현장 작업자 생체 모니터링 컨셉. Apple Watch + Android Wear 작업자 단말 ↔ AWS IoT Core 백엔드 ↔ 관제 웹 대시보드 + 모바일 보조 앱. KOSHA 산업안전보건법의 "실시간 위험성 평가" 의무 디지털 지원.

> **이 프로젝트의 목표는 발표용 프로토타입 *한정이 아니라* — 발표(2026-07-07)를 첫 검증 마일스톤으로 삼아 *최종 상용화·현장 실사용*까지 가는 것이다 (2026-06-07 방향 전환).** 따라서 — ① 발표까지는 *데모를 깨지 않는 선*에서 상용화 친화적 선택을 우선하고, ② AWS 실배포·유료 계정·멀티테넌트 같은 큰 전환은 *발표 직후* 착수하며, ③ 모든 결정 기준에 "데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다. 제품 전반 상용화 갭 분석·단계별 로드맵은 [docs/commercialization-gap-analysis.md](docs/commercialization-gap-analysis.md), 잠금·배터리 심층은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md), 성격 재정의 상세는 [docs/context-notes.md](docs/context-notes.md) 참조.

HealthPattern (개인용 HealthKit 패턴 앱) 의 분석 알고리즘만 이식. HealthKit·SwiftUI 종속 코드는 미사용. 외부 서버 0건 정책은 본 프로젝트에서 **폐기** (관제 자체가 서버 필수).

상세는 [docs/plan.md](docs/plan.md) · [docs/checklist.md](docs/checklist.md) · [docs/context-notes.md](docs/context-notes.md) · [docs/progress.md](docs/progress.md) 참조. 잠금·백그라운드 생체 모니터링 상용화 해결책은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md) 참조.

## 현재 상태 (Status — 새 세션 시작 시 먼저 읽기)

- **★ 2026-07-24 — Safari 파비콘 미표시 근본수정(ICO 형식) + 배포 규율 강화(L-09 보강·L-10) + harness 레포루트 고정 + 팀원 GCP 오너 부여 · 라이브 `00126-n2l`→`00127-qwx`→**`00129-fmt`**(이후 병렬 텔레그램 배포로 라이브 `00130-s9f`=main `330e1b6`, 파비콘 BMP 포함)**. ① **★ Safari 파비콘 2라운드 수정** — (증상) Chrome은 방패 로고 표시, Safari 즐겨찾기는 "R" 폴백. (1차 `a829e26`→`00126`) 원인=`/favicon.ico` **404**+256px PNG 하나만 선언 → Next.js `app/favicon.ico`+`app/apple-icon.png`(180) 추가(sips 리사이즈·Node로 멀티사이즈 ICO 조립). (2차 `330e1b6`→`00129`) **그래도 Safari 미표시** → 진짜 원인=1차 favicon.ico가 **PNG-in-ICO**였고 **WebKit/Safari는 ICO 내 PNG 압축 엔트리 미디코드**(Chrome/Blink만 됨) → Pillow `bitmap_format="bmp"` 로 16/32/48 **BMP-in-ICO** 재생성. 라이브 favicon.ico=BMP 3엔트리 실측 확인. **사용자측 잔여** = Safari 파비콘 캐시가 옛 폴백 붙잡음(북마크 재등록≠캐시 삭제) → `rm -rf ~/Library/Safari/Favicon\ Cache ~/Library/Safari/Touch\ Icons\ Cache`(Safari 종료 후) 또는 설정→개인정보→웹사이트 데이터 삭제 후 재방문. 진단 테스트 = Safari 주소창에 `/favicon.ico` 직접 열어 방패 렌더 확인. ② **★ 배포 규율 강화(2교훈)** — **L-09 보강**(2026-07-24 재발): `git status` local==origin(동기)이어도 **배포 이미지가 구커밋일 수 있음**(공유 워킹트리에서 병렬 세션이 local main도 전진 → 크론 커밋 누락한 구식 favicon 이미지 배포 사고). → 배포 직전 **"빌드 커밋 `BUILT=git rev-parse HEAD` == 현재 HEAD"** 대조로 강화([/deploy](../../.claude/commands/deploy.md) 개정·실적용). **L-10**(이전 세션): 배포 선검증에 **lint 필수**(ZWSP `no-irregular-whitespace`가 `next build`에서만 실패해 3분 왕복 → /deploy에 typecheck+lint+test 3종 명문화). 둘 다 `harness/4-guardrails/lessons.md` 등재·다음 세션 자동 주입. ③ **harness 레포루트 고정** — harness(lessons훅·/verify·/deploy·/retro·`harness/`)가 **레포 루트에만** 있어 모듈 하위(`기존_조달청모듈/safetymonitor`)에서 연 세션엔 훅이 조용히 미적용 → 모델 라우팅 템플릿 4종을 `cd <레포루트> && claude`로 고정, 중복 `session-templates.md` 삭제·`model-routing-templates.md` 정본 통합(전역 `~/.claude/`·로컬 전용). 이 세션은 레포 루트라 L-01~L-10 정상 주입 확인. ④ **팀원 GCP 오너 부여** — `279881795+rlaxorhs77-eng@users.noreply.github.com` 콘솔 초대→수락→`roles/owner`(오너 2명). 조직 없는 프로젝트라 오너는 콘솔 초대만(CLI `SOLO_MUST_INVITE_OWNERS` 차단)·IAM/배포는 auto-mode 분류기가 에이전트 실행 차단(사용자 `!` 직접). 메모리 `teammate-owner-granted`. (검증) 각 파비콘 배포 tsc0·lint0·test green(dashboard 231→234)·라이브 favicon.ico/apple-icon/icon 200·BMP 엔트리 실측·L-09 보강 실적용(BUILT==HEAD 330e1b6 대조 후 배포). (현재상태) **라이브 `00130-s9f` = main `330e1b6`(파비콘 BMP 포함) = origin 동기**·오너 2명·cctv-ai OFF·harness 레포루트 세션 정상. 파비콘 커밋 이후 `9854e2a`(병렬 텔레그램 docs)는 docs-only(재배포 불필요). (다음) ① (사용자) Safari 파비콘 **캐시 클리어** 후 방패 로고 표시 확인 — 서버는 BMP로 고침, 남은 건 캐시 ② (팀원 온보딩) 세션은 **레포 루트에서 열기**(harness 적용)+프로덕션 배포는 `/deploy` 명시 ③ (이월) 캘린더 **B5 = 설비 점검 일정 자동 표출**(AED D-day → 캘린더 배지) — 추천 1순위 ④ (선택) 텔레그램 봇 토큰 재발급(세션 노출)·CCTV zone hazard 알림 편입.
- **★ 2026-07-23~24 — 생체 그래프 Recharts 교체+지정기간 · 텔레그램 알림 3단계(작업자·현장환경·무인24/7) · 라이브 `00123-jmv`→`00124-vt5`→`00125-wn9`→**`00130-s9f`** (main `9f2de3f`→`4acbf48`→`330e1b6`)**. ① **생체 추세 차트 Recharts 교체 + 지정 기간 조회**(`9f2de3f`→`00123-jmv`) — 수작업 SVG LineChart/BarChart(971줄)를 [Recharts](apps/dashboard-web/app/components/VitalChartsRecharts.tsx)로 교체(A/B 토글로 로컬 육안 비교 후 채택·툴팁 `isAnimationActive={false}`로 포인트 이동 버벅임 해소). 임계선·영역·이상치 dot·즉시툴팁 이식. 프리셋(24시간~1년) 옆 `<input type="date">` 시작일~종료일 캘린더 추가 → [/api/mock/history](apps/dashboard-web/app/api/mock/history/route.ts) `from`/`to`·`buildHistoryBetween` 일별 생성. 기존 SVG 차트는 SiteSafetyTables 재사용분 보존. recharts ^2.15.0 신규 의존성. ② **텔레그램 알림 1단계 — 작업자 5종**(`9e73ed4`→`00124-vt5`) — SOS·낙상·생체·구획이탈·위험구역진입이 서버 단일 관문 [recordAlert()](apps/dashboard-web/lib/db.ts)(신규삽입 rowCount>0일 때만 1회) → [telegram.ts](apps/dashboard-web/lib/telegram.ts) sendMessage. 봇 `@vitalguard1_bot`·그룹 `-5461254248`. 배선 = 시크릿 `TELEGRAM_BOT_TOKEN`(신규 생성·런타임 SA `569797426568-compute` secretAccessor 부여)+env `TELEGRAM_CHAT_ID`. ③ **텔레그램 2단계 — 현장환경**(`4acbf48`→`00125-wn9`) — 날씨 6종(체감온도·불쾌지수·미세먼지·풍속·자외선·강수)+KMA 특보를 [/api/weather](apps/dashboard-web/app/api/weather/route.ts) 캐시미스·[/api/kma-warning](apps/dashboard-web/app/api/kma-warning/route.ts)(live만) 훅에서 판정→발송. 결정 = 브라우저 연동(인프라0)·주의+위험. 억제 = 신규 `env_alert_state` 테이블+`upsertEnvAlertState`(원자적·악화전이만 발송·정상복귀 리셋). [env-alert-notify.ts](apps/dashboard-web/lib/env-alert-notify.ts). ④ **무인 24/7 Cloud Scheduler**(`330e1b6`→`00130-s9f`) — 신규 [/api/cron/env-check](apps/dashboard-web/app/api/cron/env-check/route.ts)(X-Cron-Key 게이트·env `CRON_SECRET`)가 저장좌표(`getLatestSiteCoord`→`weather_daily`)로 **자체** weather·kma 호출(origin=Host헤더 https — Cloud Run http 프록시 자기호출 실패 회피 `9f1a2b1`) → 대시보드 없이 10분마다 판정. Cloud Scheduler API 활성화+잡 `env-check`(`*/10`·Asia/Seoul). ⑤ **★ 병렬 레이스(L-09) 처리** — 스케줄러 트랙 중 다른 세션이 파비콘 커밋 2건(`a829e26`·`330e1b6` 바이너리만) 공유트리·origin 전진 → 구식 이미지 폐기·최신 `330e1b6` 재빌드(팀원 파비콘 롤백 방지). 매 배포 전후 origin 이중 확인. (검증) tsc0·lint0err·**test 222→234**(telegram 5·env-alert 4·cron-auth 3 신규)·build OK·각 배포 루트200·rev100%. 텔레그램 = 배포전 직접 sendMessage 그룹 배달 ok:true(프로덕션 DB 무쓰기 L-04)·크론 헤더 `checked{weather200,kma200}`·무헤더401·스케줄러 실행로그200·Cloud Run `Google-Cloud-Scheduler` UA 200. (현재상태) **라이브 `00130-s9f` = main `330e1b6` = origin 동기(0/0)**·시크릿 17종+`TELEGRAM_BOT_TOKEN`·env `TELEGRAM_CHAT_ID`/`CRON_SECRET`·cctv-ai OFF. `CRON_SECRET`은 세션 스크래치패드 보관(미커밋)·Cloud Run env+스케줄러 헤더 동일값. 메모리 `telegram-alerts-phase1` 최신화. (다음) ① (육안) 낮 시간 실제 위험(폭염·강풍·미세먼지 나쁨·기상특보)에서 그룹 텔레그램 수신 확인 ② (보안) 봇 토큰 세션 채팅 노출 — `@BotFather /revoke` 재발급 권장(재발급 시 시크릿 새 버전+재배포) ③ (선택) 텔레그램 메시지 커스터마이즈(지도 링크·수치 강조·심각도 이모지) ④ (선택) CCTV zone hazard도 텔레그램 편입(현재 관문 밖·in-memory only) ⑤ (선택) `CRON_SECRET` 회전 시 env+스케줄러 헤더 동시 갱신.
- **★ 2026-07-22~23 — 풍속 판정 순간풍속(돌풍) 기준 교정 — 크레인/고소 중지 임계 정합 · main `c3c91ef` · 별도 배포 불필요(병렬 00118/00119 빌드에 포함·라이브 실측 확인)**. (요청) 현장 풍속이 타워크레인/고소 중지 임계 수준인데 현장 환경 풍속 위젯은 '정상' 표시 — 원인 확인→수정. (근본원인) **판정 지표 불일치** — [/api/weather](apps/dashboard-web/app/api/weather/route.ts) 가 Open-Meteo `current` 에서 `wind_speed_10m`(**10분 평균**)만 수집하는데, 안전보건규칙 §37·§143 임계(10/15m/s)는 **순간풍속(돌풍)** 기준(모달 스스로 "순간풍속 기준, 평균풍속 아님" 명시). 같은 화면의 캘린더 위험작업 경고는 daily `wind_gusts_10m_max`(10.5m/s)로 이미 올바르게 판정 → "위젯 정상 vs 캘린더 경고" 모순. 부수 = 헤더 10.6**km/h**(=2.9m/s)와 돌풍 10.5**m/s** 단위 혼동 유의. (수정 · `c3c91ef` · 5파일) ① route: `current` 에 `wind_gusts_10m` 추가 → `windGustKmh` 응답(DB 폴백 정합) ② [weather-rules.ts](apps/dashboard-web/lib/weather-rules.ts) `evaluateWindKmh(kmh, gustKmh?)` — 판정 = 순간풍속(미보유 시 평균 폴백+"과소경보 가능" 명시·이상 데이터[돌풍<평균]는 안전측 max)·측정값 순간·평균 병기 ③ WIND_STEPS 15m/s 단계에 타워크레인 운전 중지(법적) 반영·근거 §37·§143 로 캘린더와 통일(기존 라벨↔notes 모순 정리) ④ [WeatherStrip](apps/dashboard-web/app/components/WeatherStrip.tsx) 풍속 칩 헤드라인 = 순간풍속 m/s(평균 병기)·판정에 돌풍 전달 → 기존 확인/조치 경보 팝업·`env_alert_ack` 파이프라인 자동 합류 ⑤ [db.ts](apps/dashboard-web/lib/db.ts) `weather_log`·`weather_daily` 에 `wind_gust_kmh` 멱등 컬럼(구 행 null=평균 폴백). (검증) tsc0·lint0·**test 200→207**(풍속 회귀 7 신규 — 현장 재현 "평균 2.9 정상+돌풍 10.5 초과→주의" 포함)·Open-Meteo 원 API 프로브(current 돌풍 필드 실반환 확인). (배포) **별도 배포 불필요** — push(`ff547fa`→`c3c91ef`, 팀원 전진 감지→리베이스·재검증 후 ff) 이후 병렬 지도 세션의 00118→00119 빌드가 내 커밋 이후 main 이라 포함(`merge-base` 확인). **라이브 실측** = `/api/weather` `windGustKmh 42.1km/h(11.7m/s)` vs 평균 11.7km/h(3.3m/s) → 보고된 바로 그 조건(돌풍만 임계 초과)에서 풍속 '주의' 점등 = 실전 검증 완료. (작업 절차 특이) 이 세션 워크트리는 main 점유 불가(주 워크트리가 main 점유) → origin/main 기반 임시 브랜치에서 수정·검증 후 `push HEAD:main`(ff). (운영) 모델 하이브리드 잔여 배선 — 전역 `~/.claude/CLAUDE.md` §10 에 **안전장치 명문화**(하위 모델 트랙에서 설계 판단·원인 불명 버그 시 붙잡지 말고 "Fable 전환 권장" 보고 — 템플릿 미사용 세션에도 주입) + 시작 템플릿 파일(`~/.claude/model-routing-templates.md`) 참조 줄 추가(전문은 매 세션 주입 회피 위해 별도 파일 유지). (다음) ① (육안·하드 새로고침) 풍속 칩 "11.7 m/s·순간 (평균 3.3 m/s)"+주의 배지·클릭 모달 순간/평균 병기·§37·§143·돌풍 임계 초과 시 확인/조치 팝업 ② (선택) 관리자 XLSX 시트3(현장환경)·CSV 에 돌풍 컬럼 노출 여부 결정 — `wind_gust_kmh` DB 적재는 시작됐고 export 는 아직 미포함 ③ (참고) 구 `weather_daily` 폴백 행은 돌풍 null → 평균 판정+한계 문구 표시가 정상 동작.
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
