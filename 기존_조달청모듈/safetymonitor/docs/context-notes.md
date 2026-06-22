# SafetyMonitor — Context Notes

> **현재 상태 (2026-06-22 — [changwoojin 클론·`feat/gcp-postgres-cloudrun`] GCP Cloud Run 배포)** — 팀원 push분(`e93db68`) 클론을 changwoojin 머신에서 검토 → 관제웹 로컬 구동 → **GCP 서버 이전 완료(2커밋, 미push·미merge)**. ① pull 코드(CCTV·fusion·안전관리비) 정적+런타임 검증(`setWorkerZone` 미시딩·`cctv-poller` 미연결 = 의도된 미완 배관 발견) ② **DB SQLite→PostgreSQL(pg) 이전**(`a766ae7`) — 29함수 async·DDL Postgres화·int8→number 파서, DB=캠퍼스 공유 `project-db-campus.smhrd.com:3310`(PG14.5, **SSL 미지원→sslmode=disable**) ③ **Cloud Run 배포**(`9a59f36`) — standalone Dockerfile·프로젝트 `safetymonitor-498508`(기존·결제 활성)·Secret Manager → **고정 HTTPS `vitalguard-dashboard-569797426568.asia-northeast3.run.app`**(admin/safety2026, cloudflared 회전 종료). 라이브 = egress 적재·fusion·로그인·외부 API live. 결정 상세 아래 `## 2026-06-22` 참조. main 미merge·미push. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)·[gcp-migration/](./gcp-migration/context-notes.md)

---

