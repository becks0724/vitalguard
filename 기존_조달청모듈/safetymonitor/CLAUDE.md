# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**SafetyMonitor (가칭 `IndusView`)** — 산업 현장 작업자 생체 모니터링 컨셉. Apple Watch + Android Wear 작업자 단말 ↔ AWS IoT Core 백엔드 ↔ 관제 웹 대시보드 + 모바일 보조 앱. KOSHA 산업안전보건법의 "실시간 위험성 평가" 의무 디지털 지원.

> **이 프로젝트의 목표는 발표용 프로토타입 *한정이 아니라* — 발표(2026-07-07)를 첫 검증 마일스톤으로 삼아 *최종 상용화·현장 실사용*까지 가는 것이다 (2026-06-07 방향 전환).** 따라서 — ① 발표까지는 *데모를 깨지 않는 선*에서 상용화 친화적 선택을 우선하고, ② AWS 실배포·유료 계정·멀티테넌트 같은 큰 전환은 *발표 직후* 착수하며, ③ 모든 결정 기준에 "데모만 되는가"가 아니라 **"현장에서 실제로 24/7 돌아가는가"** 를 포함한다. 제품 전반 상용화 갭 분석·단계별 로드맵은 [docs/commercialization-gap-analysis.md](docs/commercialization-gap-analysis.md), 잠금·배터리 심층은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md), 성격 재정의 상세는 [docs/context-notes.md](docs/context-notes.md) 참조.

HealthPattern (개인용 HealthKit 패턴 앱) 의 분석 알고리즘만 이식. HealthKit·SwiftUI 종속 코드는 미사용. 외부 서버 0건 정책은 본 프로젝트에서 **폐기** (관제 자체가 서버 필수).

상세는 [docs/plan.md](docs/plan.md) · [docs/checklist.md](docs/checklist.md) · [docs/context-notes.md](docs/context-notes.md) · [docs/progress.md](docs/progress.md) 참조. 잠금·백그라운드 생체 모니터링 상용화 해결책은 [docs/commercialization-roadmap.md](docs/commercialization-roadmap.md) 참조.

## 현재 상태 (Status — 새 세션 시작 시 먼저 읽기)

