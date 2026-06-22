# SafetyMonitor — Checklist

> **★ 2026-06-22 (changwoojin 클론·`feat/gcp-postgres-cloudrun` 브랜치 — 발표 프로토타입 트랙과 별개)** — **GCP Cloud Run 배포 완료**. 고정 HTTPS `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`(admin/safety2026) + **DB SQLite→PostgreSQL 이전**(캠퍼스 `project-db-campus.smhrd.com:3310`, SSL 미지원→sslmode=disable). 2커밋(`a766ae7`·`9a59f36`), **이후 main 병합·origin push 완료**. **★ 같은 날 추가**: 관제 **레이아웃 2페이지 페이저**(`f67b1d4`, main·Cloud Run rev00003) + **관리자 회원가입 승인제**(`40d5511`, main·rev00004=**라이브**; 가입 6항목 필수=회사·아이디·이름·연락처·이메일·비번, env admin(`admin`/`safety2026`)=owner 승인자) + **Google 로그인 OAuth**(`41f2f3c`, 브랜치 `feat/google-oauth` **미병합·라이브 미반영**). **origin = `VitAlGuard-jodal/vitalguard-jodalcheong`**(직전 `rlaxorhs77-eng` 오연동 정정). 검증 tsc 0·테스트 44/44·실DB E2E·서버측(구글 동의 화면만 사용자 수동). **남은 것** = 로컬 구글 로그인 확인 → push·main 병합·**Secret Manager(GOOGLE_CLIENT_ID/SECRET)**·재배포 · Phase 5(폰·워치 URL→Cloud Run) 미완 · 상용화 DB SSL. 회원가입/구글 상세 [auth-signup/checklist.md](auth-signup/checklist.md) · GCP Phase 0~4 [gcp-migration/checklist.md](gcp-migration/checklist.md). (아래는 발표 프로토타입 D0~D4 트랙 — 별개.)
>
> ---
>
> **현재 상태 (최신은 [CLAUDE.md](../CLAUDE.md) '현재 상태(Status)' 단일 source — 2026-06-12 세션37 기준)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~92% + D3 ~78% + D4 UI 폴리싱 진행**. iPhone 2대(BECKS + YJH) + Galaxy install 이력 유지, 워치 PoC 잠금 검증 PASS. (아래는 세션30 시점 기록 — 이후 세션은 CLAUDE.md Status 참조.) **2026-06-09 세션30**(2커밋·AED 알림 현실화+NFC 점검): ① **AED 알림 현실화**(`01c379c`) — AED 본체 배터리·패드 **실시간 측정 불가**→제조사 권장 교환 주기(배터리 48개월·패드 24개월) 관리, **라이브 %는 'AED 알림 단말'(IoT) 배터리 한정**("배터리 부족"=단말), worst-of 3차원(단말 배터리·AED 배터리 교환주기·패드 교환주기). ② **★ AED NFC 점검 end-to-end**(`aa5914a`, **QR→NFC 사용자 전환**) — 리셋/관제 직접 갱신 폐기→장비별 **NFC 태그(URL)**→관리자(여러 명) 폰 태깅→모바일 점검 페이지(점검자·항목)→`POST /api/aed/inspect`→SQLite `aed_inspections`→대시보드 **12초 폴링** 자동 반영(최근 교환·주기 리셋·이력). 신규 `lib/aed-devices.ts`(레지스트리 공유)·`app/aed/inspect`·`app/api/aed/{inspect,inspections}`+`lib/db.ts` 테이블. AED 표=장비별 **NFC 모달**(origin URL→터널/LAN 무관 + Web NFC 쓰기·graceful 폴백)+이력 병합(DB 스캔+seed). **의존성 0**(Web NFC). 검증 tsc 0·단위 14/14·API(201/persist/404/400)·**실UI end-to-end**(자재창고 배터리교체→교환임박→정상 ~48개월, B1 패드교체→D-20→~24개월). ★ **Web NFC 태그 쓰기만 미검증**(Android Chrome+물리 태그 시연 시). main **`ahead 124`**(2커밋 `01c379c`·`aa5914a`), push 보류, working tree=`demo/`·docs·iOS 부산물 미커밋. 남은 것(세션30·내일): **push(124)**·demo/ 커밋·iOS 락파일/pbxproj 처리·docs 커밋·**Web NFC 물리 시연**(Galaxy Chrome)·기존 블로커. 직전 **2026-06-09 세션29**(8커밋·관제 웹 디자인 대개편+iOS 재설치): ① 생체 막대→체온계 캡슐 게이지(`f0541c3`) ② 라인→그라데이션 곡선+도트+**Lato**(`4a95a15`, 차트 패널 스코프) ③ 알림 아이콘→**cva Alert**(triangle/shield/circle-check)+상태색(`c576789`) ④ 관리자 로그인→**레퍼런스 카드 Signup1**(`d676fcf`, 구글 포함) ⑤ 관리자 모달(내보내기)→**레퍼런스 카드 리디자인**(`0d6243d`, 헤더/메타/섹션/버튼·의미색 유지·기능 100% 보존) ⑥ 통합 안전 신호등 아이콘→**모노톤 SVG**(`5212621`, cloud-sun/hard-hat/wind/heart-pulse) ⑦ 제세동기 배터리→**원형 게이지**(`a4652aa`, 행 높이 h-12 불변) ⑧ 추세 그래프 **60일·1년** 추가(`d88960a`, 1년=월별 12점·일별 365 겹침 회피). **★ iOS 재설치(BECKS)** — 무료팀 기기 미등록(임베드 프로파일 device 0)으로 `flutter build`+`devicectl`·`flutter run --release` 둘 다 `provisioning profile cannot be installed` 차단 → **Xcode `Runner.xcworkspace`에서 BECKS 선택→Product>Run 1회로 기기 등록+신뢰**(debug 설치) + **SPM 비활성화**(`flutter config --no-enable-swift-package-manager`, `health` 미지원·CocoaPods, `Cannot create link` 크래시 회피) → `flutter build ios --release`(18.1MB·RELEASE·프로파일 **devices 2·BECKS 포함**)+`devicectl install`(debug→release 덮어쓰기)+launch 성공·**EMP-1234 age 2s 수신**(hr:-- 는 잠금/Health 권한 대기). 레퍼런스 디자인 **전부 의존성 0**(framer-motion→CSS·lucide→인라인 SVG·shadcn/cva/clsx→토큰). 검증 각 dashboard tsc 0 + Playwright 실브라우저(전 항목)+단위 14/14, iOS=release+프로파일 devices 2+install/launch+수신. main **`ahead 122`**(8커밋 `f0541c3`·`4a95a15`·`c576789`·`d676fcf`·`0d6243d`·`5212621`·`a4652aa`·`d88960a`), push 보류, working tree `demo/` untracked + **iOS 재설치 부산물 미커밋**(`apps/worker-phone/ios/Podfile.lock`·`Runner.xcodeproj/project.pbxproj`·`pubspec.lock`). 남은 것(세션29): **push 결정(122)** · demo/ 커밋 여부 · **iOS 락파일/pbxproj 처리**(revert vs commit) · **YJH 동일 방식 재설치**(Xcode 1회 등록→CLI release) · BECKS 잠금해제+Health 시 실측 심박 확인 · 폰 인앱 URL 확인 · 기존 블로커(Galaxy Health·배터리 풀시프트·세션23 KMA NO_DATA·D4 리허설). 직전 **2026-06-09 세션28**(5커밋): ① **로그인 사진 → mainpic0.jpg**(`9cdf09e`, 중앙 구도라 `background-position 50%`) ② **네트워크 재연결**(새 터널 `undertaken-best-communist-release`, LAN `192.168.219.221`, dev 0.0.0.0; 폰 3대 인앱 URL 갱신 필요) ③ **★ 외형 스냅샷 HTML 2개**(SingleFile, `demo/safetymonitor-{dashboard-live,login}-snapshot.html`, 셰이더 PNG 박제·외부자원 0·정지 스냅샷·팀원 공유용) ④ **★ 현장환경 InfiniteSlider 재디자인 + 모노톤 아이콘**(`3d2408d`, 호버 22% 감속·`mask-image` 페이드·sans 폰트·WeatherIcons 신규) ⑤ **★ 헤더 ExpandableTabs 호버 확장**(`a950ef4`, 4버튼 알약바·테마토글 제외·GradientIconButton 삭제) ⑥ **★ 자동슬라이딩 복제행 생체 셀 선택 수정**(`9d88d55`, `pointer-events-none` 제거→복제본도 클릭) ⑦ **★ SOS·낙상 알림 이력 Alert 카드 재디자인**(`48d99f4`, 소프트 컬러 카드+모노톤 SVG 아이콘) ⑧ **상태 점검**(EMP-1234/장우진 실시간 연결·GPS 현장날씨 Open-Meteo **LIVE**·기상특보 mock 폴백·현장날씨 미표시=dev 재시작 세션무효→**재로그인**). 레퍼런스 디자인(InfiniteSlider/ExpandableTabs/Alert) **전부 신규 의존성 0**으로 구현(Tailwind JIT/preflight 간섭은 인라인 스타일로 우회). 검증 각 dashboard tsc 0 + Playwright 라이브(전 항목). main **`ahead 113`**(5커밋 `9cdf09e`·`3d2408d`·`a950ef4`·`9d88d55`·`48d99f4`), push 보류, working tree `demo/`만 untracked. 남은 것(세션28): **push 결정(113)** · demo/ 커밋 여부 · 폰 3대 인앱 URL 갱신(`undertaken-best-communist-release`) · 재로그인 시 현장 날씨 표시 확인 · 기상특보 KMA NO_DATA 처리 결정 · YJH iPhone 재install · Galaxy Health 권한 · 배터리 풀시프트 · D4 리허설. 직전 **2026-06-08 세션27**(6커밋): ① **현장 선택 메인 현장 지역명 표기**(`afec68e`) — `MAIN_SITE.label` "광주 스마트인재개발원 신축 공사"(데모와 동일 "지역 현장이름" 형식, `siteName`은 실제 현장명 유지) ② **★ 작업자 표 자동 슬라이딩 동일 작업자 중복 노출 수정**(`08951a4`) — 행을 항상 2벌 복제하던 것을 overflow일 때만 복제(`tableOverflowing` state, rAF tick 측정)→행 적으면 한 벌만→중복 해소, overflow 시 복제+슬라이딩 보존 ③ **비전 PoC 계획(보류)**(`cbc7205`, `vision-ppe-plan.md` 신규) — GoPro+supervision 안전모 검출+낙상 보강, supervision=후처리(별도 YOLO), 발표 PoC 결정(영상+ML 2차 비범위 승격)+HERO9 웹캠+**로컬 CPU 실시간**(Colab 로컬 USB 웹캠 불가), macOS 캡처=GoPro Webcam→OBS 가상캠→OpenCV, **GoPro 미보유→보류** ④ **루트 stray 정리**(`c59aaa5`, `.claude/skills/` gitignore+루트 중복 이미지·스크린샷 삭제) ⑤ **로그인 사진 교체 → mainpic4.jpg**(`1c08b97`, 안전모 VitalGuard 로고 브랜딩, 구도 동일 position 유지, 미사용 구 이미지 삭제). 검증 tsc 0(각 수정) + Playwright(현장선택 콤보 6항목 가나다·메인 "광주…"/자동 슬라이딩 중복 해소/사진 mainpic4). main **`ahead 107`**, push 보류, working tree clean. 직전 **2026-06-08 세션26**(5커밋): ① **로그인 화면 풀 개편 커밋**(`f3baadd`) — 반투명 글래스 카드 2분할(좌측 현장사진 `mainpic.jpg`)·셰이더 배경·스토어 배지·구글 버튼·**리퀴드 메탈 로그인 CTA**(기설치 shaders-react LiquidMetal 재사용→신규 의존성 0)·한↔영 레이아웃 높이 고정 ② **헤더 그라데이션 확장 버튼**(`1787e5c`)+테마 토글 로그아웃 우측 이동 ③ 관제 웹 폰트 Archivo/Do Hyeon 적용→**롤백(Inter)** ④ **★ 로그인 후 현장 선택 단계 신규**(`a3e8575`) — HeroUI 콤보박스(외부 의존성 0), 메인=스마트인재개발원 신축 공사 고정 + 데모 5현장(광주·부산·세종·인천·평택) **가나다순**, 선택→site-info 저장→대시보드 현장정보 반영, 레이아웃=로고만·드롭다운 비클리핑. 검증 tsc 0 + Playwright(로그인→현장선택→입장 end-to-end). main **`ahead 101`**, push 보류, 루트 stray(`mainpic.jpg`·`dashboard-full.png`)·`.claude/skills/` untracked. 직전 **2026-06-08 세션25**: ① **재가동** — 새 터널 `sends-paintball-often-carolina`(LAN `192.168.219.123`), 워치 URL+CLAUDE.md 갱신(폰 인앱 URL ⚙️ 수동 갱신 필요) ② **로그인/헤더 디자인 개편** — 테마·언어 토글 알약 슬라이딩 스위치(Serenity UI)·헤더 ghost 버튼(ruixenui)·이모지→라인 SVG(커밋 `2738fc8`), **로그인 셰이더 배경**(신규 의존성 `@paper-design/shaders-react`)·풀블리드(박스 제거·글래스 입력)·텍스트 1줄·폰트(Archivo Black+Do Hyeon) ③ **팀원 공유** — cloudflared 공개 URL+로그인+PII 가림 검증, 고정 URL 안내(결정 대기). main `ahead 96`(커밋 1건, 나머지 디자인/URL-sync 미커밋). 직전 **2026-06-08 세션24**(3커밋): ① 수신 URL 재발급 `cheers-entire-glass-editorial`(`218b96d`, 이전 터널 만료 → 재기동·GET 200/POST 202, 워치 `defaultURLString`+CLAUDE.md 갱신, 폰 인앱 URL ⚙️ 수동 갱신 필요) ② **★ 태풍 진로 "실 위협 없으면 레이더 미가동"**(`e9567b1`, 사용자 결정=엄격, `realThreat = live && track>0` → `mock`/`none`/빈 진로는 "태풍 위협 없음·레이더 대기"·지도 숨김, `live`+발효 진로만 한국/현장 GPS 게이트) ③ .gitignore `.playwright-mcp/`(`96fdad8`). 검증 tsc 0 + Playwright(위성타일 0·"추적 중" 부재). main `ahead 94`, push 보류. 직전 **2026-06-08 세션23**(코드 변경 0·검증 전용): 관제 웹 Playwright MCP 런타임 검증 — 세션22 태풍 게이팅(haversine 검산 948km≈"한국 950km")·특보영상 YouTube 라이브·통합 안전 신호등·지도 타일 CDN 전부 **PASS**, ★ **KMA `03 NO_DATA`→mock 폴백 가짜 특보 발견**(무특보 날 서울/경기/강원·전남/경남/제주 등록 작업자에 거짓 특보, 결정 대기). main `ahead 90`, push 보류. 직전 **2026-06-04 세션19**(6커밋): ① **★ API PII 로그인 세션 게이트**(커밋 `722a92c`, 미인증 GET `/api/mock/vital` PII를 `MOCK_VITAL_EXPOSE_PII`+로그인 세션 토큰 동시 충족 시에만 노출 → 팀원 공개 URL 공유해도 PII 보호) ② **★ 현장 통합 안전 신호등**(커밋 `269e663`, 기존 기상신호등 자리를 현장기상/작업자/가스/AED 4 worst-of 램프+종합 보드 `SafetySignalBoard`로 교체, WeatherHazardPanel 삭제 `b76f6a6`) ③ **★ 통합 신호등 항목별 상세 안내**(커밋 `51b4caa`, 1줄 요약+클릭 상세 팝업: 영향·노출기준·골든타임·위치, 가스 KOSHA/NIOSH 참고값+면책·AED 구동잔여 추정) ④ **생체·설비 그래프 개선**(커밋 `6378f36`, 호버 즉시반응·가스 임계선·AED 배터리≤20% 팝업·체온 추정 체온 병기) ⑤ **태풍 진로 하단 통계 한 줄**(커밋 `387f7f8`) ⑥ **UI 정리**(커밋 `722a92c`, 히어로 카피 3줄 삭제+선택 셀 h-7→h-9+뉴트럴 칩). 발견: Tailwind v3 `colors:var()` opacity 무효 → 리터럴 hex `bg-[#0052ff]/10`. main `ahead 69`, push 보류, working tree clean. 검증: dashboard `tsc` EXIT=0 · 단위 14/14 · CDP 스크린샷. 남은 것: push 결정(69) · 통합 신호등 가스/AED 샘플 sev 데모 조정 여부 · 노출기준/골든타임 표준 검수 · ★ Galaxy Health 권한 · YJH iPhone release 재install · 워치 배터리 풀시프트 · D4 리허설. 발표 마감 **최종 2026-07-07** (중간 데모 2026-06-04 추정) · AWS 는 결제 문제로 보류 · 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> 사용법.
> - `[ ]` 미완료 · `[x]` 완료 · `[~]` 진행 중 · `[!]` 블로커
> - 각 마일스톤 끝에 **검증** 항목을 통과해야 다음 단계 진입
> - 새 작업 추가 시 어느 마일스톤에 속하는지 명시
> - 상세 결정은 [context-notes.md](./context-notes.md) 에 *왜 그렇게 했는지* 와 함께 기록
>
> **트랙 분리** — 현 시점 작업은 **프로토타입 D0~D4** 트랙. 발표 후 로드맵 (M0~M9) 은 본 문서 후반부에 격하 보관.