> **이전 (2026-06-09 세션28)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행**. 최근 작업(세션28, 5커밋): ① **로그인 사진 → mainpic0.jpg**(`9cdf09e`, 중앙 구도라 `background-position 50%`) ② **네트워크 재연결**(새 터널 `undertaken-best-communist-release`, LAN `192.168.219.221`) ③ **★ 외형 스냅샷 HTML 2개**(SingleFile, `demo/`, 셰이더 PNG 박제·정지 스냅샷·팀원 공유용) ④ **★ 현장환경 InfiniteSlider 재디자인 + 모노톤 아이콘**(`3d2408d`, 호버 감속·mask 페이드·WeatherIcons 신규) ⑤ **★ 헤더 ExpandableTabs 호버 확장**(`a950ef4`, 4버튼 알약바·테마토글 제외·GradientIconButton 삭제) ⑥ **★ 자동슬라이딩 복제행 생체 셀 선택 수정**(`9d88d55`, pointer-events 허용) ⑦ **★ SOS·낙상 알림 이력 Alert 카드 재디자인**(`48d99f4`, 소프트 컬러 카드+모노톤 아이콘) ⑧ **상태 점검**(EMP-1234 실시간 연결·GPS 현장날씨 Open-Meteo LIVE·현장날씨 미표시는 dev 재시작 세션무효→재로그인). **레퍼런스 디자인 전부 신규 의존성 0**. main **`ahead 113`**(5커밋), push 보류, working tree `demo/`만 untracked. 블로커(누적): push 결정(113)·demo/ 커밋·폰 인앱 URL 갱신·기상특보 KMA NO_DATA·YJH iPhone 재install·Galaxy Health·배터리 풀시프트·D4 리허설. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> **이전 (2026-06-08 세션27)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행**. 최근 작업(세션27, 6커밋): ① **현장 선택 메인 현장 지역명 표기**(`afec68e`) — `MAIN_SITE.label`을 "광주 스마트인재개발원 신축 공사"로(데모와 동일 "지역 현장이름" 형식, `siteName`은 실제 현장명 유지) ② **★ 작업자 표 자동 슬라이딩 동일 작업자 중복 노출 수정**(`08951a4`) — 행을 항상 2벌 복제하던 것을 overflow일 때만 복제(`tableOverflowing` state, rAF tick 측정) → 행 적으면 한 벌만 → 중복 해소, overflow 시 복제+슬라이딩 보존 ③ **비전 PoC 계획(보류)**(`cbc7205`, `vision-ppe-plan.md`) — GoPro+supervision 안전모 검출, supervision=후처리(별도 YOLO), 발표 PoC 결정+HERO9 웹캠+로컬 CPU 실시간(Colab 불가), GoPro 미보유→보류 ④ **루트 stray 정리**(`c59aaa5`, `.claude/skills/` gitignore) ⑤ **로그인 사진 교체**(`1c08b97`, mainpic4 안전모 로고 브랜딩). main **`ahead 107`**(세션27 6커밋), push 보류, working tree clean. 블로커(누적): push 결정(107)·폰 인앱 URL 갱신·비전 PoC GoPro 장비 대기·데모 현장 실데이터화·세션23 KMA NO_DATA·YJH iPhone 재install·Galaxy Health 권한·배터리 풀시프트·D4 리허설. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> **이전 (2026-06-08 세션26)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행**. 최근 작업(세션26): ① **로그인 화면 풀 개편 커밋**(`f3baadd`) — 반투명 글래스 카드 2분할(좌측 현장사진 `mainpic.jpg` / 우측 폼)·셰이더 배경·스토어 배지·구글 버튼·**리퀴드 메탈 로그인 CTA**(기설치 `@paper-design/shaders-react` LiquidMetal 재사용→신규 의존성 0)·한↔영 레이아웃 높이 고정(min-h+영문 폰트 축소) ② **헤더 그라데이션 확장 버튼**(`1787e5c`, GradientIconButton)+테마 토글 로그아웃 우측 이동 ③ **관제 웹 폰트** Archivo/Do Hyeon 전역 적용→**사용자 롤백 → Inter 복원**(net 0) ④ **★ 로그인 후 현장 선택 단계 신규**(`a3e8575`) — HeroUI 콤보박스 이식(외부 의존성 0), 메인=**스마트인재개발원 신축 공사** 고정 + 데모 5현장(광주·부산·세종·인천·평택) **가나다순**, 선택→`site-info` 저장→대시보드 현장정보 반영. main **`ahead 101`**(커밋 5건), push 보류. 블로커(누적): push 결정·루트 stray(`mainpic.jpg`·`dashboard-full.png`) 정리·폰 인앱 URL 갱신·고정 URL 결정·데모 현장 실데이터화·세션23 KMA NO_DATA·YJH iPhone 재install·Galaxy Health 권한·배터리 풀시프트·D4 리허설. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> **이전 (2026-06-08 세션25)** — 트랙: 프로토타입 (D0~D4) · 현재 위치: **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행**. 최근 작업(세션25): ① **재가동** — 이전 터널 만료 → 새 quick tunnel `sends-paintball-often-carolina.trycloudflare.com`(LAN `192.168.219.123`), 워치 `defaultURLString`+CLAUDE.md active URL 갱신(폰 인앱 URL ⚙️ 수동 갱신 필요) ② **로그인/헤더 디자인 개편** — 테마·언어 토글을 알약 슬라이딩 스위치(21st.dev Serenity UI)로, 헤더 버튼 ghost 톤(ruixenui), 헤더 이모지→라인 SVG(커밋 `2738fc8`), 로그인 셰이더 배경(신규 의존성 `@paper-design/shaders-react` MeshGradient)·풀블리드 레이아웃(박스 제거·글래스 입력)·텍스트 1줄·폰트(Archivo Black 라틴+Do Hyeon 한글, Google Fonts `<link>`) ③ **팀원 공유** — cloudflared 공개 URL+로그인+PII redaction 검증, 고정 URL(Cloudflare named tunnel/ngrok/Tailscale) 안내·결정 대기. main `ahead 96`(커밋 1건, 나머지 디자인/URL-sync 미커밋). 블로커(누적): 미커밋 커밋·폰 인앱 URL 갱신·고정 URL 결정·세션23 KMA NO_DATA 처리·YJH iPhone 재install·Galaxy Health 권한·배터리 풀시프트·D4 리허설. 직전 세션19~24 작업은 아래 날짜 섹션 참조. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> **이전 (2026-06-08 세션24)** — 최근 작업(세션24, 3커밋): ① **수신 URL 재발급**(`218b96d`) — 이전 터널 만료 → 새 quick tunnel `cheers-entire-glass-editorial.trycloudflare.com`(GET 200/POST 202), 워치 `defaultURLString`+CLAUDE.md 갱신(폰 인앱 URL은 ⚙️ 수동 갱신 필요·미반영) ② **★ 태풍 진로 "실 위협 없으면 레이더 미가동"**(`e9567b1`, 사용자 결정=엄격) — `mock`/`none`/빈 진로는 지도·추적 숨기고 "태풍 위협 없음 · 레이더 대기"(`realThreat = live && track>0`), `live`+발효 진로일 때만 한국/현장 GPS 게이트(기존 보존) ③ **.gitignore `.playwright-mcp/`**(`96fdad8`). 검증: tsc 0 + Playwright(태풍 패널 위성타일 0=미가동·"추적 중" 부재). main `ahead 94`, push 보류. 블로커(누적): 세션23 KMA NO_DATA 처리 결정 · 폰 3대 인앱 URL 갱신 · YJH iPhone release 재install · Galaxy Health 권한 · 배터리 풀시프트 · D4 리허설. 직전 세션19~23 작업은 아래 날짜 섹션 참조. 상세 [progress.md](./progress.md#quick-summary-30초-안에-읽기)

---

> 의사결정의 *이유* 를 기록. 다음 세션 (사람·에이전트) 이 재논의를 피하는 핵심 자산.
>
> **규칙**.
> 1. 새 결정은 **상단 날짜 섹션** 에 추가 (역시간순)
> 2. *결정 내용* + *이유* + *대안과 기각 사유* 3종을 함께 적기
> 3. 변경된 결정은 새 섹션에 명시하고 이전 섹션은 **남겨둠** (감사 trail)
> 4. 코드 위치 변경·리팩토링 등 *코드 읽으면 알 수 있는 것* 은 여기 안 적음

---

## 2026-06-22 — GCP Cloud Run 배포 + DB SQLite→PostgreSQL 이전 (changwoojin 클론·`feat/gcp-postgres-cloudrun` 브랜치)

- **GCP 이전 목적 = 발표용 고정 HTTPS 서버(겸 상용화 기반)** — 사용자 선택. cloudflared quick tunnel 의 세션마다 URL 회전(폰·워치 재입력) 고질병을 Cloud Run 고정 HTTPS 로 종결. 데모가 곧 상용화 기반.
- **★ 컴퓨트 = Cloud Run 단일 Next.js 서비스 / DB = 캠퍼스 공유 Postgres(자체 Cloud SQL 안 씀)** — 사용자가 PostgreSQL 서버 보유(`project-db-campus.smhrd.com:3310`, 스마트인재개발원 캠퍼스 DB). 프론트/백 분리 안 함(현 코드가 Next.js UI+API 한 몸). Cloud SQL 프로비저닝 Phase 삭제. 대안(VM+SQLite 그대로)은 발표만 빠르게엔 더 간단하나 상용화 기반이 안 됨 → Cloud Run+Postgres 채택.
- **★ better-sqlite3→pg = 동기→비동기 전환(불가피)** — Node 에 프로덕션급 동기 Postgres 드라이버 없음. [lib/db.ts](../apps/dashboard-web/lib/db.ts) 29함수 전부 async + 호출처 await 전파가 작업의 80%. **교훈: tsc 는 `NextResponse.json(asyncFn())` 처럼 Promise 를 `any` 로 넘기는 자리를 못 잡는다**(7개만 탐지) → 함수명 grep 전수로 ~20개 라우트 await 보강(런타임 `{}` 직렬화 버그 차단). int8(BIGINT/COUNT/SUM)은 pg 가 문자열 반환 → `pg.types.setTypeParser(20, parseInt)` 로 number 화(금액·집계 누출 방지).
- **★ 평문 DB 구간 = 발표 데모 수용** — 캠퍼스 Postgres 가 SSL 미지원(SSLRequest 응답 'N') → `sslmode=disable` 필수. Cloud Run↔DB 가 인터넷에서 비암호화(자격증명+PII). 발표 단기 데모는 수용, **상용화 시 SSL DB 또는 SSH/stunnel 터널**. 즉시 터널은 발표 범위 초과로 보류.
- **★ monorepo standalone = 워크스페이스 패키지를 transpilePackages 로 번들** — `output:standalone`+`outputFileTracingRoot`(레포 루트)만으로는 `@safetymonitor/analyzers` dist 가 standalone 에 안 들어가(package.json 만 복사) fusion `decideFusion` 런타임 실패. schemas 처럼 **analyzers 도 transpilePackages 에 추가**해 빌드에 번들(standalone 로컬 실행으로 검증).
- **★ Cloud Run egress 로 캠퍼스 DB 직접 도달(VPC 커넥터 불필요)** — 캠퍼스 DB 가 공개 IP(49.171.84.3)+IP 허용목록 없음(이 Mac·Cloud Run 둘 다 등록 없이 접속) → Cloud Run 기본 인터넷 egress 로 충분. 허용목록 있었으면 고정 egress IP(VPC커넥터+Cloud NAT) 필요했을 것.
- **★ 관리자 인증 = fail-closed(`admin/safety2026` 소스 기본값 제거됨)** — 현 [admin-auth.ts](../apps/dashboard-web/lib/admin-auth.ts) 는 `ADMIN_PASSWORD ?? ""` 로 미설정 시 로그인 거부. 과거 문서의 `admin/safety2026` "기본값"은 보안 강화로 stale → `.env.local`/Secret Manager 의 `ADMIN_PASSWORD` 설정 필수.
- **시크릿 = Secret Manager(코드/이미지 미포함)** — `DATABASE_URL`(DB 비번 포함)·`ADMIN_PASSWORD`+외부 API 키 5종(G2B/KMA/KOSHA/YOUTUBE). `.dockerignore` 가 `.env*` 제외 → 빌더 이미지에도 시크릿 baked 안 됨. 외부키 추가로 KOSHA/KMA/유튜브/g2b `source:live` 확인(날씨는 Open-Meteo 무키라 이미 live). `PPS_SERVICE_KEY` 는 코드 미사용이라 제외.

## 2026-06-09 세션28 — 디자인 재작업(현장환경·헤더·알림이력) + 외형 스냅샷 + 자동슬라이딩 선택 수정

- **레퍼런스 디자인 = 신규 의존성 0으로 동등 구현** — 사용자가 제시한 21st.dev/shadcn 레퍼런스(InfiniteSlider·ExpandableTabs·Alert)는 `motion`/`framer-motion`·`lucide-react`·`class-variance-authority`·`@/lib/utils`(cn)·`@/components/ui/*`에 의존하나 프로젝트엔 전무. 프로젝트 규칙(외부 의존성 사전 합의) + 기존 무의존 패턴에 따라 **CSS 트랜지션 + 인라인 SVG + 토큰**으로 동일 동작/룩 구현. (현장환경=기존 `useMarqueeScroll` 훅에 `hoverSpeedFactor` 옵션 추가 / 헤더=호버 확장 알약바 / 알림=소프트 컬러 카드). 대안(의존성 설치)은 규칙 위반+오버스펙으로 기각.
- **★ Tailwind 활성 상태는 인라인 스타일(CSS 변수)로** — 동적 토글 활성 클래스(`max-w-[120px]`·`bg-surface-strong`·`text-primary`)가 ExpandableTabs 버튼에서 안 먹는 2중 원인 발견: ① **HMR 증분 빌드 JIT 타이밍**(새 파일의 arbitrary 유틸 미생성), ② **Tailwind preflight `button { color: inherit }` 간섭**으로 토큰 색 클래스가 버튼엔 적용 안 됨(같은 `text-primary`가 h1엔 정상). 해결 = 활성 폭/색/배경을 **인라인 스타일**(`style={{maxWidth, color:'var(--color-primary)', backgroundColor:'rgba(0,82,255,0.12)'}}`)로 처리 → JIT/preflight 무관 확실 적용. dev 클린 재시작으로도 클래스 방식은 실패, 인라인이 정답.
- **★ 헤더 액션 버튼 = 호버 확장(클릭-선택 아님)** — 레퍼런스 ExpandableTabs는 클릭-선택(selected 상태)이나, 헤더는 **액션 버튼**(클릭=모달/토글/로그아웃)이라 클릭 시 모달이 열리며 선택 상태가 유지되지 않는 충돌. → **호버-확장**(hover 라벨 펼침, 클릭=액션) 채택(이전 GradientIconButton과 동일 방향). 라이트/다크 토글은 사용자 요청대로 **제외**(알약바 밖 유지).
- **★ 자동 슬라이딩 복제 행 = 클릭 허용** — 자동 모드 seamless 루프용 2벌 복제 중 복제본에 `pointer-events-none`가 걸려, 화면에 보이는 인스턴스가 복제본일 때 클릭 무반응 → "**간헐적 선택 불가**". 수정 = 복제 행도 마우스 클릭 허용(셀 onClick은 같은 workerId 대상이라 원본과 동작 동일), a11y는 `aria-hidden`·`tabIndex=-1` 유지(스크린리더/키보드는 원본만). 대안(수동 모드 안내)은 임시방편이라 근본 수정 채택.
- **★ 외형 스냅샷 = SingleFile + 토큰 시드** — 관제 웹은 Next.js 서버 앱이라 "외형 그대로 HTML"은 **실제 렌더 결과를 SingleFile로 통째 인라인**해야 충실. 로그인 게이트는 sessionStorage `safetymonitor.session.v1` **존재만**으로 대시보드 표시(서버 검증은 PII GET에만) → SingleFile `--browser-script`로 토큰을 **로드 전** 심어 대시보드 캡처. WebGL 셰이더 캔버스도 SingleFile이 현재 프레임을 PNG로 떠 `background-image`로 박제 → JS 없이도 표시. 결과는 **정지 스냅샷**(실시간/API/로그인 미동작). `single-file-cli`는 `/tmp` 임시 설치(프로젝트 package.json 미오염). 대안(정적 export)은 API 라우트 제거 필요+위젯 사망으로 기각, 손코딩 목업은 외형 근사라 폐기.
- **로그인 사진 구도별 background-position** — mainpic0(820×1024)은 **중앙 정렬 구도**(안전모·"SAFETY" 문구가 가운데)라 우측 시프트(75%)가 아닌 **중앙 크롭(50% 50%)**. 사진 교체 시 구도에 맞춰 position 조정 필요(mainpic4/6은 좌측 인물+우측 문구라 75%였음).
- **모노톤 라인 아이콘 = 인라인 SVG 자체 제작** — flaticon 무료 아이콘은 출처 표기 의무 + 번들 라이선스 이슈 → 동일 스타일을 인라인 SVG로 자체 제작(현장환경 13종+날씨 8종 / 알림 SOS 옥타곤·낙상 인물 2종). `currentColor` 상속으로 카드/칩 톤과 자동 조화, 라이선스·의존성 0.
- **상태 점검 결정** — 현장 날씨 미표시는 **dev 재시작 → 세션 토큰(in-memory) 무효화 → GPS·보호자 PII redaction**(생체는 비-PII라 정상)이 원인. 새로고침은 옛 sessionStorage 토큰 유지라 무효 → **로그아웃 후 재로그인** 필수([[project-dashboard-session-relogin]]). GPS 기반 현장 날씨(Open-Meteo) 구현 자체는 정상 LIVE, 기상특보만 mock 폴백(세션23 KMA NO_DATA 이슈 미해결).

## 2026-06-08 세션27 — 현장 선택 라벨 + 자동 슬라이딩 중복 수정 + 비전 PoC(보류)

- **현장 선택 메인 현장도 지역명 표기** — 데모 현장 라벨은 "지역 현장이름"(광주 첨단3지구…) 형식인데 메인 현장만 "스마트인재개발원 신축 공사"로 지역이 없어 비일관 → **"광주 스마트인재개발원 신축 공사"**로 통일(주소가 광주광역시 광산구). 표시 라벨(`label`)만 변경하고 대시보드 반영용 `siteName`(실제 현장명)은 유지 — 데모 현장도 label(표시)/siteName(실제값) 분리 구조라 동일 패턴.
- **★ 작업자 표 자동 슬라이딩 중복 = overflow일 때만 복제** — 자동 모드 세로 슬라이딩은 seamless 루프(한 벌 높이만큼 스크롤 후 되감기)를 위해 행을 2벌 복제한다. 문제 = **행이 적어 한 벌이 뷰포트에 다 들어가면(overflow 아님) 슬라이딩이 멈춘 채 복제본이 그대로 노출** → 같은 작업자가 위/아래 중복. 해결 = overflow 여부를 rAF tick 에서 측정해 `tableOverflowing` state 로 관리하고 **overflow일 때만 복제본 렌더**. 행 적으면 한 벌만 → 중복 해소, overflow 시 복제+슬라이딩 보존(기존 동작). 대안(복제 전면 제거)은 seamless 루프가 깨져 기각. 검증 = Playwright(3명 복제 0·각 1회 / 12·10명 복제 유지·scrollTop 37→37.5).
- **★ 비전 PoC = 발표 데모 포함(영상+ML 비범위 승격)이나 GoPro 미보유로 보류** — `supervision` 은 검출 모델이 아니라 **후처리 라이브러리**(annotate·track·zone·keypoint), 안전모 검출은 별도 YOLO 모델이 필요. 영상(CCTV) 통합·ML 은 CLAUDE.md "의도적 비범위"의 2차 항목이었으나 **사용자 결정으로 발표 PoC 한해 승격**. **★ Colab(클라우드)은 로컬 USB 웹캠 실시간 추론 불가**(발표 PC에 꽂은 GoPro는 Colab 런타임에서 안 보임) → 안전모는 가벼운 모델이라 **로컬 CPU 실시간**으로 충분(Colab/GPU 불필요, Colab 은 자체 학습 시 발표 후). macOS 캡처 경로 = GoPro Webcam 유틸 → OBS Virtual Camera → OpenCV(가상캠 직접 캡처는 불안정·Device ID 리셋, 폴백 = 녹화 .mp4). **GoPro HERO9 장비 미보유 → 코드/의존성 미착수, 장비 준비 시 [vision-ppe-plan.md](./vision-ppe-plan.md) 체크리스트부터 착수**.
- **로그인 사진 = mainpic4.jpg(안전모 VitalGuard 로고 브랜딩)** — 사진을 여러 번 교체(mainpic→mainpic2→mainpic4), 최종 = 안전모에 VitalGuard 로고가 들어간 브랜딩 버전. 구도가 이전과 동일(1015×1024, 우측 하단 SAFETY 문구)이라 `background-position: 75% 50%` 유지. 미사용 구 이미지(`mainpic.jpg`·`mainpic2.jpg`) 삭제로 `public/brand` 를 사용 중인 `mainpic4.jpg` 하나로 단일화. 루트 stray(채팅 업로드 원본·검토 스크린샷)는 `rm`, `.claude/skills/`(로컬 스킬)은 gitignore.

## 2026-06-08 세션26 — 로그인 화면 풀 개편 커밋 + 로그인 후 현장 선택 단계 신규

### 결정 1 — ★ 리퀴드 메탈 로그인 버튼 = 기설치 LiquidMetal 재사용 (신규 의존성 0)
- **결정**. 사용자가 제공한 LiquidMetalButton 코드는 `@paper-design/shaders`(core, 미설치)의 `liquidMetalFragmentShader`+`ShaderMount`와 `lucide-react`(미설치)에 의존. 이미 설치된 `@paper-design/shaders-react`가 고수준 `LiquidMetal` 컴포넌트를 export → 그걸로 같은 효과를 내고, 아이콘 모드(lucide 필요)는 제거. **신규 패키지 0개**로 구현.
- **이유**. "외부 의존성 신규 추가 시 사전 합의" 원칙 + MeshGradient(셰이더 배경)가 같은 패키지로 이미 런타임/타입 동작 검증됨. core 패키지/lucide 추가는 불필요.
- **대안 기각**. 원본 그대로(core + lucide 설치) = 의존성 2개 추가 → 기각.

### 결정 2 — ★ 로그인 후 현장 선택 단계 = LoginScreen 내 2단계 (pendingToken)
- **결정**. Sign in 성공 시 `onLogin(token)` 직행 대신 `pendingToken`에 보류 → 현장 선택 단계 렌더 → 선택 확정 시 `localStorage["safetymonitor.site-info.v1"]`에 SiteInfo 저장 후 `onLogin(pendingToken)`. 대시보드는 mount 시 `loadSiteInfo()`로 localStorage를 읽어 현장정보 반영.
- **이유**. LoginGate는 `onLogin`을 게이트로 쓰므로, 그 직전에 단계를 끼우는 게 최소 변경. site-info localStorage는 대시보드가 이미 읽는 경로라 추가 배선 0.
- **대안 기각**. LoginGate에 별도 site-select 화면 추가 = 게이트 로직 복잡화 → 기각. 라우터 추가 = 과함 → 기각.

### 결정 3 — ★ 메인 현장 = 스마트인재개발원 신축 공사 (고정), 데모 5현장 가나다순
- **결정**. 콤보박스 = "메인 현장" 섹션(스마트인재개발원 신축 공사, **고정 상수** — localStorage 마지막 선택 비의존) + "데모 현장" 섹션(광주·평택·부산·인천·세종 5곳, `localeCompare("ko")` **가나다순**). 현장명은 "지역 현장이름" 순.
- **이유**. 메인은 회사 자체 현장이라 항상 노출되어야 함(직전 선택값이 "기존"으로 뜨던 혼동 제거). 데모는 가상 데이터로 시연용. 가나다 정렬은 프로그램적이라 현장 추가 시 자동 위치.
- **대안 기각**. 메인을 localStorage에서 읽기 = 직전 선택 데모가 메인으로 표시되는 버그 → 고정 상수로 정정. 메인에 지역 접두("광주 …") = 직전 "그대로 추가" 지침과 충돌 → 보류(요청 시 적용).

### 결정 4 — 현장 선택 단계 레이아웃 = 로고만 + 드롭다운 비클리핑
- **결정**. 현장 선택 단계에선 슬로건/헤딩(마케팅 문구) 숨김(로고만). 폼 컬럼 `overflow-y-auto`·카드 `max-h` 제거(레이아웃 스크롤 없음). 카드 `overflow-hidden` 해제하고 모서리 클리핑은 이미지 컬럼만(`rounded-l-3xl overflow-hidden`) → 콤보박스 드롭다운이 카드에 안 잘림. 드롭다운 자체는 `max-height:320px + overflow-y:auto`로 내부 스크롤.
- **이유**. 카드 `overflow-hidden`이 absolute 드롭다운을 잘라 화면 하단에서 잘리던 문제. 드롭다운은 컨테이너 밖으로 떠야 정상(표준 동작). 레이아웃(컬럼)은 비스크롤, 목록만 스크롤.

### 결정 5 — 관제 웹 폰트 = 로그인과 동일 적용 후 롤백
- **결정**. `--font-sans/display`에 Archivo Black/Do Hyeon prepend로 대시보드 전역에 로그인 폰트 적용 → **사용자 롤백 요청 → Inter 복원**(globals.css net 0, 커밋 없음). 로그인 페이지 폰트(인라인 적용)는 유지.
- **이유**. Archivo Black은 헤비 디스플레이 폰트라 데이터 밀집 대시보드(표·숫자)엔 부담 → 사용자가 롤백 선택. 모노(JetBrains Mono)는 정렬용이라 미변경이었음.

---

## 2026-06-08 세션25 — 재가동(URL 회전) + 관제 웹 로그인/헤더 디자인 개편 + 팀원 공유

### 결정 1 — 헤더/로그인 토글 = 알약 슬라이딩 스위치 (21st.dev Serenity UI)
- **결정**. 라이트/다크 토글을 ☀/🌙 단일 버튼 → **알약 슬라이딩 스위치**(64×32, 썸이 현재 상태 아이콘을 표시하며 좌↔우 슬라이드)로 교체. 로그인 화면 **언어 토글(한↔EN)** 도 동일 디자인(primary 썸, 한/EN 텍스트). 원본은 `lucide-react`+`framer-motion`이나 **의존성 0**(인라인 SVG+Tailwind transition)으로 이식, 원본 `div role=button`→실제 `<button>`(a11y). 커밋 `2738fc8`(테마 토글분).
- **이유**. 시각적 완성도 + 한 곳에서 토글 패턴 통일.

### 결정 2 — 헤더 버튼 = ghost 톤 (ruixenui notifications-filter), 테마 토글은 예외
- **결정**. 헤더 버튼(알림/관리자/사이렌/로그아웃)을 기존 `h-11 채워진 알약` → **ghost**(`h-8 rounded-lg`, 투명 배경 → hover 하이라이트)로. `SECONDARY_PILL` 재정의(헤더 4버튼 전용이라 일괄 적용). **라이트/다크 토글은 사용자 요청대로 그대로 둠**(별도 컴포넌트라 자동 보존). POST 배지도 h-8 rounded-lg 정렬. 헤더 이모지(🔔🔊🔇)는 14px 라인 SVG로 통일(관리자·로그아웃과 톤 일치).
- **참고**. ruixenui 링크는 알림 팝오버 컴포넌트 — 그 안의 필터 버튼 그룹(ghost sm)을 디자인 언어로 차용.

### 결정 3 — ★ 로그인 셰이더 배경 = @paper-design/shaders-react (신규 의존성, 사용자 승인)
- **결정**. shadway/background-shader(`MeshGradient`, 4색 네이비/블루 애니메이션 메시 그라데이션)를 로그인 배경에 적용. **신규 npm 의존성 `@paper-design/shaders-react@^0.0.76` 추가** — CLAUDE.md "신규 의존성 사전 합의" 규칙에 따라 옵션 제시(자체 WebGL 재구현 / 원본 라이브러리 / CSS) → **사용자 "원본 라이브러리 설치" 선택**. WebGL 클라이언트 전용이라 `LoginShaderBackground`에서 mount 후에만 렌더(SSR/hydration 회피).
- **대안과 기각**. 자체 WebGL 셰이더(의존성 0) — 사용자가 정확성 위해 원본 채택. CSS 전용 — 메시 셰이더 질감 약해 기각.
- **참고**. 셰이더는 로그인 화면에서만 동작(로그인 후 언마운트). 발표 PC WebGL 필요(지도 타일과 동일 조건).

### 결정 4 — 로그인 풀블리드 레이아웃 + 테마 독립
- **결정**. 레퍼런스(SickUI)대로 **카드 박스 제거**, 콘텐츠를 그라데이션 위에 직접 배치. 가독성 = **글래스 입력**(`bg-white/10`+backdrop-blur)+**흰색 CTA 버튼**+흰색 텍스트(drop-shadow). 배경이 **항상 블루 그라데이션**이라 콘텐츠를 **흰색-온-그라데이션으로 통일**(라이트/다크 동일, 로고만 변형 전환). 텍스트(슬로건/헤딩/본문)는 `whitespace-nowrap`으로 **각 1줄**, `max-w-sm` 폭 제약은 폼에만.
- **이유**. 배경 셰이더가 테마 무관 블루라 기존 `text-ink dark:on-dark`는 라이트에서 안 읽힘 → 흰색 고정. 테마 토글은 대시보드 선호도용으로 유지(로그인 콘텐츠엔 시각 변화 거의 없음).

### 결정 5 — 로그인 폰트 = Archivo Black(라틴) + Do Hyeon(한글), Google Fonts `<link>`
- **결정**. 사용자 제공 `<link href="…family=Archivo+Black&family=Do+Hyeon">` 그대로 적용. 슬로건/헤딩 폰트 스택 `'Archivo Black','Do Hyeon',system-ui` → 글자별 폴백으로 **영문=Archivo Black, 한글=Do Hyeon**(Archivo Black은 라틴 전용이라 한글은 Do Hyeon이 받음). 처음 next/font(Archivo)로 시작했으나 사용자가 `<link>`(두 폰트)로 지정 → next/font 제거하고 `<link>` 단일 경로로 통일(패키지 변경 없음).
- **트레이드오프**. `<link>`는 **런타임 Google Fonts CDN 의존**(발표 PC 인터넷 필요, 지도 타일과 동일). 오프라인 보장 필요 시 next/font 셀프호스트로 전환 가능(한글 서브셋 `subsets:["korean"]` 지정 필요).

### 결정 6 — 팀원 공유 = cloudflared 공개 URL + 로그인 (고정 URL은 결정 대기)
- **결정**. 팀원 공유는 cloudflared 공개 URL(`sends-paintball-often-carolina`) + 로그인(admin/safety2026). 세션19 PII 로그인 세션 게이트 덕에 **비로그인/익명 접근 시 GPS·보호자 redaction**(검증 완료) → 공개 URL 공유해도 안전. 단 quick tunnel은 임시(만료 시 재공유) + 내 Mac이 켜져 있어야 함.
- **고정 URL 옵션(미결정)**. ① Cloudflare named tunnel(도메인 필수, 무료) ② ngrok 고정 도메인(무도메인, 무료 1개) ③ Tailscale Funnel(무도메인, ts.net). 모두 "내 Mac on" 전제 — Mac 무관 24/7은 클라우드 배포(SQLite→관리형 DB 필요, 발표 후 AWS 트랙). 사용자 결정 대기.

## 2026-06-08 세션24 — 수신 URL 재발급 + 태풍 진로 "실 위협 없으면 레이더 미가동" 엄격 게이팅

### 결정 1 — 수신 URL 재발급(터널 회전)
- **결정/방식**. 이전 cloudflared quick tunnel `intelligent-funk-pads-supplies` 가 06-05 종료(만료) → `nohup … & disown` 재기동 → 새 URL `cheers-entire-glass-editorial.trycloudflare.com`. 터널 경유 GET 200 + POST 202(reserved 테스트 워커) 검증. 워치 `ConnectionSettings.defaultURLString`(스탬프 자동 마이그레이션 → 재설치 시 저장값 자동 교체) + CLAUDE.md active URL 선언 3곳 갱신. 커밋 `218b96d`.
- **한계/주의**. **폰 3대 인앱 수신 URL은 코드 상수가 아니라 인앱 저장값/빌드 define** → ⚙️ 수동 갱신(또는 재빌드)이 있어야 실기기 반영(아직 미반영). 워치는 Info.plist ATS 평문 차단이라 LAN 불가 = https 터널 전용. 과거 세션 로그의 옛 URL은 그 시점 기록이라 보존(active 선언 3곳만 교체).

### 결정 2 — ★ 태풍 진로 레이더는 "실제 위협이 있을 때만" 가동 (엄격)
- **결정**. 사용자 요구 = "태풍 위협이 없다면 진로상태 레이더는 가동하지 않는다". AskUserQuestion 결과 = **"지도 숨김 · 위협 없음(엄격)"** 채택. `realThreat = source==="live" && track.length>0` 도입 → `mock`(서비스 미승인/비시즌)·`none`(발효 없음)·빈 진로는 지도/추적 전부 숨기고 `IdleNoThreat`("태풍 위협 없음 · 레이더 대기", 배지 "샘플(대기)", 안내 "활용신청 승인 후 실시간 가동"). `live`+발효 진로일 때만 기존 세션22 한국(36.0,127.8/1000km)·현장 GPS(500km) 반경 게이트 판정(반경 내=지도 가동, 밖=추적 중지). 커밋 `e9567b1`.
- **이유**. 기존 `mock` 샘플 좌표(27.5,126.8)가 한국 반경 안(950km<1000km)이라 **실 위협이 없는데 "위험 반경 내 추적 중" 거짓 점등** = 세션23 KMA `03 NO_DATA`→가짜특보와 동일한 "데이터 없는데 위협 표시" 결함. 상용화 기준(현장 24/7) 에서 거짓 위협은 신뢰 훼손. `mock`은 실 태풍 데이터 자체가 없어 위협을 주장할 근거가 없음.
- **대안과 기각**. (B 채택) "지도 숨김·위협 없음" / (A 기각) 지도 유지 + "추적 중" 라벨만 제거 — 지도가 떠 있으면 여전히 "레이더 가동"으로 보여 요구 위반 / (C 기각) 샘플 좌표를 반경 밖으로 이동 — 여전히 mock 패널이 뜸. 서비스 승인+실 태풍 발효 시 자동 가동(목업 비캐시라 재배포 0). 태풍은 `SafetySignalBoard`(통합 신호등)와 비결합이라 파급 0.
- **검증**. dashboard `tsc` EXIT=0 + Playwright 런타임 — 단일 태풍 패널 위성타일 **0개=레이더 미가동**, "태풍 위협 없음/레이더 대기/활용신청 승인 후 실시간 가동" 텍스트 존재, "위험 반경 내 추적 중" DOM 부재.

### 결정 3 — .gitignore `.playwright-mcp/` 추가
- **결정**. Playwright MCP 검증 산출물(스냅샷·콘솔 로그)이 매 검증마다 생겨 `git status` 오염 → `.gitignore` 한 줄 추가(사용자 승인). 커밋 `96fdad8`. `dashboard-full.png`(이전 세션 1회성 스크린샷)·`.claude/skills/`(스킬 캐시)는 승인 범위 밖이라 untracked 유지.

## 2026-06-08 세션23 — 관제 웹 Playwright MCP 런타임 검증 + KMA NO_DATA 폴백 발견

### 검증 — 세션22 관제 웹 기능 실브라우저 구동 확인 (코드 변경 0)
- **결정/방식**. 사용자 요청으로 dev 서버(`localhost:3000` HTTP 200) 관제 웹을 **Playwright MCP 실브라우저**로 구동 검증. `/verify` 스킬 원칙(런타임 관찰 = 증거, 테스트·타입체크 아님) 적용. **스크린샷은 MCP 가 별도 파일시스템 네임스페이스에 저장 → 내가 못 읽음** → 증거는 **접근성 스냅샷(DOM 텍스트·실데이터 값)·서버 API 직접 호출·`evaluate()` 타일 로드 체크**로 대체(이것들은 내 디스크/응답으로 옴).
- **PASS 결과**. 로그인 게이트(admin/safety2026) · 현장 통합 안전 신호등(종합 worst-of + 가스 상세 팝업) · 현황 요약 캐러셀 4페이지 ‹›네비 · **세션22 태풍 게이팅 검산**(샘플 현재위치 27.5,126.8 → 한국중심 36.0,127.8 haversine ≈948km < 1000km 반경 → "추적 중", 화면 표기 "한국 950km"와 일치 = `haversineKm`+`gate` 정확) · 태풍 지도 확대 슬리피맵(동적 줌 z4·줌컨트롤·타일 30/30) · **세션22 특보영상 YouTube API 라이브**(`type=태풍` → `ok:true,configured:true,channelLimited:true` + YTN 뉴스사 실영상, UI 는 GPS 미등록 시 placeholder graceful) · 지도 타일 CDN 전부 로드(carto·rainviewer·esri 깨짐 0).

### ★ 발견 — KMA `03 NO_DATA` 를 API 오류와 동일 취급해 가짜 특보 표출
- **현상**. 오늘처럼 전국 발효 특보가 없는 날, 관제 웹이 서울/경기/강원 → `강풍주의보`, 전남/경남/제주 → `폭염주의보` 를 표출(둘 다 가짜). 광주는 우연히 정상("특보 없음").
- **원인**. [kma.ts:161](../apps/dashboard-web/app/lib/kma.ts#L161) `fetchAllActive` 가 `resultCode !== "00"` 을 **전부 mock 폴백**시킴. 실제 KMA 라이브는 현재 `resultCode 03 NO_DATA`(= 정상적으로 발효 특보가 없음, 오류 아님). 이걸 오류와 똑같이 취급해 `MOCK_WARNINGS`(강풍주의보 서울/경기/강원 · 폭염주의보 전남/경남/제주)로 떨어뜨림. dev 서버는 오늘 00:05 기동·env 정상 로드 → **stale env 가 아니라 코드 분기 문제**.
- **파급**. ① 6개 지역 GPS 등록 작업자의 현장 기상 신호등 거짓 점등 ② **세션22 특보 영상 패널이 가짜 특보로 실 YouTube 검색 트리거**(쿼터 소모 + 존재하지 않는 특보 영상 노출). 발표일(07-07)이 무특보 날이면 그 6개 지역 작업자에 false warning.
- **결정 대기 (대안 2)**. ① **상용화 기준 수정** — `03 NO_DATA` 는 `source:"live", warnings:[]`(특보 없음)으로 분리하고, 진짜 오류(타 resultCode·fetch 예외)만 mock 폴백. 상용화 목표상 이게 정공법. ② **발표용 폴백 유지** — 비시즌/무특보에도 데모가 "살아있어" 보이게 의도적으로 mock 특보를 보여줌(기존 설계 의도, 세션14~15 의 "미승인/비시즌 안전 강등" 계열). → 발표 우선순위 vs 상용화 정확성 트레이드오프라 **사용자 결정 필요**. (태풍·KMA 의 현 `source:mock` 자체는 태풍 서비스 미승인/무특보로 인한 정상 폴백이며 "샘플" 라벨이 명확해 오인 소지는 낮음.)

## 2026-06-05 세션22 — 낙상 ML 파이프라인 + 트랙A 스캐폴드 + 워치 배터리 진단 + 관제 웹(태풍 게이팅·특보 영상)

### 관제 웹 — 태풍 진로 위험 반경 게이팅 + 특보 영상 패널(유튜브)
- **태풍 게이팅**(커밋 `16502ef`). 태풍 **현재 위치**가 현장 GPS 반경(500km) OR 한국 반경(중앙 36.0,127.8/1000km) 안일 때만 추적(지도+상세), 둘 다 벗어나면 "추적 중지" 패널(현장/한국 거리만). 현장 GPS 미등록 시 한국 반경만. `TyphoonTrack` lat/lon prop + `haversineKm` + `gate`, DemoDashboard `fieldCoords` 전달. 반경 값은 프로토타입 튜닝 상수(물리적으론 태풍 강풍반경 `rad15` 더하는 방식도 가능 — 향후). **라이브 실증** = 제6호 장미가 동쪽 재곡(현재 144.1°E, 한국 1,463km) → 자동 추적 중지(세션16 가고시마남 648km 때는 추적이었음). 게이팅 검산 5케이스(목업 950km·장미 과거 648km·한국근접=추적 / 장미 현재 1,463km·먼 태풍=중지).
- **특보 영상 패널**(커밋 `d7030e2`). 기상특보/예비특보 발생 시 종류(태풍/강풍/호우 등)+등급으로 검색어 자동 생성 → **YouTube Data API v3** 검색 → **주요 뉴스사 한정** → '현황 요약' `WidgetCarousel` '특보 영상' 페이지. 특보 없으면/GPS 미등록 placeholder.
  - **채널 한정 3단 우선순위**: ① `YOUTUBE_OFFICIAL_CHANNEL_IDS`(channelId 엄격, 임포스터 차단) → ② **뉴스사 channelTitle 필터(현재 동작)**, 기본값 `KBS,SBS,MBC,JTBC,YTN,연합뉴스,채널A,channelA,Yonhap`(`YOUTUBE_NEWS_CHANNEL_NAMES`로 재정의) → ③ 일반. 일반 검색(25 후보)→뉴스사 필터→상위 6. `safeSearch=strict`·`relevanceLanguage=ko`·`regionCode=KR`(전국, 특정 도시 미한정)·HTML 엔티티 디코딩.
  - **키**: `.env.local YOUTUBE_API_KEY`(사용자 발급·적용 완료, gitignore·커밋 제외). 미설정 시 `configured:false` graceful. `lib/youtube.ts`+`/api/youtube-warning-videos`+`WarningVideoPanel.tsx`.
  - **★ 비용 구조**: YouTube Data API = **무료 쿼터(units), 금전 차감 0**(10,000/일, 검색 1회=100, 초과 시 403만·과금 X). **특보 없으면 youtube 호출 자체 0**(패널이 `!active` 시 호출 전 return) → 쿼터 0. 특보 시에도 **서버 3시간 캐시**라 종류당 3시간 1회. 결과 0건이어도 호출하면 100 units(쿼터는 요청당).
  - **발표 PC 인터넷 필요**(브라우저가 유튜브 CDN 직접 로드, 레이더 타일과 동일).
- **★ 보류 결정**. `YOUTUBE_OFFICIAL_CHANNEL_IDS`(UC… 엄격 모드) 적용은 **실 기상특보 live 방송 영상이 뜰 때** 결과 보고 채널 ID 확정·검색어 튜닝(현재 전국 특보 0건이라 튜닝 불가). **env-only라 그때 코드 변경 0**(채널 ID 입력 + dev 재시작이면 이름 필터보다 우선 적용).
- **검증**. dashboard `tsc` 0 · 유닛 14/14 · 키 인식(라이브 6건) · 뉴스사 필터(호우/강풍/태풍 전부 연합뉴스TV·YTN·MBCNEWS·SBS 한정) · 특보 없을 때 호출 0. 커밋 `16502ef`(태풍)·`d7030e2`(특보영상). main `ahead 87`.

### 워치 배터리 진단 + 코드 최적화 한계 + 상용화 경로(§9.4)
- **실측**. EMP-5678 배터리 DB 시계열 → 안정 구간 **~8~9%/hr(완충 ~11h)**, 꾸준한 직선(런어웨이·버그 아님). Ultra idle(~36h) 대비 3~4배라 체감 "급격"은 맞으나 **구조적**(사용자 "설치 후 급격 감소" 보고에 대한 답).
- **원인 구조**. 지배 = **워크아웃 세션 연속 광학 HR**(roadmap §9.3 추정 ~50-65%, **불가피** — 잠금우회 §4 의 유일 성립 근거). 부차 = 세션21 **deviceMotion 50Hz**(세션8이 가속도 25Hz로 낮췄던 걸 융합센서 50Hz로 회귀, `추정` — per-subsystem 측정 분리 안 함). 음성 후보(세션22)는 30초 배칭이라 미미.
- **★ 코드 최적화 한계(확인)**. axiom-health `workouts.md` — **워크아웃 세션 중 광학 HR 샘플링을 코드로 스로틀하는 공개 API 없음**(있는 1Hz 저전력 갱신은 **디스플레이** 한정, 센서 아님). 따라서 코드로는 **부차(~35-50%)만** 절감 가능, 지배원은 못 줄임 → **반감 불가**(~9→~7-8%/hr 추정). 부차 절감 3안 = **B1** deviceMotion 50→33Hz(코드 1줄·위험 최소) / **B2** raw 가속도 상시+충격 후에만 자이로(부차 최대 절감·코드 중간, raw \|accel\|이 이미 totalG라 게이트·정지엔 융합 불필요) / **B3** accel-only 25Hz(회전 코로보레이션 포기). 정확 split = deviceMotion ON/OFF A/B 실측 필요.
- **★ 상용화는 가능(데이터 소스 전환)**. 프로토타입 ~11h 는 무료계정+무개조 소비자 워치+잠금우회(워크아웃 세션)의 인공적 산물. 상용화는 §4 데이터 소스 전환으로 지배원까지 절감 → [roadmap §9.4](commercialization-roadmap.md) 추가(커밋 `9f92cd3`): ① Apple Watch+유료 엔타이틀먼트(`healthkit.background-delivery`로 24/7 워크아웃 세션 불필요·`CMFallDetectionManager`·`CMBatchedSensorManager`) ② Android/Wear OS(잠금 제약 없어 우회 불필요·`PassiveMonitoringClient`) ③ 자체 AOSP 웨어러블(펌웨어 duty-cycle·산업용 다일). 한계 = 백그라운드 전달 즉시성 trade-off(`확인 필요`)·소비자 기기 잔존 한계·진짜 다일은 자체 HW.
- **결정**. 발표 = 충전+구간 가동(시연 1h ≪ 11h)이면 코드 변경 0으로 충분 → B1/B2 적용은 **보류**. 커밋 = roadmap §9.4 `9f92cd3` + 세션22 docs `f8360c8`.

### 결정 — 수집 범위 = 전체 활성화 요소 + 음성샘플, 관리자 항목 = 내보내기 + 라벨링
- **배경**. 사용자가 "낙상감지 입력값 최적화 ML" 을 위해 ① 인지 데이터 CSV ② 활성화 요소 전부 ③ 관리자 ML 수집 항목을 요청. AskUserQuestion 으로 범위 확정 — **(Q1) 전체 활성화 요소 + 음성샘플**(워치 재빌드 필요), **(Q2) 내보내기 + 라벨링**.
- **핵심 사실**. 기존 워치는 **양성(발화)만** 전송했고 모션 특징은 `accelMagnitudeG`·`motionStillSec` 2개뿐. 알고리즘이 계산하는 `freefallPrecededImpact`·`peakRotation`·판정사유는 **폐기**됐다. ML 임계 최적화엔 ① 음성 샘플(거부된 작업충격) ② 전체 활성화 요소 ③ 정답 라벨이 모두 필요 → 셋 다 확보하도록 파이프라인 구축.

### 워치 — onFall → onCandidate (양성 + 음성 거부 2종)
- **결정**. [FallDetector.swift](../apps/worker-watch-poc/Sources/FallDetector.swift) `onFall((Double,Double))` → `onCandidate(FallCandidate)`. 후보가 "해소"될 때마다 emit — 발화(`fall`) + 거부 2종(`rejected_no_corroboration` 정지 충족했으나 전조·회전 없음 / `rejected_timeout` postWindow 내 정지 미충족). `FallCandidate`(decision·peakG·stillSec·freefallPreceded·peakRotationRadS).
- **이유**. 음성(거부된 작업충격)은 임계 최적화 학습의 **필수 음성 클래스**. 기존 3단계 판정·임계값은 그대로 — `resolve()` 가 3 해소 경로에서 emit만 추가(외부 파급 0). `simulateFall` 은 합성 양성(3.4/1.5/freefall true/rot 7.0) 보존.
- **전송**(VitalTransmitter `sendFallCandidate`). 양성 = `fallDetected` 동봉 + 즉시 flush(긴급). 음성 = `fallDetected` 미동봉 + 30초 배칭(라디오 절감, 알림/카드 미발火). WorkoutManager `handleCandidate` 가 양성만 카드/알림 갱신.

### dashboard — 수집·내보내기·라벨링
- **schema**([vital-stream.ts](../packages/schemas/src/vital-stream.ts)). optional 4필드 `fallCandidate`/`fallDecision`(enum)/`freefallPreceded`/`peakRotationRadS`.
- **DB**([db.ts](../apps/dashboard-web/lib/db.ts)). vital_samples 멱등 마이그레이션 6컬럼(`accel_magnitude_g`/`motion_still_sec`/`fall_candidate`/`freefall_preceded`/`peak_rotation_rad_s`/`fall_decision`) — 충격/정지는 종전 raw_json 에만 있었으나 ML 질의·통계 위해 전용 컬럼화, **레거시 행은 export 시 `COALESCE(col, json_extract(raw_json,…))` 로 백필**. `fall_labels` 테이블(sample_id PK, label/note/labeled_by/labeled_at). 함수 `exportFallDataset`/`listFallCandidates`/`setFallLabel`/`fallCollectionStats`. **`getDb()` HMR 가드를 신규 statement(`exportFallDataset`)로 갱신**(옛 번들 재초기화).
- **API 3종**. `fall-candidates`(GET 통계+목록)·`fall-label`(POST {sampleId,label})·`fall-export`(GET CSV). 전부 `verifyBasicAuth`. label ∈ {true_fall, false_positive, unsure}.
- **UI**([AdminExportModal.tsx](../apps/dashboard-web/app/components/AdminExportModal.tsx)). `FallMlPanel` — 수집 통계(총/양성/음성/라벨됨) + 기간 CSV 다운로드 + 후보 라벨링 표(판정 배지·충격G·정지·회전·자유낙하 + 라벨 드롭다운 낙관적 갱신).

### ML 스캐폴드(트랙A) — ml/fall-detection/
- **`optimize_thresholds.py`**. fall-export CSV → 현재규칙 기준선(혼동행렬) → 임계 그리드 탐색(`impact_g_min≥2.8`·`still_sec_min`·`rot_min`, 비용 `w_fn·FN + w_fp·FP`, `--fpr-cap`) → 작업자 GroupKFold 교차검증 → PR곡선(로지스틱=트랙B 미리보기) → FallDetector.swift 권장 상수. **무거운 라이브러리 지연 import + 선택적** → `--selftest`(결정로직, 설치 불필요)·`--demo`(합성 검증)·데이터 0건/미라벨도 안내 후 안전 종료. requirements.txt + README. `.gitignore` Python(.venv/__pycache__) 추가(out/ 기존 무시).
- **데이터 생성 구조상 한계(중요)**. ① 모든 후보는 충격 ≥2.8G(워치 게이트) → 충격 임계는 **올릴 수만** 있고 안전하게 내릴 수 없음 = 2.8G 미만 약한 낙상은 데이터 부재 = **recall 사각지대**(게이트 검증하려면 알림 임계보다 낮은 로깅 임계로 별도 수집). ② `freefallG`·`stillBandG`·`postWindowSec` 는 워치에서 집계에 이미 반영돼 집계 feature 만 남으므로 본 CSV 로 재튜닝 불가 → 재최적화 가능 임계 = `impact_g_min`·`still_sec_min`·`rot_min` 셋뿐. ③ 레거시 행(신규 feature 없음) 제외. ④ 라벨 노이즈 = 정확도 천장(CCTV 대조 권장).

### ★ 현재 단계 = 데이터 축적만, ML 아직 미실행
- **명확화**. 사용자 질문 "ML 진행 중인가 데이터만 축적인가" → **데이터 축적만**. 워치 낙상감지는 여전히 **고정 규칙(손으로 정한 임계)** 이고, 학습/추론/임계 자동최적화는 **0**. 이번 작업은 ML 의 **전제(수집·라벨·내보내기·스크립트)** 이지 ML 자체가 아님. 파이프라인 6단계 중 1단계(수집·라벨)에 진입.
- **트리거**. 실 양성(낙상)·음성(작업충격) 누적 + 관제자 라벨링 → 클래스별 충분량 도달 후에야 트랙A 실행.

### 워치 재빌드 실기기 가동 확인
- **확정**. 워치 재빌드+install 후 수동 낙상 시연(`simulateFall`)이 신규필드(`fallCandidate`/`fallDecision="fall"`/`freefallPreceded`/`peakRotationRadS:7`) 동봉 payload 로 수신 → **새 빌드 배포·수집 파이프라인 라이브 확정**(일반 HR 샘플은 구·신 동일이라 낙상 이벤트로만 판별 가능). 단 시연 2건은 **합성 상수**(3.4/1.5/true/7.0)라 ML 학습엔 부적합 → `미상` 라벨/제외 권장.

### 검증
- schemas build · dashboard `tsc` 0 · 유닛 14/14 · 워치 watchOS Sim `xcodebuild` **BUILD SUCCEEDED** · 낙상 로직 standalone **5/5**(양성 + 음성 거부 2종 emit) · 런타임 POST→신규 6컬럼 적재 + export COALESCE 백필 + 인증 API 3종 + 미인증 401 · `--selftest` 6/6 · `--demo` 전체경로(그리드 1575조합·GroupKFold·PR곡선 AP 0.916 PNG).
- **커밋** `adfa663`(워치)·`70d3087`(dashboard)·`bc26877`(docs 계획)·`a1b061c`(ML 스캐폴드+gitignore). main `ahead 82`, push 보류.

## 2026-06-05 세션21 — 워치 낙상 감지 알고리즘 보완 (deviceMotion + 자유낙하 + 자이로)

### 워치 낙상 감지 = 2단계 임계 → 3단계 게이트 + 자이로 보강
- **결정**. [FallDetector.swift](../apps/worker-watch-poc/Sources/FallDetector.swift) 를 **충격→정지 2단계**에서 **자유낙하→충격→저활동 윈도 3단계 + 자이로 코로보레이션**으로 교체. 센서도 `CMMotionManager.startAccelerometerUpdates`(가속도만, 25Hz) → `startDeviceMotionUpdates`(userAcceleration+gravity+rotationRate, 50Hz).
- **이유**. 기존 2.8G+1.2s 는 (a) 망치질·팔 내려치기 등 작업 충격에 **오탐**, (b) 충격 후 한 번이라도 움직이면 정지 리셋되어 **몸부림 낙상 미탐**. 보완 = ① **자유낙하 전조**(impact 직전 0.8s 내 총가속도≤0.6G 무중력 딥)를 코로보레이션으로 요구 → 작업 충격엔 무중력 구간이 없어 오탐↓ ② **저활동 윈도**(연속 정지 강제 → 누적 1.2s, 비연속 허용) → 미탐↓ ③ **자이로 강회전**(peak rotationRate ≥ 6 rad/s)을 자유낙하 대체 경로로 둬, 자유낙하를 놓친(벽충돌형) 낙상도 몸통 회전으로 포착.
- **스케일 보존**. `totalG = |userAcceleration + gravity|` 로 가속도계 원시 비력을 재구성 → 정지≈1.0G/자유낙하≈0G 라 기존 2.8G·0.3밴드 임계 **의미 불변**(deviceMotion 전환으로 임계 재튜닝 불필요). 발화 시 `onFall(peakG, stillSec)` 시그니처·전송 payload(`fallDetected`/`accelMagnitudeG`/`motionStillSec`)·서버 무변경 = **외부 파급 0**.
- **검증**. watchOS Sim `xcodebuild` **BUILD SUCCEEDED** + 결정 로직 복제 standalone Swift **5/5 PASS**(실낙상 발화·망치질 미발화·벽충돌낙상(회전 보강) 발화·지속운동 미발화·몸부림후정지(비연속 누적) 발화).
- **대안·기각**. (a) **CMFallDetectionManager**(Apple ML 낙상 직접 수신) = 특수 entitlement `com.apple.developer.coremotion.fall-detection` + 유료 Program + Apple 승인 필요 → 무료 Personal Team(F2P5ZFP65Q) 서명 불가(§4 때 제거한 `healthkit.background-delivery` 와 동일 계열 블로커). **상용화 트랙 정공 경로**로 기록, 발표 비범위. (b) **CMBatchedSensorManager**(800Hz 추정 고주파) = axiom 미커버 + 워크아웃 세션 중·잠금 중 배치 전달 spike 검증 필요 → 발표 후. (c) **온디바이스 ML** = 실낙상 학습데이터 확보 난제(axiom "research project" 경고) → 비채택.
- **실기기 검증 완료**. §4 잠금 PASS 는 HR null 0%만 실측이었고 가속도 잠금-중 흐름은 코드 주석 가정이었으나, 보완 후 **잠금 상태에서 실제 낙상 감지 동작을 실기기로 검증 완료**(사용자 보고) → 가속도가 잠금 중에도 흐름을 확인(§4 의 HR-only 한계 보완). `simulateFall(3.4G,1.5s)` 수동 트리거는 알고리즘과 무관하게 데모 보장.

## 2026-06-05 세션20 — LAN 연결 · 직급/직책 · GPS 진단 · 종합 취약점 감사 · 감사조치(폰/웹/워치) · 2단말 재빌드

### 작업자 직급/직책 = 폰 발신 + 관제 웹 오버라이드 (이중 입력)
- **결정**. 직급을 두 경로로 입력 — 폰 ⚙️(작업자 본인, `vital_samples.job_title`) + 관제 웹(관리자, `worker_profile` 테이블). 효과 표시값 = **웹 오버라이드 ?? 폰 발신값 ?? "—"**(관리자 지정이 폰값을 덮어씀).
- **왜**. 직급은 조직 메타라 관리자 관리가 자연스럽고, 동시에 작업자 본인 입력도 지원해야 함(사용자 요구 "둘다"). 단일 테이블 last-writer-wins은 폰 재전송이 웹 편집을 되돌리는 충돌이 있어 **우선순위 모델**(별도 저장 + 표시 시 병합)로 회피.
- **구현**. 표 13열 직급 컬럼(클릭→모달→`POST /api/worker-profile` 세션인증), DB 멱등 마이그레이션, CSV/XLSX export. 가상 작업자 fixture 직급. 커밋 `a75a6fc`/`3aef23e`.

### GPS 미수신 = 세션 토큰 무효화(폰 문제 아님)
- **진단**. 대시보드에서 생체는 정상인데 GPS·보호자만 미수신 → 폰 GPS는 DB에 33k건 정상 적재. 원인 = **dev 재기동으로 in-memory 세션 토큰 무효화 → PII redaction**(LoginGate는 토큰 존재만 검사라 로그인 상태로 보이나 서버가 거부).
- **해결**. 로그아웃→재로그인(새로고침 X). 세션 영속화 대신 **현행 유지**(audit가 의도적으로 in-memory+TTL로 둔 설계 보존). 메모리 `project-dashboard-session-relogin`.

### 종합 취약점 감사 → 감사조치 우선순위
- **방법**. 관제웹+iOS+워치를 멀티에이전트 read-only로 9차원 스캔. **CRIT/HIGH 0**(프로토타입 스코프 — 회전 터널·합성 데이터·dev 바인딩 덕). 관통 테마 2 = **데이터 연속성**(전송 실패 시 유실)·**False-OK**(폰/워치 끊겨도 sticky가 "정상" 표시).
- **발표전 권장 4 구현**. (폰)mounted 가드·SOS 재시도·(웹)stale 강등·(공개 URL 시)rate limit. + AF2(재전송 큐)·AF4(알림 이력).

### 연결끊김 상태머신 = 60초 임계 (워치 배칭 오탐 회피)
- **결정**. 60초 미수신 시 신호등 슬레이트+"연결끊김"으로 강등(생체 상태보다 우선). 처음 30초로 했으나 **워치 30초 배칭** 때문에 정상 상태에서도 매 flush 직전 깜빡(오탐) → 60초로 상향. 라이브 실측(EMP-5678 워치 13초 전)에서 발견·보정.
- **왜**. sticky merge가 직전 실측값을 유지하므로, 이 판정 없이는 폰/워치가 끊겨도 카드가 "정상 녹색"으로 false-OK. 산업안전에서 가장 위험한 false-negative.

### 워치 ATS = 평문 HTTP 차단 → 워치는 https 터널 전용
- **확정**. 워치 `SupportingFiles/Info.plist`에 ATS 예외 없음 → `http://192.168.219.106`(LAN 평문) 차단. 폰은 `NSAllowsLocalNetworking`로 LAN 가능.
- **데모 구성**. **폰 = LAN / 워치 = cloudflared 터널 혼합**. 워치 재빌드 후 "수신 URL 연결 실패" = 기본 URL이 만료 터널이었던 것(stamp 마이그레이션이 죽은 URL로 덮어씀) → cloudflared 재기동(`intelligent-funk-pads-supplies`) + `defaultURLString` 갱신으로 해결. 커밋 `fd1b117`.

### 재빌드 도구 = 폰 Flutter CLI만 / 워치 Xcode 정상
- 폰(worker-phone=Flutter): **Xcode ▶·Android Studio ▶ 둘 다 금지**(debug가 release AOT 덮어씀) → `flutter build ios --release`+`devicectl install --device <id>`(devicectl은 `--device` 필수). 워치(worker-watch-poc=네이티브 Swift): **Xcode/xcodebuild 정상**(AOT 함정 없음).

---

## 2026-06-04 세션19 — 통합 안전 신호등 · API PII 로그인 게이트 · 그래프 개선

- **★ 미인증 GET PII = 로그인 세션 토큰 게이트** — (결정) GET `/api/mock/vital` 의 PII(GPS·보호자)를 `MOCK_VITAL_EXPOSE_PII=true` **AND** 유효 로그인 세션 토큰(`verifyBasicAuth`) 동시 충족 시에만 노출. 대시보드 폴링은 `Authorization: Bearer <getSessionToken()>` 동봉. POST(폰/워치 수신)는 무인증 유지. (이유) 팀원에게 공개 cloudflared URL을 공유하면서도 "PII 유지(로그인 대시보드)"와 "익명 외부인 PII 차단"을 동시 충족 — 세션18 audit M1을 env 게이트에서 세션 게이트로 한 단계 강화. 위조 토큰(LoginGate "토큰 존재만 확인" 우회)도 서버 세션 검증으로 차단. (대안 기각) 전체 GET 401 게이트 = 비로그인은 redaction 데이터조차 못 봐 불필요(UI는 이미 로그인 게이트). POST 인증 = 폰이 토큰 못 보내 ingestion 깨짐. 커밋 `722a92c`
- **★ 관제 웹 공유 = 기존 터널 그대로 + 위 세션 게이트** — (결정) 팀원 공유 시 cloudflared 재발급 없이 기존 URL(`switch-biography-surplus-cold`, 생존 확인) 사용. (이유) 재발급하면 워커폰 4대(BECKS/YJH/Galaxy/워치) 인앱 수신 URL을 전부 재입력해야 live 데이터 안 끊김. 기존 URL이 살아있고 PII가 세션 게이트로 보호되므로 재발급 불필요.
- **★ 현장 통합 안전 신호등 = 4카테고리 worst-of 램프 + 클릭 상세** — (결정) 기존 단독 기상신호등(`WeatherHazardPanel`) 자리를 현장기상/작업자/가스/AED 4 램프 + 종합(4 worst-of) 보드(`SafetySignalBoard`)로 교체, WeatherHazardPanel 흡수·삭제. 각 행 1줄(요약+핵심 영향/골든타임) + 클릭 시 상세 팝업. (이유) 사용자가 4개 신호등을 한 레이아웃에 통합 요청. 4개 모두 severity 도출 가능(기상=`/api/kma-warning`, 작업자=`workerStatus` worst-of, 가스/AED=행 `sev` worst-of) → 통합 가능. 기상 램프가 보드에 흡수되므로 기존 단독 패널 중복 제거. (대안) 가로 스트립/우측 캐러셀 페이지는 기각(기존 기상신호등 자리 확장이 중복 없고 자연스러움). 커밋 `269e663`/`b76f6a6`
- **★ 통합 신호등 상세 = 도메인 지식 + 면책** — (결정) 각 항목 클릭 시 영향·노출기준·골든타임·위치를 팝업으로. 가스 종류별 지식 테이블(CO/H₂S/CH₄/O₂/VOC: 작업자 영향+노출기준+권장대응), AED 구동 가능 잔여 추정(완충 대비 환산: 대기 개월/충격 횟수). (이유) 사용자가 "co 52ppm 탱크야드 + 작업자 영향·골든타임", "배터리 부족 + 구동 잔여 시간·위치" 식 상세 안내 요청. (주의) 가스 노출기준(TWA/STEL/IDLH)·골든타임 수치는 KOSHA/NIOSH 도메인 참고값 → 팝업에 "법적 단정 아님" 면책 표기, 발표 전 표준 검수 권장(`확인 필요`). AED 잔여는 투명한 추정 모델("추정치" 표기). 가스/AED는 현재 가상 샘플(`GAS_ROWS`/`AED_ROWS`), 실센서 발표 후. 보드 표기는 사용자 요청으로 2줄→1줄(요약+영향 인라인 병합), 상세는 팝업 유지. 커밋 `51b4caa`
- **★ Tailwind v3 `colors:var()` opacity 수정자 무효** — (사실) `tailwind.config colors:{primary:"var(--color-primary)"}` 구조라 `bg-primary/10`·`ring-primary/50` 같은 opacity 수정자가 알파를 var() 색에 주입 못 함 → 투명/기본 blue-500 폴백(no-op). (해결) 알파 필요 시 리터럴 hex `bg-[#0052ff]/10`·`ring-[#0052ff]/50` 사용(Tailwind가 hex에 알파 주입). CDP computed style 로 확인(`rgba(0,82,255,0.1)`). 기존 `hover:bg-primary/10`(SiteSafetyTables/KoshaAccidentCaseCard) 등도 무효 상태였음(범위 밖이라 미수정·보존). 선택 셀 디자인을 이 hex 방식으로 적용 후 최종은 뉴트럴 칩(파랑 미사용)으로 결정.
- **체온 그래프 추정 체온 병기 = 요약+호버(평행선 기각)** — (결정) 체온 그래프에 손목온도 외 추정 체온(손목+0.5℃)을 요약 카드·호버 툴팁에 amber로 병기(skinTempC 한정 `hoverExtra`/`sub` 옵션 prop). (이유) 사용자가 손목/추정 둘 다 표시 요청 → 처음 두 번째 라인(평행선) 제안했으나, 추정=손목+고정 0.5℃라 평행선이라 정보량 낮음 → 사용자가 요약+호버 병기 대안 선택. (부수) 차트 호버를 네이티브 `<title>`(브라우저 지연)→onMouseMove 커스텀 오버레이로 교체(즉시 반응). 공유 차트(`LineChart`/`BarChart`)라 작업자 생체·설비 그래프 동시 적용. 커밋 `6378f36`

## 2026-06-04 세션18 — 로그인 게이트 · 3D 로고 · LAN 방화벽 · 현장위치 GPS 노출 · 안전신호등 대안C

### 관제 웹 진입 로그인 게이트 — 클라이언트 게이트 + 기존 관리자 인증 재사용
- **결정**. 첫 페이지에 로그인 화면(`LoginGate`+`LoginScreen`). 자격증명은 기존 하드닝된 `/api/admin/login`(`ADMIN_ID`/`ADMIN_PASSWORD`, fail-closed)+불투명 세션토큰 재사용. 대시보드 보기 토큰은 `safetymonitor.session.v1`로 **관리자 export 모달 키(`safetymonitor.admin.token.v1`)와 분리** → "보기 권한"과 "CSV 내보내기 권한" 결합 방지.
- **이유**. 새 인증 시스템을 또 만들지 않고 세션17에서 하드닝한 인프라를 그대로 씀(일관·저위험). 게이트는 프레젠테이션 계층(클라이언트) — API PII는 redaction, 네트워크는 LAN 방화벽이 별도 담당. SSR은 스플래시→클라이언트 판정으로 깜빡임 차단, 미인증 시 `DemoDashboard` 미마운트(폴링 안 함).
- **한/영 토글 = 로그인 페이지 한정**. 다국어는 영구 비범위라 대시보드 본문은 한국어 유지. 사용자 명시 요청으로 로그인 화면 텍스트만 KO/EN(`safetymonitor.lang.v1`).

### 로그인 로고 = Three.js 사전 렌더 3D 베벨 유리 배지(PNG)
- **결정**. CSS 모사가 아니라 **Three.js로 실제 3D 씬 렌더**(라운드 사각 `ExtrudeGeometry` bevel + `MeshPhysicalMaterial` clearcoat/IOR 유리 + PMREM 절차적 스튜디오 환경광 + 디렉셔널 키/필) → 2048² 투명 PNG(라이트/다크) 산출 후 적용. 아이콘은 중앙 cover 크롭+라운드 클립으로 배지 앞면에 입힘.
- **이유**. 사용자가 "베벨/굴절 광원까지 진짜 렌더링" 요청. 산출물이 정적 PNG라 **발표 PC/런타임은 WebGL·인터넷 불필요**(렌더는 자산 생성 시점에만). 라이트 모드는 흰 배지↔흰 배경 대비 약화 → **베벨/측면을 쿨 실버**(`#aab6cc`)로 정의해 윤곽·입체 확보.
- **대안 기각**. ImageMagick bevel(미설치)·Blender(미설치). CSS-only 글래스(이전 단계, "진짜 3D 아님"이라 격상).

### LAN 개방 + pf 방화벽 = "로컬 네트워크 연결하되 조원 차단"
- **결정**. dev `0.0.0.0:3000`(LAN) + macOS `pf` 허용목록(`scripts/lan-firewall.pf.conf`: `set skip on lo0` + 포트3000 비허용목록 차단). 허용 IP는 `.runtime/lan-allow.txt`(gitignore). `scripts/lan-dev.sh`(nohup+disown LAN 기동).
- **이유**. 사용자가 "LAN 연결 + 조원 비공유" 요청. 같은 WiFi면 `0.0.0.0`만으론 조원도 접속 → 허용목록 IP만 3000 개방. **루프백 skip** 덕에 cloudflared 터널(localhost:3000)·로컬 편집은 방화벽 무영향. 조원이 "다른 망/불확실"이라 안전망 성격(sudo 필요·미적용 상태).
- **대안 기각**. 핫스팟 분리망·앱 비번 게이트 — 사용자 선택은 방화벽 허용목록(코드 변경 0).

### 현장위치 GPS 화면 표시 = MOCK_VITAL_EXPOSE_PII=true
- **결정**. 데모에서 SOS 모달 현장위치/지도·보호자 연락을 띄우려면 `.env.local`에 `MOCK_VITAL_EXPOSE_PII=true`+dev 재시작. GPS·보호자는 **DB엔 항상 저장**되지만 GET 응답은 세션17 M1 redaction이 기본 차단 → 데모용으로 노출 ON.
- **이유**. EMP-1234(장우진) GPS는 100% 수신·저장되나 대시보드 GET이 redact → 화면 미표시. 합성/직원 데모 데이터 + private 터널이라 데모 한정 노출 허용. 되돌리려면 플래그 false+재시작(`.env.local` gitignore라 커밋 무관).

### ★ 안전신호등 대안C — 기상특보 기반 '현장 기상위험 신호등'으로 교체
- **결정**. KOSHA 건설현장 안전신호등(1020)이 **서버측 `resultCode 99 UNKNOWN_ERROR`**(우리 수정 불가, 복구 기약 없음)라 폴백 샘플만 표시되던 패널을, **기상청 특보 기반 신호등**으로 교체. `WeatherHazardPanel`(현장 GPS→`/api/kma-warning`→ 🔴 경보(danger)/🟡 주의보(caution)/🟢 정상(normal) 3색 신호등, 해당 레벨만 점등+`vital-blink`, 예비특보 t7은 `🔔 …예정`). `KoshaSafetyLightPanel` 삭제, 좌표는 `fieldCoords`(작업자 GPS 평균) 전달.
- **이유**. 정상 동작하는 live 데이터(KMA 특보)로 신호등을 실데이터화. 산업현장 핵심 위험(강풍/폭염/한파)과 직결. 같은 키로 1040/1060·특보는 live라 키·계정 문제 아님이 재확정됨.
- **대안 기각**. (A) 1040/1060 사고 빈도 기반 "전국 산업재해 경보"(사건 피드→등급 매핑 인위적) · (B) 작업자 생체+기상 결합 "현장 안전 신호등" · (D) 샘플 유지+"점검중" 배지. 사용자 선택 = **C**(기상특보, live·산업현장 직결). 4상태(정상·주의·위험·대기) 스크린샷 검증.
- **잔존**. `/api/kosha/safety-light` 라우트 + `lib/kosha.ts:fetchSafetyLight`는 호출처 0(dead code) — 기존 코드라 미삭제, 정리 여부 미결.

## 2026-06-02 세션14 — 세로 표 리스트(dnd-kit) · 슬롯100 · 속보/배지 이동 · iOS 재설치 복구 · 기상특보 GPS

### 작업자 모니터링 = 가로 카드 캐러셀 → 세로 표 리스트
- **결정**. 작업자 생체 데이터를 12열 세로 표로 전환. 자동/수동 토글(자동=세로 무한 슬라이딩, overflow 8행↑ 발동 / 수동=정지+`dnd-kit` 드래그 정렬, 순서 localStorage 영속). 이상(주의/위험)=항상 빨강 링, 자동 모드에서만 해당 행 자동 스크롤. 빈 슬롯 등록은 표 상단 '+ 작업자 등록' 버튼.
- **이유**. 인원이 늘면 가로 카드(230px, 한 화면 2~3명)는 가독성 저하. 표 리스트는 한 화면에 다수 스캔 + 정렬 가능.
- **대안 기각**. 드래그 라이브러리 — 네이티브 HTML5 대신 `dnd-kit` 채택(사용자 선택, 부드러운 애니메이션·키보드 접근성). 자동 모드의 2벌 복제 마퀴와 드래그가 충돌 → **드래그는 수동 모드에서만**(자동 시 잠금)으로 해소.
- 카드 전용 컴포넌트(MetricRow·TempDualRow·FallDetectionRow·WorkerStatusRow)+상수(ROW_CLASS 등) 표 전환으로 미사용 → 제거. 커밋 `b43f611`.

### SLOT_COUNT 12 → 100 (등록 버튼 비활성 버그)
- **증상**. 대기 인원이 있는데 '+ 작업자 등록' 버튼이 안 눌림. **원인** = 가상 12명(+실폰)이 12칸 슬롯을 채워 `firstEmptySlot=-1` → 버튼 `disabled`. 슬롯 가득 차야 비활성되는 유일 경로.
- **결정**. 정원 12→**100**(사용자 지정). 이제 사실상 비활성 안 됨. + `reserved_` 접두사 필터 추가(`reserved_test_worker` 진단 POST가 대기 큐에 노출되던 누수 차단).
- **주의**. HMR은 module 상수만 갱신하고 `slots` useState는 보존 → 열린 탭은 옛 길이-12 슬롯 유지(여전히 disabled). **하드 새로고침**으로 `loadSlots` 재정규화 시 해결. 커밋 `1e52625`.

### iOS Flutter 재설치 작동 불가 = debug 빌드 (재확인)
- **증상**. Flutter로 재설치 후 앱 실행 불가. **원인** = 산출물 120MB / `App` 35KB stub = **debug 빌드**(IDE Run ▶ 또는 `flutter run` 기본). iOS 14+는 debug Flutter 앱의 standalone(디버거 없는 단독) 실행을 거부.
- **조치**. `flutter build ios --release`(17.7MB / `App` 5.4MB AOT) + `devicectl install` + `process launch` → 정상 실행. **재발 방지 = IDE Run/`flutter run`(기기) 영구 금지, CLI release만**.

### 외부 페이지 임베드 — 네이버 불가 / 기상청 가능
- **네이버 날씨**(`weather.naver.com/map/...`) — `x-frame-options: DENY` → iframe 전면 차단. 브라우저 보안이라 코드 우회 불가. 링크아웃만 가능.
- **기상청**(`weather.go.kr`) — X-Frame/CSP·frame-busting 0 → iframe 가능. 세션14에 기상특보·폭염 iframe 페이지를 추가했다가 **사용자 요청으로 원복**(데이터 항목화가 우선).

### 현장환경 '기상특보' = 기상청 1360000 API, GPS→17 시·도
- **데이터**. `WthrWrnInfoService/getWthrWrnMsg`(stnId=108 본청) 최신 통보문의 `t6` = "현재 발효 특보 현황"(`o 특보종류 : 구역1, 구역2…`) 파싱. `getWthrWrnList`는 최대 6일 범위 제약.
- **GPS 필터**. 현장 GPS를 17 시·도 중심좌표 최근접 매핑(키 불필요) 후, 구역 문자열에 시·도 키워드 포함 여부로 필터. 경보=위험 / 주의보=주의 / 없음=정상.
- **키**. data.go.kr 활용신청 후 **기존 KOSHA 키로 통함**(403→200, 계정 공통 인증키). `KMA_SERVICE_KEY`(없으면 `KOSHA_SERVICE_KEY` 폴백). End Point=`apis.data.go.kr/1360000/WthrWrnInfoService`(코드 고정, 사용자 입력 불필요).
- `app/lib/kma.ts`+`/api/kma-warning`+WeatherStrip ⚠️ 맨앞 항목. LIVE 검증 = 전남(34.8,126.4)→강풍주의보(caution)/서울→특보 없음. 미커밋.

### 폭염영향예보 = 공개 API 없음
- **확정**. lat/lon/지역 기반 공개 데이터 API 없음(웹 `data.kma.go.kr/.../hwImpactList.do?pgmNo=696` 보고서 목록만). → GPS 데이터 항목화 불가.
- **대안**. 공식 폭염특보(주의보/경보)는 위 기상특보 항목에, 폭염 위험 단계는 체감온도 항목(31/33/35℃ 법적 휴식 기준)에 **이미 커버**. → 별도 '폭염 영향예보' 항목은 중복이라 **불필요(권장)**. 필요 시 체감온도 기반 근사 항목 또는 링크아웃. 자리 결정 대기.

---

## 2026-06-01 세션13 — 불쾌지수 · 실시간 레이더 · 그룹 캐러셀 · 레이아웃 축소 · 워치 URL 마이그레이션

### 불쾌지수 = 참고지표(체감온도와 역할 분리)
- **결정** — 기상청 표준 DI(`0.81T+0.01H(0.99T−14.3)+46.3`)로 산출, 75↑ 주의/80↑ 위험 + 경보 팝업 연동하되 `binding=reference`.
- **이유** — 불쾌지수는 법적 작업중지 기준이 아닌 생활기상지수(참고). 법적 강제는 체감온도(33℃). 모달 안내문에 "참고 지표·위험 판정은 체감온도" 명시해 오인 방지. 기온·습도는 이미 수신 중이라 추가 fetch 0.

### 실시간 레이더 = RainViewer + 자체 타일 그리드(전국날씨 지도 폐기)
- **결정** — "전국 날씨" 페이지를 **실시간 강수 레이더**로 교체. RainViewer 공개 API(키 불필요)를 `/api/radar`로 프록시, Carto 베이스맵 + 레이더 타일을 슬리피맵 좌표 직접 계산으로 오버레이. ▶재생/타임라인 + 클릭 시 확대 팝업.
- **이유** — 사용자가 기상청 레이더(강수 에코 애니메이션) 레퍼런스를 줌. RainViewer가 무료·무키·CORS 허용으로 정석.
- **대안과 기각** — (a) KMA 레이더 이미지 직접 스크랩 = referer/세션 의존·불안정 → 기각. (b) Leaflet/react-leaflet 도입 = 의존성 추가 → 타일 좌표를 직접 계산(2×2/3×3 소규모)해 의존성 0으로 해결. (c) 먼저 만든 17도시 전국날씨 지도(`NationalWeatherMap`)는 사용자가 "레이더 영상"을 원해 폐기·삭제.
- **주의** — 타일은 **브라우저가 외부 CDN(rainviewer·cartocdn)에서 직접 로드** → 발표 PC 인터넷 필수, 방화벽이 막으면 빈 화면.

### SquareFit = ResizeObserver 정사각형 핏
- **결정** — 레이더 타일 박스를 `aspect-ratio + width:auto`로 잡지 않고, 부모 실제 픽셀을 측정해 `min(w,h)` 정사각형을 중앙 배치하는 `SquareFit`으로 감쌈.
- **이유** — `aspect-ratio + width:auto`는 flex 컨테이너 안에서 폭을 0으로 붕괴시켜 타일이 안 보이는 버그가 인라인/팝업에서 반복됨(2회 디버깅). 측정 기반이라 어떤 컨텍스트든 항상 채움.

### 워치 수신 URL = 스탬프 기반 자동 마이그레이션
- **결정** — `ConnectionSettings.init`에서 빌드의 `defaultURLString`이 직전 적용분(스탬프)과 다르면 저장된 URL을 1회 자동 교체. 같은 빌드 내 인앱 수동 편집은 보존.
- **이유** — 앱 재설치는 UserDefaults를 지우지 않아, 이전에 인앱에서 저장한 옛 URL이 새 코드 기본값을 덮어써 "연결 실패"(NXDOMAIN)가 발생. 터널 회전 후 재설치만으로 새 URL이 즉시 적용되게 함.
- **검증** — 서버·터널·페이로드(UTC `Z` ISO)는 201 정상이었고, 실패는 오직 옛 URL throw 때문임을 확인.

### 우측 그룹 캐러셀 + 레이아웃 축소
- **결정** — 공정률/무사고 게이지 + 수신요약을 "현황 요약" 1페이지, 실시간 레이더 2페이지로 `WidgetCarousel` 그룹화. 이후 사용자 반복 요청으로 단계적 축소(수신요약 박스 내용높이화, 작업자 카드 행 min-h 2.4→2rem·값 15px·gap-0.5, 현장정보 2×3+폰트축소, 현장정보 h-112로 현황요약 카드 여백 축소).
- **이유(높이 결합)** — 우측 카드는 `items-stretch`로 **좌측 컬럼 높이에 맞춰 늘어남** → 카드 여백을 줄이려면 좌측(현장정보·신호등)을 같이 낮춰야 정렬이 깨지지 않음. 그래서 현장정보 높이를 조정.

### 국내재해사례 = 제목만 + 세로 자동 스크롤
- **결정** — 카드 축소로 본문이 잘리므로 **제목 한 줄만** 표시, **세로 자동 스크롤**(`useMarqueeScroll`에 `axis:"y"` 추가, 2벌 복제 seamless, 호버/터치 시 정지=수동 스크롤 우선), 상세는 클릭 시 경위 전문 팝업.
- **이유** — 좁은 높이에서 많은 사례를 노출하면서 가독성 유지. 가로 마퀴 훅을 axis 파라미터로 일반화(기본 `"x"`라 기존 가로 호출 무영향).

## 2026-05-31 세션11 — KOSHA OpenAPI 연동 + 티커 자동/수동 스크롤

### KOSHA OpenAPI (사고사망 속보 + 건설현장 안전 신호등)
- **결정** — 발표 내러티브("KOSHA 실시간 위험성 평가 디지털 지원")에 직결되는 KOSHA 공공데이터 2종을 관제 웹에 연동. 둘 다 **전국 데이터**(우리 현장 아님)라 제목에 "전국" 명시.
- **아키텍처** — weather route 패턴 재사용: 서버 프록시(`/api/kosha/*`) + 인증키 서버 보관(`.env.local`, gitignore) + 30분 캐시 + **목업 fallback**(키 없거나 실패 시 데모 무중단). 공통 클라이언트 `app/lib/kosha.ts`.
- **★ 엔드포인트 실확정(실응답 검증)** — `https://apis.data.go.kr/B552468/<서비스>/get<서비스>`. base 단독은 500, 오퍼레이션(`get…`) 필요, 잘못된 오퍼레이션은 404. KOSHA는 **HTTP 200 으로 내리고 `header.resultCode`로 성패 전달**(00 정상 / 99 UNKNOWN_ERROR / 90 APICODE_ERROR / 80 INPUT-ERROR) → `assertNormal()`로 비-00 강등.
- **사고사망 = LIVE** — `news_api02/getNews_api02` + `callApiId=1040`. 실 필드 `keyword`(제목, 날짜·지역 포함)·`contents`(HTML)·`arno`(id). `getconstplan01`이 callApiId로 다중 보드 서빙(1040 사고사망 / 1060 국내재해사례 business 필드 / 1050 기술지침 …).
- **안전 신호등 = 막힘** — `callApiId=1020`은 모든 파라미터/오퍼레이션 변형에서 `UNKNOWN_ERROR(99)`. APICODE 등록됐으나 **KOSHA 백엔드 오류(우리 수정 불가)**. 사용자 결정 = **샘플 유지 + 30분 폴링마다 자동 재시도**(실패는 캐시 안 함 → 복구 시 자동 live). 미복구 지속 시 callApiId=1060(건설업 재해사례)로 패널 교체 옵션.
- **키 형식** — Decoding 키. 우리 키는 64자 hex(특수문자 없음)라 인코딩 무관.

### 티커 자동/수동 스크롤 = useMarqueeScroll 훅
- **결정** — 현장환경·산업재해 속보를 CSS transform 마퀴 + 2벌 복제에서 **rAF `scrollLeft` 누적 방식**(작업자 캐러셀과 동일)으로 통일. 자동 흐름이 실제 스크롤 위치를 전진시키므로 **자동·수동이 같은 위치 공유** → 수동 드래그 자연스럽고 중복 안 보임. 호버/터치 시 정지.
- **★ 핵심 버그 = 소수 픽셀 유실** — `el.scrollLeft`는 브라우저가 정수로 반올림. `scrollLeft += 0.5`를 read-back 하면 1px 미만 증가분이 매 프레임 0으로 깎여 **정지**. 해결 = `posRef`(float) 누적값을 source of truth로 두고 `scrollLeft`엔 **쓰기 전용**(read-back 금지). 캐러셀 주석 "소수 픽셀 유실 방지"와 동일 원리.
- **late-mount 대응** — 컴포넌트가 데이터 로드 전 `return null`이라 effect 실행 시 ref가 없음 → rAF가 매 프레임 `ref.current`를 읽고, **콜백 ref**로 노드 attach 시점에 리스너 부착. `wx-marquee-*` CSS는 orphan화돼 제거.

### 레이아웃
- 안전신호등 패널 = 히어로 좌측(부제 아래) 컴팩트(우측 게이지와 높이 정렬), 신호등 부가문구는 헤더 인라인. 게이지(공정률/무사고) 높이 비율 축소. 산업재해 속보는 빨강 블록 디자인 유지(사용자 요청 복원), 캐러셀 위 배치.

---

## 2026-05-30 세션10 — 관제 웹 서버 중단 + 데스크탑 분리 호스팅 가능성(확인 후 보류)

- **관제 웹 서버 중단**. 결정 = dev(Next.js `next dev -H 0.0.0.0` 체인) + cloudflared 터널(`amber-manufacturer-icq-ion`) 프로세스 종료. 이유 = 사용자 요청. 영향 = 외부 URL 무효화·포트 3000 해제, 단 **DB(`.runtime/safetymonitor.db`)는 보존**(서버만 내림). 재기동 = `nohup pnpm dev:web …` + `nohup cloudflared … --url http://localhost:3000 …` → **새 cloudflared URL 발급** → 폰/워치 in-app URL 갱신 필요.
- **★ 데스크탑 분리 호스팅 = 가능(확인만, 진행 보류)**. 결정 = 맥북=코드 작성 / **동일 네트워크 데스크탑=관제 웹 구동** 분리는 **가능**. 근거 = `dev:web` 가 이미 `next dev -H 0.0.0.0`(전 인터페이스 바인딩)이라 동일 LAN에서 폰·워치가 **데스크탑 LAN IP `http://<IP>:3000/api/mock/vital` 직접 접속** 가능 → **cloudflared 불필요**. **진행은 사용자 지시로 보류**(가능성만 확인).
  - **전제 조건(실제 진행 시)**. (1) **코드 이전** — git 푸시 후 clone(단 현재 main 이 origin 보다 **24커밋 앞선 미푸시**=푸시 보류와 충돌) **또는** `node_modules/.next/.runtime/build` 제외 직접 복사(rsync/AirDrop). (2) **데스크탑 환경** — **Node ≥22 + pnpm 11.1.3** + `pnpm install`(**better-sqlite3 네이티브 모듈 그 OS용 재빌드**) + `pnpm --filter @safetymonitor/analyzers build`(대시보드가 dist/ import — 누락 시 위험도 stale). (3) **네트워크** — 데스크탑 방화벽 3000 인바운드 허용 + **AP 클라이언트 격리 off** + **iOS ATS 평문(http) 1회 검증**(차단 시 cloudflared https 폴백).
  - **주의**. DB가 데스크탑 로컬에 별도 누적(맥북 DB와 분리). 맥북 현재 LAN IP `192.168.10.103`(CLAUDE.md `192.168.219.236`과 다름 — 네트워크 변경됨, 재기동 시 실측 갱신 필요).
  - **대안 비교**. cloudflared(외부망·HTTPS 자동, 단 세션마다 URL 만료·회전 피로) vs LAN 직접(동일망 한정·HTTP·URL 고정적이나 ATS/방화벽 변수). 발표 현장이 동일 네트워크면 LAN 직접이 회전 피로 0. 미결정.

---

## 2026-05-30 세션9 — 연결 복구 + 워치 URL + 관제 웹 UI 개편

- **워치↔폰 URL 동기화 불가(재확정)**. 결정 = 폰 앱 URL 변경이 워치로 자동 sync 되지 않음. 이유 = 폰(`kr.indusview.workerPhone`)·워치 PoC(`kr.indusview.safetyWatchPoC`)는 **번들이 다른 독립 앱**이고 양쪽 다 WCSession 미사용(코드 확인). WCSession 은 "같은 앱의 iOS 타깃 ↔ 페어 워치 확장" 사이에서만 동작 → 별개 앱 연결 불가(= 세션6 경로 B 기각과 동일). 대안 = (채택) 워치 코드 `ConnectionSettings.defaultURLString` 갱신 후 재설치, 또는 인앱 편집. 근본 해결(회전 피로 제거) = 고정 URL(named tunnel) 발표 후 트랙.
- **현장환경 = 디지털 LCD 전광판 티커**. 결정 = 칸 분리된 카드 그리드 → 칸 없이 한 줄로 연속 흐르는 KRX 시세 전광판식 마퀴(녹색 LCD 글자). 이유 = 사용자 요청(전광판 레퍼런스). 위험도 색(주의 amber/위험 red)은 글로우 currentColor 로 **유지**(안전 신호 보존, 정상만 녹색). 구현 = `.lcd-digital`(globals.css) + 2벌 복제 마퀴(`wx-marquee`). 단말 raw 이므로 정책 색은 서버 판정 그대로.
- **공정률 + 무사고 게이지(우상단 2단)**. 결정 = 히어로 우상단 빈 공간에 공정률(착수~준공 경과%) + 무사고(착수 후 무사고 가정 연속일, 다음 100일 마일스톤 진행률)를 **공통 `GaugeRow`로 상하 2단**. 바 = **0~100% RGB 스펙트럼 고정 + 진행지점 이후 dim**(같은 %는 항상 같은 색). 2줄 레이아웃(1줄 라벨+값+경과/총, 2줄 바 안 오른쪽 D-day). 무사고는 사고 데이터 소스 부재라 **착수일 기준 추정**(추후 SOS/낙상 발생일을 "마지막 사고일"로 연동 시 실측 전환 가능).
- **작업자 카드 = 무한 슬라이딩 캐러셀(현장환경식)**. 결정 = 5칸 그리드 → 가로 **한 방향 무한 루프** 캐러셀. 구현 = rAF 누적 오프셋(소수픽셀 유실 방지) + 카드 2벌 복제(한 벌 폭 되감아 seamless) + `overflow-x-scroll` **하단 수동 스크롤바**(`.wx-cards-scroll`) + 호버 정지(수동 우선). **이상(주의/위험) 자동 복귀** = `anomalyPos`로 해당 카드 스크롤 + 빨강 링, 이상 동안 자동 정지. **빈 슬롯 항상 1개** = `displaySlots`(채워진 슬롯 전부 + 첫 빈 슬롯 1개), SLOT_COUNT 8→12. 카드 폭 230px(중앙 공백 제거)·세로 여백 압축. 대안 기각 = CSS 마퀴 단독(이상 복귀 위해 JS 스크롤 제어 필요), 핑퐁(한 방향 무한 요청이라 기각), 복제 비-interactive(같은 핸들러라 양쪽 클릭 정상 → 그대로 유지).
- **가상 작업자 6명(테스트 픽스처)**. 결정 = `VW-001~006`를 클라이언트 전용으로 대기 큐에 상시 노출(서버 전송·DB 적재 X, 카드에 "가상(테스트)" 표기). 이유 = 실기기 2대만으론 캐러셀 슬라이딩/이상복귀 검증 불가. **VW-004 주의(심박118)·VW-005 위험(심박138/SpO₂88)**은 이상 자동복귀 시연용. ts 는 렌더 시 현재 시각 주입(신호 4칸 "수신 중"처럼).
- **SOS 사이렌 = Web Audio 합성 + autoplay 게이트**. 결정 = SOS 모달과 동시에 앰뷸런스 사이렌 재생. 음원 = **Web Audio 합성**(오디오 파일 미번들, 오프라인 동작). 음색 = 삼각 LFO 600~1300Hz 스윕 **구급차 wail**(초기 두톤에서 변경). 이유 = YouTube 효과음은 ToS·기술상 직접 추출/재생 불가 → 합성 근사. 정확 음원 필요 시 권리 있는 mp3 를 `public/` 에 넣어 `<audio>` 재생으로 교체 가능(미채택). **★ autoplay 핵심** = 브라우저는 탭 첫 사용자 제스처 전 소리 불가(코드 우회 불가). 해결 = **"SOS 경보음 활성화" 배너로 1회 클릭 강제**(arm 전 안 사라짐) + `audioArmed` 게이트 + `statechange` 동기화 + arm 시 소급 시작. 대안 기각 = `<audio>`(동일 제스처 제약), 무제스처 자동재생(불가능).
- **무사고 카운터 = SOS 실연락 시 초기화**. 결정 = SOS 후 보호자/119 **전화·문자 액션 시** 마지막 사고 시각 기록(localStorage) → 무사고 게이지를 `max(착수일, 사고시각)` 부터 재집계. 이유 = 무사고를 단순 착수일 추정에서 **실제 사고 대응 이벤트와 연동**(한 단계 실측화). **SOS 팝업/발신만으로는 초기화 안 함** — 오발신·오탐 SOS 로 무사고가 깨지지 않게 실제 연락 액션만 트리거. 추후 자동 119 연계 시 자동 기록 가능.
- **★ 커밋 완료(push 보류)**. 세션9 작업을 **4커밋(main)** 으로 정리 — `9ccbe97`(워치 배터리 A+B+C+URL) · `7723899`(관제 웹 UI 개편) · `046603c`(docs) · `800a903`(SOS 대응 강화). 민감 파일 0건, working tree clean. **push 는 사용자 보류 지시**(로컬 누적). §4 워치 잠금 재검증 후 push 결정.

## 최신 작업 요약 (2026-05-29 세션5)

- **지금까지 작업**. (세션1~4 요약 — 관제 웹 확장 + 스트레스 P0/P1-lite + 폰 UI 리디자인 + iOS 잠금 진단·워치 워크아웃 세션 채택·독립 PoC 구현·§4 잠금 PASS. 상세는 아래 세션4/세션3 섹션.) **(세션5 — 워치 PoC 기능 확장)**: (i) **센서 확장** — 낙상(`FallDetector` Core Motion) + SpO₂(`SpO2Reader` anchored), 손목온도는 미포함(Apple Watch 수면 전용) → `b04e0f8` (ii) **인앱 설정 동적화** — 수신 URL + 작업자(이름/사원번호) UserDefaults 영속 + 동적 읽기 → 재빌드 없이 워치에서 편집 + "수신 확인" 연결테스트 → `4171541`·`6821b4e` (iii) **스트레스 입력 7종 수집** — `StressInputsReader`(폰 미러) + 60s sub-cadence, 알고리즘 `computeStressIndex` 단일 소스 그대로 → `3fec4f6` (iv) **UI 파스텔 카드 개편** — 메트릭별 카드(심박/SpO₂/낙상), 위험 판정색 없음 → `1b0c5f1` (v) **앱 아이콘(VitAIGuard) 스캐폴드** — watchOS 단일 다크 아이콘, PNG 대기 미커밋 (vi) **roadmap §9.1 통신 경로 해명** → `ac4bb9a` (vii) **손목온도 35.7℃ 진단** — 폰 수면값 재전송(실시간 아님) (viii) cloudflared 회전 `enjoyed-keeps-framed-evaluation` + 팀 LAN 뷰잉 안내. ※ 별도로 사용자 IDE에서 **관제 웹 VitAIGuard 브랜딩/레이아웃** 작업 진행 중(체크리스트 세션5 참조).
- **현재 상태**. 워치 PoC가 **잠금 해결(§4 PASS) 위에 5종 모니터링(HR/SpO₂/낙상/스트레스입력) + 인앱 설정 + 브랜드 UI/아이콘** 까지 확장됨 — 모두 워크아웃 세션 중 잠금-무관. **★ 실기기 재설치 완료 + 실측 검증** — EMP-9001 신규 빌드가 store 에 age 1s 로 SpO₂ 92·안정심박 100·활동에너지·낙상 accelG 5.45·배터리 70·작업자명 장우진 수신 → 센서/스트레스/인앱설정 전부 실기기 동작 확인(Ultra 1 한국 모델 SpO₂ 정상). 앱 아이콘·헤더 로고 적용(`65e13bf`). 관제 웹은 히어로 최종 문구 `OPEN SAFETY · NEVER ALONE`, 관리자 현장정보 일 1회 DB snapshot, XLSX/CSV 자료 포함까지 반영. 블로커 여전 = Galaxy Health 권한.
- **다음 할 일**. (1) **워치 배터리 §4 재검증**(세션8 A+B+C 적용·재설치 완료 → 15분 잠금 후 ts기준 gap·null HR 0%·소모율 vs 10.7%/hr, 실기기 사용자 몫) + 커밋·push·flushInterval 조정 결정 (2) 손목온도 freshness 필터 결정 (3) **Galaxy Health Connect 권한**(P0) (4) 2 iPhone 재install (5) 스트레스 baseline(07-07) (6) D2 자동 트리거 (7) D4 리허설. **보류**: P2/P3·Cyён·AWS.

---

## 2026-05-29 세션8 — 워치 PoC 배터리 절감 (A+B+C) + 재설치

- **문제·실측**. "워치 앱 설치 후 배터리 소모 증가"(Apple Watch Ultra 1). DB(EMP-9001) 연속 방전 70%→65%/28분 ≈ **시간당 ~10.7%**(완충 ~9h), 전송 cadence 4~5초. Ultra 1 정상 idle ~36h 대비 **3.5~4배** → 8h 풀시프트 빠듯.
- **★ 결정 — 소모는 버그가 아니라 설계 비용. 지배적 원인(워크아웃 세션 연속 HR)은 제거 불가**. 이유: 워크아웃 세션이 광학 HR 을 연속 고빈도로 돌리는 것 = **잠금 우회(§4 PASS)의 유일한 성립 근거**. 끄면 잠금 중 수집이 깨짐. 따라서 **부차 소모만 절감**하는 A+B+C 채택.
  - **A — 30초 배칭(최대 효과)**. HR 콜백마다 개별 POST(5초) → 라디오 상시 기상이 전형적 소모. 윈도에 누적했다가 **30초마다 1배열 전송** → 라디오 기상 ~1/6. 낙상은 긴급이라 즉시 flush. 실패분 backlog 재시도. 각 샘플은 자기 `ts` 보존(데이터 해상도 유지). `URLSession.shared` 유지(워크아웃 세션이 앱을 살려 §4 에서 검증된 경로). 서버는 배열·단일 둘 다 수신(폰 3대 단일 전송 하위호환).
  - **B — 가속도 50→25Hz**. 충격 스파이크(≥2.8G) 검출엔 25Hz 충분. 모션 코프로세서/CPU 소모 절반.
  - **C — 불필요 수집 타입 disable**. `HKLiveWorkoutDataSource`가 `.other` 기본셋(거리/기초대사 등)을 자동수집하나 본 PoC 미사용 → `disableCollection`(무해 no-op 포함). **활동에너지는 스트레스 입력(`StressInputsReader`)이 쓰므로 유지** = HR·활동에너지만 수집. (근거: axiom-health workouts.md — "Only enable types you actually display or save.")
- **변경 4파일**. [FallDetector.swift:16](../apps/worker-watch-poc/Sources/FallDetector.swift#L16)(B) · [WorkoutManager.swift:106-112](../apps/worker-watch-poc/Sources/WorkoutManager.swift#L106-L112)(C) + onResult 4-arg·종료 flush · [VitalTransmitter.swift](../apps/worker-watch-poc/Sources/VitalTransmitter.swift)(A) · [route.ts](../apps/dashboard-web/app/api/mock/vital/route.ts)(A 서버). + `.gitignore` `build_device/`.
- **검증**. watchOS 시뮬 BUILD SUCCEEDED · dashboard tsc 통과 · 배열 201/단일 202 · **BECKS Apple Watch Ultra Release 빌드+devicectl install 성공**(codesign valid). 빌드 말미 build DB disk I/O 에러는 산출물 완성 후 단계라 무관.
- **★ 미해결 — §4 잠금 재검증 기준 변경**. 배칭으로 서버 received_at 이 30초 묶임 → "전송 끊김 0" 판정은 **`ts`(수집시각) 기준 gap**(HR 5초 수집이라 ts gap ~5초여야 정상)으로 봐야 함. null HR 0% 기준은 동일(배칭은 읽기 무관). 추가로 배터리 소모율을 **기존 10.7%/hr 과 비교**. 실기기·사용자 몫.
- **시연 트레이드오프**. 30초 배칭이라 대시보드 신호바 4↔1 진동 + HR 30초 점프. 절충 원하면 `flushInterval` 15초(재빌드 1회).
- **상태**. 변경 **미커밋**(사용자 "우선 보류").

---

## 2026-05-29 세션7 — 다른 작업자 Apple Watch 추가 설치 시도 → Apple Developer 디바이스 한도 블로커

- **목표·결과**. BECKS 외 다른 작업자(YJH) Apple Watch 에도 워치 PoC 설치 → 발표 시 워치 2대 시연. 결과: **Apple Developer team `F2P5ZFP65Q` 디바이스 한도 벽에 막힘**(Cyён iPhone 16 차단과 동일 원인이 워치 설치에도 재현). **코드 변경 없음 — 환경/계정 이슈.**
- **워치 탐색 원리 (재확인)**. Apple Watch 는 데이터 포트가 없어 **단독 USB 설치 불가** — 반드시 페어된 iPhone 을 통해 네트워크로만 Xcode 에 등장. 워치가 보이려면 그 페어 iPhone 이 먼저 `available (paired)` 가 돼야 하고, 그다음 워치·iPhone·Mac 동일 Wi-Fi + "Connect via network" 로 워치가 iPhone 하위 nested 로 올라옴. iPhone·워치 **각각** 개발자 모드 ON 필요(워치는 토글 후 재부팅 + 확인 다이얼로그까지 눌러야 활성).
- **진단 흐름**. `xcrun devicectl list devices` — BECKS iPhone+워치만 `available (paired)`, YJH iPhone 은 `connected` 에서 멈춤(신뢰·개발자모드·preparing 미완), YJH 워치는 목록 미등장. 워치 재부팅+신뢰 후에도 안 잡힘 → 진짜 병목은 워치가 아니라 **YJH iPhone 이 `connected`→`available (paired)` 전환 실패**.
- **★ 최종 오류 = `DataGatheringNSURLSessionDelegate` HTTP 403 forbidden** (Xcode 26.5). 이건 앱 네트워킹 코드가 아니라 **Xcode 가 Apple 개발자 서비스(developerservices2 등)와 디바이스/프로비저닝 데이터를 주고받다 거부당한 계정·프로비저닝 오류**. 이 403 이 iPhone 의 디바이스 준비(=새 디바이스 등록 조회)를 막아 워치가 못 올라온 직접 원인.
- **원인 우선순위**. (1) **★ 무료 Personal Team `F2P5ZFP65Q` 디바이스 한도** — 가장 유력. Суён iPhone install 막혔던 그 팀. 새 워치 = 디바이스 등록 1건 추가라 한도 초과 계정이 403. 무료 계정은 "한도 초과" 대신 403 으로 나오는 경우 흔함. (2) Apple ID 세션 만료(Xcode → Settings → Accounts 재로그인). (3) Apple 개발자 서비스 일시 장애(developer.apple.com/system-status). (4) VPN/프록시/필터의 `*.apple.com` 차단.
- **선택지 (미결정)**. (a) Apple Developer 콘솔에서 안 쓰는 디바이스 정리 — 단 디바이스 목록 reset 은 연 1회라 회복 제한. (b) 다른 Apple ID 로 team 교체 — BECKS 워치 등 기존 설치분 재서명 부담. (c) 유료 Apple Developer Program($99/년) — 디바이스 100대 + reset 유연.
- **결론 (발표 영향)**. 다중 워치 설치는 **iPhone 과 동일한 디바이스 한도 벽**에 부딪힘 → 무료 팀 유지 시 **발표 워치 시연은 BECKS Apple Watch Ultra 1대**가 현실적. 워치 2대가 꼭 필요하면 위 (b)/(c) 결정 필요. (Android 는 device 수 제약 없음 → Galaxy 우회와 동일 구도.)

---

## 2026-05-29 — 워치↔폰 연동(경로 A) + 보호자 폰-입력(a) + 2→1 병합 실측

- **★ 연동 방식 = 경로 A(서버 레벨 병합), WCSession 직접 연동 기각** — 워치 PoC(`kr.indusview.safetyWatchPoC`, `WKWatchOnly` 독립앱)와 폰 앱(`kr.indusview.workerPhone`)은 별개 앱. WCSession 은 "한 iOS 앱 + 그 앱의 컴패니언 워치앱" 쌍에서만 동작 → 독립 워치앱 + 다른 번들이라 기기 간 직접 통신 불가. 직접 연동(경로 B)은 워치를 폰 앱 컴패니언으로 재편입해야 하고 **잠금 우회 이점을 깨뜨려 기각**. 채택 = **같은 사원번호 → 대시보드 `latestByWorker` 가 workerId 로 병합**(신규 코드 0). 자동 양방향 설정 sync 는 경로 A 로는 불가(그건 경로 B).
- **★ 보호자 연락처 = 폰만 입력(a) 결정** — 워치 `ConnectionSettings` 엔 보호자 필드 없음 + 보호자는 워치가 쓰지 않음(대시보드 SOS 모달/SMS 전용). 폰이 매 전송에 guardianName/guardianPhone 동봉 + store sticky(`?? previous`)라 **같은 사원번호면 워치 발 데이터에도 폰 보호자가 유지**. 이유: 폰=메인/워치=보조 구성에선 워치에 보호자 필드 추가 불필요(워치 단독 작업자만 fallback, (a) 전제 비해당).
- **★ (a) 실측 PASS** — 라이브 dev 서버에 같은 사원번호로 폰(보호자+SOS)→워치(보호자 없음·hr 다름) 순서 POST. 병합 결과 = **보호자 폰값 유지 + 심박 워치(최신)값 반영 + SOS 모달 트리거(recent 의 폰 manualSos)·표시 정상**. 모달 base = `latestMap.get(workerId)`(병합 sticky 엔트리)라 보호자가 따라옴. 테스트 DB 행 삭제 완료.
- **★ 2→1 병합 실기기 확인** — 사용자가 워치 사원번호 EMP-9001→EMP-1234(폰과 동일)로 변경. API 확인: EMP-1234 에 **워치 발 배터리 60·가속도**가 인입(폰엔 없던 값) = 병합 성공. 단 **옛 EMP-9001 카드는 슬롯 등록 잔존 + ring 잔상이라 자동 제거 안 됨**(5칸 수동 등록 UX는 등록 워커를 자동으로 안 지움) → 카드 "해제" 1회 또는 dev 재시작으로 정리. 겹치는 메트릭(심박/SpO₂/배터리)은 last-writer-wins 라 폰·워치가 동시 전송 시 카드 값이 번갈아 갱신(폰 잠금 시엔 폰 null→워치값으로 채워짐=의도).
- **★ Android 잠금 송신 가능 확인** — 아래 "상용화 플랫폼 분기 계획" 참조. iOS 와 달리 Android 는 부팅 후 1회 잠금 해제 시 CE 저장소가 재부팅 전까지 유지 → 잠금 중에도 센서 읽기·전송 가능(진짜 제약 = 프로세스 생존: foreground service + 배터리 최적화 예외).

---

## 2026-05-29 — 상용화 플랫폼 분기 계획 (★ 확정 아님)

- **계획 (확정 아님 — 방향성만)**. 상용화 단계의 잠금/백그라운드 생체 송신을 **플랫폼별로 다른 방식**으로 가져갈 계획.
  - **iOS / 애플워치** — `HKWorkoutSession` 워크아웃 세션으로 HealthKit 잠금-암호화를 우회(이미 §4.A PoC PASS).
  - **Android (폰 / 자체 앱)** — 우회 트릭 없이 **포그라운드 서비스 정공법**. 상주 서비스가 센서 읽고 서버로 직접 POST(잠금 중 포함).
  - **자체 웨어러블** — **Android 기반(AOSP), 디스플레이 없음.** 헤드리스 상주 서비스 + (자체 통신 시) 클라우드 직송. 설정·페어링은 폰 앱에서.
- **이유**. iOS 는 화면 잠글 때마다 건강 데이터를 재암호화(per-lock, 코드 해결 불가)라 우회가 필수지만, **Android 는 부팅 후 최초 잠금 해제 시 Credential-Encrypted 저장소가 재부팅 전까지 유지**되어 화면을 다시 잠가도 재암호화되지 않음 → 센서 읽기·전송이 잠금과 무관. 진짜 제약은 암호화가 아니라 **프로세스 생존**(foreground service + 배터리 최적화 예외, 삼성 절전 앱 제외)이라 해결 가능. 디스플레이 없는 웨어러블은 폰을 설정 허브로 두는 게 정석(BLE GATT config write 또는 서버 매개 pull) — 자체 하드웨어라 애플워치의 WCSession 컴패니언 제약도 없음.
- **대안 / 미확정 (확정 아님 명시)**. Wear OS(Health Services + Data Layer) vs 커스텀 AOSP · 자체 통신(LTE/NB-IoT) vs 폰 테더링 · 칩/펌웨어 선정 모두 미정. 발표(2026-07-07) 비범위 — 발표 후 트랙. 상세 [commercialization-roadmap.md §4.B](./commercialization-roadmap.md).

---

## 2026-05-29 세션5 — 워치 PoC 기능 확장 (센서·인앱 설정·스트레스·UI·아이콘)

- **★ 워치 센서 확장 — 무엇을 워치로 낼 수 있나** — Apple Watch Ultra 1(Watch6,18) 기준 결정:
  - **낙상감지** — Apple 내장 낙상감지는 서드파티 앱에 **미개방**(이벤트 구독 API 없음) → `FallDetector`(Core Motion `CMMotionManager` 50Hz 가속도, 충격 스파이크 ≥2.8G → 충격 후 정지 1.2s 패턴)로 **자체 판정**. 워크아웃 세션 중이라 잠금 무관.
  - **SpO₂** — 한국 판매 Ultra 1 은 Masimo 미국 수입금지 미적용이라 혈중 산소 **동작**. 단 연속 아님(백그라운드 간헐 스팟, 앱이 측정 트리거 불가, 워크아웃 중 더 드묾) → `SpO2Reader`(`HKAnchoredObjectQuery`)로 최신 샘플 구독. "참고용 저빈도".
  - **손목온도** — Apple Watch 는 **수면 중에만** 측정(`appleSleepingWristTemperature`), 주간 on-demand API 없음 → 워치 카드 **미생성**. (대시보드의 35.7℃는 폰이 30일 lookback 으로 읽은 최근 수면값을 재전송한 것 — 실시간 아님. freshness 필터 적용은 보류.)
- **★ 워치 인앱 설정 동적화 (재빌드 불필요)** — 수신 URL 이 세션마다 회전하고 작업자도 바뀌는데 매번 재빌드·재설치는 비효율 → `ConnectionSettings`(UserDefaults)로 **수신 URL + 작업자 이름/사원번호** 영속, `VitalTransmitter`가 매 전송 시 동적으로 읽음(정적 접근). `SettingsView`에서 편집 + "수신 확인"(reserved 워커 POST→202, DB 미오염) 연결테스트. **workerId = 사원번호 파생**(폰 패턴과 동일 — 대시보드 자동 분리). 빈 이름/사원번호는 페이로드 omit(스키마 min 1 회피).
- **★ 스트레스 — 워치 적용 = raw 수집만, 알고리즘 재사용** — 분석은 `packages/analyzers` `computeStressIndex` **단일 소스**(CLAUDE.md "단말은 본 분석 안 함"). 대시보드가 [DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx) 에서 **모든 workerId 에 대해** 지수를 계산하므로, 워치가 7입력만 보내면 **EMP-9001 스트레스 칩이 자동**(대시보드/analyzers 변경 0). Swift 포팅은 drift 위험·표시 불필요로 기각. `StressInputsReader`가 폰 `readStressInputs` 미러(HRV 2h·안정/보행심박/호흡 1d 최신, 활동에너지/계단/걸음 60s 합), HR 콜백 피기백 60s. 워치 자기 HealthKit 읽기라 잠금-무관(폰 잠금 중 스트레스 입력까지 수집). 한계 — HRV/호흡 등은 백그라운드/수면 측정이라 작업 중 sparse → 지수는 활동보정 ExcessHR + population fallback에 기댐(폰과 동일).
- **★ 워치 UI = 파스텔 카드 섹션, 위험 판정색 없음** — 사용자 제공 레퍼런스(파스텔 코인 카드) → 생체데이터를 메트릭별 카드(심박=올리브/SpO₂=라벤더/낙상=피치) + 다크 잉크 + 아이콘 칩. **단말은 본 분석을 안 하므로 카드 색은 위험 판정색이 아니라 메트릭 식별용 파스텔**(서버/대시보드가 판정). (앞서 Enode Pro 링 게이지 → 카드로 재변경.)
- **★ 앱 아이콘 — watchOS 는 다크/라이트 변형 불가** — watchOS 홈 화면은 항상 검정 → 앱 아이콘은 **단일**. iOS 18 의 라이트/다크/틴티드 아이콘은 iOS 홈 전용. 따라서 워치엔 VitAIGuard **다크 버전 1개**만 적용(라이트 버전은 추후 iOS 보조앱용). `Assets.xcassets/AppIcon.appiconset`(단일 1024 watchOS) + project.yml `ASSETCATALOG_COMPILER_APPICON_NAME` 스캐폴드. PNG(1024² 불투명, 텍스트 제외 로고만 권장)는 사용자 제공 대기 — 인라인 붙여넣기 이미지는 디스크 파일로 못 만들어 미완.
- **★ 팀 관제 뷰잉 = 동일 네트워크(LAN) 직접** — dev 가 이미 `next dev -H 0.0.0.0`(전 인터페이스), macOS 방화벽 off, Mac LAN IP `192.168.219.236:3000` 응답 200. 팀원은 같은 와이파이에서 그 주소 접속. **주의 = 라우터 AP/클라이언트 격리**(이 프로젝트가 cloudflared 쓴 원래 이유) — 격리 시 핫스팟/cloudflared 폴백.

## 2026-05-29 — 관제 웹 문구·자료 저장 결정

- **결정 (1) 히어로 문구 최종안** — 최종 카피는 `OPEN SAFETY · NEVER ALONE` / `보이지 않는 위험은 없습니다. 혼자가 아니기 때문입니다` / `모든 생체 신호와 현장 환경을 투명하게 — 이상 징후를 발견하는 즉시 대응합니다.` 로 둔다. 이유: 산업안전 관제의 핵심인 "투명성·동행·즉시 대응"을 강조하면서 의료 진단 표현을 피함. 대안으로 `LIVE OPERATIONS`, `ALWAYS WATCHING` 계열도 검토·반영했지만 최종 톤은 더 안전/동행 중심인 문구로 선택.
- **결정 (2) 현장정보 저장은 localStorage + 서버 일별 snapshot 병행** — 화면 즉시 반영은 localStorage 로 유지하고, 관리자 저장 시 서버 SQLite `site_info_daily` 에 KST 기준 일 1회 upsert 한다. 이유: 데모 UX 는 빠르게 유지하면서, 제출 자료에는 현장정보 변경 이력이 날짜 단위로 남아야 함. CSV 는 상단 현장정보 블록, XLSX 는 `현장정보` 시트를 추가한다. 운영 전 보강: AuditLog, 변경 사유, 권한/조직 스코프.

---

## 2026-05-29 세션4 — 워치 §4 잠금 검증 PASS + 설치 교정 + 미커밋 정리

- **★ §4 잠금 검증 PASS (실기기 실증)** — BECKS Apple Watch Ultra(watchOS 26.5)에 워치 PoC install 후 iPhone 잠금 15분 구간 DB 판정:
  - **EMP-9001 워치(워크아웃 세션)**: 182건 · null HR **0%** · gap>20s **0**(최대 7s) · 배터리 85%→85%(15분 변화 0)
  - **EMP-6861 폰(HealthKit 읽기, 대조군)**: 244건 · null HR **98%** · gap>20s 0
  - 둘 다 전송 gap 0 → 네트워크는 양쪽 정상. 차이는 오직 *데이터 읽기 소스*. 세션3에서 결정한 "워치 워크아웃 세션이 잠금을 우회한다"가 실기기로 입증됨 → §4.A 를 상용 1차 경로로 확정. 단 **배터리 풀시프트(8h) 소모는 미검증**(15분은 변화 0).

- **★ 워치 PoC 실기기 설치 차단 3종 — 원인·해결** (세션3 PoC 는 빌드만 됐고 실 워치 설치는 처음):
  - (1) **무료 Personal Team 서명** 채택 — Xcode 가 Team 을 `우진 장 (Personal Team)` 으로 잡음. 이게 오히려 유리 — `F2P5ZFP65Q` 100대 한도(Cyён 폰 막은 원인)를 우회. 단 7일 만료(데모/테스트엔 무관). 무료팀은 `com.apple.developer.healthkit.background-delivery` entitlement 서명 불가 → **제거**(PoC 는 `HKWorkoutSession` live 콜백이라 background-delivery 불필요).
  - (2) **Info.plist 표준 번들 키 누락** — `GENERATE_INFOPLIST_FILE=NO` 라 Xcode 가 표준 키 미주입 → 빌드 산출 번들에 `CFBundleIdentifier` 없음 → "not a valid bundle"(CoreDevice 3000). `CFBundleIdentifier=$(PRODUCT_BUNDLE_IDENTIFIER)` / `CFBundleExecutable` / `CFBundlePackageType=APPL` / 버전 키 추가.
  - (3) **`WKWatchOnly` 누락** — companion iOS 앱 없는 독립 워치앱은 `WKWatchOnly=true` 가 있어야 함(없으면 `WKCompanionAppBundleIdentifier` 요구 → MIInstaller 97 InvalidCompanionApp). 추가 후 설치 성공. (axiom-watchos platform-basics: `WKWatchOnly=YES` = 워치 전용, `WKApplication=YES` 와 함께.)
  - 매 수정마다 watchOS Simulator 빌드 + 산출 번들 plist 키 검증으로 확인. 커밋 `b89042d`.

- **★ 미커밋 dashboard 5파일 = 사용자 IDE Coinbase 디자인 토큰** — 세션3에서 "내가 안 건드림"으로 플래그된 5파일(DemoDashboard/ThemeToggle/WeatherStrip/globals.css/tailwind.config.ts) diff 분석 결과 = 하드코딩 색(zinc/cyan/emerald) → CSS 변수 디자인 토큰(primary `#0052ff`/semantic-up·down/surface·ink·body·muted/Inter·JetBrains Mono/rounded-xl·pill) 마이그레이션 + "LIVE OPERATIONS" 히어로 섹션 + `SummaryStat` 신규. 일관·정상(typecheck 통과·dev 200·미해결 토큰 0). 사용자 작업이라 출처 명시해 커밋 `cb1a927`. ⚠ 폰트는 `next/font` 미연결이라 시스템 폰트 fallback(미적용 항목).

- **★ cloudflared URL 회전** — `creating-availability-stuck-craps` 만료(retry loop) → 재기동 → `confirmed-provider-mainly-touring`(터널 경유 202 검증). 3 폰 + 워치 PoC `VitalTransmitter.endpoint` 갱신. 세션마다 회전하는 quick tunnel 특성 재확인.

---

## 2026-05-28 세션3 — 잠금 해결책 의사결정 + 워치 워크아웃 세션 PoC

- **결정 (1) 네이티브 재작성(Flutter→Xcode)·투트랙은 잠금 문제를 해결하지 못함 — 기각**.
  - 이유: Flutter `health` 는 iOS 에서 네이티브 `HKHealthStore`/`HKSampleQuery` 를 그대로 호출하는 얇은 래퍼. 잠금 중 read=null 은 *Flutter 한계가 아니라 iOS 데이터 보호(`NSFileProtectionComplete`) 한계* → Swift 네이티브로 다시 짜도 동일. 잠금 중 읽기를 끄는 엔타이틀먼트 없음.
  - 투트랙(Flutter + 네이티브 iOS + 네이티브 Android) 기각: 잠금 해결 이득 0 + 코드베이스 3개(유지보수 3배). observer/background delivery·anchored query 도 잠금 해제까지 *지연*만.
  - 출처: axiom-health authorization-and-privacy("Reads do not reliably work when the device is locked") + workouts + sync-and-background.

- **결정 (2) 잠금 해결 채택 경로 = 네이티브 watchOS 앱 + HKWorkoutSession (데이터 소스 전환)**.
  - 제약 확정: 현장 1km+ 원거리 → BLE 직송 불가, 고정 구조 **워치→iPhone→관제웹** 유지. (BLE 는 본래 몸↔주머니 근거리였으나 사용자가 워치 경로 선택.)
  - 선택: 워치 `HKWorkoutSession`+`HKLiveWorkoutBuilder` 가 HR 을 *live 콜백*으로 수집(폰 HealthKit 저장소 읽기 아님) → 폰 잠금 무관. 전송 = (권장) 워치 `URLSession` 직접(watchOS 가 페어 iPhone 인터넷으로 OS 라우팅 → 폰 앱 불필요·잠금 무관) / (대안) `transferUserInfo` relay(백그라운드 큐; `sendMessage` 는 reachable 필요라 잠금 불가).
  - 한계(정직): HR 연속이나 Apple Watch **SpO₂ 스팟·손목온도 수면 한정 → 연속 불가**. 워크아웃 세션 배터리 소모(풀시프트 부담 → Ultra/중간충전). TN3135 — watchOS 일반 앱 raw socket/WebSocket/MQTT 불가, **URLSession HTTP only**. 네이티브 watchOS 타깃 필수(Flutter 불가).
  - 발표 vs 상용화: 발표는 비범위(워치 앱 미작성 원칙) — 잠금 데모는 자동잠금 끄기/Galaxy. 본 PoC 는 상용화 트랙. 상세 [commercialization-roadmap.md](./commercialization-roadmap.md).

- **결정 (3) PoC 는 Flutter Runner 와 분리된 독립 watchOS 프로젝트 — release AOT 덮어쓰기 함정 회피**.
  - [apps/worker-watch-poc/](../apps/worker-watch-poc/) 별도 프로젝트(`project.yml` xcodegen, bundle `kr.indusview.safetyWatchPoC`). Flutter `apps/worker-phone` release 산출물을 안 건드리므로 여기선 Xcode 빌드가 정상·유일 경로(**IDE Run 금지 규칙은 Flutter 앱 전용**). 생성 `.xcodeproj` 는 gitignore(project.yml 이 source).
  - 검증: swiftc 타입체크 EXIT=0 / `xcodebuild` watchOS Simulator BUILD SUCCEEDED / 페이로드 VitalSampleSchema Zod valid / dev POST 201. 물리 워치 실행·§4 잠금 검증(EMP-9001 DB `gap>20s 0+null hr 0`)은 사용자 몫(워치 필요).
  - dev 서버 부수 복구: POST 가 `.next` stale chunk 로 HTTP 500(실 폰 ingestion 도 중단)이던 것 → `.next` 정리 + 재기동 → POST 201.

---

## 2026-05-28 세션2 (이어서) — iOS 잠금/백그라운드 전송 (HealthKit 잠금 암호화 한계 + sticky 복원)

- **결정 (1) iOS 잠금 시 HealthKit 미수신은 플랫폼 한계로 인정 — 코드로 "고치지" 않음**.
  - 진단: 사용자가 "잠금 시 생체 미수신" 보고. DB 진단 결과 **전송은 5초마다 지속(위치 이중화 작동)되나 vitals 가 null**, 잠금 해제 즉시 복구. axiom-health(sync-and-background) + Apple privacy 문서 확인 → iOS 는 잠금 시 건강 데이터를 암호화하므로 백그라운드라도 잠금 중 HR/SpO₂/체온 읽기 불가. `enableBackgroundDelivery`/`HKObserverQuery` 도 잠금 해제 시점까지 지연할 뿐.
  - **"변경 전엔 잠금 됐다"의 진실**: 제거한 시연 fallback(`72/97/36.5` 조작)이 잠금 시 HealthKit null 을 가짜값으로 채워 *그렇게 보였던* 것. 실측 아님.
  - 대안 기각: background-delivery/anchored query(잠금 중 읽기 불가) · 워치 workout session(워치 앱 미작성, 발표 후). 데모 방안 = 자동잠금 끄기(화면 on=백그라운드 실측 읽힘) / Galaxy(검증 권장) / 자체 웨어러블 로드맵.

- **결정 (2) 잠금 모니터링 연속성 = store 생체값 sticky 복원 (비-sticky 회귀 정정)**.
  - 선택: `latestByWorker` 생체값을 `X ?? previous` (sticky)로 되돌림 → 잠금 중 폰이 null 보내도 직전 실측값 유지. 센서 없는 메트릭(SE SpO₂/온도)은 previous 도 없어 "--" 유지.
  - 이유: 세션2 ①에서 SE 가짜값 제거하려 비-sticky 로 바꿨으나, **정확-데이터 요구는 *fabrication 제거*만으로 충족**(센서 없으면 폰이 null → previous null → "--"). 비-sticky 는 불필요했고 오히려 잠금 시 직전값까지 버려 "잠금 미수신" 회귀를 유발. sticky 면 SE "--" 와 잠금 연속성 둘 다 충족. dashboard-only(폰 재설치 불필요).
  - 한계: 잠금 중 값은 직전 실측 *고정*(iOS 가 새 읽기 불가). 변하는 값을 원하면 fabrication(가짜)뿐 → 정확-데이터 요구와 상충, 비권장.
  - 함께: iOS keepalive 강화 — `distanceFilter 10→0` + accuracy best(정지 상태도 연속 위치 → suspend 회피) + **위치 콜백 이중화**(위치 wake 마다 `_pollOnce(throttled 4.5s)`). 전송 지속으로 카드 ts/신호 fresh.

---

## 2026-05-28 세션2 — SE 센서 이슈 / 스트레스 알고리즘 P0+P1-lite / 폰 UI 리디자인 / 발표일 정정

- **결정 (1) "정확히 수신된 데이터만 모니터링" — 폰 fallback 제거 + dashboard 생체값 비-sticky**.
  - 선택: 폰 `_pollOnce` 의 시연용 조작 fallback(HR/SpO₂/온도 모두 null 시 `78/97/36.5` 전송) 제거 → 측정된 메트릭만 전송, null 은 omit. dashboard `store.ts latestByWorker` 생체값을 비-sticky(`vital()` 헬퍼 — 일반 폴은 sample 자기 값만, `manualSos/fallDetected` 이벤트 샘플만 직전 생체값 유지). 60초 cadence 스트레스 입력은 sticky 유지.
  - 이유: Apple Watch SE 는 SpO₂·손목온도 센서가 없어 그 값이 항상 null → fallback 이 가짜 97%/36.5℃ 를 띄움. 사용자가 "정확하게 수신된 데이터만" 요구. 이벤트 샘플(SOS/낙상)은 생체값을 안 실으므로 그 경우만 직전값 유지해야 SOS 모달이 마지막 생체를 보존.
  - 대안 기각: **전면 비-sticky** — SOS 시 생체가 "--" 로 비어 모달 무의미. **fallback 만 제거** — 옛 fallback 값이 ring 에 남아 sticky 로 계속 노출. 둘 다 부분 해법이라 기각.

- **결정 (2) 스트레스 알고리즘 — Flutter 수집(P0) + analyzers TS 분석(P1), 사양서의 Swift+Python 기각**.
  - 선택: 사용자 제공 사양서를 우리 스택에 매핑. 폰은 raw 7입력 수집만(iOS 한정 — Health Connect SDNN/보행심박 매핑 불확실로 `requestAuthorization` 전체가 깨질 위험). 분석은 `packages/analyzers` `computeStressIndex`(STEP1 활동분류 + STEP2 활동보정 ExcessHR + STEP3 HRV 편차 로지스틱 + HRV 신뢰도 가중). 개인 baseline 부재 시 `STRESS_POPULATION_BASELINE` fallback. 표출은 "참고용 추정"(의료 진단 금지). LSTM 은 발표 후.
  - 이유: CLAUDE.md 하드룰 — 분석 로직은 analyzers 단일 source, 폰 단말 분석 금지. baseline 7~14일 필요하나 발표가 07-07 이라 축적 시간 충분. 60초 sub-cadence = HRV/RHR/활동은 느리게 변하고 배터리 절감.
  - 대안 기각: **폰에서 지수 계산** — drift + 규칙 위반. **개인 baseline 완성까지 대기** — 데모에 숫자 안 뜸. population fallback 으로 즉시 동작 + 점진 정밀화 채택.

- **결정 (3) 폰 UI 레퍼런스 리디자인 — 디자인 언어만 차용, 폰 분석 색 없음**.
  - 선택: 사용자 제공 민트/틸 레퍼런스 → `app_tokens.dart` 토큰 + 메인 화면 재구성. 라이트 테마. 히어로/메트릭 카드는 **raw 값 + 연결 상태(UI)만** 표시(위험 판정 색 없음 — 폰 분석 금지 준수). Health 권한·수신 URL 은 설정 화면으로 이동.
  - 이유: 레퍼런스가 폰 목업이라 worker-phone 에 자연스러움. Figma View seat(월 6회 읽기) 제약으로 코드에서 직접 적용이 더 빠름. UI 레이어만이라 "발표 후 로드맵 금지"(아키텍처 리팩토링) 규칙과 무관.
  - 대안 기각: **Figma 라운드트립** — View seat 으로 생성/편집 불가. **dashboard 에 적용** — 폰 목업 레퍼런스라 부적합(사용자가 폰 선택).

- **결정 (4) 발표일 = 최종 2026-07-07** (사용자 명시). CLAUDE.md 의 06-04 는 중간 데모로 추정. 스트레스 알고리즘은 07-07 트랙(baseline 축적). 상세 [[project-final-deadline]].

- **함정 재발 — IDE Run ▶ 버튼**. release 재빌드+CLI install 직후 사용자가 IDE Run ▶ 사용 → debug 빌드가 release 덮어쓸 위험(DEBUG 배너). 로컬 release 산출물(17.7MB)은 무사 확인. **앱 실행은 항상 홈 아이콘 탭 또는 `devicectl`, IDE Run 금지** 재경고. bundle ID 는 `kr.indusview.workerPhone`(스킬 stale).

---

## 2026-05-28 — 관제 웹 대폭 확장 (다크모드 + DB 영속화 + 관리자 내보내기 + 온도 위험도 fix + 자동 재연결)

- **결정 (1) 다크/라이트 모드 — Tailwind class strategy + 사전-hydration 인라인 스크립트**.
  - 선택: `darkMode: "class"` + `ThemeProvider` (localStorage `safetymonitor.theme.v1`) + `layout.tsx` `<head>` 에 동기 인라인 스크립트로 hydration 전 `html.dark` 클래스 적용. 다크 기본. 6 컴포넌트 + `weather-rules.ts` 의 다크-only 클래스 ~150곳을 light/dark 페어로 마이그레이션. severity 색은 라이트 진한 톤(`-600/-700`) / 다크 기존 톤(`-300/-400`) 차등. SVG 차트 grid/tick 은 `currentColor` 트릭.
  - 이유: 사용자가 "토글 + 라이트 완성도 둘 다" 선택. 발표 환경/PC 에 따라 다크가 강해 보일 수 있어 라이트도 깨지지 않아야 함. 사전-hydration 스크립트 없으면 다크→라이트 깜빡임 (FOUC) 발생.
  - 대안 기각: **CSS 변수 기반 토큰** — 점진 마이그레이션엔 좋으나 arbitrary 클래스 (`bg-[#0d1117]`) 가 많아 dark variant 가 더 직접적. **최소 override (.light 셀렉터)** — arbitrary 클래스에 안 먹음. **기각**.
  - 함정: **Tailwind config 변경은 Next.js HMR 이 인식 못함** — `darkMode` 추가 후 dev 재시작 안 하면 `dark:` 클래스가 빈 채로 생성됨 (사용자 "헤더만 다크" 보고로 발견).

- **결정 (2) 실시간 미수신 메트릭 차트 비활성화 (자체 웨어러블 차별화 부각)**.
  - 선택: 카드 메트릭이 미수신(`--`)인데 누적 차트엔 mock deterministic 데이터가 그려지던 문제. `hasLiveMetric()` 판정 → 미수신 시 fetch 건너뛰고 "자체 웨어러블 디바이스 연동 시 5종 메트릭 실시간 수집" placeholder.
  - 이유: 사용자가 "자체 웨어러블 디바이스가 전체 생체 데이터를 받을 수 있다는 부각 효과" 의도로 옵션 2 (차트 비활성화) 선택. mock 데이터가 실측처럼 보이는 혼란 제거 + 자체 디바이스 차별화 메시지.
  - 대안 기각: **현재 유지 + 데모 배지** (혼란 잔존), **실시간 ring buffer 차트** (5분 시연엔 단조 + 구현 부담). **기각**.

- **결정 (3) SQLite (better-sqlite3) 채택 — 생체 데이터 영속 축적**.
  - 선택: `better-sqlite3` (pnpm-workspace `onlyBuiltDependencies` + prebuilt binary). `.runtime/safetymonitor.db` (WAL). `addSample` 이 in-memory ring(500, 화면 갱신용) + DB INSERT(무한 축적) 양쪽. `raw_json` 컬럼 감사 trail.
  - 이유: 사용자 "작업자 생체 데이터를 축적해야 산업재해 자료 제출 가능". in-memory 만으론 서버 재시작 시 휘발. SQLite = zero infra + 동기 + ms 조회 + CSV 내보내기. AWS 결제 보류 상황에 적합.
  - 대안 기각: **JSONL append** (조회/구조화 어려움), **Supabase Postgres** (외부 의존성 + 발표 네트워크 필요 + 수동 프로젝트 생성). **기각**.

- **결정 (4) 관리자 인증 — Basic auth + 환경변수 (발표용 한정)**.
  - 선택: `lib/admin-auth.ts` timing-safe 비교 + env `ADMIN_ID`/`ADMIN_PASSWORD` (default `admin/safety2026`). 로그인 → Base64 토큰 sessionStorage → 매 요청 `Authorization: Basic`. 관리자 메뉴 = 워커/기간 필터 + 위험도 미리보기 + CSV/XLSX 내보내기.
  - 이유: 사용자 "관리자 id/pw 기입 후 메뉴 진입". 발표 프로토타입 + 단일 관리자라 NextAuth/Cognito 는 과잉. 가장 단순하면서 인증 게이트 충족.
  - 대안 기각: **NextAuth/Cognito** (발표 후 로드맵, 현재 과잉), **인증 없음** (사용자 요구 불충족). **기각**.
  - 메모: Basic auth + sessionStorage 는 XSS 위험. 실서비스 화 시 httpOnly cookie + CSRF + 비밀번호 해시 저장 전환 필요. default 비밀번호는 발표 후 즉시 override.

- **결정 (5) 온도 위험도 보정 offset 1.5 → 0.5 (정상 손목 온도 위험 오판 fix)**.
  - 선택: `wristToCoreOffsetC 1.5 → 0.5`. analyzers.test 3 케이스 재작성 (37.6=danger/37.1=caution/36.5=null).
  - 이유: 사용자 보고 — 정상 손목 36.5℃ 가 "위험" 빨강 블링크. 36.5 + 1.5 = 38.0 = dangerC 임계 정확히 일치. 의학 reference 손목/액와 vs 구강/직장 차이 평균 0.5℃ + Apple Watch SLEEP_WRIST_TEMPERATURE 평균 35~36℃. 1.5 는 과대보정. "잠금 상태시 위험" 보고도 동일 원인.
  - 대안 기각: **offset 1.0** (대부분 손목값이 caution 경계, 시연 의도와 충돌), **임계 상향 (dangerC 38.0→38.7)** (의학적 fever 38.0 경계와 상충). **기각**.
  - 함정: **dashboard 가 `@safetymonitor/analyzers` 의 `dist/` 를 import** — src/thresholds.ts 만 고치면 런타임 stale. `pnpm --filter @safetymonitor/analyzers build` 필수 (런타임 검증 시 발견 — 36.5/37.0/37.5 모두 danger 로 나왔다가 build 후 정상/주의/위험).

- **결정 (6) worker-phone 자동 재연결 — lifecycle + connectivity + 영속 3계층**.
  - 선택: `connectivity_plus` + `WidgetsBindingObserver`. (1) 백그라운드→포그라운드 resume 시 Timer 죽었으면 재가동 (2) 네트워크 offline→online 즉시 `_pollOnce` (3) `auto_polling` secure storage 영속 → 앱 재시작/재부팅 자동 시작. "수집 시작"↔"수집 정지" 토글.
  - 이유: 사용자 "네트워크 벗어났다 복귀 시 자동 수집 연결". 진단 결과 lifecycle observer/네트워크 감지/상태 영속 모두 부재. 사용자 "전체 세 계층 모두" 선택 → 모든 시나리오 (백그라운드 복귀 / 네트워크 끊김 복귀 / 앱 재시작) 커버.
  - 대안 기각: **lifecycle resume 만** (네트워크/재시작 미커버), **workmanager/flutter_background_service** (무거움 + iOS Background Task 복잡). **기각**.

- **결정 (7) CSV → XLSX 전환 (`exceljs`) + 현장환경 weather_log 이력화**.
  - 선택: CSV 유지 + XLSX 병행. XLSX 시트1 생체데이터 (이상치 셀 빨강/주황 + 행 배경) + 시트2 현장환경 이력. 컬럼 순서 `id, received_at, ...`. `weather_log` 테이블 + `/api/weather` fresh fetch 시 snapshot 자동 저장.
  - 이유: 사용자 "이상치 붉은색 글씨" + "추가 시트 현장 환경". CSV 는 plain text 라 색·멀티시트 불가 → XLSX 필수. 현장환경 이력은 산업재해 시점 폭염/한파 근거 첨부용 → weather API 가 메모리 캐시만 하던 것을 DB 이력화.
  - 대안 기각: **XLSX 만 (CSV 제거)** (plain 호환성 상실), **현장환경 실시간 snapshot 1행** (과거 사고 시점 환경 못 남김). 사용자가 "둘 다" + "DB 이력화" 선택. **기각**.
  - 메모: weather_log 는 작업자 슬롯 등록 시 (GPS 좌표 있을 때) 5분 간격 축적 — 작업자 0명이면 weather API 호출 안 함.

- **결정 (8) git 저장소 init — 단일 baseline commit**.
  - 선택: `git init` → 147파일/14,498줄 단일 baseline commit `458e16f`. `.claude/settings.local.json` gitignore.
  - 이유: 사용자 "커밋" 요청 시 `.git` 부재 발견. 사용자 "git init + 수일 commit" 선택했으나 새 repo 첫 commit 은 history 부재로 도메인별 분할 불가능 (모든 commit 의 working tree 가 동일 현재 상태) → 단일 baseline 으로 진행. 다음 변경부터 분리 commit 가능.
  - 대안 기각: **6개 도메인 분할 commit** (첫 commit 은 기술적으로 분할 불가). **보류** (사용자가 init 의사 명확). **기각**.

---

## 2026-05-27 — Galaxy Health Connect 권한 흐름 진단 + 4단계 표준 검증 절차 + active cloudflared URL 확정

- **결정 (1) Android Health Connect 권한 흐름 — 우산 권한 ≠ 데이터 타입별 권한, 4단계 표준 검증 절차 채택**.
  - 선택: Galaxy Health 권한 블로커 진단 시 다음 4단계를 표준 절차로 채택. Step 1 `설정 → 앱 → "Health Connect"` 검색 → 설치 여부 확인 (Android 14+ OS 내장 / 13 이하 Play Store "Health Connect by Android" 별도 설치) → Step 2 Health Connect 앱 → 앱 권한 → worker_phone → 심박수/산소포화도/체온 각각 토글 ON → Step 3 Samsung Health → ⋮ → 설정 → Health Connect → 동기화 ON + 항목별 ON → Step 4 Samsung Health 홈에 워치 HR 측정값 가시 확인 + Galaxy Wearable 페어링 점검 → 앱 강제 종료 + 재시작 + "수집 시작" 재시도. 권한 다이얼로그가 뜨지 않으면 Health Connect 자체 미설치 강력 신호.
  - 이유: 사용자 스크린샷 2장 분석. 폰 앱 권한 화면 "건강, 피트니스, 웰니스" 허용됨인데도 [health_vitals_service.dart:31](../apps/worker-phone/lib/services/health_vitals_service.dart#L31) `_health.requestAuthorization(_types, ...)` false 반환 → [main.dart:213](../apps/worker-phone/lib/main.dart#L213) 분기 `authorized ? '5초 폴링 중' : 'Health 권한 필요'` 결과 "Health 권한 필요" 표시. 원인 = "건강, 피트니스, 웰니스" 는 **Health Connect 자체 접근 우산 권한** (Android 14+). 실제 HR/SpO₂/체온 read 권한은 Health Connect 앱 내부에서 worker_phone 의 각 데이터 타입별로 별도 토글. Galaxy 는 추가로 Samsung Health 가 데이터 소스 — Samsung Health → Health Connect 동기화 + Galaxy Watch 측정값이 Samsung Health 에 인입돼야 데이터 0건 회피.
  - 대안 기각:
    - **앱 권한 화면만 보고 권한 통과 판정** — 우산 권한과 데이터 타입별 권한이 다르다는 사실 모르면 권한 OK 인데 데이터 0 인 상황을 영구 디버깅 불가. **기각**.
    - **단일 가설 (예: Samsung Health 동기화만 의심)** — 4가지 원인 (Health Connect 미설치 / 데이터 타입별 권한 / Samsung Health 동기화 / Watch 인입) 중 어느 것이든 single point of failure. 4단계 모두 점검해야 확실히 좁힘. **기각**.
    - **앱 코드 수정으로 우회 (예: 폴링 시 권한 무시하고 시도)** — 권한 미허용 시 health 패키지가 SecurityException 던짐. 우회 불가능 + 정책 위반. **기각**.
  - 부가: [AndroidManifest.xml:4-6](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L4-L6) `READ_HEART_RATE/READ_OXYGEN_SATURATION/READ_BODY_TEMPERATURE` 3종 + [queries:60-69](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L60-L69) `com.google.android.apps.healthdata` package + `ACTION_SHOW_PERMISSIONS_RATIONALE` intent + [activity-alias:39-48](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L39-L48) `HEALTH_PERMISSIONS` 카테고리 검증 OK. [health_vitals_service.dart:18-23](../apps/worker-phone/lib/services/health_vitals_service.dart#L18-L23) Android `SLEEP_WRIST_TEMPERATURE` 제외 분기 + `BODY_TEMPERATURE` 폴백 정상. **코드 측 결함 없음** — Manifest/Service 모두 표준 health 13.x 패턴 준수.

- **결정 (2) adb logcat 진단 명령어 표준화 — `flutter:V HealthConnectKit:V` 필터**.
  - 선택: `adb logcat -s flutter:V HealthConnectKit:V | grep -iE 'health|permission'` 를 Galaxy Health 권한 false 사유 직접 추출 표준 명령어로 채택.
  - 이유: `_health.requestAuthorization` 가 false 반환 시 사유가 다양 (Health Connect 미설치 / SDK 버전 미스매치 / 데이터 타입별 권한 거절 / 패키지 visibility 차단 등). 4단계 검증을 사용자가 수행하지 않거나 시간 부족 시, Mac USB 연결 + 디버깅 ON 만으로 즉시 사유 추출 가능. `flutter:V` = Dart 측 로그 (`debugPrint` 포함), `HealthConnectKit:V` = Android Health Connect SDK 측 로그. `grep -iE 'health|permission'` 로 노이즈 제거.
  - 대안 기각:
    - **logcat 전체 출력** — 노이즈 과다, 사용자가 찾기 어려움. **기각**.
    - **flutter logs 만** — Dart 측 로그만 보이고 Health Connect SDK 내부 에러 누락. **기각**.

- **결정 (3) active cloudflared URL 확정 절차 표준화 — 프로세스 + log tail + status API 3종 검증**.
  - 선택: 새 세션 / URL 불일치 의심 시 다음 3종 검증 후 active URL 확정 표준 절차. (a) `pgrep -fl cloudflared` 로 프로세스 살아있는지 확인 (b) `grep -o 'https://[a-z-]+\.trycloudflare\.com' .runtime/cloudflared.log | tail -1` 로 가장 최근 발급 URL 추출 (c) `curl -s https://status.anthropic.com/api/v2/status.json | jq '.status.indicator'` 로 외부 API 정상 확인 (network hiccup 가능성 배제).
  - 이유: 사용자가 Galaxy 폰에 저장한 URL `prisoners-hosting-shape-assists` 가 CLAUDE.md / progress.md 의 이전 URL `calcium-together-quarterly-companion` 과 불일치. 진단 결과 cloudflared 가 사이에 한 번 재기동되어 새 URL 발급된 상태. 사용자 보고 + log tail + 프로세스 살아있음 3종으로 active URL 확정. 이후 stale URL 참조 일괄 정정 (replace_all 4개 파일).
  - 대안 기각:
    - **사용자 보고만 신뢰** — 사용자가 polling 폰 화면에서 본 URL 도 stale 일 수 있음 (다른 폰에 저장된 URL 일 수 있음). **기각**.
    - **로그만 신뢰** — 로그는 발급 이력일 뿐 active 보장 안 됨 (cloudflared 죽었으면 URL 무의미). **기각**.
    - **status.anthropic.com 만 확인** — 외부 API 정상이어도 로컬 cloudflared 죽었으면 폰 publish 도달 0. **기각**.

- **결정 (4) "건강, 피트니스, 웰니스" 라벨 한국어 단독 정책 호환**.
  - 선택: Android 시스템 권한 라벨 ("건강, 피트니스, 웰니스" / "심박수" / "산소포화도" / "체온" 등) 은 OS 가 자동 한국어 번역하므로 정책 위반 없음. 본 SKILL.md / 문서에서도 이 한국어 라벨 그대로 사용 (영문 fallback 추가 X).
  - 이유: CLAUDE.md 정책 "한국어 단독 — 영문 라벨 추가 금지". Android Health Connect 권한 라벨은 OS 가 ko-KR locale 에서 자동 번역. Health Connect 앱 내부 UI 도 한국어. 사용자 스크린샷에 영문 fallback 없음. 본 문서에서 "Health Connect" 만 영문 식별자 (API field name) 로 사용 OK (한국어 직역 "건강 연결" 은 표준 아님).
  - 대안 기각:
    - **"Health Connect (건강 연결)" 병기** — 영문 fallback 추가 금지 정책 위반. **기각**.
    - **"건강 연결" 단독** — 표준 한국어 라벨 아님 + 사용자 검색 시 못 찾음. **기각**.

---

## 2026-05-26 오후 — Cyён iPhone 차단 + 발표 폰 구성 변경 (iPhone 2 + Galaxy 1) + WeatherStrip 가독성

- **결정 (1) Cyён iPhone 16 install 포기 + Galaxy 실기기로 3번째 폰 우회**.
  - 선택: 발표 폰 구성 iPhone 3대 → **iPhone 2대 (BECKS + YJH) + Galaxy 실기기 1대**.
  - 이유: `flutter run` 출력 `Communication with Apple failed: Your development team has reached the maximum number of registered iPhone devices` + `Provisioning profile "iOS Team Provisioning Profile: kr.indusview.workerPhone" doesn't include the currently selected device "TG i_n" (00008101-001649983AB9003A)`. 원인 = Apple Developer team `F2P5ZFP65Q` 디바이스 한도 도달. Apple 정책상 연 100대 / 1년 1회 reset. 신규 device UDID 가 한도 초과로 provisioning profile 자동 등록 실패. 발표 D-9 임박 → 빠른 해소 불가.
  - 대안 기각:
    - **A) Apple Developer 콘솔 device 정리** — 유료 Apple Developer Program ($99/년) 만 console 접근 가능. 무료 Personal Team 은 console 접근 다름. annual reset 1년에 1회만 가능 → 신중. **기각 사유**: 무료/유료 계정 여부 즉시 확인 불가 + reset 정책 부담.
    - **B) 다른 Apple ID 로 team 교체** — 새 team 의 device slot 사용 가능. **기각 사유**: BECKS/YJH 도 재install 필요 (기존 Apple Development 신뢰 무효화). 발표 D-9 시점에 모든 폰 재셋업 부담.
    - **C) Cyён 폰 install 포기, Galaxy 실기기로 3번째 폰 우회** ← **채택**. Android 측 device 수 제약 없음. `debug.keystore` 자동 생성. `adb install` 무제한. debug 빌드도 standalone 실행 OK (iOS 14+ debug SIGKILL 제약 없음). USB 디버깅 활성화 + Health Connect 권한 + Galaxy Watch 페어링만 필요. **기존 사용자 시연 시나리오 변경 0** (BECKS + YJH 그대로 + Galaxy 1대 추가).
  - 보류 옵션: Apple Developer 콘솔 device 정리 → Cyён 폰 install 재시도. 발표 후 검토.

- **결정 (2) Android vs iOS device 설치 제약 비교 — Android 가 발표 폰 추가에 유리**.
  - 선택: iOS device 한도 시 우회 = Android 실기기 첫번째 옵션.
  - 이유: 비교 표 정리 — (a) iOS = Apple Developer team device 한도 (연 100대, 1년 1회 reset) + codesign + provisioning profile + Apple Development 신뢰 절차 + iOS 14+ debug SIGKILL. (b) Android = 디바이스 한도 없음 + `debug.keystore` 자동 + USB 디버깅 + "출처 미상 앱 허용" 토글 한 번 + debug APK 도 standalone 실행 OK. **Android 가 발표 폰 추가 시 압도적으로 유리**.
  - Android 측 환경 제약 (수 제약 아님): (a) USB 디버깅 활성화 (설정 → 휴대전화 정보 → 빌드번호 7회 탭 → 개발자 옵션). (b) Health Connect 권한 (Android 14+ 기본 내장). (c) Galaxy Watch 페어링 (Galaxy Wearable 앱 → Samsung Health → Health Connect 동기화). (d) JDK 17 + Android SDK (Mac 측 ready). (e) AVD 메모리 부족 → 실기기 우선.
  - 빠른 install 경로: `adb devices` 확인 → `flutter run --release -d <id> --dart-define=MOCK_RECEIVER_URL=...` 또는 `flutter build apk --debug + adb install`.

- **결정 (3) WeatherStrip 텍스트 가독성 개선 — 정상값 흰색**.
  - 선택: 정상 severity 값 `text-zinc-200` → **`text-white`**. 라벨/sub `text-zinc-500` → `text-zinc-300`. 헤더 "현장 환경" `text-zinc-300` → `text-zinc-100`. GPS 좌표/우측 정보 `text-zinc-500/600` → `text-zinc-400`. 주의/위험 색상 (amber/red 블링크) 은 정책 색이므로 그대로 보존.
  - 이유: 사용자 스크린샷 빨간 박스로 현장 환경 패널 글씨 어두움 지적. 검은 배경 `bg-[#0d1117]` 에서 `text-zinc-500` (대략 #71717a) 은 contrast ratio ~3.5 (WCAG AA 4.5 미달). `text-zinc-300` 은 ~7.5 (AAA 7 통과). 정상값은 가장 자주 보는 메트릭이므로 최대 contrast `text-white`.
  - 대안 기각:
    - **모든 텍스트를 white 단일색** — 정상/주의/위험 시각 위계가 사라짐. 정책 색 (amber/red 블링크) 효과 약화. **기각**.
    - **다크 모드 전체 재설계** — 발표 D-9 시점에 scope 과도. **기각** — WeatherStrip 만 surgical edit.

---

## 2026-05-26 오전 — 인프라 안정화 + IDE Run 영구 금지 + 관제 웹 대대적 변경 (테스트 차단 + 5칸 슬롯 + WeatherStrip + 기상 정책)

- **결정 (1) dev + cloudflared 는 `nohup ... & disown` 으로 띄움**.
  - 선택: `nohup pnpm dev:web > .runtime/dev.log 2>&1 & disown` + `nohup cloudflared tunnel --url http://localhost:3000 --no-autoupdate > .runtime/cloudflared.log 2>&1 & disown`. 부모 셸 lifecycle 에서 분리.
  - 이유: 이전 백그라운드 task `bgy979mx0` (dev 서버) 이 셸 종료/compaction 영향으로 stopped → 폰 publish 0건 도달. 사용자 진단 결과 dev + cloudflared 둘 다 down 확인. 일반 background task 도 부모 셸 죽으면 같이 죽음. `nohup` 으로 SIGHUP 무시 + `disown` 으로 job table 에서 제거 → process 만 독립적으로 살아남음.
  - 대안 기각: (a) `systemd` / `launchd` plist — overkill, 발표용 프로토타입에 과한 셋업 (b) `pm2` — 외부 의존성 추가 (c) `screen` / `tmux` — 사용자가 별도 세션 관리해야 함.
  - 영향 범위: 새 dev 세션 시작 시 사용자가 직접 띄우는 게 아니라 자동화 가능. 로그는 `.runtime/dev.log`, `.runtime/cloudflared.log` 에 적재. `.runtime/` 은 `.gitignore` 대상.

- **결정 (2) IDE Run ▶ / 디버그 🐞 버튼 영구 금지 (Xcode 직접 빌드 금지에 추가)**.
  - 선택: CLAUDE.md "Xcode Play 버튼 / 직접 빌드 금지" 정책에 **VS Code / Android Studio Flutter plugin Run/디버그 버튼 금지** 추가. install/launch 후 사용자에게 매번 경고 명시.
  - 이유: Cyён iPhone install 시도 중 `devicectl launch` 가 dev disk image 마운트 시점에 hang. 사용자가 IDE device selector "Cyён의 iPhone (mobile)" 활성 상태에서 main.dart 열려 있는 채로 Run ▶ 버튼 누름. IDE Run 버튼은 `flutter run` (--release 없이) 실행 = **debug 빌드를 install + launch + build/ios/iphoneos/Runner.app 을 120MB debug 로 덮어씀** → release 17.6MB AOT 산출물 손실 → 폰이 홈에서 열리면 iOS 14+ 정책으로 "In iOS 14+, debug mode Flutter apps can only be launched..." 다이얼로그. memory feedback `feedback_ide_run_overwrites_release` 기록.
  - 대안 기각: (a) `.vscode/launch.json` 에 `--release` 강제 — IDE 사용자가 launch config 무시하고 일반 Run 누르면 무용 (b) flutter run 자체를 wrapper 로 차단 — 너무 침습적 (c) 사용자 교육만 — 같은 함정 재발 가능성. 결국 **명시적 경고 + memory 기록으로 매 install 안내 자동화** 가 가장 현실적.
  - 영향 범위: 사용자 워크플로우. install/launch 안내문에 IDE 금지 1줄 의무. Cyён install 후 같은 실수 재발 막음.

- **결정 (3) 관제 웹 — 테스트 워커 차단 가드**.
  - 선택: `isReservedTestWorker(workerId)` 가드. exact match (`infra_check`, `warmup`, `netcheck`) + prefix regex (`/^(test_|smoke_|infra_)/i`). `addSample` 에서 차단 시 null 반환. `recentSamples / latestByWorker` 에서도 필터. POST handler HTTP 202 `dropped: reserved_test_worker`.
  - 이유: 진단/검증용 `curl POST` 가 store 에 카드로 노출되는 문제. 사용자 보고 "작업자 항목에 infra_check 삭제" 요청. 단순 삭제만 하면 다음 진단 때 다시 등장 → 영구 패턴 차단 필요.
  - 대안 기각: (a) **dashboard 측 필터만** — 백엔드 store 는 여전히 들어있음. 새로고침 / 다른 dashboard 에서도 처리 일관성 필요. (b) **store 자체에서 삭제** — 영구 차단 안 됨 (c) **HTTP 4xx 반환** — 실제 폰이 비표준 ID 보내면 의도와 다르게 작동. **202 dropped 가 정답** (success but no-op).
  - 영향 범위: 진단용 POST 모두 자동 차단. 실제 폰 publish 는 보통 `EMP-xxxx` / `demo_ios_xx` 형태라 영향 없음. 단, 향후 `infra_*` 같은 prefix 가진 정상 worker 가 생기면 패턴 조정 필요.

- **결정 (4) 위치 기반 현장 환경 패널 — 작업자 폰 GPS 좌표 평균**.
  - 선택: WeatherStrip 위치 기준 = 등록된 슬롯의 작업자 폰 GPS 좌표 평균. 사용자 결정. payload 의 `latitude/longitude` 필드 평균.
  - 이유: 사용자 결정 (질문 응답: "작업자 폰의 GPS 좌표 평균"). 발표장 좌표 하드코딩 (광주) 보다 동적 — 작업자가 어디 있든 그 장소 날씨 자동. 발표 시연 시 실제 작업자 폰이 publish 하면 그 시점 위치로 날씨 표시 (현장 fidelity ↑).
  - 대안 기각: (a) **발표장 광주광역시 하드코딩** — 시연 일관성 좋지만 발표 장소 변경 시 코드 수정 필요. 동적성 부족 (b) **브라우저 Geolocation 권한** — dashboard PC 의 위치라 작업자 현장과 다를 수 있음 (c) **Mac IP 기반** — 정확도 낮음.
  - 영향 범위: 작업자 0명일 때는 "현장 위치 대기" placeholder 표시. 1명 이상 등록되면 평균 좌표로 자동 fetch.

- **결정 (5) 5칸 슬롯 + 대기 큐 등록 UX (mock fallback 폐지)**.
  - 선택: 카드 grid 가 항상 정확히 5칸. 초기엔 모두 빈 `EmptySlotCard` placeholder. publish 만으로 카드 자동 등장 X — 빈 슬롯 클릭 → `WorkerQueueModal` → 작업자 선택 → 그 슬롯에 할당. 등록된 슬롯 우상단 "해제" 버튼. localStorage `safetymonitor.slots.v1` 영속화. 사용자 결정.
  - 이유: 사용자 결정 (질문 응답: "5칸 전부 빈자리 / 관리자가 수동 등록만 노출"). 발표 시연 시 임의 publish 폰이 카드에 자동 등장하면 시연 통제력 떨어짐. **관리자가 명시적으로 등록한 작업자만 노출** → 시연 시나리오 일관성 확보. mock fallback (`demo_mock_01/02/03`) 도 폐지 — 빈 슬롯이 placeholder 역할 (시연 데모성).
  - 대안 기각: (a) **실폰 + mock 자동 union (이전 방식)** — 임의 publish 폰 등장. 통제력 부족. 실폰 2 + mock 3 = 5 자연 채워졌지만 발표 환경에서 통제 불가 (b) **5명 고정 mock + 신규 폰은 대기 큐** — 빈 슬롯이 mock 으로 보이면 시연성 떨어짐 (c) **빈자리 default + 자동 promote** — 자동 promote 는 통제력 다시 약화.
  - 영향 범위: dashboard `workers` useMemo 폐지 (대신 `slots` state). 빈 슬롯 placeholder 컴포넌트 신규. `WorkerQueueModal` 신규. localStorage key `safetymonitor.slots.v1`. `pendingWorkers` useMemo = publish 중 미할당 워커. 향후 6칸+ 정원 변경은 `SLOT_COUNT` 상수만 수정.

- **결정 (6) 기상 정책 임계 자동 평가 + 클릭 정책 근거 모달**.
  - 선택: 사용자 제공 정책 문서 (산업안전보건기준에 관한 규칙 2025.7.17 개정 + KOSHA Guide H-188 + 환경부 대기환경기준 + 기상청 생활기상지수) 의 5종 항목 (체감온도/풍속/PM2.5/UV/강수) 임계값 그대로 적용. 정상=zinc / 주의=amber 깜빡임 / 위험=red 빠른 깜빡임 (생체 카드와 동일 `vital-blink` 키프레임 재사용). WeatherStrip 항목 클릭 시 `WeatherRuleModal` 표시 — 현재 측정값 + severity 배지 + 현재 적용 단계 (법적 강제 / 권고 / 참고 binding) + 권고 조치 + 출처 + 전체 임계 단계 리스트.
  - 이유: 사용자 명시 요청. 정책 문서가 법적 근거 (산업안전보건규칙 강제 + 중대재해처벌법 연계) 와 KOSHA Guide 권고를 구분하므로 binding 배지로 표시 — 안전관리자가 의사결정에 활용 가능. 생체 카드의 색·깜빡임 시각 언어와 일관성 유지.
  - 대안 기각: (a) **임계 색상만 + 모달 X** — 안전관리자가 임계 근거 모르면 작업중지 의사결정 불가 (b) **모달 X + 툴팁** — 정책 본문이 길어 툴팁 부족 (c) **전체 다단계 게이트 자동화** — 정책 5.1 "체감온도 임계값은 2시간 이상 지속 시 적용" 등 시간 기반 조건 있어 단순 임계만으로 자동 작업중지 결정 부적절. **표시 + 권고 조치 안내까지만**, 최종 결정은 안전관리자.
  - 영향 범위: 신규 `lib/weather-rules.ts` (정책 모듈), `WeatherRuleModal.tsx`. WeatherStrip 항목별 severity → 색상·깜빡임 자동. 정책 임계 갱신 (법령 개정 등) 시 `weather-rules.ts` 의 임계값 상수만 수정.

---

## 2026-05-25 — 환경 산소 제거 + 다중 작업자 분리 fix + Xcode 직접 빌드 영구 금지 정책

- **결정 (1) 환경 산소 row 제거 (대시보드 카드)**.
  - 선택: 카드 6 row (상태/심박/SpO₂/**환경산소**/손목/낙상) → 5 row (상태/심박/SpO₂/손목/낙상). `AmbientO2Row` 컴포넌트 + store merge `ambientO2Pct` + Zod schema `ambientO2Pct` 필드 모두 삭제.
  - 이유: Phase 2 (자체 워치 + SEN0322 센서) 합류 전까지 `N/A · Phase 2` 회색 placeholder 만 표시되어 발표 시 의미가 약함. 발표용 단순화. 폰은 원래 안 보내고 있어 변경 없음.
  - 대안 기각: (a) 회색 placeholder 유지 — 카드 시각 노이즈만 늘림 (b) 모달에 별도 표시 — 시연 동선상 노출 빈도 낮음.
  - 영향 범위: dashboard 카드 1 row 감소. 다른 동작 영향 없음. 추후 Phase 2 에서 SEN0322 센서 도입 시 별도 schema/UI 신규 추가로 부활.

- **결정 (2) workerId 자동 분리 — 사원번호 입력 시 = workerId, 미입력 시 fallback**.
  - 선택: 폰에 `_effectiveWorkerId` getter 추가 (`return (empId?.trim() ?? '').isNotEmpty ? empId : _workerId`). `_pollOnce` 1차+fallback / `_sendSos` / `_sendFall` 4 곳 교체. `VitalPublisher.workerId` 는 init metadata 만 — 변경 없음.
  - 이유: 빌드 타임 `_workerId = String.fromEnvironment('WORKER_ID', defaultValue: 'demo_ios_01')` 가 dart-define 없이 빌드된 모든 iPhone 에 동일 적용 → 두 폰이 같은 ID 로 publish → store 의 `latestByWorker` map 에서 한 키 공유 → 두 번째 폰이 첫 번째를 덮어쓰는 현상. **사용자 보고**: "EMP-1024, EMP-6861 두 작업자 publish 중인데 dashboard 에 EMP-6861 만 표시". 진단으로 store 에는 3 workers (`demo_ios_01` stale + `EMP-1024` + `EMP-6861`) 다 들어있음 확인.
  - 대안 기각: (a) **빌드 타임 `--dart-define=WORKER_ID=xxx` 별도 빌드** — 매번 다른 빌드 필요. 발표 자료 관리 복잡 (b) **앱 설정에 workerId TextField 별도 추가** — 사원번호와 의미 중복. 사용자가 두 번 입력해야 함.
  - 영향 범위: 사원번호가 곧 workerId. 같은 사원번호 → 같은 카드 합쳐짐 (의도). 사원번호 미설정 폰은 여전히 `demo_ios_01` fallback 으로 들어옴 (안전한 default).

- **결정 (3) dashboard fallback 정리 + slice 제거 + 실폰 우선 union**.
  - 선택: `fallbackWorkers` 를 mock 3개만 (`demo_mock_01/02/03`) 으로 축소 (placeholder `demo_ios_01`, `demo_and_01` 제거). `Array.from(ids).slice(0, 5)` 제거. 실폰을 `sort by ts desc` 한 뒤 fallback 과 union (`actual ∪ fallback`).
  - 이유: 기존 `slice(0, 5)` 가 Set 순서 (fallback 5 → actual N) 에서 fallback 을 우선 자리잡고 실폰을 잘라냄. 발표 시 실폰 데이터가 안 보이는 게 최악. 실폰을 먼저 두면 어떤 fallback 이 잘려도 안전.
  - 대안 기각: (a) **slice(0, 8)** 또는 더 크게 — 실폰 수에 따라 grid 흐트러짐 (b) **fallback 동적 매핑** (실폰이 들어오면 fallback 자리 대체) — 로직 복잡 + 디자인 불안정.
  - 영향 범위: 발표 시연 구성 = 실폰 N + mock 3 = `N+3` 카드. 실폰 2대 + mock 3 = 5 카드 (`xl:grid-cols-5` 깔끔). 실폰 3대 + mock 3 = 6 카드 (두 번째 줄 1 칸).

- **결정 (4) Xcode 직접 빌드 영구 금지 — Flutter CLI 만 사용**.
  - 선택: 모든 iOS 빌드는 `flutter build ios --release --dart-define=MOCK_RECEIVER_URL=<URL>` CLI 만. Xcode Play 버튼 / Run 빌드 영구 금지. Xcode 로 열어야 한다면 `Runner.xcworkspace` 단순 확인용으로만 (NOT `.xcodeproj`).
  - 이유: Xcode 직접 빌드 시 SPM 통합 플러그인 (`geolocator_apple/device_info_plus/flutter_secure_storage_darwin/package_info_plus`) 의 `Flutter/Flutter.h` 헤더 못 찾음. 원인 = Flutter 가 일부 플러그인을 SPM 으로 통합하고 Xcode 가 SPM 의존성을 안 로드. 추가로 Xcode 가 build/ 폴더 산출물을 120MB debug 로 덮어쓰면서 release 산출물 깨짐.
  - 대안 기각: (a) Xcode 에서 Runner.xcworkspace + Pods scheme 빌드 — SPM 의존성 로드 여전히 불안정 (b) SPM 비활성화 (`flutter config --no-enable-explicit-package-dependencies`) — 모든 SPM 통합 플러그인이 cocoapods 로 빠지면서 다른 plugin 충돌 위험.
  - 영향 범위: 사용자는 빌드 명령으로만 install. devicectl + xcrun 으로 launch. Xcode 의 디버거/프로파일러는 필요 시 별도 attach (현 프로토타입 비범위).

---

## 2026-05-24 — iOS 백그라운드 keepalive + SOS 모달/SMS 자동 작성 + store 이벤트 비-sticky

- **결정 (1) iOS 백그라운드 keepalive — location 백그라운드 모드 채택**.
  - 선택: `geolocator: ^14.0.1` + `UIBackgroundModes=[location]` + `NSLocationAlwaysAndWhenInUseUsageDescription`. medium accuracy + 50m distance filter.
  - 이유: iOS 일반 앱은 백그라운드 ~30초 후 suspend → `Timer.periodic` 멈춤 → 폴링 0. location 백그라운드 모드는 active CLLocationManager 가 있으면 OS 가 무제한 알 림. "작업자 현장 위치 추적" 으로 정당성 자연스럽고 시연 표 5번 항목 ("정확한 위치 추적") 과 일치.
  - 대안 기각:
    - **wakelock** (화면 켜진 상태만 alive): 잠금/Home 진입 시 죽음 → 사용자 요청 ("잠금 상태에서도 수신") 충족 못 함.
    - **HealthKit background delivery**: frequency 가 .immediate 도 5~30분 지연 → 5초 폴링 부적합 + Flutter `health` 패키지 지원 불확실.
    - **HKWorkoutSession** (워치 앱): 워치 앱 미작성 정책 (비범위).
    - **VoIP PushKit**: 비-VoIP 앱은 Apple 리젝.
  - 트레이드오프: 배터리 영향. medium accuracy + 50m filter 로 GPS hard-fix 빈도 최소. 시연 1~2시간은 무시 가능.

- **결정 (2) SOS 모달 + SMS 본문 사전작성 — 단일 화면에 모든 의사결정 정보 + 1-tap 호출**.
  - 모달 구성: 헤더 (블링크 원 + "SOS 긴급 알람") + **작업자** (이름/사원번호/소속 회사 스마트인재개발원/SOS 시각) + **최신 생체 데이터** (심박/SpO₂/체온추정, 기존 임계 색상·블링크 동일) + **현장 위치 (작업자 GPS 좌표)** + Google Maps 링크 + **보호자 연락처** (이름/전화) 통화·문자 + **119 신고** 통화·문자 (빨강 강조).
  - SMS 본문 (`buildSmsBody(sample, audience)`): `[SafetyMonitor 긴급 알림] / 회사: 스마트인재개발원 / 작업자: ... / 시각: ... / 작업자 GPS 좌표: 위도 ..., 경도 ... / 지도: maps.google.com/?q=... / 생체: ... (위험) / 조치: ...`. 보호자는 "안부 확인 + 응답 없으면 119 권장", 119 는 "위 좌표로 출동 요청".
  - URI: `sms:<number>?body=<encoded>` — iOS Messages / macOS Messages / Windows Messages 모두 호환. `?body=` 가 iOS 13+ 표준.
  - 이유: 관제자가 모달을 보는 순간 (a) 누가 (b) 어디서 (c) 어떤 상태인지 + 다음 행동 (전화 / 문자 / 119) 까지 한 화면에서 결정 가능. SMS 사전작성으로 핸드오프 마찰 제거.
  - 대안 기각: **별도 alert 페이지 라우팅** — context 잃음, 발표 시연성 떨어짐. **WebSocket push notification** — 발표 후 (Lambda + APNs/FCM 도입 시).
  - 자동 119 연계: 발표 후 (현재는 수동 클릭 트리거). KOSHA·법률 자문 전까지 자동 호출 금지 (오탐 시 책임).

- **결정 (3) store 이벤트 플래그 비-sticky + dashboard `data.recent` 스캔으로 이벤트 시각 별도 추적**.
  - 변경: `latestByWorker` 의 spread merge 가 `manualSos/fallDetected` 를 영구 sticky 시켜 → SOS 한 번이면 카드 영구 빨강, 모달 무한 재팝업. 두 필드는 sample 의 자기 값만 사용 (`manualSos: sample.manualSos` 명시).
  - 이벤트 영속성: dashboard 가 `data.recent` 를 스캔해 `lastSosByWorker / lastFallByWorker` (workerId → 마지막 발생 ts) 별도 계산. 모달 트리거는 `lastSosTs !== acknowledgedSosTs[workerId]`. 낙상 row 는 `Date.now() - lastFallTs < 5min` 으로 빨강 블링크.
  - 이유: 이벤트 (SOS, 낙상) 와 상태 (HR/SpO2 정상 범위) 의 의미 분리. 이벤트는 발생 시각이 중요 (vs. 현재 sticky 여부). 한 번 SOS 가 자동 해제되어야 다음 정상 vital 이 들어와도 화면이 자연스럽게 normal 로 복귀.
  - 대안 기각:
    - **store 측에서 `lastSosTs`/`lastFallTs` 직접 노출**: API 응답에 추가 필드 필요 + 스키마 vs runtime metadata 경계 흐려짐. dashboard 스캔이 더 깔끔.
    - **별도 events API 분리**: 시연 단계에 과한 설계. 발표 후 Lambda 도입 시 재검토.

- **결정 (4) 5명 워커 + 카드 6 row 통일 정렬**.
  - 변경: 4 → 5 워커 (`demo_mock_03` 추가), grid `xl:grid-cols-5`, `max-w-6xl → max-w-[1600px] w-full`. 카드 6 row 모두 `ROW_CLASS min-h-[3.25rem]` 통일. 상태 배지 `whitespace-nowrap` (한글 "대 기" 줄바꿈 해결). 카드 헤더 `min-h-[4.5rem]` + 사원번호 미설정 placeholder.
  - 행 순서: `상태 → 심박 → 산소포화도 → 환경 산소 → 손목 온도 → 낙상 감지` (사용자 명시).
  - 이유: 5명은 발표 표 항목 ("5 worker 시연" 명시) 충족. 와이드 모니터에서 양옆 여백 활용. 모든 카드의 같은 자리 row 가 같은 vertical position 에 와야 시연 시 카드별 비교가 쉬움.

- **결정 (5) 회사명 vs 작업자 GPS 좌표 라벨 분리**.
  - 변경: 모달 헤더 "현장 위치 (회사 스마트인재개발원)" → "현장 위치 (작업자 GPS 좌표)". 회사명은 작업자 섹션 "소속" 라인으로 이동.
  - 이유: 사용자 피드백 — 같은 줄에 회사명 + 좌표가 있어 좌표가 회사 위치처럼 보이게 혼동. 회사 = 소속 (고정), 좌표 = 작업자 현재 위치 (GPS) 로 분리.

---

## 2026-05-22 — 카드 색 통일 + 신호등 분리 + 폰↔대시보드 시그널 바

- **결정**. 카드 큰 박스의 위험/주의 톤 (`statusFor` 의 `border-red-500/70 bg-red-950/50` 등) 제거. 4 카드 모두 동일 `CARD_CLASSNAME = border-white/10 bg-[#0d1117]`. 종합 상태는 **작업자 이름 좌측 신호등** (`TrafficLight`, 12px 원 + ring-1) — `overallStatus(sample) = worst-of(heartRate/spo2/coreTemp)`. 정상 정적 녹 / 주의·위험 블링크. 정상 메트릭 값 블링크도 제거. 폰↔대시보드 통신 freshness 는 **이름 오른쪽 시그널 바** (`SignalBars`, 4 막대) — `signalLevel(sample, now)` 임계 (<8s=4 / <15s=3 / <30s=2 / <60s=1 / ≥60s=0) + 1초 단위 `now` state 갱신.
  - 블링크 키프레임 — `app/globals.css` 에 `@keyframes vital-blink` (opacity 1→0.15→1) + `.vital-blink-caution` (1.1s) / `.vital-blink-danger` (0.55s) 직접 정의. Tailwind arbitrary `[animation:pulse_<X>s_ease-in-out_infinite]` 는 JIT 가 인식 못해 dead class 였음.
  - 신호 강도 색상 — 4-3 emerald / 2 amber / 1 red / 0 zinc.
- **이유**.
  - 사용자 피드백 — "큰 박스 붉은색이 시연 시 산만". 정보가 중복 (테두리 색 + 우측 텍스트 배지 + 메트릭 값 색).
  - 신호등이 더 정밀 — 12px 원 1점만 변색/깜빡이면 시선이 정확히 그 위치로 이동. 카드 전체 톤 변화는 "어디가 문제?" 가 흐려짐.
  - 정상 블링크 — 늘 보는 상태가 깜빡이면 눈 피로. 정적 emerald 가 "살아있되 조용함" 시그널로 적절.
  - 시그널 바 freshness — 별도 RSSI 없이도 폰 publish 가 살아있는지 = 통신 상태 가장 직접적 시그널. 모바일 신호 바는 청중 친숙도 100%.
  - 키프레임 직접 정의 — Tailwind 3.x JIT 가 `infinite` 키워드 + 4-단어 animation arbitrary 를 인식 못함. CSS-in-CSS 가 가장 robust (Tailwind config 확장보다 변경 최소).
- **대안과 기각 사유**.
  - **카드 톤 유지 + 신호등 X** — 사용자가 명시적으로 카드 톤 제거 요청. 신호등은 더 작아 시연 시 산만하지 않음.
  - **상단 텍스트 배지만 (신호등 X)** — 텍스트 ("위험") 는 시각적 임팩트 약함. 신호등 + 텍스트 dual 이 빠른 인지 (아이콘) + 정확한 라벨 (텍스트) 둘 다 제공.
  - **시그널 바 색 = 신호등과 동일 (메트릭 worst-of 따라)** — 의미 중복. 시그널 바는 *통신* 상태, 신호등은 *생체* 상태로 의미 분리.
  - **Tailwind config `animation` 확장** — `tailwind.config.ts` 에 keyframes 정의도 가능하지만 hot reload 시 config 캐시 이슈. globals.css 가 즉시 반영.
  - **정상도 천천히 블링크** — 사용자 명시: "정상 녹색일때는 블링크 모드 없음".
- **대응**.
  - `apps/dashboard-web/app/globals.css` — `@keyframes vital-blink` + 클래스 2종.
  - `apps/dashboard-web/app/components/DemoDashboard.tsx` — `statusFor` 폐기 + `CARD_CLASSNAME` / `STATUS_LABEL` 상수 + `overallStatus` / `signalLevel` 헬퍼 + `TrafficLight` / `SignalBars` 컴포넌트 + `now` state + `useEffect setInterval(1000)`. 카드 렌더 부분 className 단일화 + 헤더 `<TrafficLight /> <span>{title}</span> <SignalBars />` 배치.
  - `STATUS_CLASS.normal` 에서 `vital-blink-normal` 제거 (정상 정적).
- **재검토 트리거**.
  - 시그널 바 임계 (8s/15s/30s/60s) 가 실제 폴링 주기 5초와 안 맞으면 — 폴링 주기 변경 시 임계 함께 조정. 또는 폴링 주기 자체를 상수화.
  - 신호등 12px 가 시연 화면 (큰 모니터) 에서 너무 작으면 — 16~20px 로 확대.
  - 색약 사용자 피드백 — 신호등/시그널 바 색에만 의존 X, 아이콘/패턴 보조.
  - AWS IoT Core 도입 시 — IoT Thing connection state 를 직접 가져와 freshness 대신 사용 (RSSI 유사 metric).

---

## 2026-05-22 — 대시보드 메트릭 값 색상 블링크 (메트릭별 독립 + 속도 차등)

- **결정**. 카드 안 각 메트릭 값 (심박 / 산소포화도 / 손목 온도) 의 숫자를 상태별로 색칠하고 블링크. 정상 emerald-300 (2.4s pulse) · 주의 amber-300 (1.4s) · 위험 red-400 (0.7s 빠르게). **메트릭별로 독립 판정** — 같은 카드 안에서 심박만 red, 산소포화도는 emerald 가 가능. 카드 테두리 (`statusFor`) 는 카드 전체 worst-of, 메트릭 값 색상은 셀별.
  - 임계. 심박 caution `110~129 또는 41~50` (의료 일반 reference, 안정 시 tachycardia/mild bradycardia) + danger `≥130 또는 ≤40` ([[thresholds]] 와 일치). 산소포화도 caution `88~91` + danger `<88`. 체온은 추정 체온 기준 caution `≥37.5` + danger `≥38` ([[option-c-wrist-vs-core-temp]] 참조).
  - 구현. `STATUS_CLASS` 매핑 + Tailwind arbitrary value `[animation:pulse_<X>s_ease-in-out_infinite]`. Tailwind config 무수정.
- **이유**.
  - 시각적 attention — 카드 테두리만으로는 어느 메트릭이 문제인지 즉시 안 보임. 메트릭 값 자체 색이 바뀌면 시선이 정확히 그 숫자로 이동.
  - 시연 임팩트 — 발표 시 "위험" 상태가 빠르게 깜빡이면 청중도 즉시 인지. 정상은 천천히 깜빡여 "살아있다" 시그널 + 눈 피로 최소화.
  - 메트릭별 독립 — 산업 현장은 한 작업자에게 동시 다발적 위험 (HR high + SpO₂ low) 가능. 각 메트릭이 자기 상태 표시해야 트리아지 가능.
- **대안과 기각 사유**.
  - **카드 전체 통일 색**. 카드 테두리 색이 그 역할. 메트릭 셀까지 통일 색이면 정보 중복 + 어느 메트릭이 트리거인지 불명확.
  - **블링크 없이 색만 변화**. 정적 색은 청중이 안 봤을 때 놓치기 쉬움. 발표 임팩트 약함.
  - **모든 상태 같은 속도 블링크**. 위험을 정상보다 더 빠르게 깜빡여야 직관적. 같은 속도면 차등 효과 없음.
- **대응**.
  - `apps/dashboard-web/app/components/DemoDashboard.tsx` — `VitalStatus` 타입 + `heartRateStatus` / `spo2Status` / `coreTempStatus` 헬퍼 + `STATUS_CLASS` 매핑 + `MetricRow` / `TempDualRow` 의 값 span 에 클래스 적용. `TempDualRow` 는 손목 / 추정 둘 다 같은 status 동기화.
- **재검토 트리거**.
  - 산업 작업자 활동 중 HR 110~129 가 너무 자주 caution 잡히면 (체감 false positive ↑) — caution 범위를 120~129 로 좁히거나 활동 강도 (acceleration) 와 조합.
  - 발표 후 사용자/관제자 피드백에서 "정상 emerald 블링크가 거슬린다" 면 — 정상은 정적 emerald (블링크 X) + 주의/위험만 블링크.
  - 색약 (color blindness) 사용자 피드백 — 색에만 의존 X, 아이콘/패턴 보조.

---

## 2026-05-22 — 작업자 메타데이터 (이름·사원번호) — payload 동봉 방식 + dashboard 실시간 매칭

- **결정**. 작업자 식별을 위한 메타데이터 (`workerName` · `employeeId`) 를 별도 register API 없이 **vital payload 마다 동봉**. iPhone 앱 우상단 ⚙️ → `SettingsPage` 에서 입력하고 secure storage 영속화. 대시보드는 기존 2초 polling 으로 자동 갱신 (저장 직후 다음 폴링 ≤5초 안에 반영).
  - VitalSampleSchema 에 `workerName` / `employeeId` optional (각 max 40자) 추가. `latestByWorker` 가 metadata 누적 merge — 다음 샘플이 metadata 비어 와도 이전 값 유지.
  - `workerId` 자체는 안정 키로 유지 (fallback grid `["demo_ios_01", ...]` 와 호환). name/empId 는 표시용.
- **이유**.
  - 단순성. 별도 `POST /api/mock/profile` + 인증/순서 처리 회피.
  - 자가 복원. dev 서버 재기동으로 메모리 store 가 비어도, 다음 5초 폴링에 metadata 가 자동 복원.
  - 실시간성. 별도 WebSocket 불필요 — 기존 polling 으로 충분.
- **대안과 기각 사유**.
  - **별도 register endpoint** — 클라이언트가 메타데이터 변경 시 한 번만 호출. 단 dev 서버 reboot 시 메타데이터 사라짐 → 클라이언트가 변경 안 했으면 영원히 비어 있음. 또는 클라이언트가 매 부팅 시 register 호출 추가 필요.
  - **workerId 자체에 인코딩 (`worker_홍길동_EMP-1024`)** — URL/쿼리 파싱 깨짐. 한글 인코딩 이슈.
  - **별도 사용자 DB 테이블** — 발표용 prototype 에는 과도 (인증/세션 필요).
- **대응**.
  - `packages/schemas/src/vital-stream.ts` — `workerName` / `employeeId` optional 필드.
  - `apps/dashboard-web/app/api/mock/store.ts` — `latestByWorker` metadata merge.
  - `apps/worker-phone/lib/models/vital_sample.dart` + `lib/services/health_vitals_service.dart` + `lib/main.dart` — Dart 모델 확장 + `SettingsPage` + `_pollOnce` / `_sendSos` 가 metadata 동봉.
  - `apps/dashboard-web/app/components/DemoDashboard.tsx` + `VitalHistoryPanel.tsx` — 카드 헤더 + 차트 패널 헤더 + recent table 모두 매칭 + "사원번호" 라벨 명시.
- **재검토 트리거**.
  - AWS IoT Core + DDB 로 전환 시 — workerId 별 별도 profile 테이블 분리 검토 (payload 마다 동봉은 비용 ↑).
  - 멀티 테넌트 진입 시 (조직별 격리) — workerId 만으로 식별 불가. Cognito sub + tenant key 추가.

---

## 2026-05-22 — 손목 온도 vs 체온 정책 — dual display + 추정 알고리즘 (옵션 C)

- **결정**. 워치 측정값 = **손목 피부 온도** 라는 사실을 라벨에서 정직하게 표시한다. 카드/테이블/누적 차트는 "손목 온도" 로 표시 + 동시에 **"체온 추정"** 보조 메트릭을 derive 해서 dual 로 표시. 위험 감지 임계는 **추정 체온** 기준 (KOSHA 고온 작업 ≥38℃, 의료 caution ≥37.5℃).
  - 1차 보정 알고리즘. `estimateCoreTempC(skinTempC) = skinTempC + 1.5` (고정 오프셋. `THRESHOLDS.coreTemp.wristToCoreOffsetC` 상수).
  - 데이터 모델. `skinTempC` (raw, payload + DB) 만 저장. `estimatedCoreTempC` 는 view layer / analyzer 에서 derive. 알고리즘 변경 시 client/lambda 갱신만으로 충분.
  - UI. 카드 `손목 35.9℃ / 체온 추정 37.4℃ (+1.5)` dual stacked + tooltip "단순 보정 · 의학 진단 아님".
- **이유**.
  - 의학적 사실. 손목 피부 온도는 핵심 체온 (oral/rectal) 보다 1.5~3℃ 낮고 환경·활동에 크게 영향. Apple Watch wrist temp 도 절대값이 아니라 수면 baseline 변동분이 신뢰성 시그널.
  - 법적/제품 안전. "체온" 단일 표기는 의료기기 (MFDS) 영역. [CLAUDE.md "진단·치료 주장 절대 금지"](../CLAUDE.md) 와 충돌. "추정" 명시 + dual 표기는 산업 안전 보조 정보 범주 유지.
  - 시연 임팩트. 위험 감지 5종 중 "고온" 알고리즘이 필요. 손목 절대값 임계 (`≥37.5`) 는 손목이 보통 33~35℃ 라 사실상 무용지물 → KOSHA 임계 기준 추정 체온이 의미 있음.
- **대안과 기각 사유**.
  - **옵션 A — 라벨만 "손목 온도" + 켈리브레이션 X**. 정직하지만 위험 감지 알고리즘이 사실상 사용 불가 (손목 37.5℃ 측정될 일은 극심한 발열). 발표 5종 스토리에서 "고온" 빠짐.
  - **옵션 B — 단순 오프셋 후 "체온" 단일 표시**. UX 단순하지만 의료기기 회색지대. ±0.8℃ 오차를 가림. 발표 후 법률 자문 시 위험.
  - **옵션 D — HealthKit `BODY_TEMPERATURE` (사용자 직접 입력) 우선**. 산업 현장 비현실적 (작업자가 체온계 안 잼).
- **대응**.
  - `packages/analyzers/src/thresholds.ts` — `skinTemp` 키 제거, `coreTemp` (cautionC: 37.5, dangerC: 38.0, wristToCoreOffsetC: 1.5) 로 교체.
  - `packages/analyzers/src/hyperthermia.ts` — `estimateCoreTempC()` export + analyzer 가 추정 체온 기준 비교. detail 에 `skinTempC` + `estimatedCoreTempC` 둘 다 포함.
  - `packages/schemas/src/hazard-event.ts` — `detail.estimatedCoreTempC` optional 필드 추가.
  - `apps/dashboard-web` — `@safetymonitor/analyzers` 의존성 추가 (`workspace:*`), `TempDualCell` 컴포넌트 + `statusFor` 추정 체온 기반 + recent table 컬럼 "손목 온도 (℃) / 체온 추정 (℃)" 분리 + `VitalHistoryPanel` `skinTempC` 라벨 "체온" → "손목 온도".
  - 테스트. `analyzers.test.ts` 시나리오를 손목 36.6℃ → 추정 38.1℃ (danger) / 손목 36.1℃ → 추정 37.6℃ (caution) / 손목 35.8℃ → 추정 37.3℃ (null) 로 갱신. 10/10 통과.
- **재검토 트리거**.
  - 발표 후 의학 자문 확보 시 — 단순 +1.5℃ 오프셋을 ambient temp + heart rate 기반 회귀로 교체, 또는 baseline-deviation 모드 (Apple Watch 방식) 추가.
  - KOSHA/MFDS 자문 결과 "추정" 표기로도 의료기기 분류 위험 시 — 위험 감지 영역에서 온도 metric 자체 제외 검토.
  - Galaxy Watch Health Connect 측정값 분포가 Apple Watch 와 1℃ 이상 어긋나면 워치 타입별 offset 분리.

---

## 2026-05-22 — ★ Cloudflare Tunnel 도입 (라우터 client isolation 우회)

- **결정**. iPhone → Mac dev 서버 경로를 LAN 직접 대신 **Cloudflare Tunnel (quick mode)** 로 우회한다. `cloudflared tunnel --url http://localhost:3000` 으로 무작위 `https://*.trycloudflare.com` 발급 → Flutter 앱의 in-app receiver URL 에 입력 → publish.
- **이유**.
  - 진단 결과 — `ping 192.168.219.114` (iPhone) 가 Mac 에서 100% loss. 같은 `192.168.219.x` subnet 인데 L3 통신 차단. 라우터의 **client isolation / AP 격리** 가 켜져 있음 (가정/공용 공유기 흔한 기본값).
  - 추가로 — Mac LAN IP 가 `192.168.219.246` → `192.168.219.44` 로 DHCP 갱신되어 변동. Flutter 앱에 LAN IP 를 박아두면 갱신 때마다 publish 실패.
  - cloudflared quick tunnel 은 무료 + 계정 불필요 + localhost reverse proxy 라 LAN IP 변경 무관 + 발표 장소 Wi-Fi (대학/카페) 에서도 동일하게 동작.
- **대안과 기각 사유**.
  - **iPhone 개인용 핫스팟** — iPhone 이 AP, Mac 이 client. Mac LAN IP 매번 바뀌어 dart-define 재빌드 필요. iPhone 배터리/데이터 소모. 발표 장소 변경 시 매번 재설정.
  - **라우터 admin 페이지에서 client isolation 해제** — 공유기 모델별 메뉴 상이 + admin 비밀번호 필요. 발표 장소 라우터 (대학/카페) 는 손댈 수 없음.
  - **ngrok** — 무료지만 가입 + token 필요. cloudflared quick tunnel 이 더 무난.
  - **Mac Internet Sharing** — Ethernet → Wi-Fi share. 발표 환경에 Ethernet 보장 없음.
- **대응**.
  - 설치 — `brew install cloudflared` (사용자가 별도 터미널에서 실행, auto mode classifier 가 자동 install 차단).
  - 백그라운드 실행 — `cloudflared tunnel --url http://localhost:3000 --no-autoupdate`. 발급 URL `https://provisions-corpus-nav-discussed.trycloudflare.com` (세션마다 변동).
  - Flutter 앱 — in-app TextField + secure storage 영속화 (`mock_receiver_url` 키). LAN IP/터널 URL 변경 시 재빌드 없이 in-app 으로 교체.
  - 검증 — `GET /` 200 + `POST /api/mock/vital` 201 + mock store 저장 확인.
- **재검토 트리거**.
  - 발표 당일 cloudflared quick tunnel 가 unstable 하거나 region 차단되면 → 발표 장소 Wi-Fi 의 라우터 admin 권한 확보 후 client isolation 해제 시도, 또는 iPhone hotspot fallback.
  - AWS dev 계정 보류 해제 후 IoT Core mTLS 로 전환하면 tunnel 불필요.

---

## 2026-05-22 — iPhone debug→release 빌드 전환 + in-app receiver URL

- **결정**. iPhone 실기기 시연 빌드는 **release 모드** 로 통일. dart-define 으로 default URL 박되, **사용자가 in-app TextField 로 동적 교체 가능** 한 구조 채택.
- **이유**.
  - iOS 14+ 에서 **debug 모드 Flutter 앱은 `flutter run` attached 상태에서만 실행 가능**. 홈에서 아이콘 탭으로 standalone launch 시 `Cannot create a FlutterEngine instance in debug mode` 메시지 후 즉시 SIGKILL (`signal 11`). devicectl `--console` 로 직접 확인.
  - LAN IP/터널 URL 은 환경에 따라 자주 변동 → 매번 재빌드는 비현실적. in-app 입력 + secure storage 영속화로 1회 입력 후 재실행해도 유지.
- **대응**.
  - `flutter run --release -d <iphone_id> --dart-define=MOCK_RECEIVER_URL=...` 로 빌드/install.
  - debug 빌드 잔여물은 `flutter clean` + `flutter pub get` 후 release 재빌드.
  - install 단계는 flutter run 이 일시 timeout 되면 `xcrun devicectl device install app --device <id> <Runner.app>` 으로 직접 install (devicectl 이 더 안정).
  - launch 차단 (`profile has not been explicitly trusted`) 은 iOS 설정 → 일반 → VPN 및 기기 관리 → Apple Development 신뢰 1회만 수동.
- **재검토 트리거**.
  - 발표 시 hot reload 필요해지면 (예: 마지막 순간 UI 수정) debug 빌드로 임시 전환 + `flutter run` 유지. 하지만 시연 안정성 위해 release 권장.

---

## 2026-05-22 — 대시보드 UI 강화 + 카드 클릭 누적 차트

- **결정**. 대시보드는 (a) 한국어 라벨 + 단위 표시 (b) 산소포화도 라벨 한 줄 (c) SafetyMonitor 로고 + 헤더 그라데이션 (d) 최근 수신 샘플 펼침/줄이기 토글 (e) **카드 메트릭 칸 클릭 → 1주일/30일/60일 누적 차트 패널**. 차트는 의존성 0 (인라인 SVG) + deterministic mock generator.
- **이유**.
  - 한국어 단독 정책 (CLAUDE.md) 준수 + 산소포화도 5자 라벨이 grid 칸 폭에 안 맞아 wrap 되는 문제 해결 (`whitespace-nowrap + text-xs`).
  - 누적 차트는 발표 시연에서 *"실시간 vital 뿐 아니라 추세도 본다"* 임팩트. 실제 backfill 데이터는 IoT/DDB 실배포 후라 mock generator (deterministic hash) 로 시연 안정성 확보.
  - 차트 라이브러리 (Recharts ~80KB) 추가 없이 인라인 SVG 로 ~150 lines. 번들 사이즈 + 발표 시연 안정성 우선.
- **대안과 기각 사유**.
  - **Recharts/Chart.js** — 의존성 + bundle 증가. 발표용 단순 라인 차트라 과한 선택.
  - **모달 팝업** — 카드 위에 띄우면 다른 카드 가림. drill-down 영역을 카드 grid 아래 별도 section 으로 두는 게 시연 흐름에 더 자연스러움.
- **대응**.
  - `apps/dashboard-web/app/components/DemoDashboard.tsx` — `MetricCell` (클릭 가능 메트릭 칸) + `SafetyMonitorLogo` (방패+ECG SVG) + `selection` state + `VitalHistoryPanel` 통합.
  - `apps/dashboard-web/app/components/VitalHistoryPanel.tsx` — TimeRange 토글 + 평균/최저/최고 통계 + `LineChart` (gradient fill + grid + tick + hover title).
  - `apps/dashboard-web/app/api/mock/history/data.ts` — `buildHistory(workerId, metric, range)` deterministic generator. `app/api/mock/history/route.ts` — `GET /api/mock/history?workerId=&metric=&days=7|30|60`.
- **재검토 트리거**.
  - 실제 DDB Time-series 가 붙으면 mock generator 는 backfill 으로 교체. 차트 컴포넌트는 그대로 사용.

---

## 2026-05-22 — iPhone HealthKit 실기기 수집 성공 + 관제 최신값 유지 ★

- **결정**. iPhone 실기기 경로는 D1 성공 기준을 충족한 것으로 본다. HealthKit 에서 HR/SpO₂/손목 온도를 읽고 Flutter HTTP fallback 으로 local/mock receiver 에 publish 하며, 관제 사이트는 최신 non-null 생체값을 유지 표시한다.
- **이유**.
  - Flutter 로그에서 `hr=85.0`, `spo2=98.0`, `skinTempC=35.90684509277344` 수집 확인.
  - `GET /api/mock/vital` latest 에 `demo_ios_01` 의 `heartRate`, `spo2`, `skinTempC` 가 포함됨.
  - 실제 HealthKit 은 SpO₂ 를 `0.98` 비율로 반환하므로 관제/스키마 기준에 맞게 `98` 퍼센트로 변환해야 한다.
  - 손목 온도는 일반 `BODY_TEMPERATURE` 보다 `SLEEP_WRIST_TEMPERATURE` 타입이 Apple Watch 데이터와 맞는다.
- **대응**.
  - `apps/worker-phone/lib/services/health_vitals_service.dart` — SpO₂ 조회 범위 7일, 손목 온도 조회 범위 30일, `SLEEP_WRIST_TEMPERATURE` 우선, SpO₂ 0~1 값을 0~100 으로 변환.
  - `apps/dashboard-web/app/api/mock/store.ts` — 최신 샘플의 null/undefined 값이 이전 HR/SpO₂/Temp 를 덮어쓰지 않도록 병합.
- **재검토 트리거**.
  - Apple Watch 손목 온도 값이 발표 당일 갱신되지 않으면 mock worker 의 고온 시나리오를 발표 fallback 으로 사용.
  - Galaxy Health Connect 에서 타입/단위가 다르게 들어오면 Android 전용 보정 로직을 추가.

---

## 2026-05-22 — iOS HealthKit 권한 이슈 대응 ★

- **결정**. iPhone 실기기에서 `수집 시작` 버튼 탭 후 연결 상태가 `Health 권한 필요` 로 표시되는 현상을 D1의 현재 블로킹 이슈로 기록한다. 앱 버튼/Flutter 흐름은 정상 진입했으므로, 우선 원인을 iOS HealthKit capability/entitlement 및 건강 앱 권한 상태로 본다.
- **이유**.
  - `apps/worker-phone/lib/main.dart` 는 `HealthVitalsService.requestReadAccess()` 결과가 false 일 때만 `Health 권한 필요` 를 표시한다.
  - `Info.plist` 의 Health usage description 은 이미 존재하므로, 다음 가능성이 큰 영역은 앱 서명에 포함되는 HealthKit entitlement/capability 와 사용자의 건강 앱 데이터 접근 허용 상태다.
  - local/mock receiver 서버 미실행은 HTTP fallback 수신에는 영향을 주지만, 권한 요청 false 자체의 직접 원인은 아니다.
- **대응**.
  - `apps/worker-phone/ios/Runner/Runner.entitlements` 에 `com.apple.developer.healthkit` 추가.
  - `apps/worker-phone/ios/Runner.xcodeproj/project.pbxproj` 에 HealthKit System Capability 와 `CODE_SIGN_ENTITLEMENTS` 연결 추가.
  - 재빌드/재설치 후 iPhone 설정 > 건강 > 데이터 접근 및 기기 > Worker Phone 에서 HR/SpO₂/체온 권한 허용 여부 확인.
- **재검토 트리거**.
  - 앱이 건강 앱 데이터 접근 목록에 계속 보이지 않으면 Xcode `ios/Runner.xcworkspace` 에서 Signing & Capabilities > HealthKit 활성화 상태와 provisioning profile capability 를 확인한다.
  - 권한 허용 후에도 latest 데이터가 null 이면 워치 동기화/샘플 존재 여부 문제로 분리하고, 발표 데모는 mock publish fallback 을 병행한다.

---

## 2026-05-22 — AWS 보류 대체 경로 + Android 실행 전략 ★

- **결정 1. AWS 실배포는 결제 문제 해소 전까지 보류**. `aws configure --profile dev`, IoT Thing/cert, DynamoDB 실적재 검증은 중단하지 않고 대기한다.
- **결정 2. D1~D2 검증은 local/mock receiver 로 우회**. Flutter 앱은 `MOCK_RECEIVER_URL` dart-define 이 있으면 HTTP fallback 으로 `POST /api/mock/vital` 에 동일 vital payload 를 보낸다. Next.js 대시보드는 해당 API 의 in-memory store 를 2초 polling 한다.
- **결정 3. Android Studio 개발은 가능하되 에뮬레이터 실패 시 실기기 우선**. `SafetyMonitor_API_35` AVD 는 생성/인식 완료. 단 macOS 가용 메모리 부족 시 Android Studio emulator 가 열리지 않을 수 있으므로 RAM 1024~1536MB 로 낮추거나 Galaxy 실기기를 우선 사용한다.
- **이유**.
  - AWS 결제 이슈로 클라우드 실검증을 기다리면 D1/D2 전체가 멈춤. 동일 payload 와 동일 대시보드 UI 를 local receiver 로 먼저 검증하면 AWS 연결 시 교체 비용이 작다.
  - 발표용 데모의 핵심은 “폰 앱 → 관제 화면 5초 내 상태 표시”이다. 클라우드 대신 local receiver 로도 UX 가치와 데이터 흐름 대부분을 검증할 수 있다.
  - 에뮬레이터는 UI 확인에는 유용하지만 Health Connect/워치 데이터 검증은 어차피 실기기가 필요하다.
- **기각된 대안**.
  - AWS 준비 전까지 D1 중단 → 발표 일정상 리스크 큼
  - mock script 만 사용하고 Flutter 앱 전송은 나중에 연결 → 폰 앱과 대시보드 통합 리스크가 늦게 발견됨
  - 에뮬레이터 문제 해결에 과도한 시간 투입 → 실기기 준비가 되어 있으므로 우선순위 낮음
- **영향**.
  - `apps/worker-phone` — `MOCK_RECEIVER_URL` dart-define, Android cleartext traffic, iOS local networking, `heartRate` JSON 필드 정합성
  - `apps/dashboard-web` — `POST/GET /api/mock/vital`, 4 worker grid, 최근 샘플 table
  - `scripts/mock-publish.mjs` — 4 worker mock vital publish (`--once` 지원)
  - 문서 — D1 진행률 50%, AWS 보류, 다음 액션을 에뮬레이터/실기기 run 으로 조정
- **재검토 트리거**.
  - AWS 계정/결제 문제가 해결되면 local receiver 를 유지한 채 IoT/DDB 경로를 병렬 연결
  - Android emulator RAM 조정 후에도 실패하면 에뮬레이터 검증은 보류하고 Galaxy 실기기 검증으로 전환
  - Health Connect/Apple Health 에 실제 워치 데이터가 비어 있으면 mock publish 를 발표 fallback 으로 격상

---

## 2026-05-21 — 가정 8건 재정의 (사용자 검증 결과) ★

> **상위 결정 "프로젝트 성격 재정의 (프로토타입 전환)" 의 가정 8건을 사용자 검증 결과로 정정. 원문 가정은 그대로 보존 (audit trail). 충돌 시 본 정정문 우선.**

- **결정 — 가정 8건 정정**.

  | ID | 원본 | 정정 |
  |---|---|---|
  | **A1** | 발표일까지 ~2~4주 | **~2주** (발표 마감 ≈ 2026-06-04) |
  | **A2** | 라이브 데모 + 슬라이드 (영상 백업 권장) | 동일 + **실제 제작 어플리케이션 관제 모니터링 시연** 명시 |
  | **A3** | iOS 단독 (Apple Watch). Android 발표 후 | **iOS + Android 둘 다 시연**. Android Studio 필수화 |
  | **A4** | 단일 작업자 + 단일 관제자 | **시연용 worker 2~4명 (실기기 2 + mock 1~2). 조직 1개·관제자 1명·멀티 테넌트 X 는 유지** |
  | **A5** | AWS IoT Core 유지 (단일 디바이스·dev) | AWS IoT Core 유지 (**다중 디바이스**·dev). IoT Thing 최소 4개 (iOS폰·Apple Watch·Galaxy폰·Galaxy Watch) — 단 폰만 publish 한다면 Thing 2개로 단순화 가능 |
  | **A6** | 위험 감지 3종 (낙상·심박이상·SOS) | **5종 (+ SpO₂·고온)**. 의료/KOSHA 권장 임계 인용 |
  | **A7** | 시뮬레이터 + 실기기 혼용 (없으면 mock) | **실기기 4대 사용 (iOS 폰 + Galaxy 폰 + Apple Watch + Galaxy Watch)**. 시뮬레이터·mock 의존 최소화 |
  | **A8** | 미구현. 발표 슬라이드 언급용 | 동일 + **차후 출시 확정 시 결정 예정** 보강 |

- **이유**.
  - A1 — 사용자 일정 압박. 14일 안에 D0~D4 완료. 매일 진척 측정 필수
  - A3 — Flutter 채택 정당성 강화. 단일 코드로 두 OS 모두 발표 시연
  - A4 — 시연 임팩트 (대시보드 grid 풍성) 위해 worker 다수 필요. 단 멀티 테넌트는 여전히 비범위
  - A5 — A3 + A7 의 자연스러운 귀결. 실기기 4대 = IoT Thing 다수
  - A6 — 발표 임팩트 (위험 시나리오 다양화) + 코드 자산 추가 확보. 임계 출처는 의료/KOSHA reference (`[확인 필요]` 표시로 책임 명확화)
  - A7 — 실기기 우선이 시연 신뢰도 ↑. mock 은 보조 수단 (라이브 실패 fallback)

- **임계값 (A6 — 의료/KOSHA 권장 인용. `[확인 필요]` 항목은 법률·의료 자문 후 확정)**.

  | 카테고리 | caution | danger | 출처 |
  |---|---|---|---|
  | 낙상 | — | 가속도 ≥ 3.0G + 무동작 ≥ 30s | 산업 안전 일반 reference `[확인 필요]` |
  | 심박 (high) | — | resting HR ≥ 130bpm 5s 지속 | 의료 reference `[확인 필요]` |
  | 심박 (low) | — | resting HR ≤ 40bpm 5s 지속 | 의료 reference `[확인 필요]` |
  | **SpO₂** | < 92% 30s 지속 | < 88% 즉시 | 의료 표준 (저산소증 진단 기준 일반값) `[확인 필요]` |
  | **고온 (피부 온도)** | 손목 ≥ 37.0℃ (심부 ≈ 38.5℃ 추정) | 손목 ≥ 37.5℃ (심부 ≈ 39.0℃ 추정) | KOSHA 작업 중지 권고 + Apple Watch 손목→심부 오프셋 ≈ -1.5~-2℃ `[확인 필요]` |
  | SOS | — | 사용자 트리거 즉시 | 사용자 의도 |

  > **주의**. Apple Watch / Galaxy Watch 의 손목 온도 측정은 임상 진단용이 아님. 본 임계는 *발표 데모* 용 가정. 실 운용 전 의료기기법 검토 + 의료 자문 통해 재확인.

- **시연 디바이스 구성 (A4 + A5 + A7 종합)**.
  - **작업자 A** — iPhone + Apple Watch (`workerId: demo_ios_01`). 정상 상태 시연
  - **작업자 B** — Galaxy phone + Galaxy Watch (`workerId: demo_and_01`). SOS·낙상 트리거 시연
  - **작업자 C·D (mock publish)** — 노트북 스크립트가 가상 HR/SpO₂ publish (`workerId: demo_mock_01`, `demo_mock_02`). 정상/주의 색 동시 표시
  - **관제자** — 노트북 1대 (Next.js 대시보드, 4개 카드 grid)
  - **합계**. 실기기 4대 + 노트북 1대 + mock 스크립트
  - **fallback**. 라이브 실패 시 mock 스크립트로 worker 4명 모두 가상화 → 대시보드 그대로 유지

- **영향**.
  - `packages/schemas/src/vital-stream.ts` — `skinTempC` (손목 온도) · `ambientTempC` (선택) 필드 추가
  - `packages/analyzers/` — `spo2.ts` + `hyperthermia.ts` 신규. `thresholds.ts` 에 SpO₂·체온 상수 추가. 테스트 4건 추가 (5/5 → 9/9 목표)
  - `backend/infrastructure/lib/iot-stack.ts` — 단일 Thing → 4 Things (또는 폰만 publish 라면 2 Things)
  - `apps/dashboard-web` — 단일 카드 → 4 카드 grid + mock publish 스크립트 (D2)
  - `apps/worker-phone` — Android Studio + Android SDK + JDK 17 의존 추가. `flutter build apk` + Android 실기기 시연 검증
  - `docs/checklist.md` D0/D1/D3 — Android Studio 필수화 · Android 실기기 publish · 위험 감지 5종 항목 추가
  - 발표 일정 — D-14 = 2026-06-04. 매일 진척 측정 (progress.md 활동 로그)

- **재검토 트리거**.
  - 임계값 의료/KOSHA reference 가 자문 결과와 어긋나면 → `thresholds.ts` 즉시 갱신 + `compliance.md` 미해결 항목에 반영
  - Apple Watch 손목 온도 실측이 ±1℃ 이상 흔들리면 → 고온 알고리즘은 발표 시 *데모 mock 데이터* 로만 시연 (실측 미사용)
  - 발표 일정 변경 (예. 1주 단축 / 1주 연장) 시 → D 단계 페이스 재조정
  - 실기기 1대 이상 가용 불가 시 → 해당 OS 는 시뮬레이터 + mock 으로 대체 (시연 임팩트 일부 양보)

- **이전 가정과의 관계**.
  - 2026-05-21 "프로젝트 성격 재정의" 의 A1~A8 원문은 *원본 그대로 보존*. 본 정정문이 충돌 시 우선
  - 직전 결정 "단말 아키텍처 정정 + Flutter 채택" 의 "A3 재해석 — 시연 메인 = iOS, Android 빌드 검증" → 본 정정으로 *iOS + Android 둘 다 시연* 으로 격상

---

## 2026-05-21 — 단말 아키텍처 정정 + Flutter 프로토타입 채택 ★

> **본 결정은 이전 "단말 — Apple Watch + Android 혼용" 결정의 *구현 아키텍처* 를 정정한다. 단말 페어 정책 (Apple Watch + iPhone / Galaxy Watch + 갤럭시폰) 자체는 유효.**

- **결정 1. 워치 앱 자체 미개발**. Apple Watch / Galaxy Watch 둘 다 별도 워치 앱 (watchOS App / Wear OS App) 작성하지 않음. 워치는 *순수 생체 센서* 로만 사용.
- **결정 2. 작업자 메인 클라이언트 = 폰 앱**. iPhone 의 iOS 앱 또는 갤럭시폰의 Android 앱 1개. 역할.
  - 페어된 워치의 생체 데이터를 HealthKit (iOS) 또는 Health Connect (Android) 로 query
  - MQTT 로 AWS IoT Core 에 publish
  - 디바이스 인증서 keychain/keystore 저장
  - SOS 버튼 UI · 연결 상태 표시 · 알림 수신
- **결정 3. Flutter 프로토타입부터 채택**. 작업자 폰 앱은 Flutter 단일 코드베이스 (iOS + Android). 프로토타입 D0 부터 적용.
- **이유**.
  - 워치 앱 미개발 → 워치 OS 별 네이티브 작성 부담 (Swift + Kotlin 2개) 회피. Apple Watch / Galaxy Watch 의 생체 데이터는 페어 폰의 HealthKit / Health Connect 에 자동 동기화되므로 폰 앱이 직접 query 가능
  - 폰 앱 = Flutter → 1인 개발 + 발표 임팩트 측면에서 단일 코드로 iOS + Android 데모 모두 빠르게 시연 가능
  - 발표 후 운영 단계로 넘어가도 React Native 보다 build/배포 안정성·hot reload 생산성·HealthKit 패키지 (`health`) 성숙도 우위
- **기각된 대안**.
  - **워치 앱 + 폰 앱 모두 개발** → 워치 OS 별 SwiftUI/Wear OS 2개 + WatchConnectivity bridge 부담. 프로토타입 일정 (2~4주) 과 1인 개발에 부적합
  - **iOS Swift 네이티브 + Android Kotlin 네이티브 (Flutter X)** → 코드 2배 작성, 발표 시연용 OS 1개 선택 강제
  - **React Native** → HealthKit / AWS IoT 패키지 성숙도 Flutter 대비 변동성 큼
  - **Flutter 프로토타입에는 미적용, 발표 후 도입** → 프로토타입 코드가 그대로 발표 후 자산이 되므로 처음부터 Flutter 가 일관성 우위
- **영향**.
  - 모노레포 구조 변경 — `apps/ios-watch/` 폐기 (placeholder 제거), `apps/worker-phone/` 신규 (Flutter)
  - D0 셋업 재정의 — Xcode watchOS App 생성 항목 제거, Flutter SDK 설치 + `flutter create` + `flutter doctor` 추가
  - D1 재정의 — Watch HealthKit 직접 수집 → 폰 앱에서 HealthKit/Health Connect query → MQTT publish
  - D3 SOS 재정의 — Watch Crown long press → 폰 앱 화면 SOS 버튼 (워치 누름은 미구현)
  - 환경 추가 — Flutter SDK · Android Studio (Android 빌드 시) · CocoaPods (iOS 빌드 시)
  - 가정 A3 재해석 — "iOS 단독" → "**시연 OS 우선순위 = iOS**. 단 Flutter 단일 코드라 Android 빌드도 같이 검증" (Android 시연은 발표 후로 이연 유효)
- **재검토 트리거**.
  - Flutter 의 HealthKit 패키지 (`health`) 가 백그라운드 5초 polling 또는 인증 권한 흐름에서 한계 발견 시 → 작업자 폰 앱만 Swift native + Android Kotlin 으로 회귀
  - 워치에서 직접 SOS 버튼·실시간 UI 가 시연 임팩트에 필요해지면 → 워치 앱 (Swift watchOS) 1개만 별도 추가
  - 발표 후 운영에서 iOS 백그라운드 정책·배터리 영향이 한계 도달 시 → 워치 앱 도입으로 HKWorkoutSession 활용
- **이전 결정과의 관계**.
  - 2026-05-21 "단말 — Apple Watch + Android 혼용" → *페어 정책* 은 그대로 유효. 단 *구현 코드 분할* 은 본 결정으로 정정 (워치 앱 미작성 / 폰 앱 Flutter 단일)
  - 2026-05-21 "프로젝트 성격 재정의 (프로토타입 전환) ★" 의 가정 A3 → 본 결정으로 재해석

---

## 2026-05-21 — D0 셋업 도구 선택 (테스트 러너·CSS 프레임워크 버전)

- **결정**.
  1. **`packages/analyzers` 테스트 러너 — `tsx --test`** (node 내장 `--test` runner를 tsx 가 ESM-strip-types 환경에서 실행)
  2. **Tailwind CSS — v3.4** (v4 신규 PostCSS API 가 Next.js 15 와 일부 호환 이슈 보고됨. 프로토타입에 안정성 우선)
  3. **CDK DDB billing — `PAY_PER_REQUEST`** (단일 디바이스 dev 환경에서는 provisioned 보다 저렴, 비용 예측 단순)
- **이유**.
  1. Node 26 의 `--experimental-strip-types` 만으로는 `.js` 확장자 import 가 `.ts` 로 자동 매핑되지 않음. 빌드(`tsc`) 와 테스트(`tsx`) 가 동일 import 경로를 해석할 수 있도록 tsx 채택. tsx 는 esbuild 기반이라 fast.
  2. v4 는 zero-config 가 매력이지만 본 프로토타입의 Tailwind 의존도는 낮음 (단순 색·여백). v3 의 안정 PostCSS 플러그인이 무난.
  3. 데모 단계 (시연용 단일 worker) 의 트래픽은 무시할 만큼 작음. provisioned 의 ReadCU/WriteCU 가 free tier 후 고정 비용 발생. PAY_PER_REQUEST 가 비용·운영 둘 다 단순.
- **기각된 대안**.
  - `node --test --experimental-strip-types` 직접 사용 → `.js` import 해석 실패
  - `vitest` → 추가 deps + 설정 부담 (현재 단위 테스트 5건 규모로 과잉)
  - Tailwind v4 → 호환 안정화될 때까지 보류
  - DDB Provisioned → 트래픽 적은 데모에서는 비용 더 비쌀 수 있음
- **영향**.
  - `packages/analyzers/package.json` 에 `tsx` devDependency 추가
  - `pnpm-workspace.yaml` `onlyBuiltDependencies` 에 `sharp` (Next.js image) + `esbuild` (tsx) 등록 — pnpm 11 의 build-script 차단 기본값 우회
  - CDK `IotStack` 의 `BillingMode.PAY_PER_REQUEST` 고정
- **재검토 트리거**.
  - 트래픽 증가로 DDB on-demand 비용이 provisioned 추정값을 넘으면 전환
  - Tailwind v4 호환 안정화 + 디자인 시스템 확장 필요 시 v4 검토
  - 테스트 규모가 50건 이상으로 늘면 vitest 등 본격 러너 도입 검토

---

## 2026-05-21 — 프로젝트 성격 재정의 (프로토타입 전환) ★

> **본 결정은 이전의 모든 결정·계획을 상위에서 재해석한다. 충돌 시 본 결정이 우선.**

- **결정**. 본 프로젝트의 현 시점 목표는 *프로젝트 발표용 프로토타입* 제작. 실 서비스 출시·베타 운용·KOSHA 컴플라이언스 *구현* 은 **발표 이후 로드맵** 으로 격하.
- **이유**. _(사용자 추후 보충 — 발표 일정·청중·기대 산출물 등)_
- **현 시점 가정 8건** _(사용자 검증 요청)_.
  - A1. 발표일까지 ~2~4주
  - A2. 발표 = 라이브 데모 + 슬라이드 (영상 백업 권장)
  - A3. iOS 단독 (Apple Watch). Android 발표 후
  - A4. 단일 작업자 + 단일 관제자 (멀티 테넌트 X)
  - A5. AWS IoT Core 유지 (단일 디바이스·dev 환경만)
  - A6. 위험 감지 3종 (낙상·심박 이상·SOS 버튼). SpO₂·고온·고립은 발표 후
  - A7. 시뮬레이터 + 실기기 혼용 (실기기 없으면 시뮬레이터+mock 시나리오)
  - A8. 법률 자문·동의서·KOSHA PDF 등 미구현. 발표 슬라이드 언급용으로만
- **영향**.
  - MVP 범위 대폭 축소 → 단일 작업자·단일 관제자·iOS only·위험 감지 3종
  - 마일스톤 재구성 → M0~M9 (9개) 격하, **D0~D4 (5개) 데모 트랙** 으로 대체
  - 컴플라이언스 — 발표 슬라이드 *언급용* 으로만. 본문은 자산으로 유지
  - 비용 — 200~400만원 → 거의 0 (기존 Apple Dev 활용 / AWS Free Tier)
  - 베타 협력사·법률 자문·Google Play·도메인 정식 확보 *발표 후* 로 이연
- **재검토 트리거**.
  - 발표 일정·청중 정보 추가 시 → 가정 8건 재조정
  - 발표 종료 → 프로덕션 트랙 (M0~M9) 재활성화
  - 가정 1건이라도 빗나가면 해당 영역 재정립
- **이전 결정들의 처분**.
  - 2026-05-21 "프로젝트 신설" 5건 — *방향성* 유효. 단 *구현 일정* 은 발표 후로 이연
  - 2026-05-21 "프로젝트 정식명 결정 (잠정) `IndusView`" — 잠정 유지. 상표·도메인 정식 검증은 발표 후로 이연 가능 (발표 자료에 가칭 표기로 충분)

---

## 2026-05-21 — 프로젝트 정식명 결정 (잠정)

- **결정**. 프로젝트 정식명 `IndusView` (영문). 가칭 `SafetyMonitor` 폐기.
- **이유**. _(사용자 추후 보충)_
- **기각된 대안**. _(사용자 추후 보충)_
- **영향**.
  - 도메인 후보 — `indusview.kr` / `.io` / `.com` 등으로 검색·확보 필요 (기존 `safetymonitor.kr` 후보 폐기)
  - GitHub Organization — `indusview-kr` 등으로 명칭 변경
  - npm 스코프 — `@indusview/*` (기존 `@safetymonitor/*` 폐기)
  - 문서 전반 — `CLAUDE.md` · `plan.md` · `checklist.md` · `compliance.md` · `progress.md` 의 `SafetyMonitor` 표기 일괄 치환 필요 (단 *상표 검증 후* 일괄 적용 권장 — 충돌 시 롤백 비용 최소화)
  - 작업자 동의서 양식 — `compliance.md` v0.draft 의 서비스명 갱신
- **재검토 트리거**.
  - KIPRIS 또는 USPTO 상표 검색에서 동일·유사 등록 발견 시
  - `indusview.*` 도메인 3개 모두 확보 불가 시
  - 베타 협력사로부터 어감·연상 부정 피드백 다수 발생 시
- **후속 액션**.
  - [ ] 상표 검색 — KIPRIS (한국) + USPTO (미국, B2B 확장 대비)
  - [ ] 도메인 확보 — `.kr` / `.io` / `.com` 가용성 + 등록
  - [ ] 확정 후 문서 전반 `SafetyMonitor` → `IndusView` 일괄 치환

---

## 2026-05-21 — 프로젝트 신설

### 출생 배경
- HealthPattern (개인용 iOS+watchOS HealthKit 패턴 앱) 의 fork 후보로 검토했으나 **단순 fork 비효율** 판정 → 신규 모노레포로 시작
- 사유. Apple Watch + Android 혼용 + 웹 대시보드 + AWS 백엔드 조합이면 HealthPattern 의 실제 재사용률 10~20%. HealthKit·SwiftUI 종속 코드는 죽은 코드가 됨
- 살리는 자산. 분석 알고리즘 5종 로직 + 임계값 + 디자인 토큰 일부 → `packages/analyzers`, `packages/thresholds` 로 추출 이식
- 참고용 사본. `docs/HealthPattern-reference/` 에 HealthPattern docs 그대로 보관

### 도메인 — 산업 안전 채택
- 4개 후보 중 산업 안전 (현장 작업자) 선택. 의료/요양·보안·범용 SaaS 기각
- 사유. KOSHA 산업안전보건법이 "실시간 위험성 평가" 의무를 명시 → 명확한 B2B 수요. 의료/요양은 의료기기법 인증 부담 큼. 보안은 시장 규모 작음. 범용은 차별화 어려움
- 적용 법규. 산업안전보건법 · 개인정보보호법 (생체정보 = 민감정보) · 근로기준법 (사생활 보호) · 의료기기법 (진단·치료 주장 금지)

### 단말 — Apple Watch + Android 혼용
- Apple Watch 단독 또는 Apple+Android 페어가 아닌 **혼용** 선택
- 사유. 산업현장 기업이 작업자 단말을 통일 지급하는 경우는 드물고, 기존 보유 단말 활용이 도입 장벽 낮춤. 향후 Tizen/Garmin 확장 옵션도 살려둠
- 영향. 공통 분석 로직은 **서버 사이드 (Lambda)** 로 이동. 단말 분석은 최소화 (낙상 detection 등 즉시성 필요한 것만)

### 대시보드 — 웹 우선 + 모바일 보조
- 관제실은 PC 중심이지만 관리자 외근 시 모바일 알림 필수
- 사유. B2B SaaS 표준. 웹만으로는 즉시 대응 불가, 모바일만으로는 다수 작업자 grid 한눈에 어려움
- 우선순위. 웹 M5 → 모바일 M7

### 백엔드 — AWS 매니지드 (IoT Core + Cognito + Lambda)
- BaaS (Supabase/Firebase) 또는 자체 백엔드 대신 AWS 매니지드 선택
- 사유.
  - IoT Core 가 MQTT + 디바이스 인증서 + Rule + WebSocket 까지 통합 → 자체 구현 부담 0
  - Cognito 가 멀티 테넌트 인증을 매니지드로 제공
  - 산업 IoT 표준에 맞춰 향후 IoT Greengrass·Edge 확장 가능
  - 한국 Region (ap-northeast-2) 보유 → 데이터 주권 충족
- 기각 사유.
  - **BaaS (Supabase/Firebase)** — IoT 디바이스 인증·MQTT 미지원. 작업자 단말 등록·인증서 관리를 자체 구현해야 함
  - **자체 백엔드** — 1인 개발 부담 과대. 인프라 운영 시간이 본질 가치 시간 잠식
  - **Azure IoT Hub** — 기능 동등하나 한국 시장에서 AWS 가 더 일반적
- 단점 인지. AWS 락인. 비용은 Free Tier 후 월 $50~200 (50명 가정)

### 정책 — "외부 서버 0건" 정책 완전 폐기
- HealthPattern 의 핵심 정책이었으나 본 프로젝트의 본질과 정반대 → 폐기
- 본 프로젝트의 대응 정책. **암호화·최소 수집·보존 기간 관리·접근 통제** 4종으로 privacy 확보
- 디바이스 ↔ 클라우드. TLS 1.3 + 디바이스 인증서
- 저장 데이터. KMS 암호화
- 보존. KOSHA 3년 / 일반 1년 / 익명화 후 영구

### 미결정 (M0 진입 전 결정 대기)
- [~] 프로젝트 정식명 — `IndusView` 잠정 (상표·도메인 검증 대기). 상세는 상단 "2026-05-21 — 프로젝트 정식명 결정 (잠정)" 섹션 참조
- [ ] 회사·법인 형태 — 개인사업자 vs 법인 vs 미정
- [ ] 도메인 — `.kr` vs `.io` vs `.com`
- [ ] Apple Developer Program — 개인 $99 vs 조직 $299
- [ ] AWS Account — 신규 / 기존
- [ ] 베타 협력사 1곳 사전 컨택
- [ ] 법률 자문 시점 (M0 vs M8 직전)
- [ ] 데이터 보존 기간 정책 세부 (KOSHA 3년 + 일반?)
- [ ] Android 단말 시드 — Galaxy Watch vs Pixel Watch
- [ ] 모노레포 도구 — Turborepo vs Nx

---

## 작성 가이드 (이 파일을 채우는 사람용)

각 새 결정은 다음 형식.

```
YYYY-MM-DD — 결정 제목
결정: 무엇을 하기로 했는가
이유: 왜 그렇게 했는가 (정량적/정성적 근거)
기각된 대안:
  대안 A → 기각 사유
  대안 B → 기각 사유
영향: 다른 결정·코드에 미치는 파장
재검토 트리거: 어떤 조건이 충족되면 이 결정을 재검토할 것인가
```

`재검토 트리거` 가 핵심 — "지금은 X 로 가지만, 만약 Y 가 일어나면 Z 로 전환" 을 명시해두면 미래의 자신이 감사 trail 을 따라 빠르게 판단 가능.

---

## 2026-06-01 세션12 — 주요 결정

- **국내재해사례 데이터 소스 = news_api02 + callApiId=1060** (전용 `disaster_api02`는 키 미승인 Forbidden). 영향: 데이터는 동일. 재검토 트리거: data.go.kr 에서 `disaster_api02` 활용신청 승인되면 `KOSHA_PATH.accidentCase` 를 `disaster_api02/getdisaster_api02` 로 교체.
- **★ 인앱 PDF 미리보기 = 비범위 확정.** KOSHA 첨부 파일 엔드포인트(`getImage.do`)는 토큰 없이 공개 GET 이나, 첨부 ID(`bbsAtcflNo`)를 주는 내부 RPC(`process.do/boardDetail`, `_JSON=` 폼 봉투)가 **권한 벽(`msg_913`)** 으로 막힘 → 인증 세션 재현은 비공식·취약·ToS 리스크라 기각. 외부 링크/팝업 버튼도 사용자 요청으로 제거. 재해사례는 **경위 전문 팝업만** 유지. 재검토 트리거: KOSHA 가 공개 첨부 API 를 data.go.kr 로 제공하거나, 1060 응답에 첨부 URL 이 포함되도록 바뀌면 재시도.
- **현장정보 ↔ 국내재해사례 전환 UI = 좌우 화살표 캐러셀**(`WidgetCarousel`). iOS 위젯스택 세로형(스와이프+점)을 먼저 만들었으나 데스크톱 마우스 수동 전환이 불편 → 화살표+카운터로 교체. 캐러셀 페이지의 CSS `transform` 이 자식 `position:fixed` 의 컨테이닝 블록이 되는 함정 → 모달은 **`createPortal` 로 body 에 렌더**.
- **현장환경 임계 경보 팝업 = 정상복귀 후 재발/악화 시에만 재알림.** SOS 처럼 매 폴마다 뜨지 않도록 `alertedRef`(itemKey→severity) 로 중복 억제. 자동 닫힘 1분 + 수동. **표시 = 우상단 토스트로 시작했으나 사용자 요청으로 SOS형 화면 중앙 모달**(`fixed inset-0` 배경 + 가운데 카드, 배경 클릭/ESC/닫기, 심각도 테두리)로 변경. 실측 = 체감온도 31.8℃ → 주의 트리거 정상.
- **보안 — 인증키는 절대 출력 금지(재확인).** 키 점검 중 셸 표현식 오류로 KOSHA 키가 채팅에 1회 노출됨 → 사용자 재발급으로 회전. 이후 키 관련 명령은 길이/형식만 출력, 값은 미출력. `.env.local` 은 gitignore 라 git 영향 없음.

## 2026-06-02 세션15 — 주요 결정

- **예비특보(t7) = `getWthrWrnMsg` 단일 응답 재사용.** 예비특보 전용 `getPwnStatus` 도 t6+t7 을 주지만, 우리가 이미 호출하는 `getWthrWrnMsg` 응답에 `t7` 필드가 그대로 포함 → 추가 API 호출 0 으로 구현. "(N) 종류 예비특보 / o 시점 : 구역들" 파싱 + 현장 시·도 키워드 필터. WeatherStrip 🔔 항목(발효 예정 시 caution). **함정**: in-memory 캐시의 저장 shape 를 바꿀 때(배열→객체) 키를 버전 회전하지 않으면 HMR 로 남은 옛 shape 가 `...cached` 스프레드 시 undefined 필드를 만들어 `.filter` 500 → 키 `active`→`active.v2`. 커밋 `c8c99e4`.
- **★ 태풍 진로 = 기상청 `getTyphoonInfo` 별도 활용신청 필요.** 태풍정보 서비스(`TyphoonInfoService`)는 특보(`WthrWrnInfoService`)와 **다른 활용신청 승인**이 필요 — 같은 data.go.kr 계정 키여도 미승인 시 게이트웨이가 `Forbidden`. 진단으로 확정: **같은 키**로 특보(`resultCode 00`)·KOSHA 1040(200)은 정상이고 태풍만 `Forbidden` → 키·계정·인코딩 문제 아님, 그 서비스 구독이 apigw 에 미반영(승인 후 전파 지연 또는 승인 계정 불일치). 공식 응답 필드(typTm/typLat/typLon/typPs/typWs/typDir/typSp/typName/typEn/img/tmFc)는 data.go.kr 문서로 확인(발명 아님). 설계: **목업을 캐시하지 않음** → apigw 가 200 을 주기 시작하면 다음 호출부터 자동 `live`(재배포·재시작 0). 비시즌(발효 태풍 0)이면 `source:"none"`("발효 없음"). `lib/typhoon.ts`+`/api/typhoon`+`TyphoonTrack.tsx`, 우측 캐러셀 레이더 다음 페이지. **재검토 트리거**: 사용자 활용신청 승인 전파 후 실응답으로 필드 1회 대조·보정. 커밋 `bd4dfe4`.
- **★ 지도 확대 선명도 = CSS scale 대신 동적 타일 줌(슬리피맵).** CSS `transform: scale` 로 확대하면 같은 줌 타일을 늘려 보간 → 흐려짐. 해결: `center + zoom` 상태로 타일 그리드/투영을 매 줌마다 재계산(웹 메르카토르 px 변환, `lonToWorldX`/`latToWorldY` + 역변환) → 확대 시 **더 높은 줌의 타일을 실제 로드**라 모든 배율 선명. 휠(커서 앵커 고정)/드래그 팬/＋−/리셋, 의존성 0(Leaflet 없음). 투영 라운드트립 오차 ~1e-14 로 검산. 베이스맵 = **Esri World Imagery 위성 + 경계·지명 라벨**(둘 다 키 불필요, URL `{z}/{y}/{x}`, z5~z11 검증). `TyphoonTrack` 의 `SlippyMap`(인라인=정적 자동 프레이밍, 팝업=interactive). 레이더(`RadarRealtime`)는 정적 그리드 유지(별건).
- **태풍특보는 특보 서비스로 이미 수신 — 단 해상 구역 필터 한계.** `태풍경보/태풍주의보` 는 별도 태풍 서비스 없이도 `getWthrWrnMsg` t6 에 포함되어 옴(현재 실제 발효 중). 그러나 태풍·풍랑 특보 구역명은 해상("남해동부바깥먼바다" 등)이라 우리 육지 17 시·도 키워드 필터에 매칭 안 됨 → WeatherStrip 기상특보 항목엔 미노출(의도; 산업현장 핵심 = 강풍/풍랑, 이건 매칭됨). 전국 태풍특보를 별도로 띄우려면 해상 구역 포함 필터/배지를 따로 추가해야 함(미구현).
- **KOSHA 안전신호등 1020 = KOSHA 서버측 `99 UNKNOWN_ERROR`(우리 수정 불가, 재확정).** 라이브 호출로 `{"header":{"resultCode":"99","resultMsg":"UNKNOWN_ERROR"}}` 확인. **같은 키**로 1040(사고사망)·1060(재해사례)은 200 정상 → 키·엔드포인트·코드 문제 아님 = KOSHA 1020 백엔드 오류. 우리 코드 `assertNormal` 이 99 를 감지해 샘플로 안전 강등 + 자동 재시도(복구 시 자동 live). 정상 데이터 기반 신호등 재정의는 별도 옵션(미채택).
- **국내 재해사례 빈 화면 = 데이터 아닌 렌더(높이).** `getAccidentCases` 는 0 행이면 mock 으로 강등하므로, 배지가 'KOSHA 실시간'(=source live)이면 **데이터 20건이 반드시 존재**(라이브 확인). 빈 화면은 공유 캐러셀 `h-[112px]`(현장정보 2줄 grid 기준 높이)가 목록형 재해사례엔 좁아 클리핑된 것 → `h-[140px]` 로 상향(목록 ~3줄, 현장정보는 grid h-full 이라 영향 적음). 사용자 요청으로 4줄→3줄(168→140). 커밋 `61dad59`.

## 2026-06-02 세션16 — 주요 결정

- **★ 태풍 진로 LIVE 확정 — 파서 보정 0.** 세션15 이후 사용자 활용신청 승인이 게이트웨이에 전파되어 `getTyphoonInfo` 가 `resultCode 00`, 우리 프록시 `source:live`. 실데이터 = 제6호 태풍 장미(JANGMI), 관측 진로 11점(현재 가고시마 남쪽 980hPa/24m/s/NE 36km/h). data.go.kr 공식 스펙대로 작성한 파서 필드(typTm/typLat/typLon/typPs/typWs/typDir/typSp/typName/typEn/img)가 실응답과 **100% 일치 → 코드 보정 불필요**. 단 캡션 정정: 이 응답의 점들은 전부 **관측(분석) 위치**(typTm 이 모두 현재 이하, 예보점 없음)라 "점선=예보"는 오해 소지 → "이동 경로"로 변경. 커밋 `3d094e1`. (참고: 공식 예상진로 이미지 URL 은 `img` 필드로 제공됨 — 필요 시 활용 가능.)
- **★ 작업자 모니터링 3페이지 캐러셀 + 자동회전 opt-out.** 작업자 모니터링을 [작업자|가스 누출 감지기|심장 제세동기 알림] `WidgetCarousel`(현장정보 타입)로 전환. `WidgetCarousel` 은 기본 9초 자동회전이지만, 모니터링 메인이 자동으로 넘어가지 않도록 **`autoRotate?: boolean`(기본 true) prop 추가** → 작업자 캐러셀만 `autoRotate={false}`(‹ › 수동 전환만). 현장정보/현황요약 캐러셀은 기존 자동회전 유지. 캐러셀 본문은 `flex-1` + 페이지 `absolute inset-0` 라 페이지가 높이를 만들지 않음 → 캐러셀에 고정 높이(`h-[460px]`) 필요, 작업자 페이지는 `flex h-full flex-col`(툴바 shrink-0 + 표 본문 flex-1)로 재구성. 커밋 `4f9b58b`.
- **가스/제세동기 = 가상 샘플 표(수동 스크롤만).** 실 센서 데이터 소스 없음 → `SiteSafetyTables.tsx` 가상 픽스처(가스 8개소·AED 7개소). 작업자 표와 동일 타입(신호등 점·severity 색·헤더/행 스타일 재사용)이되, **추가 페이지는 자동 상하 슬라이딩 없이 수동 스크롤만**(`overflow-y-auto`). "샘플 · 자체 디바이스 연동 시 실시간" 표기. 재검토 트리거: 실 가스 감지기/AED 점검 시스템 연동 시 데이터 소스 교체.
- **★ 설비 추세 그래프 = 작업자 차트 컴포넌트 재사용.** "작업자 생체 그래프와 동일 방식" 요구 → `VitalHistoryPanel` 내부 `LineChart`/`BarChart`/`SummaryCell` 에 `export` 추가해 그대로 재사용(중복 SVG 코드 0, drift 방지). 가스 측정값/제세동기 배터리 셀을 클릭 가능 버튼으로 만들고, 클릭 시 `SiteMetricChartPanel`(동일 24h/1주/30일·라인/막대·요약 카드)을 캐러셀 하단에 렌더(상태는 DemoDashboard 로 lift). 실 이력이 없어 현재값+key seed 결정적 합성 시계열(마지막 점=현재 실측값).
- **★ 배터리 그래프 = 단조 감소(외부 충전 없음 가정).** 제세동기 배터리는 외부 충전이 없으므로 하락 후 다시 상승은 불가능 → 노이즈를 그대로 쓰면(세션16 초기) 상승 구간이 생겨 비현실적. 수정: 각 구간 **감소량을 양수 가중치(0.5~1.5)로 배분해 누적** → 어떤 배율에서도 절대 상승하지 않음(시작=현재값+방전량, 끝=현재 실측값). 방전율 ~0.8%/일 가정. 검산: value=21% 기준 24h `23→21` / 1주 `26.6→21` / 30일 `45→21` 모두 단조감소·상승구간 0. 가스는 농도 상하 변동이 정상이라 기존 노이즈 유지. 커밋 `4f9b58b`.

## 2026-06-09 세션29 — 주요 결정

- **★ 레퍼런스 디자인 = 전부 의존성 0 재현(세션28 패턴 계승).** 이번 8종 레퍼런스(magnific 캡슐/그라데이션 차트·cva Alert·shadcnblocks Signup1·ProjectDetailView·lucide 아이콘·Gauge)는 모두 framer-motion/lucide-react/class-variance-authority/clsx/@/components/ui(shadcn) 의존인데 **프로젝트에 하나도 없음**(`node -e` 로 확인). → CSS 트랜지션 + 인라인 SVG + Tailwind 토큰으로 **신규 의존성 0 동등 구현**. 외부 의존성 사전합의 규칙 + 발표 PC 오프라인 안정성 측면에서 일관 적용. 에셋 파일을 가져온 게 아니라 시각 스타일만 참고(라이선스 attribution 파일 동봉 불요).
- **Lato 폰트 = 생체 차트 패널에만 스코프.** 라인그래프 레퍼런스가 Lato를 명시 → layout 의 Google Fonts 링크에 Lato 추가하되 `VitalHistoryPanel` 섹션에만 `fontFamily` 적용(SVG text 상속). **세션26에서 관제 웹 전역 폰트(Archivo/Do Hyeon)를 적용→롤백한 이력**이 있어 전역 미적용·되돌리기 쉬운 스코프 선택.
- **1년 추세 = 월별 12점(일별 365 회피).** 60일/1년 range 추가 시, 1년을 일별 365점으로 하면 막대 슬롯(~1.8px)이 도트(~7.8px)보다 좁아 **심하게 겹쳐 가독성 붕괴**. → `range===365` 는 **월별 12점 집계**(`buildHistory`/`buildSeries` 분기, `labelMonthsAgo`/`formatMonth`). 낙상=월 30일 카운트 총합, 배터리=단조감소·마지막=현재값. 60일은 일별 60점 유지. 작업자(API)·가스/AED(클라이언트 합성) 양쪽 적용.
- **제세동기 배터리 게이지 = 행 높이 불변이 요구사항.** 배터리 % 텍스트를 레퍼런스 원형 Gauge(인라인 SVG `stroke-dasharray`)로 교체하되, **게이지 36px 고정**으로 기존 행 `h-12`(48px) 안에 들어가게 함 → "각 줄 크기 변경 없이" 충족. 색=배터리 임계(≤20 빨강/≤50 앰버/그외 초록). 추세 그래프 클릭 버튼·aria-label 보존.
- **관리자 로그인 구글 버튼 = 레퍼런스 그대로 포함(사용자 선택).** Signup1 레퍼런스의 구글 버튼/푸터는 관리자 ID/PW 단일 인증과 안 맞지만(OAuth·가입 없음), 사용자가 "레퍼런스 그대로(구글 포함)" 선택 → 비기능 구글 버튼(클릭 시 "준비 중" 안내, 메인 로그인 패턴 동일) + 푸터("관리자 계정 문의는 시스템 관리자") 적용. 인증 로직·로그인 후 내보내기 패널은 불변.
- **★ iOS 무료팀 기기 등록 = Xcode 1회 Run 등록 후 CLI release 덮어쓰기(확립된 복구 경로).** `flutter build ios --release`(generic device)·`flutter run --release` 둘 다 무료 Personal Team(F2P5ZFP65Q)에서 **특정 기기를 프로파일에 등록 못 함**(`devicectl install` → `0xe8008012`, 임베드 프로파일 ProvisionedDevices=0). 7일 프로파일 재생성 시 기기 빠짐(Cyён/YJH워치와 동일 무료팀 블로커). **유일 해결** = Xcode `Runner.xcworkspace` 에서 기기 선택 → Product>Run 1회(자동서명이 기기 등록+신뢰, 이때 debug 설치=DEBUG 배너) → 이후 `flutter build ios --release` 가 device 포함 프로파일(검증: ProvisionedDevices 2·BECKS 포함) 생성 → `devicectl install` 로 debug→release 덮어쓰기. **최종은 CLI release**(IDE Run은 등록 한정). 재설치 후 검증 = 임베드 프로파일 device 수 + `kernel_blob` 없음(RELEASE) + EMP-1234 수신.
- **★ SPM 비활성화 = 이 프로젝트 정공.** Xcode 1회 Run 후 `flutter build ios --release` 가 `SwiftPackageManager._dependenciesForPlugins` 의 `Cannot create link, File exists`(Xcode Run이 만든 SPM 심볼릭 링크 충돌)로 크래시. 이 프로젝트는 `health` 플러그인이 **SPM 미지원**(빌드 경고)이고 CocoaPods(`pod install`) 사용 → `flutter config --no-enable-swift-package-manager`(머신 전역) 로 SPM 비활성화 후 정상 빌드(18.1MB release). 향후 iOS 빌드도 이 설정 유지 권장. **단 iOS 재빌드 부산물**(`ios/Podfile.lock`·`Runner.xcodeproj/project.pbxproj`·`pubspec.lock`)이 변경됨 → revert vs commit 결정 필요(pbxproj 는 Xcode Run의 서명/빌드 설정 변경 포함 가능).

## 2026-06-09 세션30 — 주요 결정

- **★ AED 본체 배터리·전극패드 = 교환 주기 관리(실시간 측정 불가).** 현장 AED는 텔레메트리가 없어 본체 배터리·패드의 실시간 상태를 읽을 수 없음 → 라이브 % 표시는 **물리적으로 불가능**. 대신 제조사 권장 **교환 주기**(배터리 48개월·패드 24개월)로 임박/경과만 알림. 라이브 배터리 게이지(%)는 **'AED 알림 단말'(우리 IoT 장비) 자체 배터리**에만 적용 → "배터리 부족"은 단말 한정. 행 종합 = worst-of(단말 배터리·AED 배터리 교환주기·패드 교환주기). 커밋 `01c379c`.
- **★ AED 갱신 = 현장 NFC 태깅(관제 센터 직접 갱신 폐기).** 관리자가 여러 명이라 누가 점검했는지 식별 필요 + 관제 센터가 임의로 "최근 교환"을 못 바꾸게 → **장비별 NFC 태그(URL)** 부착, 관리자가 폰을 태깅하면 점검 페이지가 열리고(점검자 이름·교체 항목 입력) `POST /api/aed/inspect` 로 전송 → `aed_inspections`(SQLite) 기록 → 대시보드 **12초 폴링**으로 최근 교환·교환주기·이력 자동 반영. 관제 웹은 **표시 전용**(직접 수정·갱신 없음). 직전안(현장 단말 리셋 버튼)을 NFC로 대체. 커밋 `aa5914a`.
- **★ QR → NFC 방향 전환(사용자 결정).** 처음엔 장비별 QR + 스캔→점검 페이지로 설계(경량 QR 라이브러리 추가 승인까지 받음)했으나, 사용자가 **NFC 방식으로 변경** 지시 → `qrcode` 의존성 불필요(Web NFC는 브라우저 API). NFC 태그는 점검 URL(NDEF)을 담고, 태깅 시 폰 OS가 URL을 열어 점검 페이지로 이동. 태그 프로비저닝은 **Web NFC `NDEFReader.write`**(Android Chrome 전용)로 대시보드 NFC 모달에서 직접 쓰거나, 미지원 환경은 URL을 NFC 쓰기 앱으로 기록(graceful 폴백). → **신규 의존성 0** 유지.
- **NFC 점검 URL = 현재 origin 기반.** 모달이 `${window.location.origin}/aed/inspect?id=<장비id>` 로 URL 생성 → 대시보드를 cloudflared 터널로 열면 터널 URL, LAN으로 열면 LAN IP가 박혀 **폰에서 그대로 스캔 가능**(세션마다 회전하는 터널 URL을 수동 입력할 필요 없음). 그래서 QR/NFC URL 생성은 클라이언트 측이 자연스러움.
- **장비 레지스트리 = 단일 공유 출처(`lib/aed-devices.ts`).** AED 장비(id·위치·관리책임자·교환주기·seed 이력)를 한 곳에 두고 **대시보드 표·모바일 점검 페이지·API 검증**이 공유 → id↔위치 매핑·미지 장비 차단(404)이 일관. 표시 이력 = DB 점검 기록(NFC) + seed 이력 병합(최신 먼저), 교환 주기는 최근 배터리/패드 교체일에서 파생. 통합 신호등 `aedDetail` 도 같은 모듈 캐시(`aedInspectionsCache`)를 읽어 표와 동기화(SSR/첫 렌더엔 빈 배열=하이드레이션 안전).
- **★ Web NFC 태그 쓰기 = 미검증(시연 시 확인 필요).** `NDEFReader` 는 **Android Chrome 전용**이라 데스크톱 검증 불가 → 폴백 안내만 확인. 실제 태그 쓰기는 **Galaxy Chrome + 물리 NFC 태그**로 발표 시연 시 검증. 그 외 전 경로(점검 페이지·POST/GET·검증·폴링 반영·병합 이력)는 실UI end-to-end PASS. 점검 페이지는 무인증(현장 액션, PII 아님: 점검자명·위치·시각).

## 2026-06-10 세션31 — 주요 결정

- **★ iOS 재설치 부산물(Podfile.lock·project.pbxproj·pubspec.lock) = revert 아닌 commit.** 세션29 무료팀 등록 벽 돌파(Xcode 1회 Run 기기 등록 → SPM 비활성화 → CocoaPods 정공 `flutter build ios --release`)로 BECKS 18.1MB release 가 나오고 수신까지 검증된 **정상 빌드 산물**임. revert 하면 repo 가 검증된 빌드 환경과 어긋나고 다음 `pod install`/`flutter pub get`/Xcode 열기에서 **동일 diff 가 그대로 재발생** → 되돌릴 실익 0. diff 검토 = Podfile.lock 플러그인 6종 CocoaPods 등록(connectivity_plus/device_info_plus/flutter_secure_storage_darwin/geolocator_apple/package_info_plus) + pbxproj **Xcode 자동 정규화**(중복 `name=Pods` 제거·속성 순서 — **서명/팀/기기 식별정보 미포함** 확인) + pubspec.lock geolocator 플랫폼 구현 `transitive` 정정(pubspec.yaml 이 `geolocator` 단일 직접 의존이라 정합). 커밋 `ac95b74`.
- **★ demo/ 외형 스냅샷 = gitignore(커밋 X).** 세션28 SingleFile 스냅샷 2개(`safetymonitor-dashboard-live-snapshot.html`·`-login-snapshot.html`, 3.1MB)는 **세션마다 재생성되는 일회성 팀 공유물**(소스 아님, 회전 터널 상태의 특정 시점 정지본 → 금세 stale). base64 인라인(PNG·WebGL·폰트 박제)이라 커밋하면 git 히스토리가 매 세션 3MB씩 영구 누적. 공유는 "더블클릭 독립 실행" 파일 직접 전달이지 repo clone 아님 → `.gitignore demo/`(세션27 `.claude/skills/` gitignore·`dashboard-full.png` 삭제 선례와 동일 결). **PII 안전성 사전 확인** = exact grep 으로 실명(장우진 등) 0·사원번호(EMP-) 0·전화(010-) 0·GPS 좌표(35.1.../126.9...) 0, 남은 건 직책 "현장소장"·도시 "광주"(비개인정보)뿐이라 커밋했어도 유출은 아니나, 위 히스토리 누적 이유로 gitignore 채택. 파일은 로컬 보존. 커밋 `57e8505`.
- **★ KMA `03 NO_DATA` = 정상 무특보로 분리(오류 아님).** 세션23 발견 = [kma.ts](apps/dashboard-web/app/lib/kma.ts) `fetchAllActive` 가 `resultCode !== "00"` 을 전부 API 오류로 묶어 `03 NO_DATA`(data.go.kr 표준 코드 = 결과 없음 = **현재 발효 특보 없음**, 정상 상태)도 `MOCK_WARNINGS` 폴백 → 전국 무특보 날 서울/경기/강원(강풍주의보)·전남/경남/제주(폭염주의보) **등록 작업자에게 가짜 특보 거짓 점등** + 현장기상 신호등 거짓 + 세션22 특보영상이 존재하지 않는 특보로 YouTube 검색 트리거(쿼터 소모). 상용화 기준 실 결함이라 **분리 수정 채택**(발표용 mock 유지 기각 — 가짜 특보가 무특보보다 나쁨, 안전 시스템에서 false alarm 은 신뢰 훼손). 수정 = `resultCode === "03"` → `source:live` + 빈 결과(10분 캐시, `00` 경로와 동일 캐싱), `00` 외 **비정상 코드(99 서버오류·30 키오류)·네트워크 throw 만** mock 폴백 유지(원저자의 "키 없거나 실 장애 시 데모 무중단" 의도 보존). 라이브 검증 = 실 KMA 오늘 `03` 반환 중 → dev HMR 후 서울(37.5665,126.978)·전남(34.8161,126.463) 모두 `source:live`·`severity:normal`·"특보 없음"(수정 전이면 mock 강풍/폭염주의보였을 자리). 발표일(07-07) 무특보여도 false warning 0. tsc 0·analyzers 15/15+dashboard 14/14. 커밋 `d60151c`.