- **★ 2026-07-27 — 다크모드 파비콘 2단(테마 자동전환 SVG + Safari용 테마별 PNG) + /retro L-16 구조적 차단 · 라이브 `00149-rs6`→`00150-9cf`→**`00151-ntq`** · 커밋 `bce061b`·`1b03481`·`eef4454`**. (요청) 라이트 모드는 로고가 잘 나오는데 **다크모드에서 탭 아이콘 가독성이 떨어짐** → 다크모드용 아이콘 설정. 부수 요청 = 감사 산출물 push 금지. (선행 — 감사 산출물 로컬 전용) `.git/info/exclude` 에 `/audit/`·`/VitAlGuard-코드베이스-audit-보고서-*.pdf` anchored 등록(harness·발표자료와 동일 방식·exclude 규칙 자체도 push 안 됨). 감사에서 나온 **코드 수정 커밋은 정상 push** — 제외 대상은 리포트·findings 산출물뿐. (1차 `bce061b`→`00150-9cf`) 기존 `app/icon.png` 단일(네이비→블루 `#0d2038`→`#2a8dff`)이라 다크 크롬에서 배경에 묻힘 → 신규 `app/icon.svg`(브랜드 원본 방패+ECG 패스 그대로, CSS `prefers-color-scheme` 로 스트로크 전환 — 다크 `#ffffff`→`#effaff`→`#a9dcff`). ★ **`app/icon.png` 제거가 필수였다** — 같은 base name 이면 Next 가 **png 만 emit 하고 svg 를 통째로 무시**(dev 서버 head 실측으로 확인, 안 지웠으면 무효 배포). (2차 `1b03481`→**`00151-ntq`**) Safari 는 SVG 내부 media query 를 무시 → `public/brand/favicon-{dark,light}.png` 신규(브랜드 원본 4267px 에서 SVG 와 **동일 crop 박스**로 방패만 잘라 256px·두 장 기하 동일 → 테마 전환 시 위치 안 튐) + `app/icon.svg`→`public/brand/favicon.svg` 이동 + `metadata.icons` 로 순서 명시 = **다크 PNG → 라이트 PNG → SVG(sizes=any)**. 순서 근거 = Chrome·Firefox 는 SVG 를 골라 내부 전환하고, `media` 를 무시하고 '마지막'을 쓰는 브라우저는 **라이트(기존 동작)로 폴백**해 어느 경로로도 회귀가 없다. ★ **회귀 1건 자체 적발·복구** — `metadata.icons` 를 선언하면 파일 컨벤션 `app/icon.*`·`app/apple-icon.png` 링크가 **전부 사라진다** → apple-touch-icon(iOS 홈화면)이 조용히 빠졌고 `icons.apple` 재명시로 복구. 라이브 head 5종 = `favicon.ico(16x16)` + 다크PNG(media dark) + 라이트PNG(media light) + `favicon.svg(any)` + apple-touch-icon. (**/retro — L-16 추가 + 구조적 차단 완료**) L-16 = *프레임워크 컨벤션 자산은 "파일을 뒀다"가 반영을 뜻하지 않는다* — 위 두 함정 모두 tsc·lint·test·build 를 전부 통과했고 **렌더된 head 를 grep 해서야** 드러났다. 신규 `apps/dashboard-web/lib/icon-metadata.guard.test.ts`(5건)가 ⓐ `metadata.icons`+`app/icon.*` 혼용 ⓑ `icons.apple` 누락 ⓒ 존재하지 않는 아이콘 참조를 **테스트 실패로 차단**(위반 3종을 실제로 만들어 각각 실패 확인·L-12 가드 방식). `/verify` 에 "메타데이터·정적 자산 변경 시 렌더된 head 대조" 절 추가. (검증) 각 배포 tsc0·lint0err(4warn 기존)·**test 363→368**(가드 5 신규)·`next build` SUCCESS·**L-09 BUILT==HEAD==origin 3자 일치**·라이브 루트200/rev100%/서빙 digest 일치/아이콘 자산 5종 200/구 `/icon.png`·`/icon.svg` **404**/라이브 SVG·PNG 2장이 **커밋 파일과 바이트 동일**/다크 PNG 불투명 픽셀 평균 RGB **(232,247,255)** vs 라이트 **(23,69,118)** 실측(테마 반전 확인)/env5·시크릿19·스케일1-4 보존. (팀원 동기 — 사용자 지시) 배포 전·빌드 후·push 전 매 단계 `git fetch`. 가드테스트 push 시 팀원 커밋 **`d528db6`**(mayeramschel — VitAlGuard 7.8 build 78 앱 소스) 발견 → 겹치는 경로 0(Swift·pbxproj) 확인 후 rebase 통합·**재검증(tsc·test) 후** push. (현재상태) **라이브 `00151-ntq` = 파비콘 커밋 `1b03481` 이미지**. main = **`eef4454`** = origin 동기이고 라이브보다 2커밋 앞서지만 **재배포 불필요**(`d528db6`=iOS/watchOS 앱 소스·대시보드 무관, `eef4454`=테스트 전용). `app/favicon.ico` 는 2026-07-24 Safari 대응으로 만든 **BMP-in-ICO 그대로 유지**(라이트 전용 레거시 폴백). cctv-ai OFF 유지. (다음) ① **(사용자 육안)** 다크모드에서 탭·북마크 아이콘 확인 — 브라우저 파비콘 캐시가 강하니 탭을 닫았다 다시 열거나 ⌘⇧R ② **Safari 의 icon `media` 속성 지원 여부 미검증** — 지원하면 테마별 PNG, 미지원이면 BMP ICO(라이트)로 폴백(회귀 없음). Safari 확인 후 필요하면 다크용 ICO 별도 배선 검토 ③ (참고·이 트랙 밖) 다른 세션의 감사 미해결 4건(BE-AUTHZ-03/-09/-08·BE-VALID-01)은 **이 워킹트리·main 에 없다**(그쪽 test 386 vs 현 368) — 별도 승인·배포 대기.
- **★ 2026-07-25~26 — 전 계층 종합 감사(6레이어·서브에이전트 16개) + FE/BE 단독 수정 8건 배포 · 라이브 `00137-vl7`→**`00145-gsd`** · main `41295e3`→`3e556d5`**. (요청) 프론트/백/DB/iOS/watchOS/Flutter 6레이어 동적 워크플로우 감사 → 팀원(양지후) 파트 제외한 우리 소유 영역만 수정·배포. (감사 산출물 — 로컬 `audit/`, 미커밋) `REPORT.md`(10장·PDF 9쪽)·`findings.json`(**109건** P0 12·P1 29·P2 42·P3 26)·`contract-diff.md`(32필드 전수 대조)·`patches/`(P0/P1 14건). (감사 핵심 발견) ①**낙상 ML 3모델이 실기기에서 한 번도 동작한 적 없음** — `.mlmodel` 이 `PBXResourcesBuildPhase`(project.pbxproj:376-383)에 있어 `.mlmodelc` 미생성 → `FallMLPipeline.init?()` 영구 nil(fail-open). 기본 전력모드 `lowPower` 가 `MLFusion` 미생성(WorkoutManager:245-250)이라 **독립 두 번째 사망 원인** ②**하루 중반 이후 워치 모니터링 무신호 정지** — 워치가 활동량을 하루 누적으로 전송(StressInputsReader:183-187 predicate 86400초)해 오후에 `steps>5000` 상한 초과 → 비-이벤트 샘플 strict 거부로 심박·SpO2·체온까지 통째 폐기, 배치가 삼키고 **HTTP 201 ok** 반환 → 워치 재전송 안 함 ③워크아웃 세션 비정상 종료 시 자동복구·통보 전무(조용한 감시 중단) ④수집 6개 라우트 무토큰 쓰기(클라 3종 전부 무토큰) ⑤소유권 검증 핸들러 **0개**. (감사 중 정정한 전제 5건) 라우트 102→**84개**(`.next/types` 오집계)·`db/*.sql` 은 앱 미사용 **고아 스키마**(기존 db/audit 지적 상당수가 미사용 테이블 대상)·`T_SAFEGUARD` 평문PW **철회**(실경로 `users`+scrypt 양호)·관제웹 낙상 신선도 게이트는 `bd6fc2a` 로 **이미 해소**·`WCH-FALL-02` 는 적대적 검증으로 **P1→P3 강등**(3796줄은 22초 뱃지이지 긴급배너 아님·제안 수정안이 스키마 미정의 필드 참조라 무동작). (배포 8커밋 — 전부 우리 소유 파일) `704693c` 스키마 계약(워치 상시모션 2종 독립필드+ML 텔레메트리 7종 추가·별칭 매핑 안 함=상시값이 충격피크로 오인되면 낙상분석 오염)·`38f8cb2` **무음유실 차단**(리질리언트 파서를 이벤트샘플→**전 샘플** 확대·`onStrip` 관측 콜백·배치 `droppedInvalid` 분리)·`18ae4b8` 인가(imu-export·worker-alias 역할게이트·weather/kma 무인증 GET 부작용 차단+호출부 4곳 토큰)·`49d4180` 레이트리밋(신규 `lib/rate-limit.ts`·수집 IP당 120/분)·`67a13b4` **크론 회귀 자체수정**(18ae4b8 이 무인 24/7 환경알림을 끊었음—크론은 세션 없음 → `x-cron-key` 전달·weather/kma 가 크론키를 세션과 동등 신뢰)·`405cc31` 내보내기 버튼(`busyFormat` 분리·눌린 쪽만 스피너·라벨 유지)·`1fe633c`+`ff9858b` **구획이탈→신호등 연동**(신규 `lib/worker-signal.ts` 순수함수·통합 신호등/표 행/지도 마커 3곳·지도는 순환의존 회피 위해 별도 파생 `workerMapPoints`)·`aff035b` **XFF 파싱 정정**(내가 넣은 오류—뒤에서 두번째→**최우측**. 헤더 한 줄로 빈도제한 무한우회 가능했던 취약점). `07f36ea` **클라이언트 IP 단일 모듈 통합**(/retro 자동화 — XFF 파싱이 3곳에 각자 구현돼 있었고 **2곳이 틀려 우회 가능**했다: admin-auth 최우측=정답 / rate-limit 뒤에서두번째=내 오류 / **email/send-code 최좌측=감사 BE-AUTHZ-07 미해소분**. 신규 `lib/client-ip.ts` 로 3→1 통합 + `client-ip.guard.test.ts` 가 다른 파일의 XFF 직접 파싱을 **테스트 실패로 차단**·임시 위반파일로 실동작 확인). (**/retro — lessons L-11~L-15 추가**) L-11 인가 추가 시 비브라우저 호출자(크론·기기) 끊김 · L-12 보안 판정 규칙 중복 구현 금지(**구조적 차단 완료**) · L-13 로그 시각 인접만으로 원인 귀속 금지(UA 로 분리) · L-14 임계 검증은 병렬 부하 필수(순차 curl=초당2건=한도와 동일이라 영원히 미도달) · L-15 서브에이전트·감사 결과는 발견이 아니라 가설(반증 시도 후 채택). `/verify`·`/deploy` 커맨드에 해당 절차 항목 추가. (★L-09 실제 발동 — 사고 예방) 마지막 배포에서 1차 빌드 완료 시점에 HEAD 가 `07f36ea`→`3e556d5` 전진(병렬 세션의 **앱 코드** 변경=`store.ts` SpO₂ 신선도 게이트 +116줄, docs-only 아님) → **구 digest 폐기**·재검증·최신 HEAD 재빌드. 그대로 배포했다면 팀원 커밋이 롤백될 뻔했다. ★**배포 없이 인프라 동작 실측한 기법** — 이미 배포된 레이트리밋을 관측 장치로 사용: 버킷 소진 후 위조 XFF 동봉 재요청이 통과하는지로 **Cloud Run 이 홉을 정확히 1개(진짜 클라 IP)만 덧붙임**을 확정. (검증) 매 배포 tsc0·lint0err(4warn 기존)·**test 239→338**(신규 99건)·L-09 대조 전건 통과·라이브 루트200/rev100%/digest일치/env23·시크릿18·스케일1-4 보존. 기능 실검증은 **L-04 준수**(`smoke_` 예약ID=파싱만 통과·DB 미저장) — steps9000 샘플이 **202**(구버전이면 400=유실차단 확정)·`droppedInvalid:1` 노출·무인증 imu-export 401·레이트리밋 200건 동시폭주 429 140건·위조XFF 수정 후 차단. (육안 검증 완료 — 사용자) 통합 신호등 이상명단 `장우진 — 구획이탈`·내보내기 CSV 쪽만 스피너+**글자 겹침 해소**·구획이탈 팝업 정상. (현재상태) **라이브 `00145-gsd` = main `3e556d5` = origin 동기**·cctv-ai OFF(ingress internal·실측 확인)·프로덕션 env 실측 = `MOCK_VITAL_EXPOSE_PII=true`·`APP_UPLOAD_TOKEN` 설정됨·시크릿 18/23 Secret Manager. (다음) ① **[미검증 1건 — 유일한 잔여 검증] 오후(하루누적 5000보 초과 시점) 워치 착용 생체카드 지속 여부** = 무음유실 수정의 실효 검증. 멈추면 서버로그 `[vital] 범위 밖 필드 스트립`·`배치 검증 실패로 폐기` 확인 ② **[양지후 조율] P0 5건** = ML 빌드페이즈(.mlmodel→Compile Sources)·lowPower ML 우회·세션 자동복구·알림 배너탭 낙상 오분류(`handleFallResponseRequested` else 분기)·워치 활동량 60초 창 → 패치 `audit/patches/` 7건에 '조율 필요' 표시 ③ **[결정 선행] DB 6건** = 캠퍼스 DB(SMHRD) 유지 여부가 전제 — RLS·암호화·보존기한·파기수단(현재 `DELETE FROM vital_samples` 코드 자체가 없음)·sslmode ④ `BE-AUTHZ-01` 하드 전환은 클라 3종 토큰 탑재 배포 후에만 ⑤ `CRON_SECRET` 평문 env 는 **의도된 결정**(harness/context-notes.md:638 — 저위험 게이트·스케줄러 헤더에 어차피 평문·IAM 왕복 회피)이라 변경 안 함.
- **★ 2026-07-24 — [진단·계획 전용·코드변경 0·배포 0] CCTV 객체인식 모델 점검 + 영상 버벅임 원인규명 + Jetson Orin Nano DETR 재분석 → 설정변경 계획서 작성**. (요청) 관제 CCTV 객체인식 사용 모델 확인·YOLO11n/DETR 스펙비교 → 객체 연결 시 버벅임 완화 최적 프레임·모델 추천 → 엣지(Jetson) GPU 전제 DETR 가능성 재분석 → 계획 .md 정리. (모델 확인 — [cctv-ai/main.py](cctv-ai/main.py)) CAM-01 객체=**YOLOv8n**(`YOLO_MODEL=yolov8n.pt`:36·imgsz960/라이브800·conf0.25)·CAM-03 PPE=**Hexmon YOLOv8m 14클래스**(`vyra_ppe.pt`:67)·CAM-02 낙상=합성(모델無). (버벅임 원인) CAM-01 파이프라인에 **FPS 2개 어긋남** — 표시 `FPS=12`(하드코딩·:33) vs 생산 `PLAYBACK_FPS=6`(:38) → 절반 중복재전송·실움직임 6fps 끊김 + 클립15fps를 6재생=0.4배 슬로모. 근본병목=매프레임 imgsz800 CPU추론. (처방=표시/추론 분리) CAM-03 라이브(`_ppe_live`:106)의 '표시=매프레임 캐시박스, 탐지=throttle' 패턴을 CAM-01(`_object_worker`:192)에 이식 → **표시15fps·탐지5fps(3프레임당1회)·imgsz800→640·YOLOv8n→YOLO11n**(CPU~30%↑·mAP+2.2·드롭인). CPU예산=640×5fps는 800×6fps 대비 추론부하~0.53배라 15fps 표시+폰override 양립 유지(`OMP/MKL_NUM_THREADS=1` 보존). (Jetson DETR 재분석) 기기=**Orin Nano**(발표자료:370·8GB공유·40~67TOPS 엔트리). **순정 DETR-R50 부적합**(~3~6fps+TRT deformable플러그인)·**실시간 DETR(RF-DETR/RT-DETR-R18/D-FINE-S)만 단일카메라 실시간**(~20~40fps FP16)·**DETR은 박스검출기라 낙상(pose) 대체 불가**. 권고=CAM-01만 RF-DETR 승격(Roboflow supervision 이미 의존·NMS-free 군중강점)·CAM-03 PPE는 YOLO유지(DETR전환=PPE재학습)·CAM-02 YOLO11n-pose 유지. (산출물) [cctv-ai/cctv-설정변경-계획.md](cctv-ai/cctv-설정변경-계획.md) — Phase1(Cloud Run CPU 부드러움)·Phase2(Jetson RF-DETR) 2단계·변경지점표·체크리스트·검증기준·열린질문 3개. (현재상태) 코드/배포 변경 0·cctv-ai OFF 유지·라이브 `00137-vl7` 그대로. (다음) ① Phase1 구현 — `_object_worker` 표시/추론 분리 재작성·`FPS→DISPLAY_FPS15`·`PLAYBACK_FPS→DETECT_FPS5`·`YOLO_MODEL=yolo11n.pt`·`YOLO_IMGSZ=640`·YOLO11n 가중치 재취득 → 로컬 벤치(fps·CPU) → /verify → /deploy(cctv-ai 재개 필요) ② Phase2 — Orin Nano에서 RF-DETR-small·RT-DETR-R18 TensorRT FP16 export 후 trtexec 단일/pose동시 벤치 ③ 열린질문 결정 = DETR대상(객체만/PPE포함)·Nano 4GB/8GB·Phase1 선배포 여부.
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