---

## 진행 스냅샷 (2026-05-29)

- **지금까지 작업**. 2026-05-27 까지의 모든 항목 (D0 완료 + D1 앱 골격 + Cloudflare Tunnel + 옵션 C + 메타데이터 + 색상 블링크 + 신호등 + 시그널 바 + 누적 차트 + iOS keepalive + SOS 모달 + SMS + 보호자/GPS + 5칸 슬롯 + 대기 큐 UX + WeatherStrip 10항목 + 기상 정책 + 테스트 워커 차단 + IDE Run 금지 + Galaxy install + Health 권한 4단계 진단). **2026-05-28** (관제 웹 대폭 확장 8건): (a) **다크/라이트 모드** — Tailwind dark variant + ThemeProvider + 6 컴포넌트 + weather-rules.ts 색 마이그레이션 + 헤더 ☀/🌙 (b) **실시간 미수신 차트 비활성화** — `hasLiveMetric()` → placeholder (자체 웨어러블 부각) (c) **SQLite DB 영속화** — better-sqlite3, `.runtime/safetymonitor.db`, "DB 영속 N건 누적" 라벨 (d) **관리자 메뉴 + CSV/XLSX 내보내기** — Basic auth + 위험도 미리보기 (이상 row 빨강) + CSV (status 4컬럼, 순서 id/received_at) + XLSX (exceljs, 셀 색 + 시트2 현장환경) (e) **weather_log 이력화** — 현장환경 5분 주기 DB 저장 (f) **★ 온도 위험도 offset 0.5** — 정상 손목 36.5℃ 위험 오판 fix (wristToCoreOffsetC 1.5→0.5), analyzers test 재작성 10/10 (g) **★ worker-phone 자동 재연결 3계층** — connectivity_plus + WidgetsBindingObserver (resume/online/재시작 자동) + 수집 정지 토글 (h) **git init + baseline `458e16f`** (147파일). **cloudflared 재기동** → 새 URL `creating-availability-stuck-craps` (이전 URL 자정 만료).
- **현재 상태**. D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행. **[세션2 2026-05-28]** SE 시연 fallback 제거(측정값만 전송) · 스트레스 P0/P1-lite · iOS 잠금 한계 진단 + keepalive/sticky 복원. **[세션3]** 네이티브 iOS 재작성 기각, watchOS `HKWorkoutSession` PoC 구현. **[세션4 2026-05-29]** 워치 §4 잠금 검증 PASS. **[세션5 2026-05-29] 관제 웹 브랜딩/레이아웃**: Apple 스타일 시도 후 복구, Coinbase/VitAlGuard 방향으로 전환, CI 라이트/다크 로고 적용, 현장정보/수신요약/WeatherStrip 레이아웃 비율 조정, 관리자 메뉴에서 현장정보 수정 가능, 서버 DB 일 1회 snapshot 저장 및 XLSX/CSV 포함, 현장환경 업데이트 시각 표시, 히어로 문구 최종안 `OPEN SAFETY · NEVER ALONE` 적용. 검증은 dashboard typecheck + dev 200. **[세션5 워치 PoC]** 센서 확장(낙상 `FallDetector` Core Motion + SpO₂ `SpO2Reader` anchored)·인앱 설정 동적화(수신 URL/작업자 편집, 재빌드 불필요)·스트레스 입력 7종 수집(`StressInputsReader`, 서버 `computeStressIndex` 재사용)·UI 파스텔 카드 개편(심박/SpO₂/낙상)·앱 아이콘(VitAIGuard) 스캐폴드. 커밋 `b04e0f8`/`4171541`/`6821b4e`/`3fec4f6`/`1b0c5f1` + 아이콘·헤더 로고 `65e13bf`. 손목온도 35.7℃=폰(EMP-6861) 수면값 재전송(실시간 아님, 워치는 "--" 정상). cloudflared 회전 `enjoyed-keeps-framed-evaluation`. 팀 LAN 뷰잉 `192.168.219.236:3000`. **★ 실기기 재설치 완료 + 실측 검증(store age 1s)** — EMP-9001 신규 빌드: SpO₂ 92·안정심박 100·활동에너지 3.56·낙상 accelG 5.45·배터리 70·작업자명 장우진 수신 → 센서/스트레스 입력/인앱 설정 전부 실기기 동작 확인. **[세션6 2026-05-29]** 워치↔폰 연동 = **경로 A(같은 사원번호 → `latestByWorker` 병합)** 채택(WCSession 직접 연동은 독립 워치앱/다른 번들이라 불가). 보호자 = **폰만 입력(a)** + 실측 PASS(store sticky 라 워치 발 데이터에도 폰 보호자 유지). **2→1 병합 실기기 확인** — 워치 EMP-9001→EMP-1234 변경 시 EMP-1234 에 워치 발 배터리/가속도 인입(병합 성공), 옛 EMP-9001 카드는 슬롯 등록 잔존이라 "해제" 1회 필요. Android 잠금 송신 가능 확인(CE 저장소). 상용화 플랫폼 분기 계획(확정 아님) 기록 `b584e9d`. 폰+워치 EMP-1234 병합 수신 중, 보호자() 폰 입력→대시보드 공유. 미커밋 = `DemoDashboard.tsx` 히어로 카피(사용자 IDE), 로컬 main 19 커밋 미push. **[세션7 2026-05-29]** 다른 작업자(YJH) Apple Watch 추가 설치 시도 → Apple Developer team `F2P5ZFP65Q` 디바이스 한도 벽(`DataGatheringNSURLSessionDelegate` HTTP 403, Cyён iPhone 차단과 동일 원인). 워치는 단독 USB 불가·페어 iPhone 통해서만 Xcode 등장. 무료 팀 유지 시 발표 워치 시연 = BECKS Ultra 1대. 코드 변경 없음. **[세션8 2026-05-29] 워치 배터리 절감 A+B+C** — 실측 Ultra 1 ~10.7%/hr(워크아웃 세션 연속 HR 이 지배·불가피). 적용: A 송신 30초 배칭(라디오 기상 ~1/6, 서버 배열 수신 하위호환) · B 가속도 50→25Hz · C 불필요 수집타입 disable(HR·활동에너지 유지). 검증 = 시뮬 빌드/tsc/POST + BECKS Ultra Release **재설치 완료**. §4 잠금 재검증(ts기준 gap·null HR 0%·소모율 비교)은 실기기 사용자 몫. **미커밋**. 시연 트레이드오프 = 신호바 4↔1 진동(절충 시 flushInterval 15초). **[세션9 2026-05-30] 연결 복구 + 관제 웹 UI 대규모 개편** — cloudflared 만료(HTTP 000) → 재기동 새 URL `amber-manufacturer-icq-ion`(GET 200/POST 202), 워치 PoC 기본 URL 코드 갱신(WCSession 동기화 불가 확정 — 별개 번들). 관제 웹 5파일(`DemoDashboard.tsx`/`WeatherStrip.tsx`/`globals.css`/`route.ts`/`store.ts`): **카드별 DB 누적 카운트** + **상단 영역 높이 압축** + **현장환경 녹색 LCD 전광판 티커**(KRX식 한 줄 연속 마퀴) + **공정률+무사고 RGB 게이지**(우상단 2단, 0~100% 그라데이션 바, 2줄 레이아웃·바 안 D-day) + **작업자 카드 무한 슬라이딩 캐러셀**(한 방향 rAF 루프+2벌 복제 seamless, `overflow-x-scroll` 하단 수동 스크롤바, 이상 자동복귀+빨강 링, 카드 폭 230px, 빈 슬롯 항상 1개 `displaySlots`, SLOT_COUNT 12) + **가상 작업자 6명**(VW-001~006, VW-004 주의/VW-005 위험=자동복귀 시연용, 클라이언트 전용). **SOS 대응 강화**: 앰뷸런스 사이렌(Web Audio 합성 구급차 wail, 모달 동기) + autoplay 해결("SOS 경보음 활성화" 배너+audioArmed 게이트, 실기기 검증) + 보호자/119 연락 시 무사고 카운터 초기화(localStorage, max(착수일,사고시각) 재집계). 검증 tsc/dev200/POST 201·202/실기기 SOS. **세션9 일괄 4커밋(main, push 보류)** `9ccbe97`/`7723899`/`046603c`/`800a903`, working tree clean.
- **다음 할 일**. (0) **★ 워치 배터리 §4 재검증(세션8)** — 15분 잠금 후 `ts`기준 gap ~5초·null HR 0%·소모율 vs 10.7%/hr → 통과 시 커밋·push, 필요 시 flushInterval 30→15초 (1) **★ Galaxy Health Connect 권한** — 데이터 타입별 토글 + Samsung Health 동기화 (2) **2 iPhone(YJH/BECKS) 최신 release 재install** — 자동재연결·offset 0.5·스트레스 수집·UI 리디자인 반영 (3) **워치 배터리 풀시프트 측정** — 워크아웃 세션 8h 소모 (4) **관제 웹 D4 최종 QA** — 라이트/다크 로고·현장정보 저장·레이아웃 모바일/데스크톱 확인, 관리자 로그인/내보내기 회귀 (5) **스트레스 baseline 축적**(07-07) (6) D2 자동 트리거 (7) D4 폴리싱·리허설. **[세션5 워치 후속]** ✅ 앱 아이콘 적용(`65e13bf`) · ✅ **워치 재설치 완료 + 실측 검증**(EMP-9001 SpO₂/스트레스/낙상/배터리 수신). (8) **손목온도 freshness 필터 결정** — 폰 omit vs 대시보드 표시 필터 (9) 워치 PoC push 여부. **[세션6 후속]** (10) **EMP-9001 stale 카드 "해제"** — 워치 사원번호 통합 후 옛 카드 정리(또는 dev 재시작) (11) **겹치는 메트릭(심박/SpO₂/배터리) last-writer-wins 정리 여부** — 깔끔한 단일 소스 원하면 병합 우선순위 규칙(워치 vitals 우선) 검토 (12) **push 여부 결정** — 로컬 main 19 커밋 미push. **[세션7 후속]** (13) **워치 추가 설치 경로 결정** — 무료 팀 디바이스 한도(DataGathering 403)라 (a) 콘솔 디바이스 정리(연 1회 reset) / (b) 다른 Apple ID 팀 교체(기존 재서명 부담) / (c) 유료 Developer Program($99) 중 택1, 또는 워치 1대(BECKS Ultra) 시연 확정. **[세션9 후속]** (14) **세션9 관제 웹 UI 커밋 여부** — 5파일 미커밋(§4 재검증 후 일괄), 가상워커/캐러셀/전광판/게이지 데모 점검 (15) **3 폰 in-app URL = `amber-manufacturer-icq-ion`** 갱신(BECKS 폰·워치 완료, YJH/Galaxy 보류) (16) **무사고 게이지 실측 연동** — ✅ SOS 후 보호자/119 연락 시 초기화 연동 완료(localStorage). 추가로 낙상/자동 119 연계 시 자동 기록 검토 가능 (17) **push 여부 결정** — 세션9 4커밋 로컬 누적(사용자 보류 중), §4 재검증 후 결정. **[세션23 후속]** (18) **★ KMA `03 NO_DATA` 처리 결정** — [kma.ts:161](../apps/dashboard-web/app/lib/kma.ts#L161) `resultCode!=="00"` 가 정상적 무특보(`03`)도 MOCK_WARNINGS 폴백 → 무특보 날 서울/경기/강원·전남/경남/제주 등록 작업자에 가짜 특보 + 특보영상이 가짜 특보로 실 YouTube 검색. (a) 발표용 폴백 유지 vs (b) `03`=`source:live, warnings:[]` 분리 수정(상용화 정공). 발표일(07-07) 무특보면 6개 지역 false warning (19) **push 결정(90)** — main `ahead 90` origin/main 미push. **[세션24 후속]** (20) **★ 폰 3대 인앱 수신 URL 갱신** — `cheers-entire-glass-editorial.trycloudflare.com/api/mock/vital`(BECKS/YJH/Galaxy 각 ⚙️ 수동, 워치는 재설치 시 스탬프 자동·또는 인앱 편집) (21) **실 태풍 발효 시 레이더 자동 가동 확인** — 태풍 서비스 승인 + 실 태풍 발효 시 `source:live`→ 한국/현장 GPS 게이트로 지도 가동되는지(목업 비캐시라 재배포 0) (22) **push 결정(94)**. **[세션25 후속]** (23) **★ 미커밋 커밋** — 로그인/헤더 디자인(`LoginScreen`·`DemoDashboard`·`layout`·`LoginShaderBackground` 신규·`package.json`·`pnpm-lock`) + URL-sync(`CLAUDE.md`·`ConnectionSettings.swift`)를 논리 단위로 분리 커밋 (24) **폰 3대 인앱 수신 URL 갱신** — `sends-paintball-often-carolina.trycloudflare.com/api/mock/vital` (25) **★ 고정 URL 방식 결정** — Cloudflare named tunnel(도메인 필요)/ngrok static/Tailscale Funnel 중 택1(모두 Mac on 전제, Mac 무관 24/7은 발표 후 클라우드 배포=SQLite→관리형 DB) (26) **폰트 오프라인 결정** — 현재 Google Fonts `<link>`(런타임 CDN 의존), 오프라인 보장 필요 시 next/font 셀프호스트 전환 (27) **push 결정(96+)** — main `ahead 96`. **[세션26 후속]** (28) **★ push 결정(101)** — main `ahead 101`(세션26 5커밋 `f3baadd`·`1787e5c`·`35844ef`·`62f0913`·`a3e8575`) origin/main 미push (29) **루트 stray 정리 + .gitignore** — 루트 `mainpic.jpg`(`public/brand/mainpic.jpg` 사본 있음)·`dashboard-full.png` 삭제 여부 + `.claude/skills/` gitignore 추가 결정 (30) **폰 3대 인앱 수신 URL 갱신** — `sends-paintball-often-carolina.trycloudflare.com/api/mock/vital`(세션25와 동일, 미반영) (31) **데모 현장 5곳 실데이터화(선택)** — 현재 가상(회사/주소/공기 임의), 실제 현장명으로 교체 시 [LoginSiteSelect.tsx](../apps/dashboard-web/app/components/LoginSiteSelect.tsx) `DEMO_SITES`만 수정 (32) **구글 로그인 실연동(발표 후)** — 현재 "준비중" 안내 플레이스홀더, 실 OAuth는 클라이언트 자격증명+백엔드 콜백 필요. **[세션27 후속]** (33) **★ push 결정(107)** — main `ahead 107`(세션27 6커밋 `eb242c1`·`afec68e`·`08951a4`·`cbc7205`·`c59aaa5`·`1c08b97`) origin/main 미push (34) **폰 3대 인앱 수신 URL 갱신** — `sends-paintball-often-carolina.trycloudflare.com/api/mock/vital`(세션25/26과 동일, 미반영) (35) **★ 비전 PoC = GoPro 장비 준비 시 착수** — HERO9+USB-C 케이블+microSD 확보 후 [vision-ppe-plan.md](./vision-ppe-plan.md) 체크리스트(스캐폴드→사전학습 hardhat 모델→`/api/vision-event` 통합). 발표 데모=로컬 CPU 실시간·macOS GoPro Webcam→OBS 가상캠→OpenCV(폴백 녹화). **보류**: P2(EMA/경보) · P3(LSTM) · Cyён 폰 / AWS.

---

# 프로토타입 트랙 (D0~D4) — 발표용 데모

## D0 — 셋업

### 개인 환경
- [x] Xcode 26.5 설치 확인 (iOS 시뮬레이터·빌드용. watchOS App 미작성)
- [x] iOS 시뮬레이터 가용 확인 (Flutter `flutter run -d "iPhone"` 대상)
- [~] Apple Developer 계정 — 사용자 확인 필요 (없으면 시뮬레이터·무료 provisioning 으로 진행)
- [x] Node.js v26.0.0 + pnpm 11.1.3 설치
- [x] AWS CLI 2.34.51 + CDK 2.1124.1 설치. `aws configure --profile dev` 는 AWS 계정 발급 후 별도
- [x] **Flutter SDK 3.44.0 설치** (Dart 3.12.0)
- [x] CocoaPods 1.16.2 설치 (iOS 플러그인 빌드용)
- [x] **Android Studio + Android SDK + JDK 17** — Android Studio 2025.3.4.7 · SDK 36.0.0 · JDK 17.0.19. `flutter doctor -v` Android toolchain OK
- [~] Android 에뮬레이터 — `SafetyMonitor_API_35` (Pixel 8 · Android 15 / API 35 · Google APIs arm64-v8a). `flutter emulators` 인식 확인. Android Studio 실행 시 메모리 부족 경고 발생 → Device Manager 에서 RAM 1024~1536MB 조정 필요
- [~] Galaxy Watch + Galaxy phone 실기기 준비 완료 — Galaxy phone 에 worker_phone install 성공 (2026-05-27, 김동현/EMP-2222). **Health 권한 "대기" 블로커** — Health Connect 4단계 검증 절차 (앱 설치 → 데이터 타입별 권한 → Samsung Health 동기화 → Watch 인입) 진행 예정
- [x] iPhone + Apple Watch 실기기 준비 완료 — HealthKit 권한 허용, HR/SpO₂/손목 온도 수집 및 local/mock receiver 전송 확인

### 모노레포 골격 (최소)
- [x] `pnpm init` + 워크스페이스 (`pnpm-workspace.yaml`)
- [x] `.gitignore` (Node·iOS·AWS CDK + **Flutter/Dart**)
- [x] **`apps/worker-phone/`** — Flutter 폰 앱 (`kr.indusview.workerPhone`, iOS + Android). `main.dart` SafetyMonitor placeholder + `widget_test.dart` 1건
- [x] `apps/dashboard-web/` — Next.js 15 + Tailwind (빈 페이지 200 OK)
- [x] `backend/infrastructure/` — AWS CDK (`IotStack` 1개. DDB `VitalStream` + IoT Thing)
- [x] `packages/analyzers/` — 위험 감지 3종 (낙상·심박이상·SOS). 단위 테스트 5/5 통과
- [x] `packages/schemas/` — `Worker` · `VitalStream` · `HazardEvent` 3개 (Zod)

### 클라우드 최소
- [!] AWS dev 계정 (개인 계정 가능). MFA + 결제 알람 ($10) 설정 — 결제 문제로 우선 보류
- [x] Region `ap-northeast-2` (CDK 앱에 고정)

### 검증 (D1 진입 조건)
- [x] `pnpm install && pnpm -r typecheck` 통과 (4 패키지)
- [x] `pnpm --filter @safetymonitor/dashboard-web build` 통과 (4 페이지 prerender)
- [x] `pnpm --filter @safetymonitor/analyzers test` 5/5 통과
- [x] `cdk synth` 통과 (CloudFormation 템플릿 생성)
- [x] Next.js `pnpm dev:web` 로 빈 페이지 표시 성공 (HTTP 200 + 한국어 텍스트 렌더)
- [x] `flutter doctor` 점검 — iOS toolchain OK · Android toolchain OK (SDK 36.0.0, JDK 17.0.19, licenses accepted) · Chrome · Connected device OK
- [x] `flutter test` 위젯 테스트 1/1 통과
- [x] `flutter build ios --simulator` 빌드 성공 (health 추가 후 재검증, `build/ios/iphonesimulator/Runner.app`)
- [ ] iOS 시뮬레이터에서 `flutter run` 빈 화면 표시 성공 — *선택 (빌드 성공으로 D1 진입에 충분, 시뮬레이터 실행은 사용자가 직접 확인 권장)*

---

## D1 — Flutter 폰 앱 → 백엔드 publish (iOS + Android 둘 다)

### `apps/worker-phone` (Flutter — iOS + Android 둘 다 실기기 시연)
- [x] `health` 패키지 통합 — iOS HealthKit HR · SpO₂ · 손목 온도 권한 요청 + read 확인. Android Health Connect 는 Galaxy 실기기 검증 남음
- [x] iOS HealthKit 권한 — `Runner.entitlements` + HealthKit capability 적용 후 권한 허용 확인
- [x] 5초 간격 폴링 (`Timer.periodic`) 골격
- [x] **Health 단계별 try-catch** — `health_vitals_service.dart` 의 `latestValue` 가 개별 type 실패해도 null 반환 → 다른 메트릭은 계속 수집
- [x] **Health 빈값 시 시연용 fallback** — `_pollOnce` 에서 hr/spo2/skinTempC 모두 null 이면 `hr≈72±, spo2=97, temp=36.5` 전송 + "Health 데이터 없음 — 시연용 값 전송" 메시지
- [~] `mqtt_client` 패키지로 AWS IoT MQTT publish — mTLS publish 서비스 골격. 실제 endpoint/cert 는 AWS 보류 해제 후 연결
- [~] 디바이스 인증서 — iOS keychain (`flutter_secure_storage`) · Android keystore 동일 패키지. secure storage key 구조 추가
- [x] HTTP POST fallback (백업) — `MOCK_RECEIVER_URL` dart-define 로 local/mock receiver 전송 가능 + **in-app TextField 로 동적 입력 + secure storage 영속화**. LAN IP 변동 시 재빌드 없이 URL 교체 가능
- [x] **http.post timeout 4s** — `vital_publisher.dart` 에 `.timeout(Duration(seconds: 4))` + `TimeoutException → HttpException("타임아웃 (4s) — LAN 도달 실패")`. publish hang 방지
- [x] 메인 화면 — 현재 HR · SpO₂ · 손목 온도 표시 + 연결 상태 (단계별 명확 메시지) + 디바이스 ID + 수신 서버 URL 입력 카드 + 큰 SOS 버튼
- [x] **iPhone 실기기 release 빌드 install** — debug 빌드는 iOS 14+ standalone launch 불가 (`Cannot create a FlutterEngine instance in debug mode`) → release 빌드 + Apple Development sign + Apple Development 신뢰 + devicectl 으로 standalone launch 검증
- [x] **iPhone codesigned release 빌드 + devicectl install/launch** — Automatic signing (`F2P5ZFP65Q`) 17.4MB. `xcrun devicectl device install app + process launch --terminate-existing kr.indusview.workerPhone` 한 번에 성공
- [x] **★ iPhone 설정 화면 (`SettingsPage`)** — 우상단 ⚙️ → 작업자 이름 + 사원번호 TextField + secure storage 영속화 (`worker_name` / `employee_id` 키). 폴링/SOS payload 마다 자동 동봉. 상태 패널 작업자/사원번호 row + 메인 "작업자" 카드에 `이름 (사원번호)` 표시

### AWS 보류 중 local/mock receiver + Cloudflare Tunnel 우회
- [x] Next.js API route — `POST /api/mock/vital` 로 vital sample 수신 + memory store 저장
- [x] **Next.js API route 추가** — `GET /api/mock/history?workerId=&metric=&days=7|30|60` deterministic mock generator (workerId × metric × day hash). 누적 차트 패널 backend
- [x] Next.js dashboard — 4 worker grid + 최근 샘플 테이블 polling 표시. HR/SpO₂/Temp 최신 non-null 값을 유지하고 새 생체값 수신 시 갱신
- [x] **대시보드 UI 강화** — 한국어 라벨 (`심박/산소포화도/체온`) + 단위 (`bpm/%/℃`) + 체온 소수점 1자리 + 산소포화도 라벨 한 줄 표시 + SafetyMonitor 로고 (방패+ECG SVG) + 헤더 그라데이션 + 최근 수신 샘플 펼침/줄이기 토글
- [x] **카드 메트릭 클릭 → 누적 차트 패널** — 24시간/1주일/30일/60일 토글 + 평균/최저/최고 통계 + 의존성 0 인라인 SVG 라인 차트 (gradient fill + grid + tick + hover title). 24시간 모드는 hourly 24 포인트 (`HH:00` label)
- [x] **★ 작업자 메타데이터 매칭** — VitalSampleSchema 에 `workerName` / `employeeId` optional (max 40자). `latestByWorker` 가 메타데이터 누적 merge. 카드 헤더 + 차트 패널 헤더 + recent table 모두 `이름 + 사원번호` 표시 (사원번호 라벨 명시)
- [x] **★ 옵션 C — 손목 온도 vs 체온 dual + 추정 알고리즘** — `THRESHOLDS.coreTemp` (cautionC 37.5 / dangerC 38.0 / wristToCoreOffsetC 1.5) + `estimateCoreTempC(skin) = skin + 1.5` export. `detectHyperthermia` 추정 체온 기준 + detail 에 `skinTempC + estimatedCoreTempC`. hazard-event schema `estimatedCoreTempC` 필드. dashboard `@safetymonitor/analyzers` 의존성 + `TempDualRow` (손목 + 추정 dual) + `statusFor` 추정 기준 + recent table "손목 온도 / 체온 추정" 분리 + history panel `skinTempC` 라벨 "체온"→"손목 온도". analyzers test 10/10 통과 (새 시나리오)
- [x] **카드 메트릭 2열 × 3행 list 레이아웃** — `flex flex-col` 세로 stack, 각 row `grid grid-cols-[5.5rem_1fr] items-baseline` (라벨 좌 / 값 우 `tabular-nums`)
- [x] **★ 메트릭 값 색상 블링크 (메트릭별 독립)** — `heartRateStatus` / `spo2Status` / `coreTempStatus` + `STATUS_CLASS` 매핑. **정상 emerald 정적** (블링크 X) / 주의 amber 1.1s / 위험 red 0.55s. 심박 caution 110~129, 41~50 (의료 reference)
- [x] **블링크 키프레임 fix — `app/globals.css` `@keyframes vital-blink`** — Tailwind arbitrary `[animation:pulse_...]` JIT 미인식으로 dead. opacity 1→0.15→1 강한 블링크 + `.vital-blink-caution` (1.1s) / `.vital-blink-danger` (0.55s) 직접 정의
- [x] **카드 색 통일 + `overallStatus` + 신호등** — `statusFor` 폐기. 4 카드 모두 plain `CARD_CLASSNAME = border-white/10 bg-[#0d1117]`. `overallStatus(sample)` = worst-of(heartRate/spo2/coreTemp). `TrafficLight` (12px 원 + ring-1 ring-white/20) 작업자 이름 좌측 + 정상 정적 녹 / 주의·위험 블링크. 우측 텍스트 배지 `STATUS_LABEL[overall]` 유지
- [x] **★ 폰↔대시보드 시그널 바 (`SignalBars`)** — `signalLevel(sample, now)` freshness 기반 0~4 (<8s=4 / <15s=3 / <30s=2 / <60s=1 / ≥60s=0). 4 막대 (5~11px 계단) + 4-3 emerald / 2 amber / 1 red / 0 zinc. 1초 단위 `now` state 갱신 (`useEffect setInterval(1000)`). 작업자 이름 **오른쪽** 배치
- [x] **★ 누적 차트 패널 — 차트 타입 토글 + 메트릭 칩 + summary 강화** — `VitalHistoryPanel` 헤더 우상단 `📈 라인 / 📊 막대` 토글 (`chartType` state) + 헤더 좌측 메트릭 칩 3개 (`onMetricChange` 콜백으로 부모 selection 전환) + summary 박스 `text-2xl` + 메트릭 색상 + `BarChart` 컴포넌트 신규 + `useChartScale` 헬퍼 공유 (라인↔막대 동일 y축)
- [x] mock publish 스크립트 — `pnpm mock:publish` (`--once` 지원). 정상/주의/위험 샘플 4명 5초 간격 publish
- [x] 검증 — `node scripts/mock-publish.mjs --once` → `GET /api/mock/vital` 에 4개 worker latest/recent 표시
- [x] **dev 서버 stale chunk 500 fix** — `pnpm build` 부작용으로 `.next/` production artifact 가 dev 와 충돌 → `rm -rf .next` + 재시작
- [x] **라우트 파일명 충돌 fix** — `app/api/mock/history.ts` vs `app/api/mock/history/` 동일 이름 → `app/api/mock/history/data.ts` 로 이동
- [x] **★ Cloudflare Tunnel 도입** — 라우터 client isolation 으로 LAN 직접 도달 불가 (`ping 192.168.219.114` 100% loss). `brew install cloudflared` + `cloudflared tunnel --url http://localhost:3000` → 무작위 `https://*.trycloudflare.com` 발급. GET 200 + POST 201 검증. (세션마다 새 URL — 현재 `templates-chronicle-external-interfaces.trycloudflare.com`)
- [x] **★ iOS 백그라운드/잠금 keepalive (location 백그라운드 모드)** — `geolocator: ^14.0.1` + Info.plist `UIBackgroundModes=[location, fetch]` + `NSLocationAlwaysAndWhenInUseUsageDescription`. 신규 `BackgroundKeepalive` 서비스 (medium accuracy + 50m filter + 초기 1회 즉시 캡처 + `lastPosition` 노출). `_startPolling` → `_keepalive.start()`. 폰 잠금/홈 진입에도 5초 폴링 유지.
- [x] **★ 5명 워커 grid + 카드 6 row 통일 정렬** — `fallbackWorkers` 5명 (`demo_mock_03`) + `xl:grid-cols-5` + `max-w-[1600px]`. 6 row 순서 `상태/심박/SpO₂/환경산소/손목/낙상`. `ROW_CLASS min-h-[3.25rem]` 모든 row 통일. 상태 배지 `whitespace-nowrap`. 카드 헤더 `min-h-[4.5rem]` + 사원번호 미설정 placeholder
- [x] **환경 산소 row + 작업자 상태 row + 낙상 감지 row** — `ambientO2Pct` 스키마 + Phase 1 `N/A · Phase 2` 회색 placeholder. `WorkerStatusRow` 우선순위 `낙상 > SOS > 위험 > 주의 > 정상 > 대기`. `FallDetectionRow` 5분 recency 빨강 블링크
- [x] **낙상 metric 누적 차트** — `VitalHistoryPanel` 에 `"fall"` 칩 (노랑) + `BarChart` 강제 + `summarizeCount` (총건수/최대/평균). `buildHistory` fall sparse count (24h ~2건, 60d ~4건). 폰 하단 `[수집 시작] [낙상 시연] [SOS]` 3-버튼
- [x] **★ SOS 모달 팝업 + SMS 자동 작성** — 신규 `SosAlertModal.tsx`. 헤더 (블링크 원) + 작업자 + 소속 회사 (스마트인재개발원) + 생체 임계 색상 + 현장 GPS Google Maps 링크 + 보호자 연락처 + 119 신고 (빨강 강조). `buildSmsBody(audience)` — `sms:?body=` 인코딩, 회사/GPS/생체/조치 본문, 보호자/119 별 톤 다름
- [x] **보호자/GPS payload 동봉 (폰)** — Settings 페이지에 보호자 이름·전화 필드 + secure storage. `_extraMeta()` 헬퍼가 모든 sample 생성부 (`_pollOnce / _sendSos / _sendFall`) 에 보호자 + lat/lon 자동 동봉. 스키마 `guardianName/guardianPhone/latitude/longitude` optional 추가
- [x] **store 이벤트 비-sticky fix** — `latestByWorker` spread merge 로 `manualSos/fallDetected` 영구 sticky 되던 버그. 두 필드 sample 자기 값만 사용. dashboard `data.recent` 스캔으로 `lastSosByWorker / lastFallByWorker` 별도 계산
- [x] **★ 환경 산소 row 제거 (2026-05-25)** — 사용자 결정 (Phase 2 자체 워치 합류 전까지 placeholder 의미 약함). `AmbientO2Row` 컴포넌트 + store merge `ambientO2Pct` + Zod 필드 모두 삭제. 카드 6 row → 5 row (상태/심박/SpO₂/손목/낙상). 폰은 원래 안 보내고 있어 변경 없음. typecheck/analyzers/POST 검증 통과
- [x] **★ 다중 작업자 분리 버그 fix (2026-05-25)** — 폰 측 `_workerId` 빌드 상수 (`demo_ios_01`) 라서 모든 iPhone 이 동일 ID. `_effectiveWorkerId` getter (사원번호 입력 시 자동 workerId). `_pollOnce` 1차+fallback / `_sendSos` / `_sendFall` 4 곳 교체. dashboard 측 `fallbackWorkers` 5 → mock 3개만 (`demo_mock_01/02/03`) + `slice(0, 5)` 제거 + 실폰 sort by ts 우선 union
- [x] **★ YJH iPhone 15 Pro Max 추가 install (2026-05-25)** — Xcode 직접 빌드 SPM 헤더 4 issue → flutter CLI 표준 (clean + pub get + pod install + build ios --release) → 17.6MB AOT codesigned → devicectl install + launch 성공. **Xcode 직접 빌드 영구 금지** 정책 확립
- [x] **★ Cyён 의 iPhone 16 install 시도 (2026-05-26 오전)** — 3번째 시연 폰 후보. install 중 `devicectl launch` hang → 사용자 IDE Run ▶ 버튼 누름 → debug 빌드 덮어쓰기 → standalone launch 거부 다이얼로그. flutter clean 사이클로 복구 + devicectl install + launch 성공. **IDE Run 버튼 영구 금지** 정책 추가. devicectl id `98310275-…`, hardware UDID `00008140-…`, iOS 26.4.2
- [!] **★ Cyён iPhone 16 재install 차단 (2026-05-26 오후)** — `flutter run` 출력 `Communication with Apple failed: Your development team has reached the maximum number of registered iPhone devices` + `Provisioning profile "iOS Team Provisioning Profile: kr.indusview.workerPhone" doesn't include the currently selected device "TG i_n" (00008101-001649983AB9003A)`. 원인 = Apple Developer team `F2P5ZFP65Q` 디바이스 한도 도달 (연 100대, 1년 1회 reset). 추가로 `in debug mode` 출력 = IDE Run 버튼 정책 위반 3회차. **블로커 해결 옵션**: A) Apple 콘솔 device 정리 (유료 계정, annual reset 제약) B) 다른 Apple ID 로 team 교체 (BECKS/YJH 재install 부담) C) Cyён 폰 install 포기, Galaxy 실기기로 대체 ← **채택**
- [x] **★ 발표 폰 구성 변경 (2026-05-26 오후)** — iPhone 3대 → **iPhone 2대 + Galaxy 1대**. Android 측 device 수 제약 없음 (debug.keystore 자동 + debug APK standalone 실행 OK + `adb install` unlimited)
- [x] **★ 인프라 안정화 — nohup+disown (2026-05-26)** — 이전 백그라운드 task 가 셸 종료 영향으로 stopped 되던 문제 해소. dev + cloudflared `nohup ... & disown` 으로 부모 셸 lifecycle 분리. 새 URL `https://prisoners-hosting-shape-assists.trycloudflare.com`
- [x] **★ Galaxy 실기기 worker_phone install 성공 (2026-05-27)** — Cyён iPhone 대체 3번째 폰. Flutter 앱 install + UI 정상 (메트릭 4 타일 + 상태 패널 + URL 입력 + 3-버튼 row) + 작업자 메타데이터 입력 (김동현 / EMP-2222) + in-app URL `https://prisoners-hosting-shape-assists.trycloudflare.com/api/mock/vital` 저장 완료
- [!] **★ Galaxy Health 권한 "대기" 블로커 (2026-05-27)** — 앱 권한 화면 "건강, 피트니스, 웰니스" 허용됨이나 `requestAuthorization` false 반환. 원인 = Health Connect 우산 권한 ≠ 데이터 타입별 권한. **4단계 검증 절차 진행 예정**: Step 1 Health Connect 앱 설치 확인 → Step 2 worker_phone 의 HR/SpO₂/체온 각각 토글 ON → Step 3 Samsung Health → Health Connect 동기화 ON → Step 4 Galaxy Watch 페어링 + Samsung Health 측정값 인입 확인 → 앱 강제 종료 + 재시작 + "수집 시작"
- [x] **★ active cloudflared URL 확정 (2026-05-27)** — `https://prisoners-hosting-shape-assists.trycloudflare.com`. status.anthropic.com `All Systems Operational` + cloudflared PID 15791 + dev:web PID 15705 + `.runtime/cloudflared.log tail` 로 검증. Galaxy 폰에 이미 동일 URL 저장됨
- [x] **★ AndroidManifest health 권한 선언 검증 (2026-05-27)** — [AndroidManifest.xml:4-6](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L4-L6) `READ_HEART_RATE/READ_OXYGEN_SATURATION/READ_BODY_TEMPERATURE` 3종 + [queries:60-69](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L60-L69) `com.google.android.apps.healthdata` + `ACTION_SHOW_PERMISSIONS_RATIONALE` intent + [activity-alias:39-48](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L39-L48) `HEALTH_PERMISSIONS` 카테고리. [health_vitals_service.dart:18-23](../apps/worker-phone/lib/services/health_vitals_service.dart#L18-L23) Android `SLEEP_WRIST_TEMPERATURE` 제외 분기 + `BODY_TEMPERATURE` 폴백 정상. **코드 결함 없음** — 원인은 Health Connect 앱 내부 권한 / 데이터 소스
- [x] **★ worker-phone 자동 재연결 3계층 (2026-05-28)** — `connectivity_plus` + `WidgetsBindingObserver`. (1) 백그라운드→포그라운드 resume 시 Timer 죽었으면 재가동 + 즉시 폴링 (2) 네트워크 offline→online 전이 즉시 `_pollOnce` (3) `auto_polling` secure storage 영속 → 앱 강제 종료/재부팅 후 자동 `_startPolling`. "수집 시작"↔"수집 정지" 토글 버튼 신규. `flutter analyze` clean
- [x] **★ cloudflared 재기동 — 새 URL (2026-05-28)** — 이전 `prisoners-hosting-shape-assists` 가 자정 (2026-05-27T23:58Z) 무렵 만료 → retry loop. 재기동 → `https://creating-availability-stuck-craps.trycloudflare.com` (smoke 202)
- [ ] **사용자 액션 (2026-05-29 갱신)** — (a) **★ Galaxy Health Connect 권한 활성화** (현재 블로커): 최우선 추정 = Step 2 데이터 타입별 권한. Health Connect → 앱 권한 → worker_phone → 심박수/산소포화도/체온 각각 토글 ON + Samsung Health → 설정 → Health Connect → 동기화 ON → 앱 강제 종료 → 재시작 → "수집 시작" → "Health 권한 필요" 가 "5초 폴링 중" 으로 바뀌는지. 실패 시 `adb logcat -s flutter:V HealthConnectKit:V | grep -iE 'health|permission'` (b) **폰/워치 endpoint 최신 URL 통일** — 우상단 ⚙️ 또는 워치 설정에서 현재 cloudflared URL 저장, 위치 권한 "항상 허용" (c) **★ 2 iPhone 재빌드/재install** — 자동 재연결 + offset 0.5 변경분 반영. `flutter build ios --release --dart-define=MOCK_RECEIVER_URL=<새 URL>/api/mock/vital` + devicectl. Galaxy 도 `flutter build apk --debug` + `adb install` (d) **자동 재연결 시연 검증** — 비행기 모드 toggle / 백그라운드→복귀 / 강제 종료 후 재시작 자동 수집 (e) **관제 웹 신규 기능** — 라이트/다크 토글 + 히어로 문구(`OPEN SAFETY · NEVER ALONE`) + 관리자 로그인(admin/safety2026) → 현장정보 저장 + 위험도 미리보기 + XLSX/CSV 다운로드 (f) 슬롯 등록 + WeatherStrip 정책 모달 + SOS/낙상 시연

### 백엔드 (AWS IoT + Lambda — 다중 디바이스 대응)
- [ ] `Stack: IotStack` — IoT Thing 최소 2개 (`demo_ios_01` · `demo_and_01`) + 인증서 2장 + Rule 1개
- [ ] DynamoDB `VitalStream` (partition=workerId, sort=ts) — 다중 worker 적재
- [ ] `backend/lambdas/vital-ingest/` — IoT Rule → DDB put
- [x] mock publish 스크립트 — `scripts/mock-publish.mjs` — `demo_ios_01`, `demo_and_01`, `demo_mock_01`, `demo_mock_02` 가상 vital publish (정상/주의/위험 시나리오)

### 검증 (D2 진입 조건)
- [ ] **iOS 실기기 (iPhone + Apple Watch)** 에서 5초 간격 vital 5분간 publish 무중단
- [ ] **Android 실기기 (Galaxy + Galaxy Watch)** 에서 동일 5분간 publish 무중단
- [ ] DynamoDB 에 worker 2명 × 60건 (5초 × 5분) = 120건+ 적재 확인
- [ ] AWS CloudWatch 비용 < $0.5 / 24h 확인
- [~] `flutter build apk --debug --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital` Android 빌드 성공. 에뮬레이터/실기기 install 은 다음 확인
- [ ] Android Studio 에서 `SafetyMonitor_API_35` 실행 — 현재 메모리 부족 경고. RAM 낮추기 또는 실기기 전환 후 확인
- [ ] Android Studio Flutter Run Configuration 에 `--dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital` 추가 후 run 확인

---

## D2 — 백엔드 → 웹 대시보드 실시간 표시

### Next.js 대시보드
- [ ] App Router + Tailwind + shadcn/ui 셋업
- [ ] 작업자 카드 1개 — 이름·HR·상태 색 (정상/주의/위험)
- [ ] 시계열 차트 — 최근 5분 HR (recharts)
- [ ] 갱신 방식 — polling 5초 (단순) 또는 AWS IoT WebSocket (도전적)

### 2026-05-26 신규 — 대시보드 대대적 변경
- [x] **테스트 워커 차단** — `isReservedTestWorker` 가드 (exact `infra_check/warmup/netcheck` + prefix `test_/smoke_/infra_`). `addSample` null 반환, POST handler HTTP 202 `dropped: reserved_test_worker`
- [x] **위치 기반 현장 환경 패널 (`WeatherStrip`, 10 항목)** — `/api/weather` route (Open-Meteo forecast + Air Quality proxy, 5분 메모리 캐시, API key 불필요). 항목: 날씨/기온/체감/습도/PM2.5/풍속/UV/강수량/일출/일몰. 위치 = 등록된 작업자 폰 GPS 좌표 평균 (`fieldCoords` useMemo, 0명이면 placeholder)
- [x] **5칸 슬롯 + 대기 큐 등록 UX** — fallback union + mock 3 폐지. `SlotAssignments = (string|null)[]` 길이 5 + `loadSlots/saveSlots` localStorage (`safetymonitor.slots.v1`) 영속화. 빈 슬롯 `EmptySlotCard` placeholder → 클릭 시 `WorkerQueueModal` (publish 중 미할당 워커 목록) → 작업자 선택 시 그 슬롯에 할당. 등록된 슬롯 우상단 "해제" 버튼. 관리자가 명시 등록한 작업자만 카드 등장 (publish 자동 등장 X)
- [x] **기상 정책 임계 자동 평가 + 클릭 정책 모달** — `weather-rules.ts` (`evaluateApparentTemp` 폭염 31/33/35℃ + 한파 -12/-15/-18℃, `evaluateWindKmh` 10/15 m/s, `evaluatePM25` 36/76/150 μg/㎥, `evaluateUV` 8/11, `evaluatePrecipitation` 1/5/10 mm/h). 정상=zinc / 주의=amber 깜빡임 / 위험=red 빠른 깜빡임 (생체 카드와 동일 `vital-blink` 키프레임 재사용). `WeatherRuleModal` — 현재 측정값 + severity 배지 + 현재 적용 단계 (법적/권고/참고 binding) + 전체 임계 단계 리스트 + 출처 + 운영 주의사항. 정보 항목 (날씨/기온/습도/일출/일몰) 도 클릭 가능 — 안내문만 표시. 19 케이스 sanity check 통과
- [x] **WeatherStrip 텍스트 가독성 개선 (2026-05-26 오후)** — 사용자 스크린샷 빨간 박스 (현장 환경 패널 글씨 어두움) 보고. `VALUE_CLASS.normal` `text-zinc-200` → **`text-white`**. 라벨/sub `text-zinc-500` → `text-zinc-300`. 헤더 "현장 환경" `text-zinc-300` → `text-zinc-100`. GPS 좌표/우측 정보 `text-zinc-500/600` → `text-zinc-400`. 주의/위험 색상 (amber/red 블링크) 은 정책 색이므로 보존. typecheck pass

### 2026-05-28 신규 — 다크모드 + DB 영속화 + 관리자 내보내기
- [x] **다크/라이트 모드 토글** — Tailwind `darkMode: "class"` + `ThemeProvider` (localStorage `safetymonitor.theme.v1`) + `ThemeToggle` (☀/🌙) + `layout.tsx` 사전-hydration 인라인 스크립트 (flash 차단). 6 컴포넌트 + `weather-rules.ts` 다크-only 클래스 ~150곳 light/dark 페어. SVG 차트는 `currentColor`. 다크 기본
- [x] **실시간 미수신 메트릭 차트 비활성화** — `VitalHistoryPanel` `hasLiveData` prop + `hasLiveMetric()` (store 에 실측값 있을 때만 live). 미수신 시 mock history fetch 건너뛰고 "자체 웨어러블 디바이스 연동 시 5종 메트릭 실시간 수집" placeholder (디바이스 차별화 부각)
- [x] **SQLite DB 영속화** — `better-sqlite3` (pnpm-workspace `onlyBuiltDependencies`). `lib/db.ts` — `.runtime/safetymonitor.db` (WAL), `vital_samples` 테이블 (raw_json 감사 trail). `addSample` 이 in-memory ring(500) + DB INSERT 양쪽. GET 응답 + 헤더 라벨 "DB 영속 N건 누적". dev 재시작 후 데이터 보존 검증
- [x] **관리자 메뉴 + CSV/XLSX 내보내기** — `lib/admin-auth.ts` (Basic auth, env `ADMIN_ID`/`ADMIN_PASSWORD` default `admin/safety2026`) + `/api/admin/{login,workers,export,export-xlsx,preview,site-info}` + `AdminExportModal`. 워커/기간 필터 + **위험도 미리보기** (최근 50건, 위험 row 빨강/주의 주황) + **CSV** (UTF-8 BOM + 현장정보 일 1회 snapshot 블록 + status 4컬럼, 순서 `id,received_at,...`) + **XLSX** (`exceljs`, 시트1 현장정보 + 시트2 생체데이터 이상치 셀 색 + 시트3 현장환경 이력)
- [x] **온도 위험도 offset 0.5 수정** — 정상 손목 36.5℃ 가 위험 오판되던 버그. `wristToCoreOffsetC 1.5→0.5` ([thresholds.ts](../packages/analyzers/src/thresholds.ts)). analyzers.test 3 케이스 재작성 (37.6=danger/37.1=caution/36.5=null) 10/10. **`pnpm --filter @safetymonitor/analyzers build` 필수** (dashboard 가 dist/ import)
- [x] **현장환경 weather_log 이력화** — `weather_log` 테이블 + `/api/weather` fresh fetch 시 snapshot 자동 저장 + `WeatherStrip` `&workers=N`. XLSX 시트2 로 export. 작업자 슬롯 등록 시 (GPS 있을 때) 5분 간격 축적

### 데이터 조회 API
- [ ] Next.js API route — `/api/vital/[workerId]/recent` (최근 5분 DDB query)
- [ ] AWS credentials — Vercel env (read-only IAM 사용자)

### 검증 (D3 진입 조건)
- [ ] 단말 publish → 대시보드 표시 지연 5초 이내
- [ ] 차트가 5분간 자연스럽게 흐르는지 (정상 HR 60~80 시뮬레이션)
- [ ] 브라우저 새로고침 시에도 기존 데이터 유지

---

## D3 — 위험 감지 5종 + 대시보드 Alert

### `packages/analyzers` (TS, D0 에서 5종 골격 + 10/10 테스트 통과)
- [x] **낙상** — 가속도 ≥ 3G + 30초 무동작 → danger
- [x] **심박 이상** — resting HR ≥ 130 또는 ≤ 40 → 5초 지속 시 warning
- [x] **SOS** — 폰 화면 버튼 → 즉시 danger
- [x] **SpO₂** — < 88% 즉시 danger / < 92% 30s caution
- [x] **고온** — 손목 ≥ 37.5℃ danger / ≥ 37.0℃ caution

### 백엔드
- [ ] `backend/lambdas/hazard-detect/` — vital 입수 시 `@safetymonitor/analyzers` 5종 호출 → HazardEvent 생성
- [ ] HazardEvent DDB 테이블 추가 (또는 단일 테이블 design)

### 대시보드 Alert
- [ ] HazardEvent 카드 — 상단 띠 (severity 색)
- [x] 청각 알림 — Web Audio API (SOS 모달 표시 중 앰뷸런스 두톤 사이렌, `DemoDashboard.tsx` 합성·세션9; 단순 1회 비프 대신 SOS 사이렌으로 구현)
- [x] 작업자 카드 상태 색 동기화 (정상 녹색 → 주의 노랑 → 위험 빨강 — `STATUS_CLASS` + `overallStatus()` 신호등)

### Flutter 폰 SOS UI
- [ ] SOS 화면 — 큰 빨간 버튼 1개 (`apps/worker-phone` 메인 화면 하단)
- [ ] 누르면 HazardEvent (`type: manual_sos`) 즉시 MQTT publish
- [x] 누른 후 시각 피드백 (3초 길게-누르기 진행 게이지 + 떼면 취소 — `main.dart` `_hold` AnimationController·세션20)

### 검증 (D4 진입 조건)
- [ ] 모의 시나리오 5종 모두 5초 내 대시보드 alert
  - 낙상: 폰 흔들기 (가속도) → alert
  - 심박이상: mock HR=180 publish → alert
  - SOS: 폰 SOS 버튼 탭 → alert
  - **SpO₂**: mock SpO₂=86 publish → danger alert
  - **고온**: mock skinTempC=37.6 publish → danger alert
- [ ] caution / danger 단계 색 정확 표시 확인
- [ ] 동일 위험 1분 내 재발생 시에도 alert (dedup 발표 후로 이연)

---

## D4 — 데모 폴리싱

### UI 폴리싱
- [x] **관제 웹 브랜딩/레이아웃 1차 폴리싱 (2026-05-29)** — Coinbase 스타일 토큰 기반 + VitAlGuard CI 라이트/다크 로고 (`public/brand/vitalguard-logo-{light,dark}.png`) + 라이트/다크 히어로 색상 분기 + 현장정보/수신요약/WeatherStrip 여백·비율 정렬. typecheck + dev 200
- [x] **관리자 현장 정보 설정 (2026-05-29)** — 관리자 메뉴에서 기업명/현장명/공사종류/주소/착수 날짜/준공 날짜 수정 → localStorage `safetymonitor.site-info.v1` 저장 + 서버 `site_info_daily` 테이블에 KST 기준 일 1회 snapshot upsert → 히어로 현장정보 카드 즉시 반영 + XLSX/CSV 다운로드 자료 포함
- [x] **현장환경 업데이트 시각 표시 (2026-05-29)** — WeatherStrip 헤더에 `업데이트 YYYY.MM.DD / HH:mm` 추가
- [ ] 대시보드 디자인 토큰 최종 정리 (색·폰트·간격) — 현재 Coinbase/VitAlGuard 방향, 발표 전 라이트/다크 QA 필요
- [ ] 빈 상태·로딩·에러 상태 표시
- [ ] Watch 화면 — 본인 HR 큼지막하게 + 연결 상태
- [x] 관리자 현장정보 persistence UX 점검 — 브라우저 localStorage 한계 보완: 관리자 저장 시 서버 DB `site_info_daily` 에도 일별 snapshot 저장

### 시연 시나리오 스크립트
- [ ] 5분 흐름 분 단위 스크립트 (도입·데모1·데모2)
- [ ] 위험 시나리오 트리거 mock 데이터 사전 준비 (publish 명령어 또는 단말 액션)
- [ ] Q&A 예상 질문 5개 + 답변

### 백업
- [ ] 데모 영상 녹화 (1회 성공 시연 화면 캡처)
- [ ] 라이브 실패 시 영상 재생 fallback 계획
- [ ] 로컬 mock 서버 — AWS 장애 시 즉시 전환 가능

### 발표 슬라이드 (별도 작업)
- [ ] 도입 (산업안전 문제·KOSHA 의무)
- [ ] 아키텍처 다이어그램 (현재 + 발표 후 로드맵 비교)
- [ ] 컴플라이언스 ([compliance.md "발표 슬라이드용 1페이지 요약"](./compliance.md) 인용)
- [ ] 로드맵 (M0~M9 요약 — 1슬라이드)

### 검증 (발표 D-Day)
- [ ] 발표 컴퓨터에서 한 번에 시연 성공 (사전 리허설 3회 이상)
- [ ] 라이브 실패 시 영상 재생 30초 내 전환 가능
- [ ] 인터넷 장애 대비 모바일 핫스팟 준비

---

# 발표 후 로드맵 (M0~M9) — 프로덕션 트랙

> 이하 모든 항목은 **발표 종료 후** 본격 활성화. 현 시점에서는 *참조용 자산* 으로만 유지.

---

## M0 — 진입 전 결정 (코드 0줄)

### 사업·법인
- [~] 프로젝트 정식명 (영문) 확정 — `IndusView` 잠정. 상표 검색 (KIPRIS·USPTO) + 도메인 가용성 검증 후 확정 ([context-notes.md 2026-05-21 — 프로젝트 정식명 결정](./context-notes.md) 참조)
- [ ] 회사·조직 형태 결정 (개인사업자 / 법인 / 미정 상태로 시작)
- [ ] 도메인 등록 후보 3개 + 최종 1개 확보 (`.kr` / `.io` / `.com`)
- [ ] 베타 협력사 1곳 사전 컨택 — 현장·작업자 수·예상 시작일

### 개발자 계정
- [ ] Apple Developer Program 가입 — 개인 $99 vs 조직 $299 결정
- [ ] Google Play Console 가입 ($25 1회)
- [ ] GitHub Organization 생성 (`safetymonitor-kr` 등) — 개인 repo 와 분리

### 클라우드
- [ ] AWS 계정 신규 생성 + 결제 카드 등록 + MFA 활성화
- [ ] AWS Region 결정 — `ap-northeast-2` (서울) 우선
- [ ] AWS IAM — 루트 계정 격리 + 관리자 IAM 사용자 생성 + Access Key 안전 보관
- [ ] AWS 비용 알람 설정 — 월 한도 (예 $50, $100, $200 단계)

### 법률·컴플라이언스
- [ ] 법률 자문 1회 컨택 — [compliance.md](./compliance.md) "법률 자문 시 질문 리스트" 15개 사전 전달 (KOSHA·개보법·근기법·의기법)
- [ ] 작업자 동의서 v1 확정 — [compliance.md](./compliance.md) v0.draft 양식 → 법무 검토 → 확정
- [ ] 데이터 보존 기간 정책 확정 — 1년 (일반) / 3년 (사고) 안. KOSHA 정확한 연수 법률 자문 답변 후 확정
- [ ] [compliance.md](./compliance.md) "미해결 항목 통합 리스트" 24건 자문 답변으로 마감

### 개발 환경
- [ ] Xcode 26.4+ 설치 확인 (이미 보유)
- [ ] Android Studio 최신 설치
- [ ] Galaxy Watch 또는 Wear OS 실기기 1대 확보
- [ ] Node.js LTS + pnpm 설치
- [ ] AWS CLI + CDK 설치 + `aws configure`

### 검증 (M1 진입 조건)
- [ ] 결정 사항 10건 모두 응답 완료 — [context-notes.md](./context-notes.md) 에 기록
- [ ] AWS 계정 로그인 + 결제 카드 등록 완료
- [ ] Apple Developer · Google Play 둘 중 하나 이상 가입 완료
- [ ] 베타 협력사 1곳 구두 합의 (강제 아님 — M9 직전까지만 확정되면 됨)

---

## M1 — 모노레포 스캐폴딩 (코드 시작)

### 디렉터리·툴체인
- [ ] `pnpm init` + 워크스페이스 설정 (`pnpm-workspace.yaml`)
- [ ] Turborepo (`turbo.json`) 또는 Nx 선택 후 도입
- [ ] `.gitignore` (Node·iOS·Android·AWS CDK 통합 패턴)
- [ ] `.editorconfig` + Prettier + ESLint
- [ ] TypeScript 5.x strict 모드
- [ ] GitHub Actions 기본 워크플로우 (lint + build)

### 디렉터리 구조 생성
- [ ] `apps/ios-watch/` — Xcode 프로젝트 placeholder
- [ ] `apps/android-wear/` — Android Studio 프로젝트 placeholder
- [ ] `apps/dashboard-web/` — Next.js 15 + Tailwind + shadcn/ui
- [ ] `apps/dashboard-mobile/` — React Native 또는 보류
- [ ] `backend/infrastructure/` — AWS CDK TypeScript
- [ ] `backend/lambdas/` — Lambda 함수들 (각 디렉터리)
- [ ] `packages/analyzers/` — 공통 위험 감지 로직 (TypeScript)
- [ ] `packages/thresholds/` — 임계값 상수
- [ ] `packages/schemas/` — Zod 또는 JSON Schema 공통 데이터 스키마
- [ ] `docs/` — plan/checklist/context-notes/compliance/architecture
- [ ] `docs/HealthPattern-reference/` — HealthPattern 의 docs 사본 보관

### 공통 패키지 초기 구현
- [ ] `packages/schemas` — 7개 모델 타입 정의. `Organization` / `Worker` / `Device` / `Operator` / `VitalStream` / `HazardEvent` / `AuditLog` ([plan.md 데이터 모델](./plan.md#데이터-모델-1차-윤곽) 참조)
- [ ] `packages/thresholds` — HealthPattern 의 `InsightThresholds` 이식 + 산업안전 임계 신규
- [ ] `packages/analyzers` — 낙상·심박이상·SpO₂ 3종 골격 (테스트 포함). 낙상에 "격렬한 움직임 후 무동작 = 의식 소실 패턴" 흡수 ([plan.md 위험 감지](./plan.md#위험-감지-알고리즘-윤곽) 참조)

### 검증
- [ ] `pnpm install && pnpm build` 모든 패키지 통과
- [ ] `pnpm test` — analyzers 단위 테스트 3건 이상 통과
- [ ] GitHub repo push 성공 + CI 녹색

---

## M2 — AWS 인프라 골격

### CDK 셋업
- [ ] `backend/infrastructure` CDK 앱 부트스트랩 (`cdk bootstrap`)
- [ ] Region · Account · Stage (dev/stg/prod) 환경 분리 설계
- [ ] `Stack: NetworkStack` (VPC 필요시) / 또는 서버리스로 VPC 생략

### IoT Core
- [ ] `Stack: IotStack` — IoT Thing Type / Thing Group 정의
- [ ] 디바이스 인증서 발급 스크립트 (테스트용)
- [ ] IoT Topic 구조 설계 (`safetymonitor/v1/org/{orgId}/worker/{workerId}/vital`)
- [ ] IoT Rule 1건 — vital 토픽 → Lambda 트리거

### 인증
- [ ] `Stack: AuthStack` — Cognito User Pool (관제자·관리자)
- [ ] Cognito Identity Pool (필요 시 — 디바이스 IAM 임시 자격)
- [ ] 역할 분리 (admin / operator / readonly)

### 데이터
- [ ] `Stack: DataStack` — DynamoDB 테이블 (`Workers`, `Devices`, `HazardEvents`)
- [ ] Amazon Timestream 또는 DynamoDB on-demand 결정 (`VitalStream` 시계열)
- [ ] 백업·복원 정책 (Point-in-time recovery 활성화)

### Lambda
- [ ] `backend/lambdas/vital-ingest/` — IoT Rule trigger → 정규화 → Timestream/DDB 저장
- [ ] `backend/lambdas/hazard-detect/` — vital 입수 시 `packages/analyzers` 호출 → HazardEvent 생성
- [ ] `backend/lambdas/notify-fan-out/` — HazardEvent → SNS → APNs/FCM/이메일

### 검증
- [ ] `cdk deploy` 성공 (dev 환경)
- [ ] mosquitto_pub 또는 AWS IoT MQTT 테스트 클라이언트로 수동 publish → DynamoDB/Timestream 1건 확인
- [ ] 모의 vital (HR=180 등 임계 초과) publish → HazardEvent 생성 + Lambda 로그 확인
- [ ] AWS Cost Explorer 첫 24시간 비용 확인 (Free Tier 내)

---

## M3 — Apple Watch 클라이언트

- [ ] `apps/ios-watch/` Xcode 프로젝트 생성 (Watch + iPhone 페어)
- [ ] HealthPattern 의 `Shared/HealthKit/` 일부 발췌 이식 (Fetch 로직)
- [ ] HealthKit 권한 요청 + 자동 수집 (현재 HR · SpO₂ · 가속도)
- [ ] 디바이스 인증서 keychain 저장 (provisioning UX 별도 설계)
- [ ] MQTT 클라이언트 통합 (CocoaMQTT 또는 자체 NWConnection + AWS SDK)
- [ ] 5초 간격 vital publish (foreground · background)
- [ ] 백그라운드 유지 전략 (HKWorkoutSession 활용 — HealthPattern M5 패턴 차용)
- [ ] SOS 버튼 — 수동 위험 신고 (Force Touch 또는 Crown long press)
- [ ] 연결 상태·배터리 UI

### 검증
- [ ] 실기기에서 5초 간격 publish 30분 무중단
- [ ] 화면 끄고 30분 후에도 publish 지속 (백그라운드 검증)
- [ ] AWS CloudWatch 에서 vital 수신 graph 확인
- [ ] SOS 버튼 → HazardEvent (`type: manual_sos`) 생성 확인

---

## M4 — Android Wear 클라이언트

- [ ] `apps/android-wear/` Android Studio 프로젝트 (Wear OS)
- [ ] Health Services API 권한 + 수집 (HR · SpO₂ · 가속도)
- [ ] AWS IoT Device SDK for Android 통합
- [ ] 디바이스 인증서 Android Keystore 저장
- [ ] 5초 간격 publish (foreground service)
- [ ] SOS 버튼
- [ ] 연결 상태 UI

### 검증
- [ ] Galaxy Watch 실기기에서 5초 간격 publish 30분 무중단
- [ ] 화면 off 후 백그라운드 지속 (Foreground Service notification 유지)
- [ ] 동일 AWS CloudWatch 에서 iOS·Android 데이터 모두 수신 확인

---

## M5 — 웹 대시보드 MVP

### 인증·라우팅
- [ ] Next.js 15 App Router + NextAuth (Cognito provider)
- [ ] 로그인·로그아웃·세션 갱신
- [ ] Multi-tenant 라우팅 (`/[orgId]/dashboard`)

### Overview 화면
- [ ] 작업자 grid (카드: 이름·심박·상태 색·마지막 통신)
- [ ] WebSocket 또는 AWS IoT Core WebSocket 으로 실시간 push 수신
- [ ] 1~3초 이내 단말 → 대시보드 표시 지연 검증

### Worker Detail
- [ ] 시계열 차트 (recharts 또는 Apache ECharts) — HR · SpO₂ · 활동
- [ ] 최근 24h 위험 이벤트 타임라인
- [ ] 위치 지도 (네이버맵 또는 카카오맵)

### Alerts
- [ ] 활성 HazardEvent 큐
- [ ] 처리 워크플로우 (ack → resolve → comment)

### 검증
- [ ] 실기기 단말 1대 → 웹 대시보드 실시간 표시 1~3초 지연
- [ ] 모의 HR=180 → Alert 화면에 카드 1초 내 표시
- [ ] 로그아웃 후 보호된 경로 접근 차단
- [ ] Lighthouse 성능 90+ (대시보드는 production 빌드 기준)

---

## M6 — 위험 감지 5종 + 알림 라우팅

### 위험 감지 알고리즘
- [ ] **낙상** — 가속도 > 3G + 자세 급변 + 30초 무동작 → danger
- [ ] **심박 이상** — resting HR > 130 또는 < 40 / zone 5 초과 5분 지속
- [ ] **저산소 (SpO₂)** — < 92% 30초 / < 88% 즉시
- [ ] **고온** — 피부 온도 + 환경 온도 → 열사병 위험
- [ ] **고립** — 마지막 통신 > 5분 + GPS 위험구역 → caution / > 15분 danger

### 알림 라우팅
- [ ] APNs (관제자 iOS / Apple Watch)
- [ ] FCM (관제자 Android)
- [ ] 이메일 (SES) — 관리자
- [ ] Slack Webhook (조직별 채널)
- [ ] 알림 규칙 매트릭스 — severity × 채널 × 수신자 그룹

### 운영
- [ ] 알림 deduplication (5분 내 동일 워커·동일 type 중복 발송 방지)
- [ ] 알림 음소거 시간대 (야간 등) — 단 danger 는 무시
- [ ] 알림 발송 로그 (감사용)

### 검증
- [ ] 모의 데이터로 5종 위험 각각 발생 → 각 채널에 알림 수신 확인
- [ ] 동일 이벤트 dedup 윈도우 검증 — 1분·3분·5분 재발생 모두 차단, 5분 초과 (예. 6분) 시 재발송
- [ ] `danger` severity 는 dedup 미적용 — 1분 재발생도 즉시 발송 확인
- [ ] 알림 발송 로그 DynamoDB 적재 확인

---

## M7 — 모바일 보조 앱 (관제자)

기술 스택 결정: React Native vs 네이티브 2개.

- [ ] 스택 최종 결정 + [context-notes.md](./context-notes.md) 기록
- [ ] 푸시 알림 수신 (APNs/FCM)
- [ ] Alert Inbox 화면
- [ ] Worker Quick View (호출·위치·연락처)
- [ ] 로그인 (Cognito)
- [ ] App Store · Play Store TestFlight/내부 테스트 배포

### 검증
- [ ] 관제자 iOS/Android 둘 다 푸시 1초 내 수신
- [ ] 푸시 탭 → Worker Quick View 이동
- [ ] TestFlight 베타 1명 가입·설치·로그인 성공

---

## M8 — KOSHA 리포트 + 감사 로그

- [ ] AuditLog 테이블 + 모든 관제자 액션 로깅 (조회·해결·삭제)
- [ ] 일/주/월 안전 지표 리포트 (작업자별 이벤트 수·평균 응답시간)
- [ ] KOSHA 사고 보고서 양식 PDF 출력 기능
- [ ] 데이터 보존 정책 자동화 (3년 경과 데이터 cold storage 이동)
- [ ] 작업자 동의 철회 시 데이터 익명화/삭제 워크플로우

### 검증
- [ ] 임의 1주 데이터로 PDF 리포트 생성 + 시각적 검토
- [ ] 감사 로그 누락 0건 (sampling 100건 검증)
- [ ] 보존 기간 cron 정상 동작 (dev 환경 단축 주기로 검증)

---

## M9 — 베타 시범 운용

### 사전 준비
- [ ] 베타 협력사 최종 확정 + 계약·동의서 서명
- [ ] 작업자 5~10명 디바이스 provisioning
- [ ] 관제자 1~2명 계정 + 교육 1시간
- [ ] 비상연락망 + 인시던트 대응 절차
- [ ] 1주 운용 일정 + 일일 체크인

### 운용
- [ ] 매일 무장애 가동 시간 측정
- [ ] 매일 발생 이벤트 종류·처리 시간·오탐 율 집계
- [ ] 작업자·관제자 피드백 인터뷰 (3일차·종료 후)

### 검증 (정식 출시 조건)
- [ ] 7일 무장애 가동률 99%+
- [ ] 위험 이벤트 1건 이상 정상 감지·대응
- [ ] 오탐률 5건/일 이하 (작업자 1인당)
- [ ] 작업자 불만 0건 (사생활 침해 등)
- [ ] 관제자 만족도 4/5 이상

---

## 보류·미정 항목

- [ ] 머신러닝 이상치 탐지 (2차)
- [ ] 영상 CCTV 통합 (2차)
- [ ] 자동 119 연계 (2차)
- [ ] 다국어 (영어 우선)
- [ ] 의료기기 인증 (별도 트랙)
- [ ] 자체 단말 OEM (Apple/Samsung 외)

---

## 운영 노트

- **세분화는 진행하며** — 지금은 M0~M3 까지만 디테일이 충분합니다. M4 이후는 큰 박스만 잡고, 해당 마일스톤 진입 시 세부 항목을 추가하면 됩니다.
- **`[!]` 블로커 표시** — 외부 의존 (법률 자문 답변 대기, 협력사 회신 등) 은 `[!]` 로 두면 daily 점검 시 잘 보입니다.
- **검증 항목 통과 전 다음 M 진입 금지** — 마일스톤 간 cascade 실패 방지.
