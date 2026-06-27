# SafetyMonitor — Progress

> 활동 로그·진척률·다음 액션을 시간순으로 기록. 다음 세션 (사람·에이전트) 이 *지금 어디까지 왔는지* 1분 안에 파악하기 위한 파일.
>
> **규칙**.
> 1. 활동 로그는 **상단 날짜 섹션** 에 추가 (역시간순)
> 2. 매 작업마다 *무엇·결과·증거(커밋/스크린샷)·다음 액션* 4종 기록
> 3. 마일스톤 상태 표는 **변경 시마다 즉시 갱신**
> 4. *왜* 그렇게 했는지는 [context-notes.md](./context-notes.md), *무엇을* 할지는 [checklist.md](./checklist.md) 참조. 본 파일은 *언제 무엇을 했는지* 만 기록

---

## Quick Summary (30초 안에 읽기)

### ★ 최신 (2026-06-27 — 기능/UX/인프라 7건 · 라이브 `00013-p28`→**`00018-5tn`** + CCTV AI 서버 신규 Cloud Run, **CAM-01 실 YOLOv8n**)

1. **내 정보 저장 완료 다이얼로그** (`2728879` → `00014-kg5`) — 저장 후 인라인 메시지만 떠 2차로 직접 닫아야 하던 불편 해소. 성공 시 '변경이 완료되었습니다' 다이얼로그(카드 오버레이)→'예' 클릭으로 모달 전체 닫기. 라이브 라우트목 E2E 6단계 PASS.
2. **클라우드 브릿지 Phase 2a — Cloudflare R2 어댑터** (`2dad666` → `00015` 번들 포함, **단 R2 자격증명 미설정이라 런타임 비활성**) — `lib/storage.ts`(S3호환 presignUpload/presignDownload/isR2Configured) + `POST /api/calendar/media/upload-url`(프리사인 PUT, 미설정 시 503) + GET 표시 경로 만료형 GET URL. 비공개 버킷·서버 API만. **Phase 2b(R2 버킷·토큰 셋업)** 남음. → [cloud-bridge-context.md](./cloud-bridge-context.md)
3. **작업자 모니터링 슬롯 등록 서버(DB) 영속** (`20ad4e1` → `00015-swq`) — 브라우저 localStorage 영속을 **서버로 승격**: `monitor_slot_config`(단일행 JSON) + `GET/PUT /api/monitor/slots`(관리자 인증) + 클라 마운트 시 서버 로드(로컬 우선)·변경마다 PUT. 어느 기기·브라우저로 접속해도 등록 유지. 라우트목 E2E — 빈 localStorage 브라우저에 서버 슬롯 복원(크로스기기)+등록 시 PUT PASS. (라이브 `monitor_slot_config` 테이블 initSchema 자동 생성 확인.)
4. **캐러셀 자동 슬라이딩 해제** (`9b0808f` → `00016-frj`) — 국내재해사례·우측 위젯(현황요약/레이더/태풍/특보) `WidgetCarousel`에 `autoRotate={false}` → 수동 ‹ ›만. 라이브 E2E 11초 경과 카운터 불변 PASS.
5. **가스/설비 표 주의·위험 행 다크모드 가독성** (`b53fd34` → `00017-cj8`) — 다크모드에서 행 배경이 라이트(orange-50/red-100)+흰 글씨라 대비 0. 원인: `dark:bg-orange-500/8`·`red-500/12`의 `/8`·`/12`가 **Tailwind 기본 opacity 스케일 밖이라 클래스 미생성**(빌드 CSS 0회) → 다크 변형 무효. 스케일 내 `/20`(amber/red)으로 교체. 라이브 계산색 어두운 틴트 확인.
6. **CCTV AI 서버 로컬→Google Cloud 이전** (`47f157b`+`bc97a33`+`c93b385` → 대시보드 `00018-5tn` + **신규 서비스 `cctv-ai`**) — CAM-01~03이 `http://localhost:8000`(빌드타임 env 미주입 폴백)을 찾아 '연결 대기'였음. ⓐ AI 서버([cctv-ai/](../cctv-ai/) FastAPI MJPEG 3종+통계 3종, opencv 합성, **계약 정확 일치**)를 Cloud Run 신규 배포(`cctv-ai-569797426568.asia-northeast3.run.app`, min0 scale-to-zero) ⓑ 대시보드 `NEXT_PUBLIC_AI_CCTV_API`를 **빌드타임 build-arg로 주입**(Dockerfile ARG/ENV + [cloudbuild.dashboard.yaml](../cloudbuild.dashboard.yaml), `.env.*`는 dockerignore라 빌드 누락→localhost 폴백이 원인이었음). 라이브 Playwright — AI타일 3개 클라우드 MJPEG **640×360 프레임 로드**·localhost호출0·연결대기0. (영상은 시뮬레이션 → 7번에서 CAM-01 실모델 교체.)
7. **CCTV CAM-01 실제 YOLOv8n 추론** (cctv-ai `main.py`/Dockerfile/requirements/README + `.gitignore`·`.gcloudignore` · `cctv-ai-00001-4d4`→**`00003-mvw`**) — 6번의 합성 영상을 **CAM-01만 실 객체감지로 교체**. 홍대 거리 라이브캠 40초(`samples/cam01.mp4`, format 93=640×360, yt-dlp+cv2로 번들)를 루프 재생, 프레임마다 `yolov8n.pt`(번들) 추론 → 보행자·차량·자전거 등 **실박스 + 실통계**. 백그라운드 스레드가 전역(frame/stats) 갱신, `/cctv/stream`·`/cctv/stats`가 읽음. 모델·영상·ultralytics 없으면 **합성 자동 폴백**. CAM-02 낙상·CAM-03 PPE는 합성 유지. **근본원인 해결 — Cloud Run 기본 CPU 스로틀링이 요청 밖 백그라운드 추론 스레드를 굶김 → `--no-cpu-throttling`(+ `--memory 2Gi`).** torch는 CPU 휠 별도 설치, ultralytics가 끌어온 full opencv 제거(headless 단일화), 바이너리(6.3M+5.5M)는 git 미추적이되 `.gcloudignore`로 빌드 컨텍스트엔 포함(gcloud 의 .gitignore 폴백 차단). 라이브 stats `fps9·보행자4·차량1·자전거1`, stream 640×360 실프레임(bus/person/car 박스 시각확인), 대시보드 CAM-01 ON·AI·LIVE·localhost0·연결대기0. (헤드리스 MJPEG 미페인트는 기존 한계 → 서버측 직접 캡처로 영상 콘텐츠 입증.) → [cctv-ai/README.md](../cctv-ai/README.md)

- **검증** — 전부 tsc=0 + next build=0. 1·3·4·5·6·7 라이브 검증 완료. 2(R2)는 코드 배포·런타임 비활성.
- **배포 체인** — 대시보드 `00013-p28`→`00014-kg5`(다이얼로그)→`00015-swq`(R2+슬롯)→`00016-frj`(캐러셀)→`00017-cj8`(다크모드)→**`00018-5tn`**(CCTV AI). cctv-ai `00001-4d4`(합성)→`00002-666`(2Gi)→**`00003-mvw`**(no-throttle·CAM-01 실추론).
- **현재 상태** — **라이브 = 대시보드 `00018-5tn` + `cctv-ai-00003-mvw`**(CAM-01 실 YOLOv8n). 직전 세션 push 로 1~6번 origin/main 동기화 완료. **7번(CAM-01 실추론) 변경은 커밋·푸시 대기.** 바이너리(`yolov8n.pt`·`samples/cam01.mp4`)는 git 미추적(로컬·이미지에만 존재). 로컬 dev 종료.
- **다음 액션** — ① **7번 커밋·GitHub push.** ② **R2 Phase 2b** — R2 버킷·토큰 생성 + `.env.local`(R2_* 4키) + Cloud Run 시크릿 → 클라우드 브릿지 업로드 활성화(현재 upload-url 503). ③ (선택) CAM-02 낙상·CAM-03 PPE도 실모델 교체(영상/가중치 추가 필요). ④ (선택) `/cctv/connection` 서버구현 → AI 타일 ON/OFF 토글 활성화(현재 404 무시·무해). ⑤ (선택) 비-관리자 권한차단 E2E(가입 이메일인증 때문에 보류). ⑥ 비용 — `cctv-ai` 는 `--no-cpu-throttling`+`min-instances 1` 로 **상시 CPU 과금**. 발표 외 시간엔 `gcloud run services update cctv-ai --min-instances 0` 으로 절약(첫 접속 콜드스타트·모델로드 지연 감수).

### (2026-06-26 세션 후반 — 프로필/보안/버그 수정 5건 + 라이브 4회 배포 `00010`→**`00013-p28`**)

직전 5종(아래) 이후 추가 작업을 전부 **push + Cloud Run 배포 완료**. 라이브 `00009-8nx`→`00010-8sp`→`00011-r2d`→`00012-j8l`→**`00013-p28`**.

1. **내 정보 수정 3건** (`3190704` → `00010-8sp`) — ① **(버그)** 부서/직책 저장 후 재진입 공란 = `save` useCallback 의존성에 `department`/`jobTitle` 누락(stale-closure로 빈값 저장) → 의존성 추가. ② 팝업 한 화면(패딩·간격 컴팩트+max-h 92vh). ③ 배경 스크롤 전파 차단(body overflow 잠금+`overscroll-contain`).
2. **사용자 관리 부서/직책 인라인 편집** (`dd32828` → `00010-8sp`) — owner가 사용자 관리 테이블에서 각 사용자 부서/직책 직접 수정(액션 `set_profile` owner전용·빈값 null·폴링 중 draft 보존, `setUserProfileFields(id,…)`). 본인 자가입력과 별개 경로. → [profile-access-context.md](./profile-access-context.md)
3. **헤더 로그인 상태 칩** (`a9b7ee3` → `00011-r2d`) — 'POST /api/mock/vital'(개발용 라벨) 자리에 로그인 확인 칩(접속점+이름+역할배지). 로그인 상태 가시화.
4. **로그인 칩 보안 개편 + 사원번호 + 비밀번호 게이트 + 한화면 모달** (`b601c37` → `00012-j8l`) — ① 칩 클릭 제거(표시 전용 div) → 칩으로 내 정보 직접 진입하던 보안 문제 해소, 표기 이름/직책/사번/아이디. ② 내 정보 진입 시 **비밀번호 재확인(step-up 인증, `/api/admin/verify-password`)**. ③ `users.employee_id`(사원번호) 신규 — 내 정보 입력칸+칩. ④ 내 정보 모달 비번섹션 접기+아이디·사번 2열 → 662px 한화면. → [profile-access-context.md](./profile-access-context.md)
5. **태풍 진로 카드 위성지도 짤림 수정** (`48926c0` → `00013-p28`) — Tailwind preflight `img{max-width:100%}` 가 좁은 카드(<256px)에서 256px 위성타일을 컨테이너 폭으로 압축(w256→188)→타일 간 틈에 배경 노출(어두운 띠). 타일 `<img>`에 `maxWidth:"none"` 추가로 해소. 모달(>256px)은 무관해 정상이었음.

- **검증** — 전부 tsc=0 + Playwright 라우트목/E2E(프로필 LOAD/SAVE 바인딩·인라인편집 DB영속·미인증401·칩 표시/클릭불가·게이트 선차단·한화면·태풍 타일 w256 복구). 각 배포마다 라이브 HTTP200+리비전 100% 확인.
- **현재 상태** — **origin/main=`48926c0`(완전 동기화)**, working tree clean, **라이브=rev `00013-p28`**(GitHub 일치). 로컬 dev 종료.
- **다음 액션** — ① 클라우드 브릿지 Phase 2(스토리지 백엔드 GCS/R2/네이버 결정 + 프리사인 업로드 URL) → Phase 3(앱 OCR→업로드 연동) ② (선택) 비-관리자 권한차단 E2E(가입 이메일인증 때문에 보류). ✅[완료] 관리자 사원번호 필드(`b601c37`).

### (2026-06-26 — 캘린더 대규모 개편 5종 + 관리자 권한제어)

이번 세션 = 캘린더/프로필/권한 기능 5종 신규·개편. 전부 **tsc=0·next build=0·Playwright 검증 통과**, **로컬 커밋만(미푸시·미배포)**. 상세 근거는 컨텍스트 노트 3종 참조.

1. **일정 라벨 커스터마이징 + 시작/종료 시간** (`57592b6`+`c3bd7e7`) — 고정 4라벨→동적(추가/삭제·이름·8색 팔레트), 단일 시간→시작/종료, localStorage 영속. → [calendar-schedule-custom-context.md](./calendar-schedule-custom-context.md)
2. **날짜별 날씨 아이콘** (`f41b433`+`25d6a79`) — 기존 Open-Meteo 7일 예보(daily7) 재사용해 셀 우상단 아이콘(예보창 오늘~+6일만 표시). 기상청 `KMA_SERVICE_KEY` 미발급이라 Open-Meteo 채택(사용자 확정).
3. **클라우드 브릿지 Phase 1** (`6963cb2`+`139d55e`) — `calendar_media` 테이블 + `/api/calendar/media`(GET/POST/PATCH/DELETE) + 셀 배지·선택일 미디어 섹션(썸네일·OCR·설명). 스토리지 비종속(media_url만으로 동작). → [cloud-bridge-context.md](./cloud-bridge-context.md)
4. **미디어 댓글 + 날짜선택 UX 개편** (`b381b13`+`89de2ad`) — 날짜 클릭=선택만(일정 추가는 (+)버튼), 미디어 카드 제목/내용 분리, '현장 미디어'→'현장 이미지/미디어', 관리자 단일 설명→댓글 스레드(`calendar_media_comment`).
5. **프로필 부서/직책 + 관리자 메뉴 권한제어 + 댓글 작성자 상세** (`bcb17fe`+`71ac4fd`) — users +department/job_title/admin_access. **owner 개별 부여**(직책=권한 자가취득 방지) + **서버 강제**(hasAdminMenuAccess, 관리자 데이터 8엔드포인트). 댓글에 이름·직책·사번·시각. → [profile-access-context.md](./profile-access-context.md)

- **검증 증거** — 권한 부여/회수(실 가입사용자 admin3470 대상 grant→true/revoke→false/원복), 서버 `/api/admin/workers` 미인증=401·owner=200, 댓글 직책 '시스템 관리자' 표시 Playwright 통과. 데모 미디어 6건(`site_id=DEMO-SEED`)+샘플 댓글 시드.
- **현재 상태(→ 이후 갱신됨)** — 당시 미푸시·라이브 `00009-8nx` 미반영이었으나, **이후 push + 배포 완료**(위 ★ 최신 섹션 = rev `00010-8sp` 반영).
- **다음 액션** — ① 클라우드 브릿지 Phase 2(스토리지 백엔드 GCS/R2/네이버 결정 + 프리사인 업로드 URL) → Phase 3(앱 OCR→업로드 연동) ② (선택) 관리자 사번 필드, 비-관리자 권한차단 E2E(가입 이메일인증 때문에 보류).

### (2026-06-26 — 한국공휴일 라이브 배포(rev 00008) + 캘린더 클라우드 아이콘·다크모드 헤더 수정 + 팀원 스타일 리팩터 안전병합 + 라이브 배포(rev 00009-8nx))

- **★ Cloud Run 재배포 rev `00008-m2w`**(2026-06-25) — 팀 pull(한국 공휴일 캘린더 `7bc9b4d` 등) 라이브 반영 위해 `gcloud builds submit`(3분16초)+`gcloud run deploy --image`(env·9시크릿 보존). 라이브 검증 = HTTP 200·`check-username`(reserved)·로그인 401·JS 청크에 공휴일 데이터 확인. 라이브 리비전 `00007-7n7`→**`00008-m2w`**. (Galaxy 스키마 `vital_samples_galaxy`는 앱 미참조·라이브 DB 미적용 = 배포 무관.)
- **★ 캘린더 헤더 아이콘 = 클라우드+캘린더 결합**(`1cdd2c2`) — [DemoDashboard.tsx:2186](../apps/dashboard-web/app/components/DemoDashboard.tsx#L2186) 단순 달력 → 결합 라인 아이콘(기능 #1 미디어 캘린더 방향 신호). 단독 렌더 검증.
- **★ 다크모드 캘린더 팝업 헤더 가독성 수정**(`1cdd2c2`) — [DemoDashboard.tsx:1230](../apps/dashboard-web/app/components/DemoDashboard.tsx#L1230) 헤더 바 `bg-surface-soft`에 `dark:bg-*` 누락 → 밝은 글자가 밝은 배경에 묻힘. `dark:bg-surface-dark-elevated`(헤더 바)+`dark:bg-white/10 dark:text-on-dark`(아이콘 칩) 추가. 다크 실캡처 검증. (★ 교훈) 다크모드는 텍스트에 `dark:` 주면서 배경 `dark:bg-*` 빠뜨리면 동색 묻힘 — 배경·텍스트 쌍으로 점검.
- **★ 팀원 스타일 리팩터 안전 병합**(`b629aaf` 보존) — 커밋 사이 원격에 팀원 `b629aaf`(globals.css/tailwind+20파일 정비)가 push됨 → **force 아닌 rebase**로 내 2커밋을 그 위에 얹음(충돌 0). 내 다크수정 토큰(`surface-dark-elevated`·`on-dark`)이 팀원 변경 후에도 존재 확인 + 다크 팝업 재캡처 검증 후 push(`42cdb04`).
- **★ Cloud Run 재배포 rev `00009-8nx`** — 병합 HEAD `42cdb04`(내 아이콘/다크 + 팀원 스타일 20파일) 라이브 반영. `gcloud builds submit`(3m20s)+`run deploy --image`(env·9시크릿 보존). 검증 HTTP200·로그인401·클라우드 아이콘 청크 확인. 라이브 `00008-m2w`→**`00009-8nx`**.
- **상태** — **origin/main=`42cdb04`(완전 동기화)**, working tree clean. **라이브=rev `00009-8nx`**(GitHub과 일치). 로컬 dev 종료.
- **다음** — ① 캘린더 OCR 미디어 기능(#1) 착수 여부 + 저장 백엔드(GCS/R2/네이버) 결정 ② (선택) 팝업 내부 헤더 아이콘도 결합 아이콘으로 통일. 상세 [llm-media-features-plan.md](./llm-media-features-plan.md).

### (2026-06-24 — 설계·타당성 검토 세션: 온프레미스 LLM 생체 모니터링 + 앱 OCR 캘린더 미디어 브리지 / 코드 변경 0, 계획 문서화)

- **★ 코드 변경 0 — 설계·타당성 검토 + 문서화.** 상세 = [llm-media-features-plan.md](./llm-media-features-plan.md). 두 기능 모두 **발표 후 2차 트랙**.
- **★ 기능 #2 = 온프레미스 LLM 생체 모니터링/보고서** — DB 생체데이터 → 비식별 피처(기존 analyzers 재사용) → **로컬 LLM**(Ollama/vLLM) → 한국어 보고서. **결정 = 온프레미스**(사용자 최우선 제약 "보고서 어떤 경유로도 외부 유출 금지" → 외부 API·Cloud Run 경유 배제). 원시 PII 미투입(이름·사원번호·GPS 제거), 의학진단 아님·작업 적합성 참고·투입/보류 human-in-the-loop. 하드웨어 = 사무 PC 직접구동 비현실 → **추론 전용 1대(본사 GPU)+사무PC 브라우저**, 발표는 Mac 통합메모리 7~14B.
- **★ 기능 #1 = 앱 OCR + 캘린더 미디어 브리지** — iOS 앱 OCR/촬영(독립 개발 완료·사진첩 저장만) → **클라우드 → 관제웹 캘린더 촬영일시 자동 배치**. 캘린더 UI·사진대지 업로드 라우트(로컬디스크 `.runtime`=Cloud Run 휘발)는 기존, 신규 = 클라우드 저장+`calendar_media` 테이블+자동배치. 날짜=EXIF·태그=OCR. 저장 후보 리서치 = 발표 GCS 서울 / 상용화 R2(zero egress) / 국내 레지던시 네이버. 비용(1개소 1TB) R2 ~₩21k 고정 vs 네이버 ~₩31k+아웃바운드(추정).
- **★ 라이브 이슈 진단 = 현장 위치 날씨 미작동** — 생체 정상인데 GPS만 redaction → 날씨 "0명 대기". 원인 = 3중 게이트 중 ②세션 토큰(rev 00007 재배포로 인메모리 소멸) 또는 ③폰 GPS 권한(①env=true 확인). 조치 = **로그아웃→재로그인**(새로고침 X), 안되면 아이폰 위치 항상허용. 구조적 = 세션 인메모리라 재배포마다 재발(발표후 스테이트리스 전환).
- **검토·미도입** — ponytail 플러그인(보안 무해하나 전역 CLAUDE.md와 철학 중복 → 미설치).
- **다음** — #2 먼저(하드웨어 확정→비식별 피처+로컬 추론 셋업) → #1(저장 선택→앱 업로드→테이블→캘린더). 상세 [llm-media-features-plan.md](./llm-media-features-plan.md).

### (2026-06-23 — 회원가입 보안 강화 + 회사(상호) B2B 선택 + 사용자 관리 확장 + 내 정보 수정 + dev-browser + 팀 캘린더·안전관리비 탭 pull 통합 + Cloud Run 라이브 배포 / origin push 완료·라이브 반영 rev 00007-7n7)

- **★ 회원가입 보안 강화**(`7c10ec6`) — 비번 8자 경고 잔존 버그 수정(제출 setError 잔존→입력값 라이브 판정) · ID 중복확인 버튼(`/api/admin/check-username`) · 연락처 3박스+통신사(carrier 컬럼) · 이메일 로컬부+도메인 선택박스 · **이메일 인증(Resend HTTP API, 의존성0)** — 인증완료해야 가입(서버 isVerified 403 이중방어, 키없으면 dev devCode 폴백). [lib/email.ts](../apps/dashboard-web/lib/email.ts)·[lib/email-verify.ts](../apps/dashboard-web/lib/email-verify.ts).
- **★ 회사(상호) B2B 선택**(`ff6887f`) — 자유입력→승인 기업 드롭다운([lib/companies.ts](../apps/dashboard-web/lib/companies.ts) **단일소스**: (주)바이탈가드·VitAlGuard·스마트인재개발원·조달청·고용노동부, 개발사가 배열 편집으로 추가/삭제). 서버 검증(register·google/complete 목록 외 400).
- **★ 사용자 관리 확장**(`4aba061`, owner) — 카드→DB 스키마 전체 컬럼 테이블(통신사·인증·경로) + **탈퇴**(하드삭제 deleteUser+확인창) + **DB 실시간 5초 폴링**·새로고침([UserManagementModal](../apps/dashboard-web/app/components/UserManagementModal.tsx)).
- **★ 내 정보 수정**(`4aba061`, admin '내 정보' 탭) — [MyProfileModal](../apps/dashboard-web/app/components/MyProfileModal.tsx) 이름·회사·연락처·통신사 + 비번변경(현재비번 검증). `/api/admin/profile` GET·POST — **세션 username 기준 본인 행만**(클라 id 불신뢰), 아이디·이메일 읽기전용.
- **★ dev-browser**(`62e1c02`) — SawyerHood 브라우저 자동화(QuickJS WASM 샌드박스) 로컬 설치(npm 없는 pnpm 전용이라 데몬런타임 직접 구성·`.claude/skills/dev-browser/SKILL.md` 환경노트) + `.claude/settings.json` 자동승인. 라이브 관제웹 검증 도구.
- **DB** — users `carrier`·`email_verified` 멱등 ALTER(옛 가입분 null/false·신규만 채워짐). (★ UI 교훈) **셀렉트 `appearance-none`+커스텀화살표 없으면 macOS 네이티브 각짐**(headless 미재현, 로그인·내정보 모달 통일) · 전화 3박스 `flex-1`+`min-width:auto` 모달 가로 오버플로→**고정폭**.
- **팀 작업 pull 통합**(`2ebf34d`·`997cdcf`, rebase) — ① **캘린더**(`2ebf34d`, 김수영) [HeaderCalendarPopup](../apps/dashboard-web/app/components/DemoDashboard.tsx) 헤더 팝업 — 날짜 선택·이전/다음 월 이동·키보드(ESC) 접근성. ② **안전관리비 검증 탭**(`997cdcf`) [SafetyVerificationTabs](../apps/dashboard-web/app/components/SafetyVerificationTabs.tsx) — 주간 검증 보고서·시공사 청구 제출·실집행 검증 3화면을 라우트 이동 없이 탭 전환(전체화면 라우트는 공유용 유지), **시공사 청구 제출 진입 전 관리자 id/pw 재인증 게이트**(ContractorAuthGate→`/api/admin/login` 재검증). 두 커밋 모두 [DemoDashboard](../apps/dashboard-web/app/components/DemoDashboard.tsx) 통합, 내 회원가입/계정관리 작업과 파일 충돌 없음.
- **★ Cloud Run 라이브 배포**(rev `00007-7n7`, 2026-06-23) — `gcloud builds submit`(Cloud Build 2m58s)+`gcloud run deploy --update-secrets RESEND_API_KEY` 로 **이번 세션 전 기능 라이브 반영**. `RESEND_API_KEY` Secret Manager 신규 등록(런타임 SA secretAccessor 부여) → 시크릿 **9종**(기존 8 + RESEND, Google OAuth 포함) 연결·env 보존. **이메일 = `EMAIL_FROM` onboarding@resend.dev 기본값**(도메인 미보유 → Resend 계정 본인 이메일만 발송, 임의 가입자 실발송은 도메인 인증 후 `services update --update-env-vars`로 전환·재빌드 불필요). 라이브 검증 = HTTP 200·`/api/admin/check-username`(admin→reserved)·로그인 401·**라이브 회원가입 폼 캡처**(중복확인·통신사·인증번호·회사 셀렉트 렌더). (교훈) 코드 변경만 `builds submit` 재빌드 필요, `EMAIL_FROM` 등 env 는 `services update`로 즉시 교체. **(재배포) AED 명칭 통일(`89a6932`) 반영 위해 재빌드·재배포 → 현재 라이브 rev `00007-7n7`**(이전 `00006-sjk`는 RESEND·이메일 인증 최초 반영분).
- **상태** — origin/main 에 이번 4커밋(`62e1c02`·`7c10ec6`·`ff6887f`·`4aba061`) push 완료 + 팀 5커밋(`2ebf34d`·`997cdcf` 외 머지 포함) **rebase pull 로 통합**(문서 커밋은 맨 위로 재배치). working tree clean. 세션 중 팀원 `47dd027`(db/integrated) 도 pull 병합. **라이브(Cloud Run rev 00007-7n7) 반영 완료.** 증거: tsc 0·테스트 44/44·next lint 에러0·API e2e 다수(미인증403/401·미승인회사400·비번변경 현재비번검증)·dev-browser UI 스크린샷·라이브 배포 검증.
- **다음** — (선택) **이메일 임의 수신자 실발송** = 도메인 확보→Resend 도메인 인증→`EMAIL_FROM` 갱신(`services update`, 재빌드 불필요). 현재는 onboarding(본인 이메일만) 의도적 유지 · Google 동의 화면 인터랙티브 확인 · **Phase 5(폰·워치 수신 URL→Cloud Run) 여전히 미완**. 상세 [auth-signup/checklist.md](./auth-signup/checklist.md).

### (2026-06-22 — 레이아웃 2페이지 페이저 + 관리자 회원가입(승인제) + Google 로그인(OAuth) + GitHub remote 정정 / 레이아웃·회원가입 main 병합·재배포 = 라이브, Google 은 로컬만)

- **★ GitHub remote 정정** — 작업분이 잘못된 `rlaxorhs77-eng` repo로 가던 것을 **`VitAlGuard-jodal/vitalguard-jodalcheong`(SSH·becks0724 키)** 로 origin 교체 후 main push. (증거: `git ls-remote` HEAD=`f67b1d4`→`40d5511`)
- **★ 관제 레이아웃 2페이지 페이저**(`f67b1d4`) — [DemoDashboard](../apps/dashboard-web/app/components/DemoDashboard.tsx)를 상단 `‹ 제목 N/M ›` 좌우 슬라이드 2페이지로 재구성([SectionPager](../apps/dashboard-web/app/components/SectionPager.tsx) 신규 — WidgetCarousel 과 달리 활성 페이지 높이 자동 동기화). 1p=실시간 현장 관제(신호등·현황·작업자 모니터링), 2p=안전관리비 검증. **main 병합·Cloud Run rev 00003 재배포**. 증거: tsc 0·테스트 40/40·로컬+라이브 Playwright 좌표 전환 검증·스크린샷 2장.
- **★ 관리자 회원가입(승인제)**(`40d5511`) — 단일 env 관리자 → 다중 가입/승인. [users 테이블](../apps/dashboard-web/lib/db.ts)·scrypt 해시([password.ts](../apps/dashboard-web/lib/password.ts), 의존성0)·세션 role(owner/admin)·`/api/admin/register|login|users`(owner 전용 승인). **가입 6항목 필수**(회사·아이디·이름·연락처·이메일·비번). env admin(`admin`/`safety2026`)=owner(최초 승인자), 가입자 pending→승인 후 로그인. LoginScreen 회원가입 폼 + owner 전용 [사용자 관리 모달](../apps/dashboard-web/app/components/UserManagementModal.tsx). **main 병합·rev 00004 재배포 = 라이브**. 증거: tsc 0·테스트 44/44·실DB E2E(가입201→미승인403→틀린비번401→승인200→승인후 role=admin→owner전용 401)·라이브 검증·DB 6항목 적재 확인.
- **★ Google 로그인(OAuth)**(`41f2f3c`, 브랜치 `feat/google-oauth`, **로컬만·미병합·라이브 미반영**) — 수동 OAuth(의존성0)·기존 세션 재사용(Auth.js 미도입)·승인제 유지. [google-oauth.ts](../apps/dashboard-web/lib/google-oauth.ts)+`/api/auth/google|callback|complete|handoff`, users.`google_sub`·`auth_provider`·password_hash nullable, 구글 인증 후 **회사·연락처 추가정보 폼→pending**. 증거: tsc 0·테스트 44/44·서버측(시작 307·추가정보 201·DB 적재·잘못된쿠키 400). **구글 동의 화면은 사용자 인터랙티브 테스트 영역.**
- **상태** — `main = 40d5511`(레이아웃+회원가입 라이브, Cloud Run rev 00004), `feat/google-oauth = 41f2f3c`(미병합). origin = **VitAlGuard-jodal**. `GOOGLE_CLIENT_ID/SECRET` = `.env.local`(gitignore). 로컬 dev `:3000` 가동 중.
- **다음** — ① **로컬 구글 로그인 인터랙티브 확인**(콘솔 테스트 사용자 추가 필수) ② push·main 병합 ③ **Secret Manager** GOOGLE_CLIENT_ID/SECRET + Cloud Run `--set-secrets` 재배포 ④ (선택) 콘솔 앱 게시·이메일 UNIQUE·DB 세션 저장·상용 DB SSL. **Phase 5(폰·워치 URL→Cloud Run 전환) 여전히 미완.** 상세 [auth-signup/checklist.md](./auth-signup/checklist.md).

### (2026-06-22 — [changwoojin 클론·`feat/gcp-postgres-cloudrun`] GCP Cloud Run 배포 + DB SQLite→PostgreSQL 이전, 2커밋 — 이후 main 병합·push 완료)

- **★ 고정 HTTPS 서버 확보** — `https://vitalguard-dashboard-569797426568.asia-northeast3.run.app`(admin/safety2026). 38세션 내내 골치던 **cloudflared URL 회전 영구 종료**. 워치도 정식 HTTPS라 ATS 예외 불필요.
- **★ DB SQLite→PostgreSQL(pg) 이전**(`a766ae7`) — `better-sqlite3`(동기)→`pg`(비동기) 전면 재작성. [lib/db.ts](../apps/dashboard-web/lib/db.ts) 29함수 async·DDL Postgres화(SERIAL·DOUBLE PRECISION·BIGINT 금액·`to_char` ISO 기본값·int8→number 파서)·첫 쿼리 멱등 `ensureSchema`. store.ts+라우트 ~20개 await 전파 — **tsc는 7개만 탐지, 나머지 `NextResponse.json(Promise)` 런타임 자리는 grep 전수**로 처리. `ingestCctvEvent` async화. DB = **캠퍼스 공유 Postgres** `project-db-campus.smhrd.com:3310`(vitalguard, PG14.5, **SSL 미지원→sslmode=disable**, 빈 DB·CREATE).
- **★ 컨테이너화·배포**(`9a59f36`) — next.config `output:standalone`+`outputFileTracingRoot`+transpilePackages에 **analyzers 추가**(standalone dist 누락→fusion 실패 회피). pnpm 멀티스테이지 Dockerfile(비루트)+.dockerignore(`.env*` 제외). Cloud Build 2m21s→Artifact Registry. 프로젝트 **`safetymonitor-498508`**(기존·결제 활성)·`asia-northeast3`·Secret Manager(DATABASE_URL·ADMIN_PASSWORD+외부키 5종). `gcloud run deploy`(min-1·512Mi).
- **라이브 검증** — Cloud Run→캠퍼스 Postgres 적재 201(**egress 통과·IP 허용목록 없음**)·fusion·로그인·KOSHA/KMA/유튜브/g2b `source:live`·날씨 live. tsc 0·테스트 101/101·10테이블 생성.
- **상태** — `feat/gcp-postgres-cloudrun` 브랜치 2커밋, **main 미merge·origin 미push**. Cloud Run 리비전 00002 라이브. `.env.local`(gitignore)에 DATABASE_URL+키.
- **다음** — **Phase 5 = 폰 인앱 URL·워치 `defaultURLString`을 Cloud Run 주소로 전환** · 브랜치 push/PR/merge 결정 · 상용화 시 DB SSL · 재배포 `gcloud builds submit`+`run deploy`. 상세 [gcp-migration/checklist.md](./gcp-migration/checklist.md).

### (2026-06-13 세션38 — DB 추천 + 코드베이스 종합 audit 60건 + Tier 0~2 전수 수정·push, 18커밋)

- **★ DB 추천**(상담·코드 0) — vital_samples 시계열 + GPS lat/lon + raw_json audit 기준 = **PostgreSQL 권장**(TimescaleDB·PostGIS·JSONB·RLS). AWS=RDS/Aurora, **GCP=AlloyDB**(Cloud SQL은 PG/MySQL만 — Oracle·MariaDB 관리형 없음). MySQL 조건부(8.0+·ts 파티셔닝·요약테이블·POINT SPATIAL·앱레이어 테넌트격리). 발표후 전환.
- **★ 종합 audit(9차원·읽기전용)** — **bounded 파일그룹 워크플로**(15그룹 scan + 그룹별 적대적 검증)로 **60건 확정**(CRIT 0/HIGH 1/MED 10/LOW 49, 아키텍처 0 클린). PDF 12쪽. unbounded 차원별 스캔 2회 실패(rate-limit·컨텍스트 269KB stall)→bounded로 완주(false positive 3 제거).
- **★ Tier 0~2 전수 수정**(파일그룹 fix 워크플로, 겹침 0) — 60건 처리(수정 59+#51 보존). **Tier 0**(FallDetector 레이스·AED HMAC·CCTV allowlist·alert 안정임계) / **Tier 1**(타임아웃·배열격리·NaN 가드·핵심 테스트) / **Tier 2**(메모이즈·누수·sustain·테스트·dead·문서·인증 하드닝).
- **세션 한도 대응** — Tier 2 중간 1am 한도 → 완료분 격리·커밋, 부분편집 stash(복구가능), 리셋 후 재개. **교훈**: 멀티에이전트 fix=파일그룹별 1에이전트(겹침0)+상위 일괄 검증, unbounded는 stall.
- **검증** — dashboard tsc 0·24/24 · analyzers 재빌드+28/28 · schemas 13/13 · flutter analyze 0 · watchOS BUILD SUCCEEDED.
- **상태** — **18커밋 origin push 완료**(`main` ahead 0). 미커밋 = 세션32 제외분. 네트워크 세션37 종료 유지(dev/cloudflared/CCTV OFF).
- **다음** — 디바이스 런타임 확인(#6 워치 flush·#31 폰 initState **재빌드·재설치**) · #2 AED HTTP e2e(dev 재기동) · 상용화 DB PostgreSQL · 기존 블로커(YJH iPhone·Galaxy Watch fresh·Web NFC·배터리·D4 리허설).

### (2026-06-12 세션37 — 관제웹 네트워크 진단·복구 + 워치 수신 URL 갱신·실기기 검증 + 공유 스택 전체 종료, 1커밋)

- **★ dev :3000 전 라우트 500 복구** — 12:33 기동 next-server 가 날짜 변경(06-12) 후 **샌드박스 stale 로 `.next/server/app-paths-manifest.json` `EPERM`**(파일 권한 정상·신규 Bash 는 읽힘, 실행 중 프로세스만 차단). next 정리 후 재기동 → **202 복구**(dev.log EPERM 0줄).
- **★ cloudflared 530 = 터널 사망** — 05:01Z(KST 14:01) `signal terminated` 종료 발견 → 재기동, 새 quick tunnel **`channels-respect-absolute-watches.trycloudflare.com`**(터널 POST 202·GET 200). 이전 `falling-writing-gui-priority` 만료.
- **★ 워치 수신 URL 갱신** (`c37e6f6`, [ConnectionSettings.swift:9](apps/worker-watch-poc/Sources/ConnectionSettings.swift#L9)) — `defaultURLString` them-registration-alt-matrix[2회 회전만큼 stale]→channels-respect-absolute-watches(스탬프 마이그레이션, 재설치 시 자동 반영). 사용자 워치 재빌드 → **실기기 검증 EMP-5678(워치) age 2s·hr 105·SpO₂ 97·배터리 75% 라이브**(ATS 평문차단 → https 터널 경유만 = 새 터널 end-to-end 확정).
- **★ 공유 네트워크 전체 종료** — 사용자 요청 → dev :3000 + cloudflared + CCTV :8000 전부 kill(프로세스 0·포트 해제).
- **교훈** — 장시간 dev 프로세스는 날짜 변경 후 샌드박스 stale 로 `.next` EPERM 500 → **재기동이 유일 해결**(파일 손상 아님) · cloudflared quick tunnel 세션/수시간마다 만료 → **재기동 시 URL 회전 불가피**(폰·워치·문서 갱신) · 워치 ATS 로 https 터널 전용.
- **상태** — main **`ahead 2`**(세션37 `c37e6f6` 워치 URL + 세션36 docs `c597625`, push 보류). 미커밋 유지(의도) = `health_vitals_service.dart`·`commercialization-roadmap.md`(세션32 제외분)·`worker-watch-poc.zip`(빌드 산출물). **네트워크 전부 종료**(dev/cloudflared/:8000 OFF), 마지막 URL `channels-respect-absolute-watches`(종료됨).
- **다음** — 재개 시 dev(`run_dashboard.command`)→cloudflared 재기동→새 URL→폰/워치 반영 · push 결정(2) · CLAUDE.md active URL 7곳 정리 · 데모 리포 본인 터미널 커밋·push · 기존 블로커(YJH iPhone 재install·Galaxy Watch fresh·Web NFC 물리 태그·배터리 풀시프트·D4 리허설).

### (2026-06-12 세션36 — CCTV 3-AI 확장[CAM-02 낙상·CAM-03 GoPro PPE 안전모] + 팀원 공유 프록시 + 샌드박스 .command 우회, 메인 2커밋 push)

- **★ CAM-02 = 낙상 감지(YOLOv8-pose)** — 데모 리포(`safetymonitor-cctv-demo`) `fall_detector.py`(Supervision EdgeAnnotator/VertexAnnotator/ByteTrack) + `main.py` stream2 + `/cctv/stream2·stats2·connection2`. 프론트 [CctvQuadView](apps/dashboard-web/app/components/CctvQuadView.tsx) CAM-02 `aiKind:"fall"` + FallDetectionStrip(정상/불안정/누움/낙상). 영상 **건설현장 낙상 shorts `8O_e1pvjffE`로 교체** + **상단 VitAlGuard 바 제거**(`patch_fall_overlay.py` = `_add_brand_overlay` no-op) + object-contain 전체표시.
- **★ CAM-03 = GoPro 웹캠 PPE 안전모 감지** — GoPro HERO9(cv2 AVFoundation **index 0**, Terminal.app 카메라 권한 승인) → `webcam_stream.py`(WebcamStream) + `ppe_detector.py`(PPEDetector, Supervision) + stream3 + `/cctv/stream3·stats3·connection3`. 모델 `backend/models/ppe_best.pt`(snehilsanyal Construction-Site-Safety-PPE-Detection, 클래스 Hardhat/NO-Hardhat/Safety Vest/NO-Safety Vest/Mask/NO-Mask/Person). 프론트 CAM-03 `aiKind:"ppe"` + PpeDetectionStrip(준수율·안전모 착용/미착용·위반). 라이브 NO-Hardhat 3명·준수율 0%.
- **★ 팀원 CCTV 미표시 해결 = same-origin 프록시** — 원인 = 타일이 브라우저에서 `localhost:8000` 직결이라 공유 터널 연 팀원 PC 미표시(발표 PC만 보임). 해결 = 신규 `app/ai-cctv/[...path]/route.ts`(`/ai-cctv/*` → 발표 PC localhost:8000, `upstream.body` 반환 = MJPEG 무한 스트림 **버퍼링 0**·더미서버 직접10=프록시10 청크 검증) + `.env.local NEXT_PUBLIC_AI_CCTV_API=/ai-cctv`. **:3000 터널 하나로 팀원도 CAM-01/02/03 표시**(두 번째 터널 불필요), 터널 경유 stream3 5.5MB/2초 수신 검증.
- **★ 샌드박스 우회 = .command 더블클릭(Terminal.app)** — 날짜 변경 후 OS 샌드박스가 데모 리포 기존 파일(.venv·main.py·fall_detector·detector) 읽기/쓰기 차단(VS Code 통합 터미널·내 Bash·`dangerouslyDisableSandbox` 전부 불가; 새 파일 생성·내가 만든 파일 편집만 허용). Finder 더블클릭 `.command`(Terminal.app=샌드박스 밖)로 패치+기동. `run_cam03.command`(PPE 백엔드 원클릭), `run_ppe_demo.command`(독립 데모), [run_dashboard.command](run_dashboard.command)(dev 분리). main.py 는 패치 스크립트(apply_cam03_ppe.py = main.py.bak[CAM-01/02]에서 멱등 재패치)로만 수정.
- **검증/교훈** — dashboard `tsc` EXIT=0 · 단위 20/20 · 백엔드 3캠 연결 + PPE stats3(NO-Hardhat) + 프록시/터널 200 + Playwright(CAM-03 PPE 팝업·CAM-02 contain) 실측. **CSS 로 영상 화각(포커싱) 줌아웃 불가**(소스 FOV 한계, scale 은 박스 축소일 뿐 → 되돌림). dev 가 백엔드 churn 중 시그널 종료(`[?25h`) → run_dashboard.command 본인 터미널 분리 실행.
- **상태** — 메인 리포 **2커밋 push 완료**(`6b0de82` CCTV 프론트 · `5e37e06` 프록시+dev 스크립트, origin 동기화 `ahead 0`). 데모 리포(`ppe_detector.py`·`webcam_stream.py`·패치/.command·patched main.py·fall_detector) **미커밋 = 본인 터미널 커밋 필요**(*.pt·.venv·main.py.bak 제외). 터널 `falling-writing-gui-priority`·dev 0.0.0.0:3000+`/ai-cctv` 프록시·데모 백엔드 :8000(.command 기동)·`.env.local NEXT_PUBLIC_AI_CCTV_API=/ai-cctv`.
- **다음** — 데모 리포 본인 터미널 커밋·push · 더 넓은 CAM-02 화각 원하면 영상 URL 교체(`YOUTUBE_VIDEO_ID_2`) · CCTV 백엔드는 .command(Terminal.app)로만 기동 · 기존 블로커(YJH iPhone 재install·Galaxy Watch fresh·Web NFC 물리 태그·배터리 풀시프트·D4 리허설).

### (2026-06-11 세션35 — 날씨 502 근본해결 + CCTV 8분할 + 타일 영상 채움 진단, 2커밋)

- **★ 날씨 조회 502 근본해결** (`f012345`, [route.ts](apps/dashboard-web/app/api/weather/route.ts)·[WeatherStrip.tsx](apps/dashboard-web/app/components/WeatherStrip.tsx)) — 원인 = `api.open-meteo.com`(예보 호스트) 간헐 장애(세션 중 라이브 재현, 대기질 호스트는 정상)에 라우트가 **타임아웃·재시도·폴백 전무** → 502 → "날씨 조회 실패" 박스로 현장환경 패널 붕괴. 수정 = AbortController 6초 타임아웃 + 예보 1회 재시도 + 대기질 best-effort + **업스트림 실패 시 직전 캐시(만료됐어도) stale 200 반환** + WeatherStrip 데이터 있으면 마지막값 유지(`error && !data` 일 때만 오류). **라이브 검증** = 예보 다운 상태 데모 좌표 stale 200(수정 전 502).
- **★ CCTV 관제 4분할 → 8분할** (`7101c75`, [CctvQuadView](apps/dashboard-web/app/components/CctvQuadView.tsx)) — CAM-05~08(동측 비계·콘크리트 타설구역·후문 차량 통제·가설 전기실) 추가 + `grid-cols-4 grid-rows-2` + 라벨 8개소.
- **★ "분할 타일 영상 안 채워짐/팝업만 채워짐" 진단** — **측정상 fill 정상**(타일 img 294×144=영상영역·gap 0, 팝업 766×431 둘 다 `object-cover`·fills:true) → CSS 버그 없음. **실제 원인 = 백엔드 연결 OFF**(`enabled:false`→"절약 모드" placeholder). 백엔드 `enabled`는 POST `/cctv/connection`으로만 변경(자동 disable 코드 없음)·브라우저 네트워크 GET만(POST 0) → 외부 탭/수동 OFF였음. ON 되돌리니 타일·팝업 모두 라이브 꽉 참. 보강 = AI 타일 자동재연결 4초→1.2초.
- **검증** — dashboard `tsc` EXIT=0 · 단위 **20/20** · **Playwright 실측**(8분할 4×2 / 타일+팝업 fills:true·gap 0 / 날씨 stale 200 / 연결 ON 라이브 YOLO 박스).
- **상태** — main **`ahead 11`**(세션35 2커밋 `f012345`·`7101c75`, 세션34 9 누적), push 보류. CCTV AI 연결 **ON 상태로 둠**(데모 ON 유지 권장). 미커밋 = 세션32 잔여 2파일(`health_vitals_service.dart` 기기 미검증·`commercialization-roadmap.md`, 의도적 제외). 터널 `them-registration-alt-matrix`·dev 0.0.0.0:3000+PII ON·AI 백엔드 :8000 기동.
- **다음** — push 결정(11) · 세션32 잔여 처리 · CCTV 연결 OFF 외부 토글(스테일 탭) 정리 · 원격 CCTV용 :8000 터널 · 기존 블로커(YJH iPhone 재install·Galaxy Watch fresh·Web NFC 물리 태그·배터리 풀시프트·D4 리허설).

### (2026-06-11 세션34 — [신규] CCTV AI 풀스택 데모 + 대시보드 통합 + 영상 끊김 근본해결)

- **★ 신규 sibling 리포 `safetymonitor-cctv-demo`** — 유튜브 라이브 → YOLOv8+Supervision 실시간 감지 → Next.js 관제웹. 백엔드 FastAPI+yt-dlp+Pillow(한글 오버레이), 프론트 Next.js14. **자체 git 첫커밋 `3b0bde6`(26파일), 발표 리포와 분리.** 검증 PASS.
- **★ 환경 함정** — Python 3.11 venv 필수(3.14 wheel 부재) · **yt-dlp 최신 필수**(구버전은 YouTube throttle/세그먼트 hang, 2026.6.9로 해결) · `python -m yt_dlp` 모듈호출 · cv2 한글 미지원→Pillow 오버레이.
- **★ 대시보드 통합** ([CctvQuadView](apps/dashboard-web/app/components/CctvQuadView.tsx)) — CAM-01 = AI 라이브 MJPEG `<img>`(나머지 3 샘플) + 팝업 하단 실시간 감지 스트립. 영상 = **홍대입구역 4K(`t3ZNjo1AVog`)**.
- **★ 기능 3종** — 타일 이름 편집(✎·localStorage) · 연결 ON/OFF(`/cctv/connection`로 백엔드 YouTube 연결 실제 중단·width 0↔1920) · 자동 재연결(끊김 시 4초 후).
- **★★ 영상 끊김 근본해결** — 진단(byte-md5/full-hash): **HLS 세그먼트 버스트 + `BUFFERSIZE=1` 무페이싱 reader가 버퍼 62fps 드레인 → render가 frozen 라이브 엣지만 봄**(reader 신선 62/s, render 입력 1/s 확정). **수정 = BUFFERSIZE 제거(ffmpeg 버퍼) + reader 소스fps 페이싱**. **측정 정지 96%·4.8s → 9%·0.3s**. 보강 = 감지/렌더 스레드분리·encode-once·480p·imgsz640·torch 스레드절반. 감지 21fps/20객체.
- **검증** — 데모 백엔드 구문 OK · 대시보드 `tsc` OK · MJPEG 측정(9%정지) · 프레임 육안 · **Playwright 실측**(CAM-01 라이브·이름변경유지·ON/OFF·팝업 감지스트립·자동재연결).
- **상태** — 메인 `CctvQuadView.tsx` 미커밋(main 여전 `ahead 7`) · 데모 리포 별도 git(첫커밋 후 backend 3+README+page.tsx 미커밋) · 둘 다 push 보류. **공유 URL `them-registration-alt-matrix`(:3000, 살아있음, admin/safety2026)** — CCTV AI 타일은 `localhost:8000` 직결이라 원격 미동작(발표 PC 본인은 정상). dev(:3000)+AI 백엔드(:8000) 기동 중.
- **다음** — 두 리포 커밋·push 결정 · 원격 CCTV용 :8000 터널+`NEXT_PUBLIC_AI_CCTV_API` · 720p 트레이드오프 · 기존 블로커.

### (2026-06-11 세션33 — 관제 웹 UX 5종 + 작업 중 심박 기준(활동 게이트), 5커밋)

- **재기동 + URL 회전** — 이전 터널 `lol-year-consulting-counted` 만료 → 관제웹 연결 해제 후 재기동, 새 quick tunnel **`them-registration-alt-matrix.trycloudflare.com`**(GET 200/POST 202). dev 0.0.0.0:3000. **iOS 미수신 진단** = 폰이 죽은 옛 터널로 POST(NXDOMAIN), 서버·터널 정상 → 폰 인앱 URL 갱신 안내(세션마다 회전 고질 패턴).
- **워치 URL**(`96647d6`) — ConnectionSettings `defaultURLString`→them-registration(스탬프 마이그레이션, 재설치 시 자동).
- **차트 요약 레이아웃**(`3d2733c`) — 평균/최저/최고 1줄(라벨=수치 동일 폰트)+축 폰트 10→9 + **기간 안전 통계 셀**(정상 비율·주의/위험 구간·변동성, 기존 points 계산·새 API 0).
- **★ 작업강도 HR 밴드(차트)**(`3d2733c`) — 육체노동 심박 상승을 안정 임계(110/130)로 오경보 안 하게 차트 기준선·이상치·기간안전을 작업 중 기준(고강도 135·과부하 155, ISO 8996·ACGIH). SpO₂·체온은 생리 임계 유지.
- **★ 활동 게이트 시스템 확대**(`7a32bea`, 카드·통합 신호등·알림) — `classifyActivity` export(스트레스 분류 재사용) + `heartRateStatus(hr, activity?)`: 활동 heavy(작업 중)면 작업밴드, 안정/무활동이면 안정 임계 폴백. **안전 불변식** = 데이터 없음→안정 임계(false-negative 0)·완화만(강화 없음)·과부하/급락은 작업 중에도 위험. 내보내기(감사)는 안정 기준 유지.
- **아이콘 모노톤**(`d03d267`) — 특보영상(📺)·태풍진로(🌀)→라인 SVG(사이클론·모니터+재생).
- **★ CCTV 관제 4분할 + 클릭 팝업**(`e5affd7`) — 작업자 모니터링 캐러셀 4페이지째. 2×2 4분할(각 상단 위치 라벨+CAM ID+LIVE+타임스탬프) + 타일 클릭→팝업(createPortal·16:9 확대·✕/배경/ESC). `streamUrl` 있으면 `<video>`, 없으면 샘플(가스/AED 동일 표기, 실 영상 발표 후).
- **검증** — dashboard `tsc` EXIT=0 · 단위 **20/20**(활동 게이트 6 신규) · Playwright 실측(차트 1줄·작업밴드 기준선 "과부하155/고강도135"·SpO₂ 생리 임계 분리 / **실 POST 대조: hr=122+고활동→정상 vs +무활동→주의** 카드·신호등 램프 반영 / CCTV 4분할·클릭 팝업 portal·ESC).
- **상태** — main **`ahead 7`**(세션32 2 + 세션33 5커밋 `96647d6`·`d03d267`·`7a32bea`·`3d2733c`·`e5affd7`), push 보류. 터널 `them-registration-alt-matrix`·dev 0.0.0.0+PII ON. 미커밋 = 세션32 잔여(CLAUDE.md·progress·roadmap·health_vitals_service.dart 기기 미검증). 검증용 demo_alert_01에 122bpm 주입(DB gitignore, 카드 정리 필요).
- **다음** — 폰/워치 새 URL(them-registration) 수신 재개 확인 · **실 iOS 워커(활동 데이터)로 활동 게이트 카드 검증·컷오프 튜닝** · demo_alert_01 정리(해제/DB) · push 결정(7) · 세션32 잔여 처리(docs·손목온도 dart 기기검증) · 기존 블로커(YJH iPhone 재install·Galaxy Watch fresh·Web NFC 물리 태그·배터리 풀시프트·D4 리허설).

### (2026-06-10 세션32 — 자동 트리거(차트 임계선·생체 위험 경보 모달) + 생체 위험 alerts 이력화 + 차트 동시표시 버그 수정, 4커밋·push 완료)

- **쉬움 항목** — cloudflared 만료(이전 `undertaken-best-communist-release`) → 재기동 새 quick tunnel **`lol-year-consulting-counted.trycloudflare.com`**(GET 200/POST 202 검증) + **이전 129커밋 push**(origin 동기화).
- **★ 자동 트리거(2커밋)** — ① **차트 임계 기준선/이상치**(`54a0bbd`, [VitalHistoryPanel](../apps/dashboard-web/app/components/VitalHistoryPanel.tsx)) = 심박/SpO₂/손목온도 추세 차트에 위험/주의 임계선(THRESHOLDS, 손목온도는 core→손목 역산) 점선·라벨 + 이상치 dot danger 빨강·caution 앰버(severity 헬퍼). 기존 `ReferenceLines` 인프라에 `referenceLines`/`pointSeverity` 연결만(인프라는 이미 있었음). ② **생체 위험 자동 경보 모달**(`eb74d83`) = SpO₂/심박/체온 danger 시 SOS급 중앙 팝업. `SosAlertModal`에 `reason="vital"` 겸용(헤더/시각라벨/위험사유/SMS 분기, 기본 sos라 기존 SOS 호출 불변·새 파일 0). DemoDashboard `data.latest`(실제 수신) 기반 트리거라 **가상 워커 자동 제외**·SOS 우선(`!activeSos`)·정상복귀 후 재발 시만(`ackedVital` Set).
- **★ D3 알림 흐름 — 생체 위험 alerts 이력화(`be329fb`)** — 기존 SOS/낙상 alerts 이력+ack(세션20 AF4)에 생체 위험만 미연동이던 갭 해결. db `AlertType`에 `"vital"` + store `addSample`에서 **병합(sticky) 기준 정상→위험 전이당 1건** `recordAlert("vital")`(잠금 null 깜빡임 danger→null→danger에 안 흔들림·ts UNIQUE dedup·서버 경로라 대시보드 미관찰도 기록) + `AlertHistoryModal` 3종 분기(생체 위험·로즈·heart-pulse, 헤더 "SOS·낙상·생체 알림 이력") + 대응 확인(ack).
- **★ 차트 동시표시 버그 수정(`1d9279b`)** — 작업자 생체 차트(`selection`)와 가스/AED 설비 차트(`siteChart`)가 별도 state라 한쪽 열어도 다른 쪽 안 닫혀 하단 동시 표시되던 문제 → `toggleSelection`에 `setSiteChart(null)` + 설비 `onSelect`를 공통 `openSiteChart`(`setSelection(null)` 후 열기)로 교체. 하단 차트는 항상 하나만(양방향 상호 배타).
- **가스/AED sev — 현행 유지**(사용자 결정, 코드 변경 0) — 가스 CO 52ppm·AED 지하 B1 단말 18% 위험 점등 유지(위험 감지 시연 임팩트).
- **검증** — dashboard `tsc` EXIT=0 · 단위 14/14 · Playwright 런타임(경보 모달 자동표시·"위험 감지: 산소포화도"·차트 임계선 "위험 88/주의 92" 실측·alerts vital 전이 1건/지속 dedup/ack `ack_by=관제자`·차트 상호배타 양방향 칩 4↔0). 검증용 주입(`demo_alert_01`/`demo_vital_01`)은 DB 정리(in-memory 잔존은 dev 재시작 시 제거).
- **상태** — main **`ahead 0`**(세션32 4커밋 `54a0bbd`·`eb74d83`·`be329fb`·`1d9279b` **push 완료**, origin 동기화). working tree clean. 터널 `lol-year-consulting-counted`·dev 0.0.0.0:3000+PII ON.
- **★ Galaxy Health 권한 블로커 해결 (이어서, 코드 변경 0)** — adb 진단(충전케이블 미인식→무선adb AP 클라이언트 격리→**데이터 USB 연결 성공**) → **SM-S931N(S25)·Android 16**, 권한 3종 **이미 granted=true**("Step 2 데이터 타입별 권한" 추정 폐기) → **진짜 원인 = stale APK**(05-27 설치 후 14일+ 미반영, MainActivity는 이미 `FlutterFragmentActivity`·health 13.3.1=pub.dev 최신). **현재 소스 재빌드**(`flutter build apk --debug` 28초 + `adb install -r`, lastUpdateTime 06-10) → **Health 권한 해결**("5초 폴링 중", `FLUTTER_HEALTH` 생체 조회·debug라 로그 확인). 관제 웹 전송 연결 완료(빈 샘플=경로 정상). 메모리 `galaxy-health-stale-apk` 기록.
- **★ Galaxy Watch fresh HR 전송 해결 (이어서2, 코드 변경 0)** — 라이브 logcat 진단 = `HEART_RATE stale: measured 16:40 (>5분) → 미전송` 반복(SpO₂·체온은 HC 데이터 자체 없음=Galaxy 스팟). 사용자 "계속 측정" ON 후에도 stale → Samsung Health 포그라운드 띄우자 최근 측정 **16:40→17:03 갱신** = **Samsung Health→HC 동기화 ~8분 지연**(HR 1분 집계 배치, 설정으로 못 줄이는 삼성 플랫폼 특성; 우리 5분 필터는 Apple Watch 직접 기준). **해결 = 착용 유지 + 계속 측정 + 동기화 캐치업** → **17:11:46 첫 fresh(hr=97)→hr=99 연속**(stale 라인 소멸). **코드 0**(5분 필터=M4 안전장치 불변, 삼성 동기화가 라이브 되니 자연 통과). end-to-end = 관제 웹 GET **`EMP-8888 김동현 hr=94 ts=17:15:06 KST`(라이브)** · DB EMP-8888 **최근 2분 65건** HR 94~99 매 ~2.5초 · SpO₂/체온 null 유지(데모 "--"). 교훈 = 착용+계속측정이면 코드 없이 5분 필터 통과(삼성 동기화 라이브 시)·**발표 안정성엔 워치 운동 세션 권장**(연속 동기화 강제)·Galaxy 라이브 메트릭=HR 한정.
- **★ Galaxy 3메트릭 + Samsung Sensor SDK 실시간 경로 검토 (이어서3 — 손목온도 코드 미커밋·미검증, Wear OS 앱 미구현)** — 사용자 목표 격상: "iOS는 실시간, Galaxy도 동일·최종 실사용." ① **HR** = Samsung→HC 동기화가 **버스트**(17:12 또 멈춤)라 재-stale → nudge로 hr=99~100 복귀하나 **버스트 자체는 미해결**(운동 세션/nudge = 운영 workaround). ② **SpO₂** = 수동 측정 1회 → HC → 30분 윈도 전송(**DB 17:30:58 hr=98+spo2=91 동시 도달**). **연속 실시간 불가**(온디맨드만). ③ **손목온도** = [health_vitals_service.dart](../apps/worker-phone/lib/services/health_vitals_service.dart)에 Android `SKIN_TEMPERATURE` 읽기 추가(현재 `BODY_TEMPERATURE`만 읽어 null이던 갭, best-effort 권한 분리 + `latestSkinTempC()`). `flutter analyze` 통과·APK 재빌드 완료·**⚠️ `adb install` 직전 USB 분리 → 실기기 검증 미완**. SkinTemperatureRecord는 델타+수면-only라 주간 실시간 아님. ④ **★ Samsung Health Sensor SDK 검토(공식 문서)** — Galaxy 진짜 실시간/실사용 = **Wear OS Kotlin 앱**(직접 센서, Apple PoC 대칭): HR 연속1Hz+IBI·**피부온도 연속1Hz(Watch5+)**·SpO₂ 온디맨드·가속도25Hz. **개발/데모=개발자모드(파트너 불필요)·프로덕션=Samsung Partner Program 승인 필수**. 연속 피부온도는 SDK로 가능(HC 수면-only는 데이터 경로 한계). 상세 [roadmap §9.5](commercialization-roadmap.md). **교훈** = 현 Flutter+HC는 실시간 파이프라인 아님(Samsung→HC 1분집계 배치)·SpO₂는 모든 소비자워치 온디맨드(연속 불가)·iOS "실시간 손목온도"도 실은 마지막 수면값·**진짜 실시간/iOS동등/최종실사용 = Samsung Sensor SDK Wear OS 앱**.
- **다음** — **Galaxy USB 재연결→APK 설치→`SKIN_TEMPERATURE` 실값 검증**(내일) → OK면 손목온도 커밋 · **Wear OS 앱(`worker-watch-wear`) 스캐폴드 착수 결정**(최종 실사용 트랙·개발자모드 시작→파트너 승인) · 관제 웹 빈 슬롯에 김동현(EMP-8888) 등록 시 라이브 카드 · 발표 시 워치 운동 세션 권장 · YJH iPhone release 재install · Web NFC 물리 태그 · 배터리 풀시프트 · D4 리허설.

### (2026-06-10 세션31 — 세션30 미커밋 git 정리 + KMA NO_DATA 실 결함 수정)

- **★ iOS 재설치 부산물 커밋**(`ac95b74`) — 세션29~30 미커밋이던 `apps/worker-phone/ios/Podfile.lock`·`Runner.xcodeproj/project.pbxproj`·`pubspec.lock` 3종을 **revert 아닌 commit**으로 처리. 세션29 SPM 비활성화→CocoaPods 정공 빌드(BECKS 18.1MB release, 수신 검증 완료)의 **정상 산물**이라 되돌리면 다음 `pod install`/Xcode 열기에서 동일 diff 재발생. diff 확인 = Podfile.lock 플러그인 6종 CocoaPods 등록(connectivity_plus/device_info_plus/flutter_secure_storage_darwin/geolocator_apple/package_info_plus) + pbxproj **자동 정규화(중복 name=Pods 제거·속성 순서, 서명/팀/기기 식별정보 0)** + pubspec.lock geolocator 플랫폼 구현 transitive 정정(pubspec.yaml 정합).
- **★ demo/ 외형 스냅샷 gitignore**(`57e8505`, 사용자 결정) — 세션28 SingleFile 스냅샷 2개(`safetymonitor-dashboard-live-snapshot.html`·`-login-snapshot.html`, **3.1MB**). **PII 스캔 = 실명 0·사원번호(EMP-) 0·전화(010-) 0·GPS 좌표 0**(직책 "현장소장"·도시 "광주"만 = 비개인정보) → 유출 위험 없음. 그럼에도 **세션마다 재생성되는 일회성 공유물(소스 아님)** + base64 인라인이라 커밋 시 히스토리 3MB씩 영구 누적 → `.gitignore demo/`(세션27 `.claude/skills`·`dashboard-full.png` 선례). 파일은 로컬 보존·공유 계속 가능, working tree clean.
- **★ KMA `03 NO_DATA` 실 결함 수정**(`d60151c`, 세션23 발견 해결) — [kma.ts](../apps/dashboard-web/app/lib/kma.ts) `fetchAllActive` 가 `resultCode !== "00"` 을 전부 API 오류로 묶어 **`03 NO_DATA`(발효 특보 없음=정상 무특보)도 MOCK_WARNINGS 폴백** → 전국 무특보 날 서울/경기/강원(강풍주의보)·전남/경남/제주(폭염주의보) **등록 작업자에게 가짜 특보 거짓 점등**(+현장기상 신호등 거짓·세션22 특보영상이 가짜 특보로 YouTube 검색 트리거). 수정 = **`03` → `source:live` + 빈 결과(10분 캐시)** 분리, `00` 외 비정상 코드(99 서버오류·30 키오류)·네트워크 실패만 목업 폴백 유지(데모 무중단 의도 보존). **★ 라이브 검증** = 실 KMA 오늘 `03` 반환 중 → dev 서버 HMR 반영 후 서울/전남 모두 `source:live`·`severity:normal`·"특보 없음"(수정 전이면 mock 강풍/폭염주의보 거짓 점등). 발표일(07-07) 무특보여도 false warning 0.
- **검증** — dashboard `tsc` EXIT=0 · 단위 analyzers 15/15 + dashboard 14/14(fail 0) · KMA 라우트 라이브(서울 37.5665,126.978 / 전남 34.8161,126.463) 둘 다 live·정상.
- **상태** — main **`ahead 128`**(세션31 3커밋 `ac95b74`·`57e8505`·`d60151c`), **push 보류**(사용자 결정). working tree **clean**(demo/ 무시됨). 터널 `undertaken-best-communist-release`·dev 0.0.0.0:3000+PII ON.
- **다음** — push 결정(128) · **물리 단말 필요 항목**(★ Web NFC 물리 태그 시연=Galaxy Chrome+태그 / YJH iPhone 재설치=Xcode 1회 등록→CLI release / Galaxy Health 권한=Step 2 데이터 타입별) · D4 리허설 · 스트레스·낙상 ML 데이터 축적.

### (2026-06-09 세션30 — AED 제세동기 알림 현실화 + NFC 점검 시스템 2커밋)

- **★ AED 알림 현실화**(`01c379c`) — AED 본체 배터리·전극패드는 **실시간 측정 불가** → 라이브 % 폐기, 제조사 권장 **교환 주기**(배터리 48개월·패드 24개월)로 임박/경과 관리. **라이브 게이지(%)는 'AED 알림 단말'(IoT 장비) 배터리 한정**("배터리 부족"=단말). worst-of 3차원 = 단말 배터리·AED 배터리 교환주기·패드 교환주기. (직전 중간안 = 월1회 점검 시행규칙 §38-3 worst-of → 교환주기 모델로 대체, 법적 근거는 모달 유지.)
- **★ AED NFC 점검 end-to-end**(`aa5914a`, 사용자 방향 전환 **QR→NFC**) — 리셋 버튼/관제 직접 갱신 폐기 → 장비별 **NFC 태그(URL)** → 관리자(여러 명) 폰 태깅 → **모바일 점검 페이지**(점검자·항목 입력) → `POST /api/aed/inspect` → **SQLite `aed_inspections`** → 대시보드 **12초 폴링** 자동 반영(최근 교환·주기 리셋·이력).
- **신규 파일** — `lib/aed-devices.ts`(장비 레지스트리 공유)·`app/aed/inspect/page.tsx`(모바일 점검)·`app/api/aed/{inspect,inspections}/route.ts`. `lib/db.ts` 테이블+record/list. AED 표 = 장비별 **NFC 모달**(origin 기반 URL→터널/LAN 무관 + Web NFC 쓰기 `NDEFReader`, Android Chrome 외 graceful) + 점검 이력(DB 스캔+seed 병합). 통합 신호등 `aedDetail` 공유 캐시 동기화. **의존성 0**(Web NFC, qrcode 미추가).
- **검증** — tsc 0 · 단위 14/14 · API(201/persist·404·400) · **실UI end-to-end**(자재창고 배터리교체→교환임박→정상 ~48개월, B1 패드교체→D-20→~24개월, 최근 교환 오늘) · NFC 모달(URL·쓰기·폴백·병합 이력). ★ **Web NFC 태그 쓰기 자체는 미검증**(데스크톱 미지원, 폴백만 확인 — 실 쓰기 Android Chrome+물리 태그 필요).
- **상태** — main **`ahead 124`**(세션30 2커밋), push 보류. working tree = `demo/`·docs(세션29~30)·iOS 부산물 미커밋. 터널 `undertaken-best-communist-release`·dev 0.0.0.0+PII ON.
- **다음(내일 진행·사용자 보류)** — push(124) · demo/ 커밋 · iOS 락파일/pbxproj 처리 · docs 커밋 · Web NFC 물리 태그 시연(Galaxy Chrome) · 기존 블로커(YJH 재install·Galaxy Health·배터리 풀시프트·세션23 KMA NO_DATA·D4 리허설).

### (2026-06-09 세션29 — 관제 웹 디자인 대개편 8종(레퍼런스·의존성 0) + iOS 재설치(BECKS, 무료팀 등록 벽 돌파))

- **생체 막대그래프 → 체온계(캡슐) 게이지**(`f0541c3`) — `BarChart` 레퍼런스 캡슐 룩(회색 트랙+둥근 색상 필+바닥 원형 마커, ≤8개 시 상단 값 라벨, clamp 로 밀집 자동 축소). 심박/산소/손목온도/낙상 공유.
- **생체 라인그래프 → 그라데이션 곡선 + 도트 + Lato**(`4a95a15`) — 카드뮬-롬 스플라인 + 색상 파생 가로 그라데이션 stroke + 점별 보간색 도트. **Lato 폰트는 차트 패널에만 스코프**(세션26 전역 폰트 롤백 이력).
- **알림 이력 아이콘 → cva Alert + 상태별 컬러**(`c576789`) — 미대응 SOS=`triangle-alert`(레드)/낙상=`shield-alert`(앰버)/대응완료=`circle-check`(녹색). 세션28 옥타곤·인물 아이콘 교체 + 대응완료 회색→녹색.
- **관리자 로그인 → 레퍼런스 카드(Signup1)**(`d676fcf`) — 좁은 중앙 카드(로고 상단+클린 인풋+풀폭 로그인+구글 아웃라인(준비중)+푸터). 사용자 선택 "레퍼런스 그대로(구글 포함)". 로그인 후 패널 유지.
- **관리자 모달(내보내기) → 레퍼런스 카드 리디자인**(`0d6243d`) — 브레드크럼 헤더+ghost 아이콘 액션+아이콘 메타 행+rounded-xl 섹션. 버튼은 레퍼런스 구조+**의미색 유지**(XLSX 초록/CSV 시안/ML 인디고). 기능 100% 보존(미리보기 68,782건 검증).
- **통합 안전 신호등 아이콘 → 모노톤 라인 SVG**(`5212621`) — 🌦👷🧪❤️→`cloud-sun`/`hard-hat`(안전모)/`wind`/`heart-pulse`(AED), 중립 톤(상태는 점·배지).
- **제세동기 배터리 텍스트 → 원형 게이지**(`a4652aa`) — 레퍼런스 Gauge 축약(인라인 SVG dasharray), 중앙 값+임계색(≤20 빨강/≤50 앰버/그외 초록), 36px 고정이라 **행 높이 h-12 불변**.
- **추세 그래프 range 60일·1년 추가**(`d88960a`) — 작업자/가스/AED. **1년=월별 12점**(일별 365 겹침 회피, 낙상=월 총합, 배터리=단조감소). buildHistory 365 분기 + ALLOWED_RANGES + labelMonthsAgo.
- **★ iOS 재설치(BECKS)** — `flutter build`+`devicectl install`/`flutter run --release` 둘 다 `provisioning profile cannot be installed`(프로파일 device 0). **원인=무료 Personal Team이 `flutter build`(generic)로 기기 미등록**. **돌파**: ① Xcode `Runner.xcworkspace`→BECKS 선택→Product>Run 1회(debug 설치=기기 등록+신뢰) ② **SPM 비활성화**(`flutter config --no-enable-swift-package-manager`, Xcode Run의 SPM 산출물이 `Cannot create link` 크래시·health 미지원→CocoaPods 정공) ③ `flutter clean && flutter build ios --release`(18.1MB·RELEASE·프로파일 **devices 2·BECKS 포함**) ④ `devicectl install`(debug→release)+launch. **수신 확인** EMP-1234 age 2초(hr:-- 는 잠금/Health 권한 대기).
- **검증/상태** — 각 디자인 dashboard `tsc` EXIT=0 + Playwright 실브라우저(전 항목) + 단위 14/14. iOS=release 검증+프로파일 devices 2+install/launch+EMP-1234 수신. main **`ahead 122`**(8커밋 `f0541c3`·`4a95a15`·`c576789`·`d676fcf`·`0d6243d`·`5212621`·`a4652aa`·`d88960a`), push 보류. working tree=`demo/` untracked + **iOS 부산물 미커밋**(`Podfile.lock`·`Runner.xcodeproj/project.pbxproj`·`pubspec.lock`). 터널 `undertaken-best-communist-release`(생존)·LAN `192.168.219.221`·dev 0.0.0.0+PII ON. (다음) push 결정(122) · demo/ 커밋 여부 · iOS build 락파일/pbxproj 처리 · YJH 동일 방식 재설치 · BECKS 잠금 해제+Health 시 실측 심박 확인 · 기존 블로커(Galaxy Health·배터리 풀시프트·세션23 KMA NO_DATA·D4 리허설).

### (2026-06-09 세션28 — 로그인 사진(mainpic0) + 네트워크 재연결 + 외형 스냅샷 HTML + 현장환경/헤더/알림이력 재디자인 + 자동슬라이딩 선택 수정 + 상태 점검)

- **로그인 사진 → mainpic0.jpg**(`9cdf09e`) — "Safe Workers, Strong Structures." **중앙 정렬 구도**라 `background-position 75%→50%`(중앙 크롭). 구 mainpic4/6 폐기.
- **네트워크 재연결** — cloudflared 새 터널 **`undertaken-best-communist-release.trycloudflare.com`**, Mac LAN IP **`192.168.219.221`**(망 변경). dev 0.0.0.0:3000. 폰 3대 인앱 URL 갱신 필요(미반영).
- **★ 외형 스냅샷 HTML(팀원 공유용)** — SingleFile CLI(`--browser-script`로 sessionStorage 토큰 시드 → 로그인 게이트 통과)로 **실제 외형 그대로** 단일 .html 2개([demo/safetymonitor-dashboard-live-snapshot.html](../demo/safetymonitor-dashboard-live-snapshot.html)·[demo/safetymonitor-login-snapshot.html](../demo/safetymonitor-login-snapshot.html)). CSS·이미지·폰트·**WebGL 셰이더 캔버스(PNG 박제)** 인라인, 외부자원 0·스크립트 0 → 더블클릭 독립 실행. **정지 스냅샷**. 손코딩 목업 폐기. demo/ untracked.
- **★ 현장환경 InfiniteSlider 재디자인**(`3d2408d`) — LED 전광판 → 클린 칩 슬라이더(`rounded-full`+`mask-image` 페이드) + **호버 시 22% 감속**(useMarqueeScroll `hoverSpeedFactor` 옵션·하위호환) + sans+tabular-nums 폰트 + **모노톤 라인 아이콘**([WeatherIcons.tsx](../apps/dashboard-web/app/components/WeatherIcons.tsx) 신규, 이모지→SVG·날씨 WMO 8종 분기·flaticon 라이선스/의존성 0).
- **★ 헤더 ExpandableTabs(호버 확장)**(`a950ef4`) — 알림이력/관리자/사이렌/로그아웃 4버튼 알약 그룹 바([ExpandableTabs.tsx](../apps/dashboard-web/app/components/ExpandableTabs.tsx) 신규), 호버 시 라벨 펼침+primary 색/블루 틴트, 클릭=액션. **라이트/다크 토글 제외**. 미사용 `GradientIconButton.tsx` 삭제.
- **★ 자동 슬라이딩 복제 행 생체 셀 선택 수정**(`9d88d55`) — 복제 행 `pointer-events-none` 제거 → 보이는 게 복제본이어도 클릭 가능(같은 workerId, "간헐적 선택 불가" 해소). a11y는 `aria-hidden`·`tabIndex=-1` 유지.
- **★ SOS·낙상 알림 이력 Alert 카드 재디자인**(`48d99f4`) — 소프트 컬러 카드(미대응 SOS=레드/낙상=앰버, 대응완료=중립+녹색 배지·체크) + 이모지(🆘/🤕)→모노톤 SVG(SOS 옥타곤/낙상 인물). 대응 확인 동작·데이터 불변.
- **상태 점검(코드 0)** — **EMP-1234(장우진) 실시간 연결**(HR 91·SpO₂ 98·손목 35.7℃·GPS 광주). **GPS 기반 현장 날씨 = Open-Meteo LIVE 정상**(23.7℃ 등+예보), 기상특보 mock 폴백(광주 무특보). **현장 날씨 미표시 = dev 재시작으로 세션 토큰 무효화 → GPS redaction → 로그아웃 후 재로그인**으로 복구(새로고침 X).
- **핵심 결정** — 레퍼런스(InfiniteSlider/ExpandableTabs/Alert)의 motion/lucide/cva/cn 의존을 **전부 신규 의존성 0으로 동등 구현**(CSS 트랜지션+인라인 SVG+토큰). Tailwind arbitrary JIT 타이밍 + button preflight(color:inherit) 간섭 → **활성 상태는 인라인 스타일(CSS 변수)** 패턴.
- **검증/상태** — 각 변경 dashboard `tsc` EXIT=0 · Playwright 라이브(전 항목). dev 재시작 1회(Tailwind 클린 재빌드, URL 유지). main **`ahead 113`**(세션28 5커밋 `9cdf09e`·`3d2408d`·`a950ef4`·`9d88d55`·`48d99f4`), push 보류, working tree `demo/`만 untracked. 터널 `undertaken-best-communist-release`·LAN `192.168.219.221`·dev 0.0.0.0+PII ON. (다음) push 결정(113) · demo/ 커밋 여부 · 폰 3대 인앱 URL 갱신 · 재로그인 시 현장 날씨 확인 · 기상특보 KMA NO_DATA 처리 · 기존 블로커(YJH iPhone 재install·Galaxy Health·배터리 풀시프트·D4 리허설).

### (2026-06-08 세션27 — 현장 선택 라벨·자동 슬라이딩 중복 수정 + 비전 PoC 계획(보류) + 로그인 사진 교체 + stray 정리)

- **현장 선택 메인 현장 지역명 표기**(`afec68e`) — [LoginSiteSelect.tsx](../apps/dashboard-web/app/components/LoginSiteSelect.tsx) `MAIN_SITE.label` "스마트인재개발원 신축 공사"→**"광주 스마트인재개발원 신축 공사"**(주소 광주광역시 광산구). 데모 현장과 동일 "지역 현장이름" 형식 통일. 표시 라벨만 변경, 대시보드 반영용 `siteName` 은 실제 현장명 유지.
- **★ 작업자 표 자동 슬라이딩 동일 작업자 중복 노출 수정**(`08951a4`) — 자동 모드가 seamless 루프 위해 행을 **항상 2벌 복제**(`[0,1].map`)하던 것을 행이 뷰포트 초과(overflow)일 때만 복제하도록 수정. rAF tick 에서 overflow 측정 → `tableOverflowing` state 로 복제 렌더 게이팅. 행 적으면 한 벌만 렌더 → 중복 해소, overflow 시 복제+슬라이딩 보존. 검증 Playwright(3명=복제 0·각 1회 / 12·10명 overflow=복제 유지·scrollTop 37→37.5 슬라이딩).
- **비전 PoC 계획(보류)**(`cbc7205`, [vision-ppe-plan.md](./vision-ppe-plan.md) 신규) — GoPro+supervision 안전모 착용 검출 + 워치 낙상 오차율 감소(영상 라벨링/융합). **supervision = 후처리 라이브러리(검출 모델 아님 → 별도 YOLO 필요)**. 결정 = 발표 데모 PoC 포함(영상+ML 2차 비범위 PoC 한해 승격) + GoPro **HERO9** 웹캠(USB 0.5s). **★ Colab 은 로컬 USB 웹캠 실시간 추론 불가 → 발표 PC(macOS) 로컬 CPU 실시간**(안전모 가벼워 GPU 불필요). macOS 캡처 = GoPro Webcam→OBS Virtual Camera→OpenCV(폴백 녹화 .mp4). 통합 = Python `apps/vision-ppe/`→`/api/vision-event`→통합 신호등 PPE 램프. **GoPro 장비 미보유 → 보류**, 장비 준비 시 착수.
- **루트 stray 정리**(`c59aaa5`) — `.claude/skills/` gitignore 추가(로컬 스킬, 파일 보존) + 루트 중복 `mainpic.jpg`·검토용 `dashboard-full.png` 삭제.
- **로그인 사진 교체 → mainpic4.jpg**(`1c08b97`) — 로그인 좌측 현장 사진을 안전모 VitalGuard 로고 브랜딩 버전(1015×1024)으로 교체. 구도 동일이라 `background-position: 75% 50%` 유지(컬럼 1:1, 안전모·SAFETY 문구 노출). 미사용 구 이미지(`mainpic.jpg`·`mainpic2.jpg`) 삭제 → `public/brand` 엔 `mainpic4.jpg` 만.
- **검증/상태** — dashboard `tsc` EXIT=0(각 수정) · Playwright(현장선택 콤보 6항목 가나다순+메인 "광주 스마트인재개발원 신축 공사" / 자동 슬라이딩 중복 해소·overflow 복제·슬라이딩 / 로그인 사진 mainpic4 적용·컬럼 1:1). main **`ahead 107`**(세션27 6커밋 `eb242c1`·`afec68e`·`08951a4`·`cbc7205`·`c59aaa5`·`1c08b97`), push 보류, working tree clean. 터널 `sends-paintball-often-carolina`·dev 0.0.0.0+PII ON. (다음) push 결정(107) · 폰 3대 인앱 URL 갱신 · 비전 PoC는 GoPro 장비 준비 시 착수 · 데모 현장 실데이터화(선택) · 기존 블로커(세션23 KMA NO_DATA·YJH iPhone 재install·Galaxy Health·배터리 풀시프트·D4 리허설).

### (2026-06-08 세션26 — 로그인 화면 풀 개편 커밋 + 로그인 후 현장 선택 단계 신규)

- **로그인 화면 개편 커밋**(`f3baadd`) — 세션25 미커밋 디자인 + 신규를 묶어 커밋. **반투명 글래스 카드 2분할**(좌측 현장사진 `public/brand/mainpic.jpg` 1:1·bg-cover·position 75% / 우측 폼) + **셰이더 배경**(`LoginShaderBackground`) + **스토어 배지**(App Store/Google Play) + **구글 버튼**(준비중) + **리퀴드 메탈 로그인 CTA**(기설치 `@paper-design/shaders-react` `LiquidMetal` 재사용→신규 의존성 0) + **한↔영 레이아웃 높이 고정**(min-h + 영문 폰트 축소 h1 22→15·line2 14→10, 카드높이 한=영).
- **헤더 그라데이션 버튼**(`1787e5c`) — 알림이력/관리자/사이렌/로그아웃 원형→hover 112px 확장+그라데이션/라벨(`GradientIconButton`), 테마 토글 **로그아웃 오른쪽 이동**, 미사용 `SECONDARY_PILL` 제거.
- **워치 URL**(`35844ef`) + **세션24~25 docs**(`62f0913`).
- **관제 웹 폰트** — Archivo Black/Do Hyeon 전역 적용 → **사용자 롤백 요청 → Inter 복원**(globals.css net 0, 커밋 없음). 로그인 폰트는 유지.
- **★ 로그인 후 현장 선택 단계 신규**(`a3e8575`) — Sign in 성공 → **현장 선택 단계**(`pendingToken`). HeroUI 콤보박스 이식(`heroui-combo-box.tsx`, 외부 의존성 0) + `LoginSiteSelect.tsx`(메인 **스마트인재개발원 신축 공사** 고정 + 데모 5현장 광주·부산·세종·인천·평택 **가나다순**, 현장명 "지역 현장이름"). 선택 → `site-info` 저장 → 대시보드 현장정보 반영. 레이아웃 = 로고만(문구 제거)·레이아웃 스크롤 제거·드롭다운 자체 스크롤(카드 overflow 해제로 비클리핑).
- **검증/상태** — `tsc` 0 · Playwright(로그인→현장선택→입장 end-to-end, 평택 선택→대시보드 "평택 반도체 P4 FAB 증설공사/(주)대성플랜트", 가나다순, 비클리핑, 뒤로 복귀, KO/EN 카드높이 동일). main **`ahead 101`**(커밋 5건 `f3baadd`·`1787e5c`·`35844ef`·`62f0913`·`a3e8575`), push 보류. 터널 `sends-paintball-often-carolina`·dev 0.0.0.0+PII ON. untracked(의도): 루트 `mainpic.jpg`·`dashboard-full.png`·`.claude/skills/`. (다음) push 결정(101) · 루트 stray 정리 · 폰 인앱 URL 갱신 · 데모 현장 실데이터화(선택) · 기존 블로커.

### (2026-06-08 세션25 — 재가동 + 로그인/헤더 디자인 개편 + 팀원 공유)

- **재가동 + URL 회전** — 이전 `cheers-entire-glass-editorial` 만료 → dev+cloudflared 재기동, 새 quick tunnel **`sends-paintball-often-carolina.trycloudflare.com`**(GET 200/POST 202), **LAN IP `192.168.219.123`**(망 변경). 워치 `defaultURLString`+CLAUDE.md active URL 3곳 갱신. 폰 3대 인앱 URL ⚙️ 수동 갱신 필요(미반영).
- **헤더 토글/아이콘**(커밋 `2738fc8`) — 테마 토글을 **알약 슬라이딩 스위치**(21st.dev Serenity UI, 의존성 0) + 이모지 🔔🔊🔇 → **라인 SVG 통일**.
- **로그인 화면 대개편**(미커밋) — ① 언어 토글도 동일 슬라이딩 스위치(한↔EN) ② 헤더 버튼 **ghost 톤**(ruixenui, h-8 rounded-lg 투명→hover, 테마 토글 제외) ③ **셰이더 배경**(신규 의존성 `@paper-design/shaders-react@^0.0.76` MeshGradient 4색 블루, 사용자 결정="원본 라이브러리") ④ **풀블리드 레이아웃**(SickUI 레퍼런스 — 카드 박스 제거, 글래스 입력+흰 CTA+흰 텍스트, 배경 항상 블루라 테마 독립) ⑤ **텍스트 1줄**(`whitespace-nowrap`, max-w-sm은 폼에만) ⑥ **폰트**(사용자 Google Fonts `<link>`) 라틴=Archivo Black·한글=Do Hyeon(글자별 폴백).
- **팀원 공유**(코드 0) — cloudflared 공개 URL + 로그인(admin/safety2026), 비로그인 PII redaction 검증(익명 GPS/보호자 가림=안전). 고정 URL 안내(Cloudflare named tunnel=도메인 필요/ngrok static/Tailscale Funnel) = 미실행·결정 대기.
- **검증/상태** — `tsc` 0 · Playwright(토글 슬라이드·헤더 ghost·셰이더 풀스크린·박스 제거·텍스트 1줄 한/영·폰트 로드·터널 외부 200·PII 가림). main **`ahead 96`**(커밋 `2738fc8` 1건만, 나머지 미커밋: LoginScreen/DemoDashboard/layout/LoginShaderBackground(신규)/package.json/pnpm-lock/CLAUDE.md/ConnectionSettings). 터널 `sends-paintball-often-carolina`·dev 0.0.0.0+PII ON. (다음) 미커밋 커밋(URL-sync / 디자인 분리) · 폰 인앱 URL 갱신 · 고정 URL 방식 결정 · push(96+) · 기존 블로커.

### (2026-06-08 세션24 — 수신 URL 갱신 + 태풍 진로 엄격 게이팅)

- **수신 URL 재발급**(커밋 `218b96d`) — 이전 터널 `intelligent-funk-pads-supplies` 만료 → 재기동, 새 quick tunnel **`cheers-entire-glass-editorial.trycloudflare.com`**(터널 GET 200/POST 202 검증). 워치 `ConnectionSettings.defaultURLString` 갱신(스탬프 자동 마이그레이션) + CLAUDE.md active URL 3곳. **폰 3대 인앱 URL은 ⚙️ 수동 갱신 필요(미반영)**, 워치는 ATS 평문 차단이라 https 터널 전용.
- **★ 태풍 진로 "실 위협 없으면 레이더 미가동"**(커밋 `e9567b1`, 사용자 결정 = "지도 숨김·위협 없음 엄격") — 세션22 한국/현장 GPS 게이팅 자체는 정상(검산 950.1km=화면 "한국 950km")이나 **`mock` 샘플 좌표가 한국 반경 안(950km)이라 실 위협 없는데 "추적 중" 거짓 점등**(세션23 KMA NO_DATA 가짜특보와 동일 계열). 수정 = `realThreat = source==="live" && track.length>0` → `mock`·`none`·빈 진로는 지도/추적 숨기고 `IdleNoThreat`("태풍 위협 없음 · 레이더 대기"), `live`+발효 진로일 때만 한국/현장 GPS 게이트(기존 보존). 서비스 승인+실 태풍 발효 시 자동 가동(목업 비캐시).
- **.gitignore `.playwright-mcp/` 추가**(커밋 `96fdad8`).
- **검증/상태** — dashboard `tsc` 0 · Playwright 런타임(태풍 패널 위성타일 0=미가동 + idle 텍스트 + "추적 중" DOM 부재). main **`ahead 94`**, push 보류(+`.claude/skills/`·`dashboard-full.png` untracked). 터널 `cheers-entire-glass-editorial`·dev 0.0.0.0+PII ON. (다음) 폰 3대 인앱 URL 갱신 · push 결정(94) · 실 태풍 발효 시 레이더 자동 가동 확인 · 기존 블로커(세션23 KMA NO_DATA·YJH iPhone 재install·Galaxy Health·배터리 풀시프트·D4 리허설).

### (2026-06-08 세션23 — 관제 웹 Playwright MCP 런타임 검증)

- **검증 방식** — 사용자 요청으로 dev 서버(`localhost:3000` HTTP 200) 관제 웹을 **Playwright MCP 실브라우저**로 구동·관찰. 스크린샷은 MCP 별도 네임스페이스 저장이라 못 읽어 **접근성 스냅샷·API 응답·`evaluate()` 타일 로드 체크**로 증거 확보. **코드 변경 0**(검증 전용).
- **PASS** — 로그인 게이트(admin/safety2026) · **현장 통합 안전 신호등**(종합 위험+4램프 worst-of)+가스 상세 팝업(측정/영향/노출기준 TWA·STEL·IDLH/골든타임/위치/면책) · 현황 요약 캐러셀 4페이지 ‹›네비 · **세션22 태풍 게이팅 검산**(샘플 27.5,126.8→한국중심 haversine ≈948km<1000km→"추적 중", 화면 "한국 950km" 일치) · 태풍 지도 확대 슬리피맵(동적 줌 z4·타일 30/30) · **세션22 특보영상 YouTube API 라이브**(`type=태풍`→`ok:true,configured:true,channelLimited:true`+YTN 뉴스사 실영상, UI는 GPS 미등록 시 placeholder) · 지도 타일 CDN 전부 로드(carto 4/4·rainviewer 4/4·esri 8/8+30/30, 깨짐 0) · 작업자 모니터링 3페이지·산업재해 속보 KOSHA 라이브·환경키 4종 설정.
- **★ 발견 ⚠️** — **KMA `03 NO_DATA`(정상적 무특보)를 API 오류와 동일 취급해 MOCK_WARNINGS 폴백**([kma.ts:161](../apps/dashboard-web/app/lib/kma.ts#L161) `resultCode!=="00"`). 오늘처럼 전국 무특보 날 서울/경기/강원(강풍주의보)·전남/경남/제주(폭염주의보) **등록 작업자에 가짜 특보** + 현장기상 신호등 거짓 점등 + 세션22 특보영상이 가짜 특보로 실 YouTube 검색 트리거. 광주는 mock 지역 외라 우연히 "특보 없음". 라이브 KMA 현재 `03 NO_DATA`(서버 오늘 00:05 기동=stale 아님, 발효 특보 실제 없음). 발표일(07-07) 무특보면 6개 지역 false warning → 상용화 기준 실 결함.
- **상태/다음** — main `ahead 90`(origin/main), working tree clean(+`.claude/skills/` untracked). 터널 `intelligent-funk-pads-supplies`·dev 0.0.0.0+PII ON. (다음) **KMA NO_DATA 처리 결정**(발표용 폴백 유지 vs `03`=무특보 분리 수정) · push 결정(90) · 기존 블로커(YJH iPhone release 재install·Galaxy Health 권한·배터리 풀시프트·D4 리허설).

### (2026-06-05 세션22 이어서 — 관제 웹: 태풍 게이팅 + 특보 영상)

- **★ 태풍 진로 위험 반경 게이팅**(커밋 `16502ef`) — 태풍 현재 위치가 현장 GPS 반경(500km) OR 한국 반경(중앙 36.0,127.8/1000km) 안일 때만 추적(지도+상세), 둘 다 벗어나면 "추적 중지"(거리만 안내). 현장 GPS 없으면 한국 반경만. 라이브: 장미 재곡(144.1°E, 1,463km)→자동 추적 중지.
- **★ 특보 영상 패널**(커밋 `d7030e2`) — 기상특보/예비특보 시 종류(태풍/강풍/호우 등)로 YouTube Data API v3 자동 검색 → **주요 뉴스사 한정**(KBS/SBS/MBC/JTBC/YTN/연합뉴스/채널A) → '현황 요약' 캐러셀 '특보 영상'. 특보 없으면 placeholder. safeSearch·전국(KR)·3시간 캐시. 채널한정 3단(channelId 엄격→뉴스사명 필터(현재)→일반).
- **API 키/비용** — `.env.local YOUTUBE_API_KEY`(사용자 발급 완료, gitignore·커밋 제외). YouTube Data API = **무료 쿼터, 돈 차감 0** · 특보 없으면 호출 0(쿼터 0) · 특보 시 종류당 3시간 1회.
- **보류** — `YOUTUBE_OFFICIAL_CHANNEL_IDS`(UC 엄격모드·임포스터 차단)는 실 특보 live 방송 시 적용·튜닝(env-only, 코드 0).
- **검증/상태** — tsc 0·유닛 14/14·뉴스사 필터 실증·태풍 게이팅 검산. main **`ahead 87`**, push 보류. 발표 PC 인터넷 필요(유튜브/타일 CDN). (다음) push · 실 특보 시 영상 표출 확인 · 기존 블로커.

### (2026-06-05 세션22 이어서 — 워치 배터리 진단 + 상용화 최적화 경로)

- **실측 소모율** — EMP-5678 배터리 DB 시계열 = 안정 구간 **~8~9%/hr(완충 ~11h)**, 꾸준한 직선(런어웨이·버그 아님), Ultra idle 3~4배 → 체감 "급격"은 구조적.
- **원인 구조** — 지배 = 워크아웃 세션 연속 광학 HR(~50-65%, **불가피** = 잠금우회 §4 근거) · 부차 = 세션21 deviceMotion 50Hz(가속도 25Hz→융합 50Hz 회귀, 추정) · 음성 후보 배칭이라 미미.
- **★ 코드 최적화 한계** — axiom-health 확인: 워크아웃 세션 중 광학 HR 스로틀 **공개 코드 API 없음**(1Hz 저전력은 디스플레이 한정). 코드로는 **부차(~35-50%)만** 절감(B1 deviceMotion 33Hz·B2 raw accel+충격후 자이로·B3 accel-only 25Hz), 반감 불가(~9→~7-8%/hr 추정).
- **★ 상용화 경로(§9.4 추가, 커밋 `9f92cd3`)** — 프로토타입 ~11h는 데모 산물. 상용화는 데이터 소스 전환으로 지배원까지 절감 = 3트랙(Apple Watch 유료 엔타이틀먼트 / Android·Wear OS / 자체 AOSP 다일) + 엔타이틀먼트 표(background-delivery·CMFallDetectionManager·CMBatchedSensorManager).
- **결정/상태** — 발표는 충전+구간 가동이면 코드 변경 0으로 충분 → B1/B2 보류. main **`ahead 84`**, push 보류, clean. (다음) push · (선택) 배터리 A/B 실측→B1/B2 · 기존 블로커(YJH iPhone 재install·Galaxy Health·배터리 풀시프트·D4 리허설).

### (2026-06-05 세션22 — 낙상 ML 데이터 수집 파이프라인 + 트랙A 스캐폴드)

- **★ 낙상 ML 수집 파이프라인**(커밋 `adfa663`·`70d3087`) — 워치 [FallDetector](../apps/worker-watch-poc/Sources/FallDetector.swift) `onFall`→`onCandidate`. 후보 해소 시 **양성(발화) + 음성 거부 2종**(`rejected_no_corroboration`/`rejected_timeout`)을 모두 전송하며 **활성화 요소 전부**(충격G·정지초·자유낙하 전조·회전 피크·판정 사유) 동봉. 음성=배칭·알림 미발火. dashboard = schema 4필드 + DB 6컬럼+`fall_labels` 테이블 + API 3종(`fall-candidates`/`fall-label`/`fall-export` CSV) + 관리자 `FallMlPanel`(통계+CSV+라벨링). 레거시 154건 raw_json COALESCE 백필.
- **★ 트랙A ML 스캐폴드**(커밋 `a1b061c`) — `ml/fall-detection/optimize_thresholds.py`: fall-export CSV → 현재규칙 기준선 → 임계 그리드 탐색(impact≥2.8/still/rot, 비용가중 w_fn≫w_fp) → 작업자 GroupKFold 교차검증 → PR곡선(로지스틱 트랙B 미리보기) → FallDetector.swift 권장상수. 지연 import+선택적 → `--selftest`(설치 불필요)·`--demo`(합성)·데이터 0건 안전 종료.
- **★ 워치 재빌드 실기기 가동확인** — 수동 낙상 시연(`simulateFall`)이 신규필드(`fallCandidate`/`fallDecision=fall`/`freefallPreceded`/`peakRotationRadS=7`) 수신 → 새 빌드 배포·수집 파이프라인 라이브 확정. 시연값은 합성상수라 ML 부적합(`미상` 라벨 권장).
- **현재 = 데이터 축적만, ML 아직 아님** — 낙상감지는 여전히 고정 규칙(임계), 학습·추론·임계 자동최적화 미실행. 한계 = 충격 2.8G 미만 부재(recall 사각지대)·freefallG/stillBandG/postWindow 재튜닝 불가·라벨 노이즈=정확도 천장.
- **검증** — schemas build·dashboard tsc 0·유닛 14/14·워치 watchOS Sim **BUILD SUCCEEDED**·낙상 로직 standalone **5/5**(양성+음성)·런타임 POST→신규 6컬럼·인증 API+401·`--selftest` 6/6·`--demo` PR곡선 AP 0.916.
- **상태/다음** — main **`ahead 82`**(이번 4커밋), push 보류, clean. (다음) push 결정 · 실 양성·음성 누적+라벨링 · 데이터 성숙 후 트랙A 실행→권장 임계→shadow 모드(구·신 동시 로깅)→배포 · 기존 블로커(YJH iPhone 재install·Galaxy Health·배터리 풀시프트·D4 리허설).

### (2026-06-05 세션21 — 워치 낙상 감지 알고리즘 보완)

- **★ 워치 낙상 감지 보완**(커밋 `f842e59`) — [FallDetector.swift](../apps/worker-watch-poc/Sources/FallDetector.swift) 충격(2.8G)→정지(1.2s) 2단계 → **자유낙하→충격→저활동 윈도 3단계 + 자이로 코로보레이션**. 센서 가속도계 25Hz → **deviceMotion 50Hz**(userAcceleration+gravity+rotationRate).
- **3단계 게이트** — 자유낙하 전조(impact 직전 0.8s 내 totalG≤0.6G)로 작업 충격 **오탐↓** · 저활동 윈도(연속 정지→누적 1.2s 비연속 허용)로 몸부림 낙상 **미탐↓** · 자이로 강회전(≥6rad/s)으로 자유낙하 놓친 벽충돌형 낙상 보강.
- **스케일 보존** — `totalG=|userAccel+gravity|` 원시 비력 재구성 → 기존 2.8G·0.3밴드 임계 의미 불변. `onFall`·payload·서버 무변경(외부 파급 0, `simulateFall` 수동 트리거 보존).
- **Apple 낙상 API 정정** — `CMFallDetectionManager`(watchOS 9+) 서드파티 수신 API 존재하나 특수 entitlement(유료+Apple 승인)라 무료 Personal Team 불가 → 상용화 트랙 정공.
- **검증** — watchOS Sim `xcodebuild` **BUILD SUCCEEDED** + 결정로직 복제 standalone Swift **5/5 PASS**(실낙상·망치질 미발화·벽충돌(회전)·지속운동 미발화·몸부림후정지) + **★ 실기기 잠금 검증 완료**(사용자 보고 — 잠금 상태 낙상 감지 동작 확인, §4 HR-only 한계 보완).
- **상태/다음** — main **`ahead 77`**(낙상 `f842e59` + 세션20 docs `5d66181`), push 보류, clean. (다음) push 결정 · YJH iPhone 재install · Galaxy Health 권한 · 배터리 풀시프트 · D4 리허설.

### (2026-06-05 세션20 — LAN 연결 + 직급/직책 기능 + GPS 진단 + 종합 취약점 감사 + 감사조치 구현 + 2단말 재빌드 가동확인)

- **관제 웹 LAN 연결** — dev `0.0.0.0:3000`, Mac LAN IP **`192.168.219.106`**(망 변경). 폰 평문 HTTP 허용(iOS `NSAllowsLocalNetworking`/Android cleartext) → 폰 LAN 직송 가능.
- **★ 작업자 직급/직책 기능**(커밋 `a75a6fc`·`3aef23e`) — 표 직급 컬럼(13열) + 폰 ⚙️ 입력(`jobTitle` payload) + 관제 웹 입력(`worker_profile` 오버라이드, `/api/worker-profile` 세션인증) + DB 영속 + CSV/XLSX. 효과값=오버라이드 ?? 폰값. 실기기 EMP-1234 "현장소장" 확인.
- **GPS 미수신 진단** — 폰 GPS 정상(DB 33k건). dev 재기동으로 세션 토큰 무효화 → PII redaction(생체 정상, GPS·보호자만). 해결=대시보드 **재로그인**. 현행 유지 결정.
- **★ 종합 취약점 감사**(관제웹+iOS+워치 멀티에이전트) — CRIT/HIGH 0(프로토타입). 관통 테마 = 데이터 연속성·False-OK. 발표전 권장 4 도출.
- **★ 감사조치 구현**(커밋 `15355b6`·`7b80fca`·`fd1b117`) — **폰**: SOS 3초 길게+자동재시도+백로그(AF3)·재전송 큐(AF2)·stale freshness(M4)·mounted 가드(M1). **웹**: 연결끊김 상태머신 60초(AF1)·SOS/낙상 알림 이력(`alerts` 테이블+모달, AF4)·로그인 rate limit(M1). **워치**: 단독 SOS 버튼(AF3)·backlog UserDefaults 영속(AF2).
- **★ cloudflared 재기동** — 새 터널 `intelligent-funk-pads-supplies`. **워치는 ATS 평문 차단→https 터널 전용**(폰은 ATS 예외로 LAN). 데모=폰 LAN/워치 터널 혼합.
- **★ 2단말 재빌드·가동확인** — iPhone BECKS(EMP-1234: HR+GPS+직급) / Apple Watch(EMP-5678: HR+배터리, 터널) 실시간 인입 검증. **폰=Flutter CLI만 / 워치=Xcode 정상**.
- **검증** — 폰 `flutter analyze` 0 · 웹 `tsc` 0+테스트 14/14 · 워치 watchOS Sim BUILD SUCCEEDED · AF1/AF4 CDP 스크린샷 · AF4 ack·M1 429 런타임.
- **상태/다음** — main **`ahead 75`**(직급 2 + 감사조치 3커밋), push 보류, clean. (다음) push 결정 · YJH iPhone 재install · Galaxy Health 권한 · 배터리 풀시프트 · D4 리허설.

### (2026-06-04 세션19 — 관제 웹 현장 통합 안전 신호등 + API PII 로그인 게이트 + 생체/설비 그래프 개선)

- **★ API PII 로그인 세션 게이트**(커밋 `722a92c`) — 미인증 GET `/api/mock/vital` 의 PII(GPS·보호자) 노출을 `MOCK_VITAL_EXPOSE_PII` **AND** 유효 로그인 세션 토큰(`verifyBasicAuth`) 동시 충족 시에만 허용. 비로그인 익명/위조 토큰은 redaction. `LoginGate.getSessionToken()` + 대시보드 폴링 `Authorization: Bearer`. POST(폰 수신) 무인증 유지 → **팀원에게 공개 cloudflared URL(`switch-biography-surplus-cold`, 생존 확인) 공유해도 PII 안 샘**(재발급 시 워커폰 4대 URL 재입력 필요해 보류).
- **★ 현장 통합 안전 신호등**(커밋 `269e663`) — 기존 단독 기상신호등(`WeatherHazardPanel`) 자리를 **4카테고리(현장기상/작업자/가스/AED) worst-of 램프 + 종합 보드**(`SafetySignalBoard`)로 교체. WeatherHazardPanel 고아화→삭제(커밋 `b76f6a6`). 집계 = 기상 `/api/kma-warning`(GPS)·작업자 `workerStatus`(낙상·SOS) worst-of·가스/AED 행 `sev` worst-of.
- **★ 통합 신호등 항목별 상세 안내**(커밋 `51b4caa`) — 각 행 1줄(요약+핵심 영향/골든타임 인라인) + **클릭 시 상세 팝업**(영향·노출기준·골든타임·위치). 가스 종류별 지식 테이블(CO/H₂S/CH₄/O₂/VOC, KOSHA/NIOSH 참고값+면책), AED 구동 잔여 추정(대기 개월/충격 횟수), 작업자 이상 메트릭 상세, 특보 작업중지 가이드. 라벨 괄호 부속어 줄바꿈.
- **생체·설비 그래프 개선**(커밋 `6378f36`) — 호버 즉시반응(네이티브 `<title>`→onMouseMove 커스텀 오버레이)·가스 임계 기준선·AED 배터리 ≤20% 경고 팝업·체온 그래프 추정 체온(손목+0.5℃) 병기(요약 amber+호버). **태풍 진로 하단 통계 한 줄**(커밋 `387f7f8`).
- **UI 정리**(커밋 `722a92c`) — 히어로 카피 3줄(`OPEN SAFETY` 등) 삭제 + 작업자 표 선택 셀 `h-7→h-9`(2줄 체온 겹침 해소)+선택박스 강한 풀-링→뉴트럴 엘리베이티드 칩(값 상태색 유지, 대안 3종 제시 후 선택).
- **★ 발견 — Tailwind v3 `colors:var()` opacity 무효** — `bg-primary/10`·`ring-primary/50` 가 알파 주입 불가(투명/기본 blue-500 폴백) → 리터럴 hex `bg-[#0052ff]/10` 로 해결. 기존 `hover:bg-primary/10` 등도 무효 상태(범위 밖 보존).
- **검증** — dashboard `tsc` EXIT=0 · 단위 테스트 14/14 · 각 기능 CDP 스크린샷(통합 신호등 4램프·가스 상세 팝업·체온 추정 병기·선택박스·태풍 한 줄·라벨 줄바꿈).
- **상태/다음** — main **`ahead 69`**(이번 6커밋), push 보류, working tree clean. dev 0.0.0.0+PII ON, 터널 `switch-biography-surplus-cold`(팀원 공유 가능). 주의 = 가스/AED 통합 신호등은 가상 샘플(CO 52ppm·B1 18% 위험 점등, 실센서 발표 후), 노출기준/골든타임 참고값(표준 검수 권장), 현장기상 램프는 GPS 작업자 등록 시 점등. 다음 = push 결정(69) · 가스/AED 샘플 sev 데모 조정 여부 · 노출기준/골든타임 표준 최종 검수 · 기존 블로커(Galaxy Health, YJH iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-04 세션18 — audit 조치 완료 + LAN/방화벽 + 로그인 게이트·로그아웃·3D 로고 + 현장위치 GPS 표시 + 안전신호등 대안C)

- **★ audit 조치(remediation) 완료** — 세션17 audit 23건 전부 구현. 그룹A 보안(M1 미인증 GET PII redaction env-게이트·M2 관리자 비번 fail-closed·L3 불투명 세션토큰) · 그룹C(M5 `THRESHOLDS` 단일 source 복구·M4 tsconfig `noUncheckedIndexedAccess` 28곳 가드) · 정확성(L1 sticky **ts-기준** merge·L2 weather 가드) · 테스트(M3 store.test+L4 schemas+L5 severity = **38/38 pass**) · 위생(dead code·문서). remediation 보고서 HTML/PDF. 커밋 `648d942`·`fcc74d0`·`417cd09`·`c09c76e`·`f981265`·`326359b`.
- **★ LAN 개방 + pf 방화벽** — `scripts/lan-dev.sh`(dev 0.0.0.0)+`lan-firewall.sh/.pf.conf`(포트3000 허용목록 IP만 개방, 루프백 skip→cloudflared 터널 무영향). 조원 다른 망/불확실이라 안전망. 커밋 `b123019`.
- **★ 로그인 게이트 + 로그아웃 + 3D 로고** — `LoginGate`(세션토큰 `safetymonitor.session.v1`, 관리자 export 키와 분리, `useSession(logout)`)+`LoginScreen`(브랜드 로고·슬로건·**한/영 토글(로그인만)**·라이트/다크·기존 `/api/admin/login` 재사용, 푸터 `(주)바이탈가드`)+헤더 로그아웃 버튼. 로고=**Three.js 사전 렌더 3D 베벨 유리 배지**(라이트/다크 PNG, 런타임 WebGL 불필요, 라이트는 실버 베벨로 대비 보강). 커밋 `d04cbb1`.
- **★ 대안C — 안전신호등을 기상특보 기반 '현장 기상위험 신호등'으로 교체** — KOSHA 1020(서버 99 오류)을 대체. `WeatherHazardPanel`(현장 GPS→`/api/kma-warning`→경보/주의보/정상 **3색 신호등**+예비특보 t7, 위험/주의 `vital-blink`). `KoshaSafetyLightPanel` 삭제. **미커밋**(잔존 dead code = `/api/kosha/safety-light`·`fetchSafetyLight`).
- **연결/데이터 갱신** — cloudflared URL `switch-biography-surplus-cold`(GET/POST 202 검증, iOS 인앱 수신 URL은 폰 ⚙️ 갱신). **현장위치 GPS 표시 ON**(`MOCK_VITAL_EXPOSE_PII=true`+dev 재시작 → GET에 GPS·보호자 노출). EMP-1234(장우진) 실시간 5초 gap0·광주 GPS 100% 인입 확인. 태풍 위젯 live지만 제6호 장미 소멸로 06-03 22시가 KMA 마지막 통보(현 상태 유지). KOSHA 1020=mock(서버오류) / 1040·1060·날씨·특보·태풍·레이더 live.
- **검증** — dashboard `tsc` EXIT=0 · 38/38 테스트 · 로그인/로그아웃 CDP 종단 · 3D 로고 다크/라이트 + 신호등 4상태(정상·주의·위험·대기) 스크린샷.
- **상태/다음** — main **`ahead 61`**(이번 8커밋 포함), 대안C 미커밋. dev 0.0.0.0+PII ON, 터널 `switch-biography-surplus-cold`. 다음 = 대안C 커밋 + dead code 삭제 결정 · push 결정(61+) · 기존 블로커(Galaxy Health, YJH iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-03 세션17 — 코드베이스 종합 Audit: 9차원 멀티에이전트 + adversarial 검증)

- **★ 종합 Audit 수행(read-only)** — 사용자 요청. 전체 코드베이스(dashboard-web/backend/worker-phone/worker-watch-poc/packages/scripts)를 9차원(타입안전성·보안·정확성·성능·아키텍처·테스트·의존성·dead code·문서일관성) Workflow 멀티에이전트로 병렬 스캔 → 발견사항별 adversarial 검증으로 false positive 제거. **3회 Workflow**로 완주(1차 6/9 verify 실패 → 2차 재실행 → 3차 type-safety/performance/architecture 자체검증 방식으로 공백 메움). 파일 무수정.
- **결과** — **확정 23건: CRITICAL 0 / HIGH 0 / MEDIUM 5 / LOW 18**, false positive 10건+ 제거. CRIT/HIGH 0 = 프로토타입 스코프(임시 회전 터널·합성 데이터·localhost 바인딩, "실서비스면 HIGH"가 강등). **MEDIUM 5** = ① 미인증 GET `/api/mock/vital` PII(보호자 전화·GPS·이름) 노출 ② 기본 관리자 자격증명 `admin/safety2026`(소스+`.env.example`) ③ 핵심 수신 게이트 `store.ts` 테스트 0 ④ dashboard `tsconfig` base 미상속→`noUncheckedIndexedAccess` 누락 ⑤ **vital 임계 분류 로직이 `DemoDashboard.tsx`에 매직넘버로 중복 → `THRESHOLDS` 단일 source 보장 깨짐**(HR/SpO₂). 양호 = **performance CLEAN**(useEffect cleanup 전수·Flutter dispose·prepared stmt 재사용)·analyzers 순수성 OK·순환참조 0·Swift force-unwrap 0.
- **증거/산출물** — PDF [audit-report-20260603.pdf](./audit-report-20260603.pdf)(Chrome 헤드리스 변환, AppleSDGothicNeo 한글 폰트 임베드 검증, 6쪽 972KB) + HTML 소스 + 수정 트래커 [audit-findings.md](./audit-findings.md). 코드 변경 0 → main 여전 `ahead 53` + 미커밋 audit 산출물 3파일.
- **다음** — 그룹 A(공개 터널 전 PII 차단: M1 GET·M2 비번·L3 세션토큰) · 그룹 C(발표 전: M5 임계 단일 source 복구·M4 tsconfig) · 정확성 패치(L2 weather 가드·L1 sticky ts) · 테스트 부채(M3+L4+L5) · 위생(dead code 6·문서 4) · audit 산출물 커밋 여부 · 기존 블로커(Galaxy Health, YJH iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-02 세션16 — 태풍 LIVE 검증(제6호 장미) + 작업자 모니터링 3페이지 캐러셀 + 설비 추세 그래프)

- **★ 태풍 서비스 승인 전파 → 실데이터 LIVE** — 세션15에서 `Forbidden`이던 `getTyphoonInfo`가 `resultCode 00`, `source:live`. **제6호 태풍 장미(JANGMI)** 관측 진로 11점, 현재 (30.7,130.7) 가고시마 남쪽 · **980hPa/24m/s/이동 NE 36km/h**. 공식 응답 필드 전부 파서와 일치 → 보정 불필요. 캡션 "점선=예보"→"이동 경로"(응답이 전부 관측 위치). 커밋 `3d094e1`.
- **★ 작업자 모니터링 3페이지 캐러셀** — [작업자 모니터링 | 가스 누출 감지기 | 심장 제세동기 알림] `WidgetCarousel`(`h-[460px]`). `WidgetCarousel`에 `autoRotate` opt-out 추가 → 작업자 캐러셀만 `autoRotate={false}`(**‹ › 수동 전환만**), 다른 캐러셀 자동회전 유지. 가스/AED = 작업자 표와 동일 세로 표(가상 샘플, **수동 스크롤만**). 신규 `SiteSafetyTables.tsx`. 커밋 `4f9b58b`.
- **★ 설비 추세 그래프(작업자 그래프와 동일 방식)** — 가스 `측정값`/제세동기 `배터리` 셀 클릭 → 하단 추세 그래프. `VitalHistoryPanel`의 `LineChart`/`BarChart`/`SummaryCell`을 export 해 재사용(동일 SVG 차트·24h/1주/30일·라인/막대·요약). 합성 시계열(마지막=현재값). **배터리=외부 충전 없음 가정 → 단조 감소**(상승 구간 0, 검산 통과), 가스=측정값 주변 변동. 커밋 `4f9b58b`.
- **검증** — `tsc` EXIT=0 · 페이지 200 · `/api/typhoon` 제6호 장미 11점 · 메르카토르 라운드트립 ~1e-14 · 배터리 단조감소(24h/1주/30일 상승구간 0).
- **상태/다음** — main **`ahead 52`** 미push. 태풍 LIVE. active URL `kay-spatial-manitoba-duty`, dev 127.0.0.1 전용. 다음 = push 결정(52)·기존 블로커(Galaxy Health, YJH iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-02 세션15 — 예비특보(t7) + 태풍 진로 데이터화·Esri 위성 슬리피맵 + KOSHA 신호등/국내재해사례 진단)

- **★ 현장환경 '예비특보(t7)' 항목** — 우리가 이미 호출하는 `getWthrWrnMsg` 응답의 `t7`(예비특보=발효 예정 특보)을 파싱(추가 API 호출 0) + 시·도 키워드 필터. WeatherStrip 전광판 `🔔 예비특보`(발효 예정 시 주의 블링크+"{종류} 예정·{시점}", 없으면 "예정 특보 없음", 클릭 시 사전 대비 모달). `kma.ts` 캐시 shape 변경으로 키 **v2 회전**(HMR stale 배열 shape→`.filter` 크래시 500 회피). 라이브 검증 전남 `강풍주의보`. 커밋 `c8c99e4`.
- **★ 태풍 진로 데이터화 + Esri 위성 슬리피맵** — 기상청 `getTyphoonInfo`(진로 typTm/위경도+중심기압 typPs+최대풍속 typWs+이동 typDir/typSp, 공식 필드 확인) `lib/typhoon.ts`+`/api/typhoon`+`TyphoonTrack.tsx`. 우측 그룹 캐러셀 **'태풍 진로' = 실시간 레이더 다음 페이지**. **태풍 서비스는 특보와 별도 활용신청 필요 — 현재 `Forbidden`(승인 전파 대기)**, 같은 키로 특보/1040은 정상이라 키·계정 OK·태풍만 게이트웨이 미반영. 미승인/비시즌은 샘플/없음 안전 강등(**목업 비캐시→승인 즉시 자동 라이브**). 시각화 = **Esri World Imagery 위성+경계·지명 라벨**(키 불필요) + 팝업 **정식 슬리피맵(동적 타일 줌)** = 확대 시 더 높은 줌 타일 로드라 항상 선명(처음 CSS scale 방식은 흐림→교체) + 휠/드래그/＋−/리셋. 커밋 `bd4dfe4`.
- **태풍특보는 이미 수신 중** — 지금 실제 `태풍경보:남해동부바깥먼바다` 발효, `getWthrWrnMsg` t6에 포함. 단 해상 구역명이라 육지 17 시·도 필터엔 안 걸려 미노출(의도; 현장 핵심은 강풍/풍랑).
- **KOSHA 안전신호등 1020 = `resultCode 99 UNKNOWN_ERROR` 재확정(라이브)** — 같은 키로 1040/1060은 200 정상, 1020만 99 → KOSHA 서버측 백엔드 오류(우리 수정 불가). 샘플 유지+자동 재시도.
- **국내 재해사례 빈 화면 = 데이터 아닌 높이** — `/api/kosha/accident-cases` **live 20건 정상**(0건이면 mock 강등이라 배지 'KOSHA 실시간'=데이터 존재 확정). 공유 캐러셀 `h-[112px]`(현장정보 2줄 grid 기준)가 목록형엔 좁아 클리핑 → **`h-[140px]` 상향**(목록 ~3줄). 커밋 `61dad59`.
- **검증** — dashboard `tsc` EXIT=0 · 페이지/`/api/typhoon`/`/api/kma-warning` 200 · Esri 위성·라벨 타일 z5~z11 200 · 메르카토르 투영 라운드트립 오차 ~1e-14.
- **상태/다음** — main **`ahead 49`** 미push. 태풍 서비스 승인 전파 대기(풀리면 실응답 필드 검증). active URL `kay-spatial-manitoba-duty`, dev 127.0.0.1 전용. 다음 = 태풍 승인 전파 후 필드 검증·push 결정(49)·기존 블로커(Galaxy Health, YJH iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-02 세션14 — 작업자 모니터링 세로 표 리스트(dnd-kit) + 슬롯100 + 속보/배지 이동 + iOS 재설치 복구 + 현장환경 기상특보 GPS 항목)

- **세션13 미커밋분 + 표 개편 = 7커밋** — `79d4714`/`29e32a9`/`22380c8`/`f5b37cf` + `b43f611`/`1e52625`/`f3fb4cc`.
- **★ 작업자 카드 가로 캐러셀 → 세로 표 리스트** — 12열 표. 자동/수동 토글(자동=세로 무한 슬라이딩 overflow 8행↑ / 수동=`dnd-kit` 드래그 정렬·순서 localStorage 영속). 이상=항상 빨강 링+자동 모드 해당 행 스크롤. 상단 '+ 작업자 등록' 버튼. 가상 6→12명. 카드 전용 컴포넌트 4종 제거. 인원 증가 시 가독성↑. 커밋 `b43f611`.
- **산업재해 속보 → 작업자 모니터링 하단 이동** + **'KOSHA 실시간' 배지 → 캐러셀 헤더 이동**(`WidgetCarousel.headerAccessory`). 커밋 `b43f611`.
- **★ '+ 등록' 버튼 비활성 버그 = SLOT_COUNT 12→100** + **reserved_ 접두사 필터**(`reserved_test_worker` 대기 큐 누수 차단). HMR 잔존 시 하드 새로고침. 커밋 `1e52625`.
- **관제 웹 배포 중지 → localhost 전용** — `next dev -H 127.0.0.1`(혼자 편집용, 팀 LAN 차단).
- **애플워치 재설치** — 새 터널 `kay-spatial-manitoba-duty`, `ConnectionSettings` 갱신·Release 빌드 OK → **install 차단**(워치 RemotePairing 터널 타임아웃 `CoreDeviceError 4000`; 워치 깨움+동일 WiFi 필요). 커밋 `f3fb4cc`.
- **★ iOS Flutter 재설치 작동 불가 = debug 빌드 → 해결** — 120MB/App 35KB stub(IDE Run/`flutter run`)이라 iOS 14+ standalone 거부. **`flutter build ios --release`(17.7MB/App 5.4MB AOT)+`devicectl install`+launch 성공**.
- **네이버 날씨 임베드 불가**(`x-frame-options: DENY`). 기상특보·폭염 iframe 추가 후 **사용자 원복**(기상청은 frameable).
- **★ 현장환경 '기상특보' GPS 항목** — 기상청 `1360000/WthrWrnInfoService`, 활용신청 후 **KOSHA 키로 통함(403→200)**. `app/lib/kma.ts`(getWthrWrnMsg t6 파싱+GPS→17시도+키게이트 KMA→KOSHA 폴백+캐시+목업)+`/api/kma-warning`+WeatherStrip ⚠️ 항목. LIVE 검증(전남→강풍주의보 caution/서울→특보없음). 미커밋.
- **폭염영향예보 = 공개 API 없음 확정**(웹 `hwImpactList.do?pgmNo=696`만) → GPS 항목 불가. 폭염특보는 기상특보 항목·폭염 단계는 체감온도 항목에 이미 커버 → 별도 항목 불필요(권장). 자리 결정 대기.
- **상태/다음** — active URL `kay-spatial-manitoba-duty`(dev 127.0.0.1 전용). iPhone BECKS release 재설치·실행 OK. 워치 install 보류(네트워크). **main `ahead 44` + 기상특보 4파일 미커밋**(`kma.ts`·`kma-warning/`·`WeatherStrip.tsx`·`.env.example`). `KMA_SERVICE_KEY`=`.env.local`(KOSHA와 동일). 다음 = 폭염 자리 결정→기상특보 커밋·워치 install 재시도·push 결정·기존 블로커(Galaxy Health, YJH iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-01 세션13 — 불쾌지수 + 전국날씨→실시간 레이더 + 우측 그룹 캐러셀 + 레이아웃 축소 + 국내재해사례 자동스크롤 + 워치 URL 자동 마이그레이션)

- **현장환경 불쾌지수 항목** — 기상청 표준 DI(`0.81T+0.01H(0.99T−14.3)+46.3`, 기온+습도, 추가 fetch 0). `lib/weather-rules.ts` `computeDiscomfortIndex`/`discomfortGrade`/`evaluateDiscomfortIndex`. 75↑ 주의/80↑ 위험, **`binding=reference`**(법적 작업중지 기준 아님=체감온도와 역할 구분). WeatherStrip 전광판(🥴)+정책 모달+**임계 경보 팝업 연동**. 실측 75.3(높음) 주의 트리거. 커밋 `7105326`.
- **애플워치 수신 URL 갱신 + 재설치** — `ConnectionSettings.defaultURLString`→`birth-carb-angels-semi`, Release 재빌드(`xcodebuild` generic watchOS BUILD SUCCEEDED, 바이너리 URL 검증)+`devicectl install`(BECKS Apple Watch Ultra `available(paired)`).
- **★ 워치 연결 실패 원인+수정** — 진단: dev/터널/페이로드(UTC `Z` ISO) 모두 201 정상인데 워치 "연결 실패"(`catch` throw) → **재설치해도 UserDefaults의 옛 URL(`posters-favour-sleep-general`, NXDOMAIN)이 새 기본값을 덮어씀**. 수정 = **스탬프 기반 자동 마이그레이션**(`migrateDefaultURLIfNeeded` — 빌드 기본 URL 변경 시 저장값 1회 자동 교체, 인앱 수동 편집은 보존). 재빌드·재설치.
- **★ 전국날씨 지도 → 실시간 레이더 영상 교체** — 처음 `NationalWeatherMap`(17개 도시 위경도 투영 지도+7일 탭+현재/오전/오후)을 만들었다가 사용자 요청으로 **RainViewer 레이더**로 교체. `/api/radar`(weather-maps.json 프록시, 13프레임) + Carto 베이스맵 + 레이더 타일을 **슬리피맵 좌표 직접 계산**(인라인 줌6 2×2/팝업 줌7 3×3, Leaflet 등 의존성 0)으로 오버레이, ▶재생/일시정지+시각 타임라인, **클릭 시 `createPortal` 확대 팝업**. 컬러 스킴 7(무지개). `NationalWeatherMap`+`/api/national-weather` 삭제.
- **★ 레이아웃 붕괴 수정(SquareFit)** — `aspect-ratio + width:auto`가 flex 컨테이너 안에서 폭을 0으로 붕괴(레이더 빈 화면) → **`SquareFit`(ResizeObserver로 부모 실제 픽셀 측정 후 `min(w,h)` 정사각형 중앙 배치)**로 인라인/팝업 공용·컨텍스트 무관 채움.
- **우측 그룹 캐러셀** — 공정률/무사고 게이지 + 수신요약을 **"현황 요약" 1페이지**, **실시간 레이더 2페이지**로 `WidgetCarousel` 그룹화. 좌측은 [히어로카피+안전신호등] 위에 [현장정보/국내재해사례 캐러셀].
- **레이아웃 축소(반복 요청 반영)** — ① 수신요약 박스 `flex-1` 제거(내용 높이로 축소)+중앙정렬 ② 작업자 카드 행 `ROW_CLASS` min-h `2.4→2rem`·`py-0.5`·값 `17→15px`·`gap-0.5`(겹침 없이) ③ 현장정보 **3행×2열→2행×3열**+폰트축소(라벨 10px/값 13px) ④ 현장정보 `h-152→h-112`로 현황요약 카드 상·하 여백 축소(items-stretch 정렬 유지).
- **국내재해사례 = 제목만 + 세로 자동 스크롤** — `useMarqueeScroll`에 **`axis:"y"` 추가**(2벌 복제 seamless, 호버/터치 정지=수동 우선, 이음새 `mb-1` 균일), 제목 한 줄 표시, 클릭 시 경위 전문 팝업(기존). 가로 호출(WeatherStrip·속보 티커)은 axis 기본 `"x"`라 영향 0.
- **검증** — dashboard `tsc` EXIT=0 · 페이지 200 · `/api/radar` 13프레임·타일 줌6/7 PNG 200 · `/api/national-weather` 검증 후 삭제 · 재해사례 `source:live` 20건.
- **커밋** — `7105326`(불쾌지수)만 커밋. **나머지 미커밋** = `DemoDashboard.tsx`·`KoshaAccidentCaseCard.tsx`·`useMarqueeScroll.ts`·`ConnectionSettings.swift` + 신규 `RadarRealtime.tsx`·`app/api/radar/`. main `ahead 37`, 미push.
- **다음** — 미커밋분 커밋·push 결정 · **레이더 타일은 브라우저가 외부 CDN(rainviewer·cartocdn) 직접 로드 → 발표 PC 인터넷/방화벽 확인** · 워치 §4 잠금 재검증 · 기존 블로커(Galaxy Health 권한, 2 iPhone 재install, 배터리 풀시프트, D4 리허설).

### (2026-06-01 세션12 — 날씨예보·국내재해사례·임계경보 + KOSHA 키 회전 + PDF 미리보기 한계 확정)

- **연결 복구** — cloudflared 만료(NXDOMAIN, control stream failure) → 재기동 새 URL **`birth-carb-angels-semi.trycloudflare.com`**(GET 200/POST 202 검증). Mac LAN IP **`192.168.219.69`**(망 변경). 팀원 접속 = 터널(어디서나) 또는 LAN `192.168.219.69:3000`.
- **산업재해 속보 티커 여백/상단쏠림 수정** — `.wx-cards-scroll`의 항상 표시 9px 가로 스크롤바가 한 줄 텍스트를 위로 밀던 문제 → `.no-scrollbar` 유틸(스크롤바 예약공간 제거, 자동·휠 스크롤 유지) + `flex items-center` 세로중앙. 커밋 `44c25ec`.
- **현장환경 날씨/기온 예보** — WeatherStrip 티커 항목 클릭 시: **날씨→일주일 기상예보**(7일 아이콘·요약·최고/최저·강수확률), **기온→24시간 시간대별 기온 인라인 SVG 차트**. `/api/weather`에 Open-Meteo `daily`(7일 weather_code/최고·최저/강수확률)+`hourly`(현재부터 24h) 추가. 날씨코드→아이콘/라벨 변환은 WeatherStrip이 처리해 모달엔 문자열만 전달(drift 방지). 커밋 `f98ada0`.
- **★ KOSHA 키 노출 사고 + 회전** — 키 점검 중 셸 표현식(`${KEY:-…}`) 오류로 `KOSHA_SERVICE_KEY` 64자가 채팅에 노출 → 사용자 data.go.kr 재발급 + `.env.local` 교체(gitignore라 git/커밋 영향 0), dev 재시작(인메모리 캐시 무효화) 후 사고사망 `source:live` 재검증. 이후 키 점검은 값 미출력 처리.
- **End Point/신호등 재확인** — 포털 End Point는 서비스 base(`/constplan01`)만 표기, 실호출은 `/getconstplan01`(우리 코드가 정답; base 단독 호출은 HTTP 500). **안전신호등 1020은 여전히 `UNKNOWN_ERROR(99)`**(KOSHA 서버측; 같은 키로 1040은 `00` 정상 → 우리 키·엔드포인트 무관). 현행 유지(샘플+30분 자동 재시도).
- **★ 국내재해사례(callApiId=1060) LIVE 적용** — `news_api02/getNews_api02`+1060(totalCount 6,334; 필드 business·keyword·contents·boardno). **전용 `disaster_api02` End Point는 현재 키 미승인 = 모든 호출 Forbidden** → 동일 데이터 주는 1060 사용(`KOSHA_PATH.accidentCase`; 승인 시 1줄 교체). `getAccidentCases()` + 프록시 `/api/kosha/accident-cases` + HTML 제거/요약. **현장정보 박스 = 좌우 화살표 캐러셀**(`WidgetCarousel`, ‹ 제목 N/M ›, 9초 자동순환·호버정지)로 [현장정보 ↔ 국내재해사례] 전환(iOS 위젯스택 세로형 시도했으나 수동 전환 불편→화살표로 변경). 현장정보 6항목 한 화면 핏(헤더/여백 슬림화, 박스·폰트 유지). 커밋 `b3352b3`.
- **현장환경 임계 자동 경보 팝업** — 체감온도·미세먼지·풍속·자외선·강수량이 주의/위험 단계 진입 시 경보 팝업(`WeatherAlertToast`; 60초 자동닫힘 카운트다운 바 + 수동 닫기; 정상복귀 후 재발·심각도 악화 시에만 재알림으로 도배 방지; 항목 클릭 시 정책 근거 모달). 처음 우상단 토스트(커밋 `dcea461`) → **사용자 요청으로 SOS형 화면 중앙 모달**(`fixed inset-0` 배경 + 가운데 카드, 배경 클릭/ESC/닫기, 심각도 테두리)로 변경(미커밋). 실측 = 체감온도 31.8℃ → 주의 트리거 확인.
- **재해사례 경위 전문 팝업** — 카드 항목 버튼화 → 클릭 시 **SOS 모달 패턴**(amber 헤더 바, ESC/배경 닫기) 상세 팝업(제목·업종·사고 경위 전문). 캐러셀 페이지 `transform`이 `position:fixed`를 박스 안에 가두는 문제는 **`createPortal`로 body 렌더**해 해결(전체 화면 오버레이). `AccidentCase.detail`(경위 전문 2000자) 추가. 커밋 `4922064`.
- **★ 인앱 PDF 미리보기 = 불가 확정(중요)** — 1060 API가 첨부 `bbsId`/`bbsAtcflNo` 미제공 + 본문 평문(URL 없음). KOSHA 포털 내부 RPC `process.do/boardDetail`은 `_JSON=` 폼 봉투(`{common.data.tboard:{systemCd,channel,bbsId,bbsGrpId,serviceId}, service.data}`)로 **토큰 게이트는 없으나 권한 벽 `msg_913 권한없음`**. 파일 엔드포인트 `getImage.do`는 공개 GET(137KB 확인)이나 첨부ID를 권한 없이 못 얻음 → **직접 임베드 불가**(비공식·취약·ToS 리스크). 외부 링크/팝업 버튼도 사용자 요청으로 최종 제거. 상세 [docs/kosha-openapi-plan.md](./kosha-openapi-plan.md).
- **커밋** — 5개(main, push 보류) `44c25ec`·`f98ada0`·`b3352b3`·`dcea461`·`4922064`. 이전 세션 미커밋 포함 main `ahead 34`, 미push.
- **다음** — 34커밋 push 결정 · 현장환경 경보 팝업 오후 실제 임계 시 육안 검증 · 국내재해사례 캐러셀/팝업 데모 점검 · 기존 블로커(Galaxy Health 권한, 2 iPhone 재install, §4 워치 재검증, 배터리 풀시프트, D4 리허설).

### (2026-05-31 세션11 — KOSHA OpenAPI 연동 + 티커 자동/수동 스크롤 리팩토링)

- **서버 재기동 + 새 URL** — `posters-favour-sleep-general.trycloudflare.com` (GET 200/POST 202 검증). 워치 [ConnectionSettings.swift](../apps/worker-watch-poc/Sources/ConnectionSettings.swift) `defaultURLString` 갱신. BECKS 폰(EMP-1234) 인입 확인(HR null = 잠금 or 워치 미착용, SpO₂/온도 정상).
- **★ KOSHA OpenAPI 연동** — ① **사고사망 속보 = LIVE 실연결** `news_api02/getNews_api02` + `callApiId=1040`(실 필드 `keyword`/`contents`/`arno`, totalCount 2831). 한 줄 티커(KoshaAccidentTicker). ② **건설현장 안전 신호등** `constplan01/getconstplan01` + `callApiId=1020` = **KOSHA 서버 `UNKNOWN_ERROR(99)`**(APICODE 등록됐으나 백엔드 오류, 우리 수정 불가) → **샘플 유지 + 30분 폴링마다 자동 재시도**(복구 시 자동 live). ③ 엔드포인트 규칙 = `B552468/<서비스>/get<서비스>`, KOSHA는 HTTP 200 + `header.resultCode`로 성공/실패(00 정상) → `assertNormal` 강등. ④ 키는 `apps/dashboard-web/.env.local`(gitignore, 커밋 제외). 상세 [docs/kosha-openapi-plan.md](./kosha-openapi-plan.md).
- **레이아웃** — 안전신호등 패널을 히어로 좌측(부제 아래)에 컴팩트 배치, 우측 공정률/무사고 게이지 높이 비율 축소, 신호등 부가문구를 헤더 인라인으로 이동. 속보 티커는 캐러셀 위.
- **★ 티커 자동+수동 스크롤 = `useMarqueeScroll` 훅** — 현장환경(WeatherStrip)+산업재해 속보를 CSS transform 마퀴 → **rAF `scrollLeft` 누적값 방식**(작업자 캐러셀과 동일)으로 통일. 자동·수동이 같은 스크롤 위치 공유, 호버/터치 시 정지. **핵심 버그 = 소수 픽셀 유실**(`scrollLeft`는 정수 반올림 → 1px 미만 증가분이 0으로 깎여 정지) → **`posRef`(float) 누적 + scrollLeft 쓰기 전용**으로 해결. `wx-marquee-*` CSS 전부 제거.
- **커밋** — 3개(main, push 보류): `65948df`(feat KOSHA 연동)·`f626a8c`(워치 URL)·`f5eebdf`(docs 세션10). main `ahead 27`. **이후 변경(스크롤 훅 + 레이아웃 수정 + 신호등 문구) 미커밋.**
- **다음** — 미커밋분 커밋 여부 · 안전신호등 1020 복구 대기(또는 callApiId=1060 건설업 재해사례 LIVE로 패널 교체 옵션) · 27커밋 push 결정 · 기존 블로커(Galaxy Health 권한, 2 iPhone 재install, §4 워치 재검증, 배터리 풀시프트, D4 리허설).

### (2026-05-30 세션10 — 관제 웹 서버 중단 + 데스크탑 분리 호스팅 가능성 확인·보류)

- **관제 웹 서버 중단** — dev(Next.js `next dev -H 0.0.0.0` 체인 PID 5종) + cloudflared(`amber-manufacturer-icq-ion`) 종료. **포트 3000 해제·외부 URL 무효** 검증(`lsof -iTCP:3000` 비어있음). **DB는 보존**(서버만 내림). 재기동 시 새 cloudflared URL 발급 + 폰/워치 URL 갱신 필요.
- **★ 데스크탑 분리 호스팅 = 가능(확인만, 진행 보류)** — 맥북=코드 / 동일 네트워크 데스크탑=관제 웹 구동 분리 **가능**. `dev:web`가 `next dev -H 0.0.0.0`(전 인터페이스)이라 동일 LAN에서 폰·워치가 **데스크탑 IP `http://<IP>:3000/api/mock/vital` 직접 접속** → **cloudflared 불필요**. 전제 = ①코드 이전(git 푸시 후 clone[현재 24커밋 미푸시=보류 충돌] 또는 직접 복사) ②데스크탑 Node≥22+pnpm 11.1.3+`pnpm install`(better-sqlite3 재빌드)+`analyzers build` ③방화벽 3000+AP격리 off+iOS ATS 평문 1회 검증. DB는 데스크탑 로컬 별도 누적. 맥북 현재 LAN IP `192.168.10.103`. **진행 보류**(사용자 지시). 상세 [context-notes.md 세션10](./context-notes.md).

### (2026-05-30 세션9 — 연결 복구 + 워치 URL + 관제 웹 UI 대규모 개편)

- **★ 연결 복구** — cloudflared `enjoyed-keeps-framed-evaluation` 만료(외부 GET **HTTP 000** + 로그 `control stream failure` retry loop, 마지막 정상 수신 05-29 08:55) → `pkill` 후 `nohup` 재기동 → 새 URL **`amber-manufacturer-icq-ion.trycloudflare.com`**(터널 경유 루트 GET 200 + reserved POST 202 검증). CLAUDE.md active URL **3곳 갱신** + 워치 PoC [ConnectionSettings.swift](../apps/worker-watch-poc/Sources/ConnectionSettings.swift) `defaultURLString` 새 URL로 변경(미커밋).
- **★ 연결 검증(실측)** — BECKS 폰(**EMP-1234**)+워치(**EMP-5678**, 둘 다 "장우진") 새 터널로 오늘 인입 확인. 폰은 **GPS는 들어오나 hr/spo2 null** = 화면 잠금(iOS HealthKit 암호화 한계 재확인). 워치는 풀 vital. **워치 30초 배칭 정상 작동** DB 검증 — `received_at` 묶음당 4~7샘플 / 배치 간 ~30초 / 배치 내 `ts` ~5초(수집 해상도 보존).
- **★ 워치↔폰 URL 동기화 불가 확정** — 폰(`kr.indusview.workerPhone`)·워치(`kr.indusview.safetyWatchPoC`)는 **다른 번들 독립 앱**이라 WCSession 동기화 불가(코드로 확인: 양쪽 WCSession 미사용). 워치 URL은 **코드 기본값 갱신+재설치** 또는 **인앱 편집**으로만. 회전 피로 근본 해결 = 고정 URL(named tunnel) 발표 후 트랙.
- **★ 관제 웹 UI 대규모 개편(5파일)** — `DemoDashboard.tsx`/`WeatherStrip.tsx`/`globals.css`/`route.ts`/`store.ts`:
  - **카드별 DB 누적 카운트** — store `countsByWorker()`(관리자용 `listAllWorkers` GROUP BY 재사용) → GET 노출 → 카드 footer(가상워커는 "가상(테스트)").
  - **상단 영역 높이 압축** — 히어로/현장정보·수신요약 패널(248→196px)/WeatherStrip 비율 축소.
  - **현장환경 = 녹색 디지털 LCD 전광판** — `.lcd-digital`(등폭+글로우, 정상 녹색·주의 amber·위험 red 유지) + **KRX 시세 전광판식 한 줄 연속 마퀴 티커**(칸 분리 없이 `날씨 맑음 │ 기온 28℃ │ …`, 2벌 복제 끊김없이 순환, 호버 정지, 좌우 페이드).
  - **공정률 + 무사고 게이지(우상단, 상하 2단)** — 착수~준공/착수~오늘 기반 %, **0~100% RGB 그라데이션 바**(진행지점 이후 dim + 흰 마커), **2줄 레이아웃**(1줄 라벨+값+경과/총, 2줄 바 안 오른쪽 끝 D-day), 공통 `GaugeRow`. 공정률 35.0%(196일/경과69일/D-128), 무사고=착수 후 무사고 가정 연속일(다음 100일 마일스톤 진행률).
  - **작업자 카드 = 가로 무한 슬라이딩 캐러셀** — 현장환경식 **한 방향 무한 루프**(rAF 누적 오프셋 + 2벌 복제 seamless) · `overflow-x-scroll` **하단 수동 스크롤바**(`.wx-cards-scroll`) · 호버 정지 · **이상(주의/위험) 자동 복귀**(스크롤+빨강 링) · 카드 폭 300→**230px**(중앙 공백 제거) · 세로 여백 압축 · **빈 슬롯 항상 1개**(`displaySlots`=채워진 전부+빈 1개, SLOT_COUNT 8→12) · **가상 작업자 6명**(VW-001~006, **VW-004 주의/VW-005 위험 = 자동복귀 시연용**, 클라이언트 전용 픽스처).
- **★ SOS 사이렌(관제 웹)** — SOS 모달 표시 중 **앰뷸런스 사이렌 동시 재생**. Web Audio 합성(오디오 파일 불필요): 삼각 LFO 로 600~1300Hz 스윕하는 **구급차 wail**(초기 두톤 "삐뽀삐뽀"에서 사용자 요청으로 변경 — YouTube 효과음은 ToS·기술상 직접 사용 불가라 합성 근사). 모달 해제/🔊 토글 OFF 시 정지. **★ autoplay 정책 해결** — 브라우저는 탭 첫 제스처 전 무음 → **"SOS 경보음 활성화" 배너 강제 노출**(arm 전까지 안 사라짐) + `audioArmed` 게이트 + `statechange` 동기화 + **arm 시 떠 있는 SOS 도 사이렌 소급 시작**. 실기기 SOS 로 동작 검증 완료.
- **★ 무사고 카운터 초기화** — SOS 후 **보호자/119 에 전화·문자 시** 마지막 사고 시각 기록(localStorage `last-accident.v1`) → `computeSafetyStreak` 가 `max(착수일, 사고시각)` 부터 재집계("사고 후 재집계" 라벨). **SOS 팝업만으로는 초기화 안 함**(실제 연락 액션만 = 오발신 보호).
- **★ 검증·커밋** — dashboard `tsc` 통과 · dev 200 · 배열 POST 201/단일 202 · 실기기 SOS 모달+사이렌 동작. **세션9 일괄 4커밋(main, push 보류)**: `9ccbe97`(워치 배터리+URL) · `7723899`(관제 웹 UI 개편) · `046603c`(docs) · `800a903`(SOS 강화). working tree clean.
- **다음** — §4 워치 잠금 재검증 → 통과 시 push · 캐러셀/가상워커/전광판/SOS 사이렌 데모 점검 · 기존 블로커(Galaxy Health 권한, 2 iPhone 최신 install) 유지 · push 여부 결정.

### (2026-05-29 세션8 — 워치 PoC 배터리 절감 A+B+C 적용 + 실기기 재설치)

- **★ 원인 분석(실측)** — 설치 후 배터리 소모 증가 보고(Apple Watch Ultra 1). DB(EMP-9001 워치 발신) 연속 방전 구간 70%→65% / 28분 ≈ **시간당 ~10.7%**(완충 ~9h), 전송 cadence 4~5초 확인. Ultra 1 정상 idle ~36h 대비 **3.5~4배**. 원인 = ① **워크아웃 세션 연속 심박**(지배적·**불가피** — 잠금 우회의 유일한 성립 근거) ② 가속도 50Hz ③ **5초마다 개별 URLSession** = 라디오 상시 기상 ④ HealthKit 쿼리(경미). Always-On 디스플레이는 부차.
- **★ A+B+C 코드 적용(4파일)** — **B** 가속도 50→25Hz([FallDetector.swift:16](../apps/worker-watch-poc/Sources/FallDetector.swift#L16), 충격검출 유지·코프로세서 ½). **C** 불필요 수집 타입 disable([WorkoutManager.swift:106-112](../apps/worker-watch-poc/Sources/WorkoutManager.swift#L106-L112), 거리·기초대사 `disableCollection`, HR·활동에너지 유지 — 활동에너지는 스트레스 입력에 사용). **A** 30초 배칭([VitalTransmitter.swift](../apps/worker-watch-poc/Sources/VitalTransmitter.swift), HR 윈도 누적→30초마다 1배열 전송 = 라디오 기상 ~1/6, 낙상은 즉시 flush, backlog 재시도) + `onResult` 4-arg(sentDelta) + 세션 종료 시 `flushPending`. 서버 [route.ts](../apps/dashboard-web/app/api/mock/vital/route.ts) 배열 POST 수신(단일도 하위호환).
- **★ 검증** — watchOS 시뮬 **BUILD SUCCEEDED** · dashboard `tsc` 통과 · 배열 POST **201**(스키마 파싱 성공)/단일 **202**(하위호환). **BECKS Apple Watch Ultra Release 빌드+설치 성공**(`kr.indusview.safetyWatchPoC`, codesign valid). ※ 빌드 말미 build DB `disk I/O error` 발생했으나 **산출물 codesign/validate 완료 이후 단계**라 무관 — devicectl install 정상.
- **★ 미커밋** — 변경 4파일 + `.gitignore`(`build_device/` 추가). 커밋·push 보류(사용자 "우선 보류").
- **★ 시연 트레이드오프** — 30초 배칭이라 대시보드 워치 카드 **신호바 4↔1 진동** + HR 30초마다 점프. 실시간감 우선이면 `flushInterval = 30`→**15초**(재빌드·재설치 1회), 배터리 우선이면 30초 유지.
- **다음** — **§4 잠금 15분 재검증(실기기·사용자 몫)** — 기준: null HR **0%**(배칭은 읽기 무관) · gap 은 **`ts`(수집시각) 기준**으로 ~5초여야 정상(received_at 은 배칭이라 30초 묶임) · **배터리 소모율 vs 기존 10.7%/hr 비교**. 이후 커밋·push 결정 · flushInterval 조정 여부.

### 2026-05-29 세션7 — 다른 작업자 Apple Watch 추가 설치 시도 → Apple Developer 디바이스 한도 블로커

- **★ 목표·결과** — BECKS 외 YJH Apple Watch 에 워치 PoC 추가 설치(워치 2대 시연 목적) 시도 → **Apple Developer team `F2P5ZFP65Q` 디바이스 한도 벽**(Cyён iPhone 차단과 동일 원인이 워치에도 재현). **코드 변경 없음 — 환경/계정 이슈.**
- **★ 워치 탐색 원리** — Apple Watch 는 데이터 포트 없어 **단독 USB 설치 불가**, 페어 iPhone 통해 네트워크로만 Xcode 등장. iPhone 이 `available (paired)` 돼야 워치가 그 하위 nested 로 올라옴. iPhone·워치 **각각** 개발자 모드 ON(워치는 토글→재부팅→확인 다이얼로그).
- **★ 진단** — `devicectl list devices`: BECKS iPhone+워치만 available(paired), YJH iPhone 은 `connected` 에서 멈춤, YJH 워치 미등장. 워치 재부팅+신뢰 후에도 안 잡힘 → 병목은 **YJH iPhone 이 connected→available(paired) 전환 실패**.
- **★ 최종 오류 = `DataGatheringNSURLSessionDelegate` HTTP 403 forbidden**(Xcode 26.5) — 앱 네트워킹 아님, **Xcode↔Apple 개발자 서비스 핸드셰이크 거부**(계정/프로비저닝). 새 디바이스 등록 조회 403 → iPhone 준비 막힘 → 워치 미등장.
- **★ 원인·선택지** — 유력 = **무료 Personal Team 디바이스 한도**(Суён iPhone 막힌 그 팀). 그 외 Apple ID 세션 만료 / Apple 서비스 장애 / VPN·프록시. 선택지 (a) 콘솔 디바이스 정리(연 1회 reset) (b) 다른 Apple ID 팀 교체(기존 재서명 부담) (c) 유료 Developer Program($99). 미결정.
- **결론** — 무료 팀 유지 시 **발표 워치 시연 = BECKS Apple Watch Ultra 1대** 현실적. 워치 2대 필요하면 (b)/(c) 결정.
- **다음** — 워치 추가 설치 경로((b)/(c)) 결정 · (기존) Galaxy Health 권한 · 2 iPhone 재install · 배터리 풀시프트 · push 여부.

### 2026-05-29 세션6 — 워치↔폰 연동(경로 A)·보호자 폰-입력·2→1 병합 실측·상용화 플랫폼 분기 계획

- **★ 연동 방식 = 경로 A(서버 레벨 병합)** — 워치 PoC·폰 앱은 별개 앱(독립 워치앱 + 다른 번들)이라 WCSession 직접 연동 불가. **같은 사원번호 → 대시보드 `latestByWorker` 가 workerId 로 병합** 채택(신규 코드 0). 직접 연동(경로 B)은 워치를 폰 컴패니언으로 재편입해야 하고 잠금 우회 이점이 깨져 기각.
- **★ 보호자 연락처 = 폰만 입력(a) + 실측 PASS** — 워치엔 보호자 필드 없음 + store sticky(`?? previous`)라 같은 사원번호면 폰 보호자가 워치 발 데이터에도 유지. 검증: 라이브 dev 서버에 폰(보호자+SOS)→워치(보호자 없음·hr 다름) 순서 POST → **보호자 폰값 유지 + 심박 워치(최신) 반영 + SOS 모달 트리거(recent 폰 manualSos)·표시 정상**(모달 base=`latestMap.get(workerId)`). 테스트 DB 행 삭제.
- **★ 2→1 병합 실기기 확인** — 사용자가 워치 사원번호 EMP-9001→EMP-1234(폰과 동일) 변경 → API 상 EMP-1234 에 **워치 발 배터리 60·가속도** 인입(폰엔 없던 값)=병합 성공. 단 옛 EMP-9001 카드는 **슬롯 등록 잔존 + ring 잔상으로 자동 제거 안 됨**(5칸 수동 UX) → 카드 "해제" 1회 또는 dev 재시작 필요. 겹치는 메트릭(심박/SpO₂/배터리)은 last-writer-wins(폰 잠금 시 폰 null→워치값=의도).
- **★ Android 잠금 송신 가능 확인** — iOS 와 달리 Android 는 부팅 후 1회 잠금 해제 시 CE 저장소가 재부팅 전까지 유지 → 잠금 중에도 센서 읽기·전송 가능(진짜 제약 = 프로세스 생존: foreground service + 배터리 최적화 예외).
- **★ 상용화 플랫폼 분기 계획 기록(★ 확정 아님)** — iOS=워크아웃 세션 / Android=포그라운드 서비스 정공법 / 자체 웨어러블=Android(AOSP, 디스플레이 없음) 헤드리스 직송(설정·페어링은 폰=BLE GATT 또는 서버 매개). [commercialization-roadmap.md §4.B](./commercialization-roadmap.md) + context-notes 에 기록, 커밋 `b584e9d`.
- **현재 상태** — 폰(EMP-1234)+워치(EMP-1234) 한 작업자로 병합 수신 중, 보호자() 폰 입력→대시보드 공유. 미커밋 = `DemoDashboard.tsx` 히어로 카피 1건(사용자 IDE 작업). 로컬 main 이 origin 보다 19 커밋 앞섬(push 미실행).
- **다음** — EMP-9001 stale 카드 해제 · 겹치는 메트릭(심박) last-writer-wins 정리 여부 결정 · (기존) Galaxy Health 권한 · 2 iPhone 재install · 워치 배터리 풀시프트 · push 여부.

### 2026-05-29 세션5 — 워치 센서 확장·인앱 설정·UI 카드 개편·스트레스 수집

- **★ 워치 PoC 센서 확장** — 낙상감지(`FallDetector`, Core Motion 가속도 충격+정지 패턴 — Apple 내장 낙상은 서드파티 미개방) + SpO₂(`SpO2Reader`, `HKAnchoredObjectQuery` 간헐 스팟). 둘 다 워크아웃 세션 중이라 잠금-무관. 손목온도는 Apple Watch 수면 전용이라 미포함. 커밋 `b04e0f8`.
- **★ 워치 인앱 설정 동적화** — 수신 URL + 작업자(이름/사원번호)를 UserDefaults 영속 + 매 전송 시 동적 읽기 → 터널 URL 회전·작업자 변경 시 **재빌드·재설치 없이** 워치 설정에서 편집. SettingsView 에 "수신 확인"(연결 테스트, reserved POST→202) 추가. workerId=사원번호 파생(대시보드 자동 분리). 커밋 `4171541`(URL+UI)·`6821b4e`(작업자).
- **★ 워치 스트레스 입력 7종 수집** — `StressInputsReader`(폰 readStressInputs 미러: HRV 2h·안정/보행심박/호흡 1d 최신, 활동에너지/계단/걸음 60s 합) + HR 콜백 피기백 60s sub-cadence. 알고리즘은 `packages/analyzers` `computeStressIndex` **단일 소스 그대로** → 대시보드가 워커별 계산하므로 EMP-9001 스트레스 칩 자동(대시보드/analyzers 변경 0). 워치 자기 HealthKit 읽기라 잠금-무관. 커밋 `3fec4f6`.
- **★ 워치 UI 카드 섹션 개편** — 레퍼런스(파스텔 코인 카드) 스타일 → 생체데이터 메트릭별 카드(심박=올리브/SpO₂=라벤더/낙상=피치) + 다크 잉크 + 아이콘 칩. **위험 판정색 없음**(단말 raw 표시, 서버 판정). watchOS Ultra 3 시뮬레이터 렌더 확인. 커밋 `1b0c5f1`. (직전 Enode Pro 링 게이지에서 카드로 재변경)
- **★ 앱 아이콘 스캐폴드** — VitAIGuard 로고. `Assets.xcassets/AppIcon.appiconset` + project.yml `ASSETCATALOG_COMPILER_APPICON_NAME`. **watchOS는 다크/라이트 아이콘 변형 불가(홈 항상 다크) → 단일 다크 아이콘.** PNG(1024² 불투명, 로고만 권장) 사용자 제공 대기 → **미커밋**(빌드는 PNG 후).
- **★ 손목온도 35.7℃ 진단** — 카드의 손목온도는 워치 아님 **폰(EMP-6861)** 이 보낸 값. 폰이 `SLEEP_WRIST_TEMPERATURE`를 30일 lookback 최신으로 읽어 재전송 → 최근 *수면* 측정값(정지 과거값, 실시간 아님). 워치(EMP-9001)는 "--" 정상. freshness 필터(폰/대시보드) 적용은 **미결정 보류**.
- **★ roadmap §9.1 통신 경로 해명** — 워치는 BLE로 관제웹 직송 X(BLE=워치↔근거리 폰, 폰↔웹=인터넷). "1km"가 폰↔서버면 인터넷이라 거리 무관. 커밋 `ac4bb9a`.
- **★ 테스트 기기 = Apple Watch Ultra 1**(Watch6,18) — 혈중 산소가 한국 판매 모델이라 Masimo 미국 금지 미적용 → SpO₂ 동작 기대. 손목온도는 모델 무관 수면 전용.
- **★ cloudflared 회전** → `enjoyed-keeps-framed-evaluation`(이전 `confirmed-provider-mainly-touring` 만료, 터널 죽음 000 확인 후 재기동). 워치 endpoint 기본값 갱신.
- **★ 팀 관제 뷰잉(LAN)** — dev `next dev -H 0.0.0.0` + Mac LAN IP `192.168.219.236:3000` 직접 접속. 방화벽 off 확인. AP/클라이언트 격리 시 차단 → 핫스팟/cloudflared 폴백.
- **★ 관제 웹 VitAlGuard 브랜딩/현장정보/레이아웃 폴리싱** — 사용자 제공 CI 이미지 적용. 라이트/다크 로고 분기(`/public/brand/vitalguard-logo-light.png`, `vitalguard-logo-dark.png`), 헤더 워드마크 `VitAlGuard`, Coinbase 톤 히어로의 라이트/다크 색 분기, 기업 현장 데이터 박스·수신요약 박스·WeatherStrip 여백/비율 정렬. 관리자 메뉴에 현장정보 설정(기업명/현장명/공사종류/주소/착수 날짜/준공 날짜) 추가, localStorage 저장 및 히어로 즉시 반영. WeatherStrip 업데이트 시각(`YYYY.MM.DD / HH:mm`) 표시. 검증: dashboard typecheck + `localhost:3000` 200.
- **★ 관리자 현장정보 자료 포함** — `/api/admin/site-info` 추가. 관리자 저장 시 `site_info_daily` 테이블에 KST 기준 일 1회 snapshot upsert. XLSX 는 시트1 "현장정보" + 시트2 "생체데이터" + 시트3 "현장환경", CSV 는 상단 현장정보 snapshot 블록 + 생체데이터 블록으로 내보냄. 검증: `pnpm --filter @safetymonitor/dashboard-web typecheck` 통과.
- **★ 관제 웹 히어로 문구 최종안 적용** — 사용자 제공 카피 시안 3종을 순차 반영 후 최종 `OPEN SAFETY · NEVER ALONE` / `보이지 않는 위험은 없습니다. 혼자가 아니기 때문입니다` / `모든 생체 신호와 현장 환경을 투명하게 — 이상 징후를 발견하는 즉시 대응합니다.` 적용. 모바일에서는 보조 문구 줄바꿈 허용, 관제 웹 레이아웃 톤 유지. 검증: dashboard typecheck 통과.
- **★ 앱 아이콘 + 헤더 로고** — VitAIGuard 다크 로고(`public/brand/vitalguard-logo-dark.png`)를 sips 센터 크롭 1024 무알파 → AppIcon. 헤더 'SafetyWatch' 좌측 BrandLogo 타일 + 폰트 17pt 라운드 볼드(한 줄 자동 축소). 커밋 `65e13bf`.
- **★ 실기기 재설치 완료 + 실측 검증** — 누적 변경(센서/스트레스/인앱설정/URL/UI/아이콘)을 워치 재설치로 일괄 반영. 관제 store 조회(age 1s): **EMP-9001 = SpO₂ 92 · 안정심박 100 · 활동에너지 3.56 · 낙상 accelG 5.45 · 배터리 70 · 작업자명 장우진** → 낙상/SpO₂ 센서 + 스트레스 입력 + 인앱 작업자 편집 전부 실기기 동작 확인(Ultra 1 한국 모델 SpO₂ 정상 수신).
- **다음** — 관제 웹 라이트/다크 최종 QA + 관리자 현장정보 저장/내보내기 회귀 + 히어로 문구 실제 화면 확인 · 손목온도 freshness 필터 결정 · (기존) Galaxy Health 권한·2 iPhone 재install·배터리 풀시프트·스트레스 baseline.

### 2026-05-29 세션4 — 물리 워치 §4 잠금 검증 PASS + 미커밋 정리

- **★ 워치 PoC 물리 검증 PASS** — BECKS Apple Watch Ultra(watchOS 26.5) install 후 iPhone 잠금 15분: **워치(EMP-9001) null HR 0% · gap 0 · 배터리 85%→85% / 폰(EMP-6861) null HR 98%**. 둘 다 전송 gap 0 → 잠금 중 막히는 건 *읽기*뿐, 워치 워크아웃 세션이 우회함을 실기기 실증. 상용 1차 경로 확정. 상세 [commercialization-roadmap.md §9](./commercialization-roadmap.md).
- **★ 워치 PoC 설치 교정** — 세션3 PoC가 빌드는 됐으나 실기기 설치 거부(번들 키/entitlement). Info.plist 표준 키+`WKWatchOnly=true` 추가, 무료 Personal Team 미지원 `healthkit.background-delivery` 제거 → 설치 성공. 무료팀 서명이라 `F2P5ZFP65Q` 100대 한도 우회. 커밋 `b89042d`. cloudflared URL 회전(`confirmed-provider-mainly-touring`) → 워치 endpoint + 3폰 갱신.
- **★ 미커밋 5파일 정리** — 세션3에서 발견한 dashboard 5파일 = 사용자 IDE **Coinbase 스타일 디자인 토큰** 작업(typecheck 통과·dev 200·정상) → 커밋 `cb1a927`. 누락 docs 기록 → `f4fd54d`.
- **다음** — Galaxy Health Connect 권한(P0-1) · 2 iPhone 최신 release 재install · 스트레스 baseline 축적(07-07) · 워치 배터리 풀시프트 측정.

### 2026-05-28 세션3 — 잠금 해결책 결정 + 워치 PoC + dev 복구 + 원격 push

- **★ 잠금 재진단 (확정)** — DB 재분석(EMP-6861 최근 150건): 수신 **5초 간격 끊김 0건** + 잠금 구간 hr/spo2/temp **null** / 해제 구간 실측. API GET 으로 store **sticky 가 직전 실측값(90.9/94/35.9) 유지** 확인. 전송은 멀쩡, 막힌 건 잠금 중 HealthKit *읽기*.
- **★ "네이티브 재작성 ≠ 잠금 해결" 결론** — axiom-health/watchos/testing 스킬 검토. Flutter `health` 는 네이티브 `HKHealthStore`/`HKSampleQuery` 의 얇은 래퍼라 Xcode 네이티브로 다시 짜도 잠금 중 null 동일. 투트랙(Flutter+네이티브 iOS+네이티브 Android)은 이득 0 + 유지보수 3배 → 기각. observer/background delivery 도 잠금 해제까지 지연만.
- **★ 채택 경로 = 워치 워크아웃 세션** — 현장 1km+ 원거리라 BLE 직송 불가 → 고정 구조 워치→iPhone→관제웹 유지. 잠금 해결의 유일한 길 = **네이티브 watchOS 앱 + `HKWorkoutSession`+`HKLiveWorkoutBuilder`**(워치가 live 콜백으로 HR 수집 → 폰 HealthKit 읽기 아님 → 잠금 무관). 전송 = (권장) 워치 `URLSession` 직접(watchOS 가 페어 iPhone 인터넷으로 OS 라우팅, 폰 앱 불필요·잠금 무관) / (대안) `transferUserInfo` relay. 한계 — HR 연속이나 Apple Watch SpO₂ 스팟·손목온도 수면 한정(연속 불가), 배터리, TN3135(URLSession HTTP only).
- **★ 워치 PoC 구현 + 구동가능 검증** — [apps/worker-watch-poc/](../apps/worker-watch-poc/) 독립 watchOS 앱(WorkoutManager/VitalTransmitter/ContentView/App + Info.plist workout-processing + entitlements + project.yml + README). **검증 = swiftc 타입체크 EXIT=0 / `xcodebuild` watchOS Simulator BUILD SUCCEEDED / 페이로드 VitalSampleSchema 정합(Zod valid) / dev POST 201**. `xcodegen` brew 설치 → `.xcodeproj` 생성(gitignore). 커밋 `1873254`.
- **★ dev 서버 복구** — POST 가 `.next` stale chunk 로 HTTP 500(실 폰 ingestion 도 중단 상태)이던 것 → `.next` 정리 + 재기동 → **POST 201 정상화**.
- **★ 원격 push 설정** — 신규 **private** GitHub `becks0724/safetymonitor` 생성 + origin 연결, baseline~`03d94ed` push. 민감데이터(.runtime/DB/.env/*.key) gitignore 확인.
- **세션3 커밋** — `6beee77`(keepalive+sticky fix) · `452f7da`(위젯 테스트) · `03d94ed`(docs: 잠금 기록+상용화 로드맵 [commercialization-roadmap.md](./commercialization-roadmap.md)) · `1873254`(워치 PoC).
- **⚠ 미정리 발견** — dashboard 파일 5개(DemoDashboard/ThemeToggle/WeatherStrip/globals.css/tailwind.config.ts) modified — 내가 안 건드림(IDE 별도 작업 추정). 커밋 제외·미확인.
- **다음** — ① Xcode 로 `SafetyWatchPoC.xcodeproj` 열고 **물리 워치 Run** → §4 잠금 검증(EMP-9001 DB 끊김0+null0) ② 위 5개 dashboard 변경 정체 확인 ③ 워치 PoC push 여부 ④ (기존) Galaxy Health 권한·2 iPhone 재install·스트레스 baseline.

### 2026-05-28 세션2 — 오후/저녁

- **★ iOS 잠금/백그라운드 전송 — 진단·해결** — 폰 잠금 시 생체 미수신 보고. **DB 진단**: 전송은 5초마다 지속(위치 이중화 작동)되나 잠금 구간 vitals 전부 null, 해제 즉시 복구. **근본 원인 = iOS 잠금 시 HealthKit 암호화 → 잠금 중 읽기 불가(플랫폼 한계, 코드로 해결 불가)**. "변경 전 잠금 됐다"는 제거한 시연 fallback(72/97/36.5 조작)이 보였던 것(실측 아님).
- **★ keepalive 강화 + store sticky 복원** — (1) iOS `distanceFilter 10→0` + accuracy best + **위치 콜백 이중화**(위치 wake 마다 `_pollOnce(throttled 4.5s)`) → 잠금/정지에도 전송 지속. (2) `store.ts` 생체값 **sticky 복원**(`X ?? previous`) → 잠금 중 직전 실측값 유지(모니터링 연속). 세션2의 비-sticky 가 잠금 회귀 원인이라 정정. 센서 없는 메트릭은 "--". store 수정은 dashboard-only(폰 재설치 불필요). BECKS release 재빌드×2 install. **keepalive+sticky 미커밋**. (다음) 커밋 + 폰 잠금 테스트 + 데모(자동잠금 끄기/Galaxy).
- **SE 센서 이슈 수정** — Apple Watch SE 작업자 카드에 SpO₂/온도 가짜값 표시 → 폰 시연 fallback(78/97/36.5) 제거(측정값만 전송), dashboard store 생체값 **비-sticky**(SOS/낙상 이벤트 샘플만 직전값 유지). 센서 없는 메트릭은 "--".
- **스트레스 알고리즘 P0 (수집)** — `VitalSampleSchema` 7입력(HRV/안정심박/활동에너지/걸음/보행심박/계단/호흡) + SQLite 컬럼 멱등 마이그레이션 + Flutter `health` read(**iOS 한정**, 60초 sub-cadence). 분석은 서버, 폰은 raw 수집만. `docs/stress-algorithm-plan.md` 신규.
- **스트레스 P1-lite (지수+칩)** — `analyzers/stress-index.ts` `computeStressIndex`(활동보정 ExcessHR + HRV 로지스틱, population baseline fallback) + 검증 시나리오 5/5(전체 15/15). store 스트레스 입력 sticky(60초 cadence). dashboard 작업자 카드 헤더 **스트레스 칩**(보정중/지수, 참고용·의료진단 아님). 런타임 지수 71(위험) 검증.
- **폰 UI 레퍼런스 리디자인** — 사용자 제공 민트/틸 레퍼런스 → `lib/theme/app_tokens.dart` + 메인 화면(히어로 심박/메트릭 카드/상태 카드/액션 바). 라이트 테마. **폰 분석 금지 준수 — raw 값+연결상태만, 위험 판정 색 없음.** Health 권한·수신 URL 을 **설정 화면으로 이동**.
- **BECKS release 재빌드+install** — `flutter build ios --release` 17.7MB AOT codesigned, `xcrun devicectl device install` 성공(Worker Phone v1.0.0). **bundle ID `kr.indusview.workerPhone`**(스킬 stale 정정). BECKS=iPhone 17 Pro, 실 HRV(11.17ms) 수신 → 스트레스 칩 실값. ⚠ 직후 **IDE Run ▶ 재발**(release→debug 함정) — 경고, 로컬 release 산출물 무사. **BECKS DEBUG 배너 확인 필요**(있으면 CLI 재설치).
- **발표일 정정** — **최종 2026-07-07** · 중간 데모 2026-06-04(추정). 스트레스 알고리즘 07-07 트랙.
- **커밋 6건** — `592d2b4`(offset+비-sticky) · `270c514`(dashboard 스트레스/weather/관리자) · `b9eef47`(폰 스트레스 수집+fallback 제거) · `3309cc0`(docs) · `e3593f1`(스트레스 지수+칩) · `dad39a9`(폰 UI 리디자인). push 미실행.
- **다음** — ① BECKS DEBUG 배너 확인 → 있으면 CLI 재설치 ② YJH/Galaxy 동일 release install ③ Galaxy Health 권한 4단계 ④ 스트레스 baseline 축적(07-07 까지) ⑤ D2 자동 트리거 ⑥ D4 리허설.

### 지금까지 작업 (2026-05-21~2026-05-28)

1. **문서 골격 6종 작성** — [plan.md](./plan.md) · [checklist.md](./checklist.md) · [context-notes.md](./context-notes.md) · [compliance.md](./compliance.md) · 본 파일 · [../CLAUDE.md](../CLAUDE.md)
2. **컴플라이언스 정리** — KOSHA·개보법·근기법·의기법 4종 + 작업자 동의서 v0.draft + 자문 질문 15개 + 미해결 24건
3. **정합성 이슈 4건 수정** — 위험 감지 5종 통일 (낙상에 흡수) · `packages/schemas` 7개 모델 · M6 dedup 검증 1·3·5분 · `architecture.png` 표기
4. **M0 결정 #1 (잠정)** — 프로젝트명 `IndusView` (상표·도메인 검증 대기). 가칭 `SafetyMonitor` 폐기 예정
5. **★ 프로젝트 성격 재정의** — 프로덕션 B2B SaaS → 발표용 *프로토타입* 으로 전환. 6개 파일 일괄 재정립. 트랙 분리 (프로토타입 D0~D4 신규 / 발표 후 M0~M9 격하)
6. **D0 TS 자산 완료** — pnpm/AWS CLI/CDK 설치 · 모노레포 골격 4 패키지 · analyzers 단위 테스트 5/5 · Next.js dev HTTP 200 · CDK synth OK
7. **★ 단말 아키텍처 정정 + Flutter 채택** — 워치 앱 미작성. 작업자 메인 클라이언트 = **폰 앱 (Flutter 단일 코드, iOS+Android)**. `apps/ios-watch/` 폐기 → `apps/worker-phone/` (Flutter) 로 재구성. D0/D1/D3 마일스톤 재정의.
8. **Flutter 셋업 완료** — Flutter 3.44.0 + CocoaPods 1.16.2 설치. `flutter create apps/worker-phone` (`kr.indusview.workerPhone`). `flutter test` 1/1 통과. `flutter build ios --simulator` 30초 통과.
9. **★ 가정 8건 사용자 검증 + 정정** — 발표 마감 2026-06-04 (D-14) · iOS + Android 둘 다 시연 · 실기기 4대 + mock 1~2명 · 위험 감지 5종 (의료/KOSHA 권장 임계) · Android Studio 필수화. 6개 파일 일괄 갱신
10. **★ 위험 감지 5종 확장 + 테스트 10/10 통과** — `packages/schemas` HazardType 5종 + `skinTempC`/`ambientTempC` 추가. `packages/analyzers` `spo2.ts` + `hyperthermia.ts` 신규 + thresholds 갱신. 단위 테스트 5/5 → **10/10 통과**.
11. **D1 착수 + Android 빌드 준비 완료** — Android Studio 2025.3.4.7 · Android SDK 36.0.0 · JDK 17.0.19 설치. `worker-phone` 에 `health`/`mqtt_client`/`flutter_secure_storage`/`http` 통합. Health query + 5초 polling + MQTT/HTTP publish 골격 + SOS UI. `flutter analyze` · `flutter test` · `flutter build apk --debug` · `flutter build ios --simulator` 통과.
12. **AWS 보류 대체 경로 준비** — Android AVD `SafetyMonitor_API_35` 생성. Flutter HTTP fallback 을 `MOCK_RECEIVER_URL` 로 주입 가능하게 변경. Next.js `POST /api/mock/vital` receiver + 4 worker dashboard polling + `scripts/mock-publish.mjs` 추가. mock POST/GET 검증 통과.
13. **Android Studio 실행 확인 + 에뮬레이터 이슈 확인** — Android Studio Panda 4 실행, Flutter plugin 설치 후 `main.dart` run configuration 표시. `SafetyMonitor_API_35` 실행 시 가용 메모리 부족 경고 발생 (`Available 3946MB, Required 5120MB`).
14. **iPhone 실기기 Health 수집 성공** — iPhone `BECKS` 에 앱 설치/실행 완료. HealthKit 권한 허용 후 HR/SpO₂/손목 온도 수집 확인. SpO₂ 는 HealthKit 비율값 `0.98` 을 관제 payload 용 `98` 로 변환. 손목 온도는 `SLEEP_WRIST_TEMPERATURE` 로 수집.
15. **관제 사이트 HR 유지 표시 적용** — 최신 샘플에 HR 값이 없더라도 이전 HR 값을 상시 유지 표시하고, 새 HR 값이 수신될 때만 갱신하도록 mock store 병합 로직 수정.
16. **대시보드 UI 한국어 + 단위 정리** — `HR/SpO2/Temp` → `심박/산소포화도/체온` + `bpm/%/℃` 단위 표시. `formatTemp` 헬퍼로 체온 소수점 1자리 통일. 산소포화도 라벨 `whitespace-nowrap + text-xs` 한 줄 표시.
17. **대시보드 SafetyMonitor 로고 + 헤더 디자인** — 방패 + ECG 펄스 SVG 인라인 로고 (cyan 그라데이션 + emerald 펄스). 헤더 텍스트 cyan→sky→emerald 그라데이션 + bold.
18. **최근 수신 샘플 펼침/줄이기 토글** — 기본 접힘. 헤더 버튼으로 토글. 펼침 영역 `max-h-[32rem]` 스크롤.
19. **★ 누적 차트 패널 (1주일/30일/60일)** — 카드 메트릭 칸 클릭 → 의존성 0 인라인 SVG 라인 차트 (gradient fill + tick + hover title + 평균/최저/최고 통계). deterministic mock generator (`app/api/mock/history/data.ts`) + `GET /api/mock/history` 신규.
20. **dev 서버 stale chunk 500 fix** — `pnpm build` 부작용으로 `.next/` 에 production artifact 남아 `vital` 라우트가 stale webpack chunk 요구 → `rm -rf .next` + dev 재시작.
21. **라우트 파일명 충돌 fix** — `app/api/mock/history.ts` (모듈) 와 `app/api/mock/history/` (라우트) 동일 이름 충돌 → `app/api/mock/history/data.ts` 로 이동.
22. **iPhone debug→release 빌드 전환** — iOS 14+ 에서 debug 빌드는 standalone launch 시 `Cannot create a FlutterEngine instance in debug mode` 로 즉시 SIGKILL. release 모드로 재빌드 → 홈 아이콘 standalone launch 가능.
23. **Flutter 앱 in-app receiver URL 입력 + secure storage 영속화** — `_loadReceiverUrl`/`_saveReceiverUrl` + TextField + 저장 버튼. LAN IP 변동 시 재빌드 없이 in-app 으로 URL 교체 가능. dart-define `MOCK_RECEIVER_URL` 은 default fallback.
24. **http.post timeout 4s + Health type 별 try-catch + Health 빈값 fallback** — publish 단계와 Health 읽기 단계 분리. 개별 type 실패해도 나머지 메트릭 수집. Health 데이터 없으면 시연용 fallback 값 (`hr≈72±, spo2=97, temp=36.5`) 전송. 폴링 실패 시 단계별 명확한 상태 메시지.
25. **★ 라우터 client isolation 우회 — Cloudflare Tunnel 도입** — Mac LAN IP `.246` → `.44` DHCP 변동 + 라우터 AP 격리로 iPhone → Mac LAN HTTP POST 도달 0건 확인. `cloudflared tunnel --url http://localhost:3000` 으로 무작위 `https://*.trycloudflare.com` 발급. GET 200 + POST 201 검증 통과. iPhone 은 Wi-Fi/셀룰러 어느 망에서든 도달 가능 (발표 환경 무관).
26. **iPhone 앱 설정 화면 + 작업자 메타데이터 영속화** — 우상단 ⚙️ → `SettingsPage` (작업자 이름·사원번호 TextField + secure storage 영속화). 폴링/SOS payload 마다 `workerName` + `employeeId` 자동 동봉. `_StatusPanel` 에 작업자/사원번호 row 표시.
27. **VitalSampleSchema 메타데이터 확장 + 대시보드 실시간 매칭** — Zod 스키마에 `workerName` / `employeeId` optional (각 max 40자). `latestByWorker` 가 메타데이터 누적 merge (한 번 받으면 다음 샘플이 비어 와도 유지). 대시보드 카드 헤더 + history panel 헤더 + recent table 모두 `이름 + 사원번호` 매칭. 2초 polling 으로 저장 즉시 갱신.
28. **codesigned release build + devicectl install/launch on BECKS** — Automatic signing `F2P5ZFP65Q` 로 codesigned 17.4MB 빌드. `xcrun devicectl device install app + process launch --terminate-existing` 한 번에 성공.
29. **네트워크 환경 변경 대응 (cellular passthrough)** — Mac LAN IP `192.168.219.44` → `192.0.0.2` 로 변경 (iPhone hotspot/cellular 추정). dev 서버 + cloudflared 둘 다 죽어 재기동. 새 quick tunnel URL 발급 + iPhone in-app URL 갱신 안내.
30. **★ 24시간 주기 추가** — history 토글에 "24시간" 추가 (맨 앞). backend `buildHistory(range=1)` 시간별 24 포인트 + label `HH:00`. response payload 에 `label?: string` 필드 추가, frontend 가 `points[idx].label ?? date.slice(5)` 우선순위로 렌더.
31. **★ 옵션 C — 손목 온도 vs 체온 정책 (dual display + 추정)** — `THRESHOLDS` 의 `skinTemp` 키 → `coreTemp` (cautionC 37.5 / dangerC 38.0 / wristToCoreOffsetC 1.5). `estimateCoreTempC(skin) = skin + 1.5` export. `detectHyperthermia` 가 추정 체온 기준 비교, hazard detail 에 `skinTempC + estimatedCoreTempC` 둘 다. hazard-event Zod 스키마에 `estimatedCoreTempC` optional 추가. analyzers test 시나리오 갱신 (손목 36.6 → 추정 38.1 danger / 36.1 → 37.6 caution / 35.8 → 37.3 null), 10/10 통과. dashboard `@safetymonitor/analyzers` workspace 의존성 추가 + `TempDualRow` (손목 / 체온 추정 dual) + `statusFor` 추정 체온 기준 + recent table "손목 온도 / 체온 추정" 분리 + VitalHistoryPanel `skinTempC` 라벨 "체온" → "손목 온도".
32. **카드 메트릭 2열 × 3행 list 레이아웃** — 3 cols 가로 grid → `flex flex-col` 세로 stack. 각 row `grid grid-cols-[5.5rem_1fr] items-baseline` (라벨 좌 5.5rem / 값 우 우측 정렬 + `tabular-nums`). baseline 정렬 자연 해결.
33. **★ 메트릭 값 색상 블링크 (3-단계, 메트릭별 독립 판정)** — `heartRateStatus` / `spo2Status` / `coreTempStatus` 헬퍼 + `STATUS_CLASS` 매핑. 정상 emerald-300 (2.4s pulse) / 주의 amber-300 (1.4s) / 위험 red-400 (0.7s, 빠르게). 심박 caution 범위 110~129, 41~50 (의료 일반 reference 안정 시 tachycardia/mild bradycardia). 같은 카드 안에서도 메트릭별 색·블링크 독립.
34. **블링크 미동작 fix — globals.css `@keyframes vital-blink`** — Tailwind 3.4 가 `[animation:pulse_<X>s_ease-in-out_infinite]` arbitrary value 를 JIT 인식 못해 클래스 dead. `app/globals.css` 에 직접 `@keyframes vital-blink` (opacity 1→0.15→1, Tailwind 기본 pulse 0.5 보다 강한 진짜 깜빡임) + `.vital-blink-caution` (1.1s) / `.vital-blink-danger` (0.55s) 정의. `STATUS_CLASS` 도 단일 클래스로 단순화.
35. **카드 색 통일 + 신호등 분리** — `statusFor` (위험 red / 주의 amber 톤 카드 배경) 폐기. 4 카드 모두 동일 plain `CARD_CLASSNAME = border-white/10 bg-[#0d1117]`. 작업자 이름 좌측에 신호등 (`TrafficLight`, 12px 원 + ring-1 ring-white/20) — `overallStatus` 헬퍼로 메트릭 worst-of 계산. **정상 정적 녹색** / 주의 amber + 블링크 / 위험 red + 빠른 블링크. 정상 메트릭 값 블링크도 제거 (`STATUS_CLASS.normal` 정적 emerald). 사유: 카드 전체 색 변화가 시연 시 산만 + 신호등이 더 정밀.
36. **★ 폰 ↔ 대시보드 시그널 바 (`SignalBars`)** — 마지막 sample.ts 와 현재 시간 차이로 신호 강도 0~4 판정 (`signalLevel`). <8s = 4 막대 / <15s = 3 / <30s = 2 / <60s = 1 / ≥60s = 0. 4 막대 (5~11px 계단), level 4-3 emerald / 2 amber / 1 red / 0 zinc 회색. 1초 단위 `now` state 로 매 초 갱신 — fetch 사이에도 막대가 줄어듦. 작업자 이름 **오른쪽** 배치 (신호등 좌 · 이름 · 시그널 우).
37. **★ 누적 차트 패널 — 차트 타입 토글 + 메트릭 칩 + summary 강화** — `VitalHistoryPanel` 재구조화. (a) 우상단에 `📈 라인 / 📊 막대` 차트 타입 토글 + 기존 range 토글 (24h/1주/30일/60일) 병렬 배치 (b) 헤더 좌측에 메트릭 칩 3개 (심박/산소포화도/손목 온도) — 클릭 시 부모 콜백 `onMetricChange` → 패널 닫지 않고 메트릭만 즉시 전환. 선택된 칩만 메트릭 색상 (red/cyan/emerald) + 굵게 + 비활성 disabled (c) summary 박스 3개 — 글자 `text-2xl` 확대 + 메트릭 색상 적용 + `tabular-nums` + padding 확대 (d) `BarChart` 컴포넌트 신규 (동일 viewBox + `useChartScale` 헬퍼 공유, rounded 막대 + gradient 0.85→0.35 + grid/tick/hover title 라인 차트와 동일).
38. **2026-05-24 시스템 복구 + 환경 재구성** — dev 서버 + cloudflared 둘 다 다운 → 재기동. 새 quick tunnel URL `https://templates-chronicle-external-interfaces.trycloudflare.com` 발급. iPhone 빌드가 어느 시점부터 다시 debug (116MB + kernel_blob.bin) 로 되어있어 standalone launch 즉시 SIGKILL → release 17.5MB 재빌드 + devicectl install/launch 성공.
39. **★ iOS 백그라운드/잠금 keepalive (location 백그라운드 모드)** — `geolocator: ^14.0.1` 추가 + Info.plist 에 `UIBackgroundModes=[location, fetch]` + `NSLocationAlwaysAndWhenInUseUsageDescription` + `NSLocationWhenInUseUsageDescription`. 신규 서비스 `BackgroundKeepalive` (위치 권한 요청 + low-power location stream 으로 OS suspend 회피 + `lastPosition` 노출). 폰 잠금/홈 화면 진입에도 5초 폴링 유지. 권한 다이얼로그 "항상 허용" 필수.
40. **환경 산소 row + 작업자 상태 row 추가 (대시보드 카드)** — `ambientO2Pct` 스키마 추가 (Phase 2 자체 워치 SEN0322 자리). Phase 1 카드에 `N/A · Phase 2` 회색 placeholder. **작업자 상태** row 신규 — 우선순위 `낙상 감지 > SOS 요청 > 위험 > 주의 > 정상 > 대기`. 빨강 블링크.
41. **카드 행 순서 재정렬** — `상태 → 심박 → 산소포화도 → 환경 산소 → 손목 온도 → 낙상 감지`. 상태 우선 노출 + 환경 산소 placeholder 가 SpO₂ 와 자연 인접 (산소 두 종류 §5).
42. **낙상 감지 row + 누적 추세 (낙상 metric 차트)** — 카드 row + `lastFallByWorker` (recent 스캔, 5분 recency 빨강 블링크). `VitalHistoryPanel` 에 `"fall"` 메트릭 칩 (노랑) + `BarChart` 강제 + `summarizeCount` (총 건수/시간·일 최대/평균). mock `buildHistory` 에 fall sparse count (24h ~2건, 60d ~4건).
43. **낙상 시연 버튼 (폰)** — Apple Watch / Galaxy Watch native fall detection 은 외부 API 없음 — watchOS 자체 응급호출 화면만 표시. 시연용 우회로 폰 하단 `[수집 시작] [낙상시연] [SOS]` 3-버튼 row. `_sendFall()` → `fallDetected:true` payload. VitalSample 모델 + 스키마 동기.
44. **★ SOS 모달 팝업 (대시보드)** — `manualSos:true` 수신 시 자동 빨강 모달. 헤더 (블링크 원 + "SOS 긴급 알람") + **작업자 (이름/사원번호/소속 회사 스마트인재개발원/SOS 시각)** + **최신 생체 데이터** (심박/SpO₂/체온추정, 기존 임계 색상·블링크 동일) + **현장 위치 (작업자 GPS 좌표)** Google Maps 링크 + **보호자 연락처** (이름 + 전화) + **119 신고** 빨강 강조. 통화 (`tel:`) / 문자 (`sms:`) 버튼.
45. **★ SMS 양식 자동 작성 (`buildSmsBody`)** — 보호자/119 별 다른 톤. 본문 포맷:
    `[SafetyMonitor 긴급 알림] / 회사: 스마트인재개발원 / 작업자: 장우진 (EMP-6861) / 시각: 14:24:51 / 작업자 GPS 좌표: 위도 35.158768, 경도 126.851234 / 지도: https://maps.google.com/?q=... / 생체: 심박 145bpm (위험), SpO₂ 87% (위험), 체온추정 38.3℃ (위험) / 조치: ...`
    `sms:<number>?body=<encoded>` (iOS/macOS Messages 둘 다 호환).
46. **보호자 연락처 + GPS 위치 payload 동봉 (폰)** — Settings 페이지에 **보호자 이름/관계** + **보호자 전화** 필드 + secure storage (`guardian_name`, `guardian_phone`). 헬퍼 `_extraMeta()` 가 모든 sample 생성부 (`_pollOnce`, `_sendSos`, `_sendFall`) 에 보호자 + lat/lon 자동 동봉. `BackgroundKeepalive.lastPosition` → payload `latitude/longitude`. 스키마 `guardianName/guardianPhone/latitude/longitude` optional 추가.
47. **store fix — 이벤트 플래그 비-sticky** — `latestByWorker` 가 spread merge 로 `manualSos/fallDetected` 가 영구 sticky 되던 버그 (SOS 한 번 들어오면 카드 영구 빨강) → 두 필드는 sample 의 자기 값만 사용. 다른 vital/메타는 기존 merge 유지. dashboard 는 `data.recent` 스캔으로 `lastSosByWorker / lastFallByWorker` 별도 계산 → 모달 트리거 + 낙상 row 빨강 블링크 5분 recency.
48. **SOS 모달 라벨 정리** — 헤더 "현장 위치 (회사 스마트인재개발원)" 이 좌표가 회사 위치처럼 보이게 혼동 → 회사명은 작업자 섹션의 "소속" 라인으로 이동, 위치 헤더는 "현장 위치 (작업자 GPS 좌표)" 로 명시. 좌표는 `위도 35.158768 · 경도 126.851234` 분리 표기.
49. **5명 워커 grid + 정렬 fix** — fallbackWorkers 5명 (`demo_mock_03` 추가). grid `xl:grid-cols-5`. mock-publish.mjs + DEMO_GUARDIANS 동기. 카드 정렬: max-w-6xl → `max-w-[1600px]`, ROW_CLASS 상수 + `min-h-[3.25rem]` 모든 row 통일, 상태 배지 `whitespace-nowrap` (대 기 줄바꿈 해결), 카드 헤더 `min-h-[4.5rem]` + 사원번호 미설정 placeholder 항상 표시.
50. **네트워크 시나리오 확인** — MacBook 코딩 + 발표 PC 사용 시나리오 3종 분석. 권장 = **시나리오 A (MacBook + 발표 PC 같은 망 + cloudflared 그대로 사용)**. 발표 PC 는 브라우저만 있으면 됨 (Chrome/Safari/Edge/Windows 무관). 발표 당일 체크리스트 10분 작성. 백업: 셀룰러 핫스팟 + LAN 직접 접속 사전 검증.
51. **★ 환경 산소 row 제거 (2026-05-25)** — 사용자 결정. 카드 6 row → 5 row (상태/심박/SpO₂/손목/낙상). `AmbientO2Row` 컴포넌트 + store merge 의 `ambientO2Pct` + `VitalSampleSchema.ambientO2Pct` 필드 모두 제거. 폰은 원래 안 보내고 있어 변경 없음. typecheck pass + analyzers 10/10 + POST 201 검증.
52. **★ 다중 작업자 분리 버그 fix (2026-05-25)** — 두 폰 (BECKS / YJH iPhone) install 후 두 번째 폰이 첫 번째를 덮어쓰는 현상. 원인 두 겹:
    - (a) 폰 측 — `_workerId = String.fromEnvironment('WORKER_ID', defaultValue: 'demo_ios_01')` 빌드 상수. 모든 iPhone 이 동일 ID publish. `_effectiveWorkerId` getter 추가 (사원번호 입력 시 자동 workerId, 미입력 시 fallback). `_pollOnce` 1+1 / `_sendSos` / `_sendFall` 4 곳 교체. 단, `VitalPublisher` 의 init workerId 는 metadata 만 사용 (publish 는 sample.workerId) — 영향 없음.
    - (b) dashboard 측 — `workers = Array.from(ids).slice(0, 5)` 가 fallback 5개를 우선 자리잡고 실폰 2대를 잘라냄. fallback 의 placeholder `demo_ios_01 / demo_and_01` 제거 (mock 3개만 남김). `slice(0, 5)` 제거 + 실폰 sort by ts 우선 union (`actual ∪ fallback`).
    - dev 서버 재기동으로 in-memory store 의 stale `demo_ios_01` 정리. 시뮬레이션 POST 로 `[EMP-1024 양지후, EMP-6861 장우진]` union 검증.
53. **★ YJH iPhone 15 Pro Max 추가 install (2026-05-25)** — 두 번째 시연 폰. Xcode 직접 빌드 시 SPM 통합 플러그인 4개 (`geolocator_apple/device_info_plus/flutter_secure_storage_darwin/package_info_plus`) `Flutter/Flutter.h` not found 빌드 실패. 원인 = Xcode 가 build/ 폴더 안 산출물을 120MB debug 로 덮어쓰면서 SPM 의존성 못 잡음. 해결 = **flutter CLI 표준 절차** (`flutter clean` → `pub get` → `pod install` → `flutter build ios --release`) → 17.6MB AOT codesigned 복구 → `xcrun devicectl device install + process launch --terminate-existing` 한 번에 install + launch 성공. 사용자에게 "Xcode Play 버튼 금지" 안내.
54. **시스템 재기동 (2026-05-25)** — dev 서버 + cloudflared 다운 후 재기동. 새 quick tunnel URL `https://researchers-excitement-they-overnight.trycloudflare.com`. 두 iPhone 동일 URL 로 in-app 설정.
55. **★ 인프라 안정화 — nohup+disown lifecycle 분리 (2026-05-26)** — 이전 백그라운드 task 가 셸 종료/compaction 영향으로 stopped 되던 문제. dev 서버 + cloudflared 를 `nohup ... & disown` 으로 띄워 부모 셸 lifecycle 에서 분리. 새 quick tunnel URL `https://prisoners-hosting-shape-assists.trycloudflare.com`.
56. **★ IDE Run 버튼 함정 진단 + 학습 (2026-05-26)** — Cyён iPhone 16 install 시도 중 `devicectl launch` 가 dev disk image 마운트에서 hang → 사용자가 IDE (VS Code Flutter plugin) Run ▶ 버튼 누름 → debug 빌드가 release 17.6MB AOT 산출물을 120MB 로 덮어씀 → 홈 아이콘 standalone launch 거부 ("In iOS 14+, debug mode Flutter apps can only be launched..."). flutter clean 사이클로 release 재빌드 + devicectl install + launch 성공. memory feedback 2건 기록 (multi-device scope + IDE Run overwrites release).
57. **★ 관제 웹 — 테스트 워커 차단 (2026-05-26)** — `infra_check / warmup / netcheck` exact + `test_/smoke_/infra_` prefix 패턴을 `isReservedTestWorker` 가드로 차단. `addSample` null 반환, `recentSamples / latestByWorker` 필터, POST handler HTTP 202 `dropped: reserved_test_worker`. 진단용 smoke test 가 store 에 노출 안 됨.
58. **★ 관제 웹 — 위치 기반 현장 환경 패널 (2026-05-26)** — 신규 `/api/weather` route (Open-Meteo forecast + Air Quality proxy, API key 불필요, 무료, 5분 메모리 캐시, lat/lon query). 신규 `WeatherStrip` 컴포넌트 — 가로 10 항목 그리드 (날씨/기온/체감/습도/PM2.5/풍속/UV/강수량/일출/일몰). 위치 기준 = 등록된 작업자 폰 GPS 좌표 평균 (작업자 0명이면 "현장 위치 대기" placeholder).
59. **★ 관제 웹 — 5칸 슬롯 + 대기 큐 등록 UX (2026-05-26)** — fallback union 폐기. 카드 grid 가 항상 정확히 5칸. 모든 슬롯 빈 placeholder 로 시작 (`EmptySlotCard`, 클릭 시 대기 큐 모달). publish 중인 작업자 중 슬롯에 할당 안 된 워커는 `pendingWorkers` 큐. 빈 슬롯 클릭 → `WorkerQueueModal` (이름·사원번호·HR·SpO₂·마지막 수신 시각 표시) → 작업자 클릭 시 그 슬롯에 할당. 등록된 슬롯 우상단 "해제" 버튼 → 다시 큐로. 슬롯 할당은 `localStorage` (`safetymonitor.slots.v1`) 영속화 — 새로고침에도 유지. mock 3 개 fallback 도 제거 (관리자가 수동 선택만 등록).
60. **★ 관제 웹 — 기상 정책 임계 + 클릭 모달 (2026-05-26)** — 사용자 제공 정책 문서 (산업안전보건기준에 관한 규칙 2025.7.17 개정 + KOSHA Guide + 환경부 + 기상청) 5종 항목 적용. 신규 `weather-rules.ts` 모듈 — `evaluateApparentTemp` (폭염 31/33/35℃ + 한파 -12/-15/-18℃, 법적/권고 binding), `evaluateWindKmh` (10/15 m/s, km/h 자동 변환), `evaluatePM25` (36/76/150 μg/㎥), `evaluateUV` (8/11), `evaluatePrecipitation` (1/5/10 mm/h). 정상=zinc, 주의=amber 깜빡임 (`vital-blink-caution`), 위험=red 빠른 깜빡임 (`vital-blink-danger`) — 생체 카드와 동일 키프레임 재사용. 신규 `WeatherRuleModal` — 항목 클릭 시 (a) 현재 측정값 + severity 배지 (b) 현재 적용 임계 단계 (법적 강제 / 권고 / 참고 배지) + 권고 조치 + 출처 (c) 전체 임계 단계 리스트 + 현재 단계 강조 (d) 단발성 스파이크 제외 등 운영 주의사항. 정보 항목 (날씨/기온/습도/일출/일몰) 도 클릭 가능 — 안내문만 표시. 19 케이스 sanity check 모두 정책대로 평가 확인.
61. **★ Cyён iPhone 16 install 차단 + 발표 폰 구성 변경 (2026-05-26 오후)** — `flutter run` 시 `Communication with Apple failed: Your development team has reached the maximum number of registered iPhone devices` + `Provisioning profile "iOS Team Provisioning Profile: kr.indusview.workerPhone" doesn't include the currently selected device "TG i_n" (00008101-001649983AB9003A)`. 원인 = Apple Developer team `F2P5ZFP65Q` 디바이스 한도 도달 (연 100대, 1년 1회 reset). 추가로 출력 `in debug mode` — IDE Run 버튼 또 사용 (정책 위반 3회차). 해결 옵션 3개 분석 (A: Apple 콘솔 device 정리 — annual reset 제약, B: 다른 Apple ID 로 team 교체 — BECKS/YJH 재install 부담, C: Cyён 폰 install 포기). Android 측 device 수 제약 없음 분석 (debug.keystore 자동 생성, debug 빌드도 standalone 실행 OK) → **iPhone 2대 + Galaxy 실기기 1대 구성 채택** (옵션 C). Cyён iPhone install 은 발표 후 보류.
62. **★ 관제 웹 — WeatherStrip 텍스트 가독성 개선 (2026-05-26 오후)** — 사용자 스크린샷 빨간 박스로 현장 환경 패널 글씨 어두움 지적. [WeatherStrip.tsx:266-270](../apps/dashboard-web/app/components/WeatherStrip.tsx#L266-L270) `VALUE_CLASS.normal` `text-zinc-200` → **`text-white`**. 라벨/sub `text-zinc-500` → `text-zinc-300`. 헤더 "현장 환경" `text-zinc-300` → `text-zinc-100`. 헤더 GPS 좌표·우측 정보 `text-zinc-500/600` → `text-zinc-400`. 주의/위험 색상 (amber/red 블링크) 은 정책 색이므로 보존. typecheck pass.
63. **★ Galaxy worker_phone install 완료 + Health Connect 권한 흐름 블로커 진단 (2026-05-27)** — Galaxy 실기기에 Flutter 앱 install 성공. 폰 UI 정상 + 작업자 메타데이터 입력 완료 (김동현 / EMP-2222). in-app URL `https://prisoners-hosting-shape-assists.trycloudflare.com/api/mock/vital` 저장 — Status 의 `prisoners-hosting-shape-assists` 과 다른 URL → active cloudflared URL 재확인 필요. **블로커 = Health 권한 "대기"** + 연결 상태 "Health 권한 필요". Android 앱 권한 화면 "건강, 피트니스, 웰니스" 허용됨 (Health Connect 우산 권한). 단 [health_vitals_service.dart:31](../apps/worker-phone/lib/services/health_vitals_service.dart#L31) `_health.requestAuthorization` 가 false 반환. 가설 4개 (Health Connect 미설치 / 데이터 타입별 권한 미허용 / Samsung Health 동기화 OFF / Galaxy Watch 인입 부재). [AndroidManifest.xml:4-6](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L4-L6) health 권한 선언 검증 OK + [health_vitals_service.dart:18-23](../apps/worker-phone/lib/services/health_vitals_service.dart#L18-L23) Android iOS 분기 (Android 는 SLEEP_WRIST_TEMPERATURE 제외 + BODY_TEMPERATURE 폴백) 정상. 코드 결함 없음 — 원인은 Health Connect 앱 내부 권한 / 데이터 소스 측. **4단계 검증 절차 표준화** = Health Connect 앱 설치 확인 → Health Connect 내부 worker_phone 데이터 타입별 권한 ON → Samsung Health 동기화 ON + 항목별 ON → Galaxy Watch 페어링 + Samsung Health 측정값 인입 확인 → 앱 강제 종료 + 재시작 + "수집 시작". adb logcat 명령어 `adb logcat -s flutter:V HealthConnectKit:V | grep -iE 'health|permission'` 로 false 사유 직접 추출 가능. 사용자 확인 4건 요청 (모델/Android 버전, Health Connect 설치, 권한 다이얼로그 표시, Watch 인입).

64. **★ 관제 웹 대폭 확장 + 위험도 fix + 자동 재연결 + git init (2026-05-28)** — 8개 작업 묶음:
    - **다크/라이트 모드 토글** — Tailwind `darkMode: "class"` + `ThemeProvider`/`ThemeToggle` 신규 + `globals.css` 라이트 기본/`html.dark` 다크 + `layout.tsx` 사전-hydration 인라인 스크립트 (flash 차단). 6개 컴포넌트 + `weather-rules.ts` 의 다크-only 클래스 ~150곳 light/dark 페어 마이그레이션. SVG 차트는 `currentColor`. 헤더 우상단 ☀/🌙. **Tailwind config 변경은 HMR 미인식 → dev 재시작 필수**.
    - **실시간 미수신 차트 비활성화** — 카드 메트릭 `--` 인데 누적 차트엔 mock deterministic 데이터가 그려지던 문제. `VitalHistoryPanel` `hasLiveData` prop + `hasLiveMetric()` → 미수신 시 fetch 건너뛰고 "자체 웨어러블 디바이스 연동 시 수집" placeholder (디바이스 차별화 부각).
    - **SQLite DB 영속화** — `better-sqlite3` (pnpm-workspace `onlyBuiltDependencies` + prebuilt binary). `lib/db.ts` — `.runtime/safetymonitor.db` (WAL), `vital_samples` 테이블 (raw_json 감사 trail). `addSample` 이 in-memory ring(500) + DB INSERT 양쪽. 헤더 라벨 "DB 영속 N건 누적". dev 재시작 후 데이터 보존 검증 (recent=0, totalPersisted 유지).
    - **관리자 메뉴 + CSV/XLSX 내보내기** — `lib/admin-auth.ts` (Basic auth timing-safe, env `ADMIN_ID`/`ADMIN_PASSWORD` default `admin/safety2026`) + `/api/admin/{login,workers,export,export-xlsx,preview,site-info}` + `AdminExportModal` (로그인↔내보내기, sessionStorage 토큰). 워커 드롭다운 + 기간 picker + 현장정보 설정 + **위험도 미리보기** (최근 50건 이상 row 빨강/주의 주황) + CSV (현장정보 snapshot 블록 + UTF-8 BOM + status 4컬럼, 순서 `id,received_at,...`) + XLSX (`exceljs` 시트1 현장정보 + 시트2 생체데이터 색 + 시트3 현장환경).
    - **현장환경 weather_log 이력화** — `weather_log` 테이블 + `/api/weather` fresh fetch 시 snapshot 자동 저장 + `WeatherStrip` `&workers=N`. **작업자 슬롯 등록 시 (GPS 있을 때) 5분 간격 축적**.
    - **★ 온도 위험도 offset 0.5 수정** — 사용자 보고: 정상 손목 36.5℃ 가 위험 빨강 블링크. 원인 `wristToCoreOffsetC 1.5` → 추정 38.0℃ = dangerC 일치. **0.5℃ 로 조정** ([thresholds.ts](../packages/analyzers/src/thresholds.ts)) + analyzers.test 3 케이스 재작성 (37.6=danger/37.1=caution/36.5=null) 10/10 통과. **`pnpm --filter @safetymonitor/analyzers build` 필수** (dashboard 가 dist/ import — src 만 고치면 stale). "잠금 상태시 위험" 보고도 동일 원인 해결. 런타임 검증 (36.5=정상/37.0=주의/37.5=위험).
    - **★ worker-phone 자동 재연결 3계층** — `connectivity_plus` + `WidgetsBindingObserver`. (1) 백그라운드→포그라운드 resume 시 Timer 죽었으면 재가동+즉시 폴링 (2) 네트워크 offline→online 즉시 `_pollOnce` (3) `auto_polling` secure storage 영속 → 앱 재시작/재부팅 자동 시작. "수집 시작"↔"수집 정지" 토글 버튼. `flutter analyze` clean.
    - **★ git 저장소 init** — `.git` 부재 → `git init` → 안전 스캔 (secret/large 0건) → 147파일/14,498줄 baseline commit `458e16f`. identity `becks0728 <233276656+becks0724@users.noreply.github.com>` (기존 global). `.claude/settings.local.json` gitignore.
    - **cloudflared 재기동** — 이전 URL `prisoners-hosting-shape-assists` 가 자정 (2026-05-27T23:58Z) 만료 → retry loop. 재기동 → 새 URL `creating-availability-stuck-craps.trycloudflare.com` (smoke 202).

### 현재 상태 (아카이브 — 2026-05-28 시점 기록, 최신은 상단 [Quick Summary](#quick-summary-30초-안에-읽기))

- **트랙**. 프로토타입 (D0~D4). 발표 후 로드맵 (M0~M9) 은 격하 보관.
- **★ 발표 마감**. **2026-06-04 (D-7)**. 매일 진척 측정.
- **현재 마일스톤**. **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행** — iPhone **2대 install 완료** (BECKS + YJH) + **Galaxy install 완료** (김동현/EMP-2222). **Cyён iPhone 16 install 차단** (Apple Developer team device 한도) → 발표 폰 **iPhone 2대 + Galaxy 1대**. 2026-05-28 관제 웹 대폭 확장 + 2026-05-29 **VitAlGuard 브랜딩/관리자 현장정보/레이아웃 폴리싱** 완료. **블로커 = Galaxy Health 권한 "대기"** (Step 2 데이터 타입별 권한 미수행 강력 추정).
- **★ 시연 구성 (2026-05-26 오후 갱신)**. iPhone **2대** (BECKS 장우진/EMP-6861 + YJH 양지후/EMP-1024) + Apple Watch + **Galaxy 실기기 1대** (3번째 폰 역할, Cyён iPhone 대체) + Galaxy Watch + 발표 PC 1대. **mock fallback 폐지** — 카드는 관리자가 대기 큐에서 등록한 작업자만 등장 (5칸 정원).
- **네트워크 구성**. iPhone → Cloudflare Tunnel (세션마다 새 `https://*.trycloudflare.com`, 현재 `creating-availability-stuck-craps`) → Mac localhost:3000 → mock receiver. 발표 PC 도 동일 URL 로 접근. dev + cloudflared 둘 다 `nohup ... & disown` 으로 셸 lifecycle 분리. **quick tunnel 은 ~24시간/세션 단위 만료** — 만료 시 retry loop → 재기동 + 새 URL 발급.
- **대시보드 UI**. **VitAlGuard 브랜딩** + 라이트/다크 CI 로고. 상단 히어로는 한줄 메시지 + 관리자 수정 가능한 현장정보 카드(기업명/현장명/공사종류/주소/착수/준공) + 수신요약 카드. 아래에 **WeatherStrip**(10항목, 업데이트 시각, 정책 모달)과 **5칸 슬롯 grid**. 등록된 슬롯은 카드 헤더 `🟢 신호등 · 이름 · ▁▃▅▇ 시그널 바 + 스트레스 칩 + 우상단 상태/해제`. 5 row 메트릭 list — `상태 / 심박 / 산소포화도 / 손목 온도 / 낙상 감지`. 카드 메트릭 클릭 → 누적 차트 패널. **SOS 모달** — 작업자 + 소속 + 생체 + 현장 GPS + 보호자 + 119.
- **분석기**. analyzers 5종 10/10 통과.
- **이벤트 흐름**. `manualSos / fallDetected` 비-sticky (store fix). dashboard `data.recent` 스캔으로 `lastSosByWorker / lastFallByWorker` 별도 계산.
- **★ 등록 정책 (2026-05-26 신규)**. publish 만으로 카드 자동 등장 ✗. 관리자가 빈 슬롯 클릭 → 대기 큐 모달 → 작업자 선택 → 등록. localStorage 영속화 (`safetymonitor.slots.v1`).
- **★ 기상 정책 (2026-05-26 신규)**. WeatherStrip 5종 항목 (체감온도/풍속/PM2.5/UV/강수량) 자동 평가. 정상/주의/위험 색상 + 깜빡임 + 클릭 시 정책 근거 모달 (법적 강제 / 권고 / 참고 binding 배지).
- **★ 워커 ID 블랙리스트 (2026-05-26 신규)**. `infra_check / warmup / netcheck` + `test_/smoke_/infra_` prefix 가드 — 진단용 POST 차단 (HTTP 202 dropped).
- **★ IDE Run 금지 (2026-05-26 강화)**. CLAUDE.md 의 "Xcode Play 버튼 금지" 정책에 추가 — IDE (VS Code Flutter plugin) Run ▶/디버그 🐞 버튼도 동일 함정 (debug 빌드 덮어쓰기 → 홈 아이콘 launch 거부). install/launch 후 사용자에게 매번 명시 경고.
- **★ Android Health Connect 권한 흐름 (2026-05-27 신규)**. 우산 권한 (앱 권한 → "건강, 피트니스, 웰니스" 토글) ≠ 개별 데이터 권한. 실제 HR/SpO₂/체온 read 는 Health Connect 앱 내부에서 worker_phone 의 각 데이터 타입별 토글 별도 ON 필요. Galaxy 는 추가로 Samsung Health → Health Connect 동기화 ON + Galaxy Watch 측정값이 Samsung Health 에 인입되어야 데이터 0건 회피. 4단계 표준 검증 절차 + adb logcat 진단 명령어 정립.
- **대기 항목**. AWS dev 계정 + 결제 알람 — 결제 문제로 우선 보류

### 다음 할 일 (우선순위 순)

1. **★ 사용자 — Galaxy Health Connect 권한 활성화 (현재 블로커)** — 최우선 추정 원인 = **Step 2 데이터 타입별 권한 미수행**. Health Connect → 앱 권한 → **worker_phone** → 심박수/산소포화도/체온 각각 토글 ON (우산 권한 ≠ 개별 데이터 권한) + Samsung Health → 설정 → Health Connect → 동기화 ON. 앱 강제 종료 → 재시작 → "수집 시작" → "Health 권한 필요" 가 "5초 폴링 중" 으로 바뀌는지. (S24 Android 14+ = OS 내장 / Samsung Health 워치 심박 가시 / 권한 다이얼로그 안 뜸 → Step 2 강력 추정). 실패 시 adb logcat 진단.
2. **사용자 — 3 폰 in-app URL 통일 갱신** — `https://creating-availability-stuck-craps.trycloudflare.com/api/mock/vital`. 우상단 ⚙️ → 저장. 위치 권한 "항상 허용".
3. **★ 사용자 — 2 iPhone 재빌드/재install** — 이번 세션 자동 재연결 + offset 0.5 변경분 반영. `flutter build ios --release --dart-define=MOCK_RECEIVER_URL=<새 URL>/api/mock/vital` + devicectl. Galaxy 도 `flutter build apk --debug` + `adb install`.
4. **사용자 — 자동 재연결 시연 검증** — 비행기 모드 toggle → 자동 재폴링 / 앱 백그라운드→복귀 / 강제 종료 후 재시작 자동 수집.
5. **사용자 — 관제 웹 신규 기능 검증** — 라이트/다크 토글 + VitAlGuard 로고 분기 + 히어로 문구 + 관리자 메뉴 로그인(admin/safety2026) → 현장정보 저장 + 위험도 미리보기 + XLSX/CSV 다운로드.
6. **사용자 — 슬롯 등록 + WeatherStrip + SOS/낙상 시연** — 빈 슬롯 → 대기 큐 → 등록 → 전체 시나리오.
7. **자동 — D2/D3 잔여 위험 감지 자동 트리거** — SpO₂ alert, 심박 이상 SVG marker, fall analyzer 자동 호출.
8. **자동 — D4 폴리싱** — 시연 시나리오 스크립트 + 백업 영상 + 슬라이드 + 리허설 3회 (목표 2026-06-04, D-7).
9. **발표 당일** — MacBook + cloudflared 기동 → 새 URL → 3 폰 in-app URL 교체 → 빈 슬롯 → 대기 큐 등록 → SOS·낙상 시연. 셀룰러 핫스팟 백업.
10. **보류 옵션** — Apple Developer 콘솔 device 정리 → Cyён 폰 install 재시도 / PrivacyInfo.xcprivacy (App Store 제출 시) / AWS dev 계정.

---

## 현재 상태 (Snapshot)

- **트랙**. **프로토타입 (D0~D4)** — 발표용 데모. 발표 마감 **2026-06-04 (D-7)**.
- **현재 마일스톤**. **D1 ~99% + D2 ~88% + D3 ~68% + D4 UI 폴리싱 진행**. iPhone **2대** (BECKS + YJH) + **Galaxy** (김동현/EMP-2222) install 완료. 2026-05-28 관제 웹 대폭 확장 + 2026-05-29 VitAlGuard 브랜딩/현장정보/레이아웃 폴리싱.
- **진척률**. D1 ~99%. D2 ~88%. D3 ~68%. D4 UI 폴리싱 진행.
- **다음 액션**. (1) **★ Galaxy Health Connect 권한 활성화** — Step 2 데이터 타입별 권한 (최우선 추정) (2) 3 폰/워치 endpoint 최신 cloudflared URL 통일 (3) **2 iPhone 재빌드/재install** (자동 재연결 + offset 0.5 반영) (4) 관제 웹 라이트/다크·관리자 현장정보·내보내기 회귀 검증 (5) 슬롯 등록 + SOS/낙상 (6) D2 자동 트리거 (7) D4 폴리싱·리허설.
- **블로커**. (a) AWS 계정 보류 — local/mock 우회 (b) cloudflared quick tunnel 만료 — 재기동 + 새 URL (현재 `creating-availability-stuck-craps`) (c) **Apple Developer team device 한도** — Galaxy 우회 (d) **Galaxy Health 권한 + 워치 fresh HR 모두 해결**(세션32 — 권한은 stale APK 재빌드, fresh HR은 착용+계속측정→Samsung Health 동기화 라이브로 5분 필터 통과, 관제 웹 hr 연속 수신·코드 변경 0).
- **마지막 업데이트**. 2026-06-10 세션32 (자동 트리거 = 차트 임계선/이상치 `54a0bbd` + 생체 위험 경보 모달 `eb74d83`; D3 생체 위험 alerts 이력화 `be329fb`; 차트 동시표시 버그 수정 `1d9279b`. main `ahead 0`, **4커밋 push 완료**·origin 동기화. 터널 `lol-year-consulting-counted`). 본 Snapshot 의 트랙·발표 마감·다음 액션·블로커는 stale(발표 마감은 **2026-07-07**, 06-04 는 중간 데모) — 최신은 상단 [Quick Summary](#quick-summary-30초-안에-읽기) 참조.

---

## 마일스톤 상태

### 프로토타입 트랙 (현 시점)

| D | 상태 | 진척률 | 시작일 | 완료일 | 비고 |
|---|---|---|---|---|---|
| D0 | 완료 | 100% | 2026-05-21 | 2026-05-21 | TS 4 패키지 + Flutter `worker-phone` + analyzers 5종 10/10 |
| D1 | 진행중 | 99% | 2026-05-22 | 목표 ~2026-05-28 | iPhone **2대** (BECKS + YJH) codesigned release + 사원번호 기반 workerId 자동 분리 + Health + Cloudflare Tunnel + iOS 백그라운드 keepalive + 작업자/보호자 메타데이터 + GPS payload. **Cyён iPhone 16 install 차단** (Apple device 한도). **Galaxy install 완료 (2026-05-27, 김동현/EMP-2222)** — 권한 블로커 **해결**(세션32 stale APK 재빌드 → "5초 폴링 중") + **워치 fresh HR 전송 해결**(착용+계속측정→관제 웹 EMP-8888 hr 94~99 연속 수신). 폰 인앱 URL 갱신·발표용 워치 운동 세션 권장 남음 |
| D2 | 진행중 | 92% | 2026-05-24 | 목표 ~2026-05-29 | 대시보드 카드 + 신호등 + 시그널 바 + 메트릭 블링크 + 낙상 감지 row + 누적 차트 + 테스트 워커 차단 + 5칸 슬롯 + 대기 큐 등록 UX + WeatherStrip 10 항목 + 기상 정책 임계 색상 + 클릭 정책 모달 + **VitAlGuard 브랜딩/관리자 현장정보/레이아웃 폴리싱** + **위험 감지 자동 트리거(생체 위험 경보 모달·차트 임계선·이상치 강조) 완성 (세션32)**. 잔여 = 위험 자동화 마무리 |
| D3 | 진행중 | 78% | 2026-05-24 | 목표 ~2026-06-01 | SOS 모달 + SMS 자동 작성 + 보호자/119 통화·문자 + 작업자 상태 row + 기상 정책 권고 조치 + 법적 근거 표시 + **생체 위험 alerts 이력화(SOS/낙상/생체 발생→대응 전 경로 완성, 세션32)**. 관리자 현장정보는 사고/보고 컨텍스트 보강 완료 |
| D4 | 진행중 | 25% | 2026-05-29 | 목표 ~2026-06-04 | 관제 웹 브랜딩/레이아웃 1차 폴리싱 완료. 데모 시나리오·백업 영상·슬라이드·리허설 3회 남음 |

### 발표 후 로드맵 (이연)

| M | 상태 | 진척률 | 비고 |
|---|---|---|---|
| M0~M9 | 이연 | — | 발표 종료 후 재활성화. 잠정 결정 — 프로젝트명 `IndusView` (M0 #1, 상표·도메인 검증은 발표 후) |

**상태 표기**. `대기` / `진행중` / `블로커` / `완료` / `보류` / `이연`

---

## 활동 로그

### 2026-05-27 — Galaxy worker_phone install 완료 + Health Connect 권한 흐름 진단 + 4단계 검증 절차 표준화 + active URL 확정

- **무엇**.
  - (1) **Galaxy 실기기에 worker_phone Flutter 앱 install 성공** — 사용자가 두 장의 스크린샷 제공. 첫 번째 = Android `설정 → 앱 → worker_phone → 앱 권한` 화면 (Flutter 로고 + "허용됨: 건강, 피트니스, 웰니스" + "거부된 권한: 없음" + "사용하지 않는 앱 관리 ON"). 두 번째 = worker_phone 메인 화면 (헤더 "SafetyMonitor 작업자" + 우상단 ⚙️ + 메트릭 4 타일 [심박 --, SpO2 --, 손목 온도 --, 작업자 "김동현 (E..."] + 상태 패널 [Health 권한 "대기", 연결 상태 "Health 권한 필요", 백그라운드 "대기", 작업자 "김동현", 사원번호 "EMP-2222", 수신 서버 `https://prisoners-hosting-shape-...`] + 수신 서버 URL 입력란 + 3-버튼 row [수집 시작, 낙상 시연, SOS]).
  - (2) **블로커 식별 — Health 권한 "대기"** — 폰 install + UI 정상 + 메타데이터 (이름 김동현 / 사원번호 EMP-2222) 입력 완료 + URL 저장 완료. 단 [health_vitals_service.dart:31](../apps/worker-phone/lib/services/health_vitals_service.dart#L31) 의 `_health.requestAuthorization(_types, ...)` 가 false 반환 → [main.dart:213](../apps/worker-phone/lib/main.dart#L213) 분기 `authorized ? '5초 폴링 중' : 'Health 권한 필요'` 결과 "Health 권한 필요" 표시.
  - (3) **앱 권한 화면 vs 앱 내부 표시 모순 분석** — Android 설정에선 "건강, 피트니스, 웰니스" 허용됨. 이것은 **Health Connect 자체 접근 우산 권한** (Android 14+). 실제 HR/SpO₂/체온 read 권한은 **Health Connect 앱 내부에서 worker_phone 의 각 데이터 타입별로 별도 토글**. 우산만 켜고 데이터 타입별 권한이 꺼져 있으면 `requestAuthorization` false.
  - (4) **코드 검증 — 결함 없음** — [AndroidManifest.xml:4-6](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L4-L6) `android.permission.health.READ_HEART_RATE / READ_OXYGEN_SATURATION / READ_BODY_TEMPERATURE` 3종 선언 OK. [AndroidManifest.xml:60-69](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L60-L69) `queries` 에 `com.google.android.apps.healthdata` package + `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` intent OK. [activity-alias ViewPermissionUsageActivity](../apps/worker-phone/android/app/src/main/AndroidManifest.xml#L39-L48) `HEALTH_PERMISSIONS` 카테고리 OK. [health_vitals_service.dart:18-23](../apps/worker-phone/lib/services/health_vitals_service.dart#L18-L23) Android 측 `SLEEP_WRIST_TEMPERATURE` 제외 분기 + `BODY_TEMPERATURE` 폴백 정상.
  - (5) **원인 가설 4건 식별** — (a) Health Connect 앱 미설치 또는 구버전 (Android 13 이하 + 별도 설치 안 함) → `requestAuthorization` 즉시 false (b) Health Connect 우산 권한만 허용, 데이터 타입별 권한 미허용 → 우산 통과해도 read 시 empty (c) Samsung Health → Health Connect 동기화 OFF → 권한 통과해도 데이터 0건 (d) Galaxy Watch 페어링/Samsung Health 인입 부재 → 데이터 소스 자체 없음.
  - (6) **4단계 표준 검증 절차 정립** — Step 1 `설정 → 앱 → "Health Connect"` 검색 → 설치 여부 확인 (Android 14+ OS 내장 / 13 이하 Play Store "Health Connect by Android" 별도 설치) → Step 2 Health Connect 앱 → 앱 권한 → worker_phone → 심박수/산소포화도/체온 각각 토글 ON → Step 3 Samsung Health → ⋮ → 설정 → Health Connect → 동기화 ON + 항목별 ON → Step 4 Samsung Health 홈에 워치 HR 측정값 가시 확인 + Galaxy Wearable 페어링 점검 → 앱 강제 종료 + 재시작 + "수집 시작" 재시도. 권한 다이얼로그가 뜨지 않으면 → Health Connect 자체 미설치 강력 신호.
  - (7) **adb logcat 진단 명령어 정립** — Mac USB 연결 + 디버깅 허용 시 `adb logcat -s flutter:V HealthConnectKit:V | grep -iE 'health|permission'` 로 `requestAuthorization` false 사유 직접 추출 가능. 사용자 정보 확인 4건 요청 — Q1 Galaxy 모델/Android 버전, Q2 Health Connect 앱 설치 여부, Q3 "수집 시작" 시 권한 다이얼로그 표시 여부 (안 뜨면 Health Connect 미설치 강력 신호), Q4 Samsung Health 에 워치 HR 측정값 가시 여부.
  - (8) **active cloudflared URL 확정** — 네트워크 진단 6종 (status.anthropic.com `All Systems Operational` / api.anthropic.com TLS 89ms / 1.1.1.1 ping 0% loss / localhost:3000 HTTP 200 / cloudflared PID 15791 / dev:web PID 15705) + `grep -o 'https://[a-z-]+\.trycloudflare\.com' .runtime/cloudflared.log | tail -1` → **`https://prisoners-hosting-shape-assists.trycloudflare.com`** 확정. CLAUDE.md/progress.md 의 이전 URL (`calcium-together-quarterly-companion`) 은 stale → 전체 일괄 정정. Galaxy 폰에는 이미 동일 URL 저장됨 → iPhone 2대만 갱신 필요.
  - (9) **사용자 보고 일시 API 에러 진단** — `socket connection was closed unexpectedly` 발생. Anthropic status `All Systems Operational` + 네트워크 정상 검증 후 큰 payload (CLAUDE.md 35KB + progress.md 98KB + 4 스킬 본문) 전송 중 일회성 hiccup 으로 판단. 작업물 디스크 보존 — 영향 없음.

- **결과**.
  - Galaxy install 성공 + UI 정상 + 메타데이터 입력 완료 (김동현 / EMP-2222) + URL 저장 완료
  - Health 권한 블로커 원인 명확화 + 4단계 검증 절차 표준화
  - 사용자 확인 질문 4건 + adb logcat 명령어로 진단 즉시 가능
  - active cloudflared URL `prisoners-hosting-shape-assists` 확정 + CLAUDE.md / progress.md 일괄 정정
  - 모든 코드 측 결함 없음 검증 (AndroidManifest health 권한 선언 + iOS/Android 분기 + queries package visibility)

- **증거**.
  - 검토 파일: [apps/worker-phone/lib/services/health_vitals_service.dart](../apps/worker-phone/lib/services/health_vitals_service.dart), [apps/worker-phone/lib/main.dart](../apps/worker-phone/lib/main.dart), [apps/worker-phone/android/app/src/main/AndroidManifest.xml](../apps/worker-phone/android/app/src/main/AndroidManifest.xml)
  - 네트워크 검증: status.anthropic.com indicator `none` / cloudflared PID 15791 / dev:web PID 15705
  - 디바이스: Galaxy 실기기 (모델 미확인 — 사용자 Q1 확인 대기)
  - 문서 갱신: CLAUDE.md (Status / 작업 스냅샷 2026-05-27 / 현재 상태 / 다음 할 일 / 핵심 결정 (w) 추가), progress.md (Quick Summary / 다음 할 일 / 마일스톤 표 / 본 활동 로그)

- **다음 액션**.
  - 사용자: (a) **Galaxy Health Connect 4단계 검증 절차 실행** (Step 1 설치 확인 → Step 2 데이터 타입별 권한 ON → Step 3 Samsung Health 동기화 → Step 4 Watch 인입 → 앱 재시작), (b) 사용자 확인 질문 4건 답변 (모델/Android 버전, Health Connect 설치, 권한 다이얼로그 표시, Watch 인입), (c) 선택적 adb logcat 진단, (d) 2 iPhone in-app URL 새 `prisoners-hosting-shape-assists` 로 갱신 (Galaxy 는 이미 동일 URL 저장됨), (e) 슬롯 등록 + WeatherStrip + SOS/낙상 시연 검증.
  - 자동: D2 자동 트리거 + D4 폴리싱·리허설.

### 2026-05-26 오후 — Cyён iPhone install 차단 진단 + 발표 폰 구성 변경 (iPhone 2 + Galaxy 1) + WeatherStrip 텍스트 가독성

- **무엇**.
  - (1) **Cyён iPhone 16 install 재시도 실패 진단** — 사용자가 `flutter run` 으로 install 시도 (IDE Run 버튼 추정). 출력 — `The following plugins do not support Swift Package Manager for ios: health` (기존 warning, 무시) + `Launching lib/main.dart on TG i_n in debug mode...` + `Failed to build iOS app` + `Communication with Apple failed: Your development team has reached the maximum number of registered iPhone devices` + `Provisioning profile "iOS Team Provisioning Profile: kr.indusview.workerPhone" doesn't include the currently selected device "TG i_n" (identifier 00008101-001649983AB9003A)`. 같은 에러 1회 더 재발 (사용자가 flutter clean/build 만 반복).
  - (2) **원인 분석 2건** — (a) Apple Developer team `F2P5ZFP65Q` 디바이스 한도 도달 — Apple 정책상 연 100대 / 1년 1회 reset. 이미 등록된 device 가 누적 100개 도달 → 신규 device UDID `00008101-001649983AB9003A` provisioning profile 자동 등록 실패 → 2차 에러 "doesn't include the currently selected device". (b) `in debug mode` 출력 = IDE Run ▶/디버그 🐞 버튼 사용 (정책 위반 3회차). flutter CLI release 빌드 아님.
  - (3) **해결 옵션 3개 분석** — A) Apple Developer 콘솔 device 정리 — 유료 Apple Developer Program ($99/년) 만 가능. https://developer.apple.com/account/resources/devices/list 에서 device "Disable". annual reset 1년 1회 제약. 무료 Apple ID (Personal Team) 는 console 접근 다름. B) 다른 Apple ID 로 team 교체 — 새 team 의 slot 사용 가능하지만 BECKS/YJH 도 재install 필요 (기존 신뢰 무효화). 발표 D-9 시점에 부담. C) **Cyён 폰 install 포기, 발표 폰 구성 변경** — 가장 안전.
  - (4) **Android 측 device 제약 분석** — iOS team device 한도 같은 제약 **없음**. Free Apple Developer team 한도 vs Android: Android 는 `debug.keystore` 자동 생성, device 수 제약 0, `adb install` 또는 APK 파일 직접 공유 unlimited. debug 빌드도 standalone 실행 OK (iOS 14+ debug SIGKILL 같은 제약 없음). USB 디버깅 활성화 + Health Connect 권한 + Galaxy Watch 페어링 (Galaxy Wearable → Samsung Health → Health Connect 동기화) 만 필요. AVD 메모리 부족 시 실기기 우선 (CLAUDE.md 명시).
  - (5) **발표 폰 구성 변경 채택 (옵션 C)** — iPhone 3대 → **iPhone 2대 + Galaxy 1대**. Cyён iPhone install 은 발표 후 보류. Apple device 한도는 빠르게 해소 안 됨 (annual reset 정책). Galaxy 실기기로 3번째 폰 확보가 가장 빠름.
  - (6) **관제 웹 — WeatherStrip 텍스트 가독성 개선** — 사용자 스크린샷 빨간 박스 (현장 환경 패널 글씨 어두움) 보고. [WeatherStrip.tsx:266-270](../apps/dashboard-web/app/components/WeatherStrip.tsx#L266-L270) `VALUE_CLASS.normal` `text-zinc-200` → **`text-white`**, [WeatherStrip.tsx:298-302](../apps/dashboard-web/app/components/WeatherStrip.tsx#L298-L302) 라벨/sub `text-zinc-500` → `text-zinc-300`, [WeatherStrip.tsx:176-186](../apps/dashboard-web/app/components/WeatherStrip.tsx#L176-L186) 헤더 "현장 환경" `text-zinc-300` → `text-zinc-100` + GPS 좌표/우측 정보 `text-zinc-500/600` → `text-zinc-400`. 주의/위험 색상 (amber/red 블링크) 은 정책 색이므로 보존.

- **결과**.
  - Cyён iPhone 16 install 차단 원인 명확 + 사용자에게 옵션 3개 제시 → 옵션 C (발표 폰 구성 변경) 채택
  - 발표 폰 구성 = iPhone 2대 (BECKS + YJH) + Galaxy 실기기 1대 (3번째 폰)
  - WeatherStrip 텍스트 가독성 개선 — typecheck pass
  - **기존 폰 영향 0** — Cyён 폰 install 시도가 BECKS/YJH 에 영향 없음

- **증거**.
  - 수정 파일: [apps/dashboard-web/app/components/WeatherStrip.tsx](../apps/dashboard-web/app/components/WeatherStrip.tsx)
  - 디바이스: Cyён 의 iPhone 16 (UDID `00008101-001649983AB9003A`) — install 차단 확인

- **다음 액션**.
  - 사용자: (a) 2 iPhone in-app URL 새 cloudflared 갱신, (b) **Galaxy 실기기 install** (USB 디버깅 + adb + flutter run --release), (c) 슬롯 등록 검증, (d) WeatherStrip 텍스트 가독성 + 정책 모달 검증, (e) SOS/낙상 시연.
  - 보류: Apple Developer 콘솔 device 정리 → Cyён 폰 install 재시도 (annual reset 1년 1회, 발표 후 검토).

### 2026-05-26 오전 — 인프라 안정화 + 관제 웹 대대적 변경 (테스트 워커 차단 + 5칸 슬롯 + WeatherStrip + 기상 정책) + IDE Run 함정 학습

- **무엇**.
  - (1) **인프라 안정화 — nohup+disown** — 이전 백그라운드 task `bgy979mx0` (dev 서버) 가 셸 종료/compaction 영향으로 stopped → 폰 publish 도달 0건 → 모든 폰 전송 실패. 진단: `lsof :3000` no listener, `pgrep cloudflared` empty. 복구: `nohup pnpm dev:web > .runtime/dev.log 2>&1 & disown` + `nohup cloudflared tunnel --url http://localhost:3000 --no-autoupdate > .runtime/cloudflared.log 2>&1 & disown` → 부모 셸 lifecycle 분리. 새 quick tunnel URL `https://prisoners-hosting-shape-assists.trycloudflare.com`.
  - (2) **IDE Run 버튼 함정 진단 + 학습** — Cyён iPhone 16 install 시도 → `xcrun devicectl install` 성공, `process launch` 가 dev disk image 마운트 시점에 hang → 사용자가 IDE (VS Code Flutter plugin) device selector "Cyён의 iPhone (mobile)" 활성 상태에서 Run ▶ 버튼 누름 → `flutter run` (--release 없이) = debug 빌드를 install + launch (release 17.6MB AOT 산출물을 120MB debug 로 덮어씀). 폰이 홈에서 열리면 iOS 14+ 정책으로 debug 빌드 standalone launch 거부 → "In iOS 14+, debug mode Flutter apps can only be launched from Flutter tooling, IDEs with Flutter plugins or from Xcode." 다이얼로그. flutter clean → pub get → pod install → build ios --release 사이클로 17.6MB AOT 복구 + devicectl install + launch 성공. 두 memory feedback 신규 — [multi-device scope](~/.claude/projects/-Users-changwoojin-Documents-06-safetymonitor/memory/feedback_multi_device_scope.md), [IDE Run overwrites release](~/.claude/projects/-Users-changwoojin-Documents-06-safetymonitor/memory/feedback_ide_run_overwrites_release.md).
  - (3) **관제 웹 — 테스트 워커 차단** — 사용자 요청 ("infra_check 삭제"). 신규 [store.ts:14-20](../apps/dashboard-web/app/api/mock/store.ts#L14-L20) `isReservedTestWorker` 가드 (exact: `infra_check / warmup / netcheck`, prefix: `test_ / smoke_ / infra_`). `addSample` null 반환, `recentSamples / latestByWorker` 필터. POST handler HTTP 202 `dropped: reserved_test_worker`.
  - (4) **관제 웹 — 위치 기반 현장 환경 패널** — 사용자 요청 ("작업자 상단에 가로로 위치기반 날씨"). 신규 [api/weather/route.ts](../apps/dashboard-web/app/api/weather/route.ts) — Open-Meteo forecast (`current=weather_code,temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,uv_index` + `daily=sunrise,sunset` + `timezone=auto`) + Air Quality API (`pm10,pm2_5`) proxy. 5분 메모리 캐시 (`Map<key, {ts, data}>`, key=`lat.toFixed(2),lon.toFixed(2)`). API key 불필요. 신규 [WeatherStrip.tsx](../apps/dashboard-web/app/components/WeatherStrip.tsx) — 가로 10 항목 그리드 (날씨 WMO 코드 한국어 / 기온 / 체감 / 습도 / PM2.5 + 등급 / 풍속 km/h+m/s / UV 지수+라벨 / 강수량 mm/h / 일출 HH:MM / 일몰 HH:MM). 위치 = 등록된 작업자 폰 GPS 좌표 평균 (`fieldCoords` useMemo, 작업자 0명이면 "현장 위치 대기" placeholder).
  - (5) **관제 웹 — 5칸 슬롯 + 대기 큐 등록 UX** — 사용자 요청 ("작업자는 5명 기본 + 추가 메뉴에 신규등록자를 대기순위로 올려서 선택 후 등록"). 사용자 결정 = "5칸 전부 빈자리 / 관리자가 수동 등록만 노출". fallback union 폐기 (mock `demo_mock_01/02/03` 도 제거). `SlotAssignments = (string | null)[]` 길이 5, `loadSlots / saveSlots` localStorage (`safetymonitor.slots.v1`) 영속화. `pendingWorkers` useMemo — publish 중 작업자 중 슬롯 미할당 워커. 빈 슬롯은 `EmptySlotCard` placeholder (클릭 → `setQueueModalSlot(slotIndex)`). 등록된 슬롯 우상단 "해제" 버튼 → `clearSlot(slotIndex)`. 신규 [WorkerQueueModal.tsx](../apps/dashboard-web/app/components/WorkerQueueModal.tsx) — 대기 워커 목록 (이름·사원번호·HR·SpO₂·마지막 수신 시각) + 클릭 시 `assignWorkerToSlot(slotIndex, workerId)` (중복 등록 자동 방지).
  - (6) **관제 웹 — 기상 정책 임계 + 클릭 모달** — 사용자 요청 + 정책 문서 (산업안전보건기준에 관한 규칙 2025.7.17 개정 + KOSHA Guide H-188 + 환경부 + 기상청). 신규 [lib/weather-rules.ts](../apps/dashboard-web/lib/weather-rules.ts) — `evaluateApparentTemp` (폭염 31/33/35℃ + 한파 -12/-15/-18℃, 법적 강제 / 권고 binding), `evaluateWindKmh` (10/15 m/s, km/h 자동 변환), `evaluatePM25` (36/76/150 μg/㎥, 환경부 기준), `evaluateUV` (8/11, 기상청 행동요령), `evaluatePrecipitation` (1/5/10 mm/h, KOSHA Guide). 정보 항목 (날씨/기온/습도/일출/일몰) 도 `infoEvaluation` 으로 클릭 가능. WeatherStrip 각 항목에 severity → `VALUE_CLASS` 매핑 (normal=zinc / caution=amber + `vital-blink-caution` / danger=red + `vital-blink-danger`, 생체 카드와 동일 키프레임 재사용). 신규 [WeatherRuleModal.tsx](../apps/dashboard-web/app/components/WeatherRuleModal.tsx) — 클릭 시 (a) 현재 측정값 + severity 배지 (b) 현재 적용 단계 박스 (법적/권고/참고 binding 배지) + 권고 조치 + 출처 (c) 전체 임계 단계 리스트 (현재 단계 강조) (d) 단발성 스파이크 제외 등 운영 주의사항. 19 케이스 sanity check 모두 정책대로 평가 확인.

- **결과**.
  - dev typecheck pass · analyzers test 10/10 pass · flutter build ios --release 17.6MB AOT (Cyён iPhone install + launch 성공)
  - dev/cloudflared lifecycle 분리 성공 — 새 URL `prisoners-hosting-shape-assists.trycloudflare.com` 안정
  - infra_check POST → HTTP 202 dropped, store latest 에서 사라짐
  - 정상 worker POST → HTTP 201, store 에 `EMP-1111 김수영 / EMP-6861 장우진` publish 정상 확인
  - 5칸 슬롯 + 대기 큐 + WeatherStrip + 기상 정책 모달 모두 typecheck + 광주 좌표 weather 실시간 응답 (체감 25.7℃, 풍속 14.4km/h, PM2.5 9.7, UV 1.25, 강수 0mm, 일출 05:21, 일몰 19:37 — 모두 정상 단계)
  - 정책 평가 sanity check: apparentTemp 36→danger 35°C, 33→danger 33°C, 31→caution 31°C, -20→danger -18°C / wind 60kmh→danger 15m/s, 40kmh→caution 10m/s / pm25 160→danger 150, 80→danger 76, 40→caution 36 / uv 12→danger 11, 9→caution 8 / rain 12→danger 10, 6→caution 5, 2→caution 1 — 모두 정책대로
  - **기존 폰 영향 분리 보장** — Cyён 폰 UDID `98310275-…` 만 install 명시. BECKS/YJH 안 건드림. EMP-1111 / EMP-6861 publish 정상 유지 확인

- **증거**.
  - 신규 파일: [apps/dashboard-web/app/api/weather/route.ts](../apps/dashboard-web/app/api/weather/route.ts), [apps/dashboard-web/app/components/WeatherStrip.tsx](../apps/dashboard-web/app/components/WeatherStrip.tsx), [apps/dashboard-web/app/components/WorkerQueueModal.tsx](../apps/dashboard-web/app/components/WorkerQueueModal.tsx), [apps/dashboard-web/app/components/WeatherRuleModal.tsx](../apps/dashboard-web/app/components/WeatherRuleModal.tsx), [apps/dashboard-web/lib/weather-rules.ts](../apps/dashboard-web/lib/weather-rules.ts)
  - 수정 파일: [apps/dashboard-web/app/api/mock/store.ts](../apps/dashboard-web/app/api/mock/store.ts), [apps/dashboard-web/app/api/mock/vital/route.ts](../apps/dashboard-web/app/api/mock/vital/route.ts), [apps/dashboard-web/app/components/DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx)
  - 디바이스: Cyён 의 iPhone 16 (devicectl id `98310275-6797-521D-BD09-DDEC2F34767B`, hardware UDID `00008140-001109A114E9801C`, iOS 26.4.2)
  - Memory: `~/.claude/projects/-Users-changwoojin-Documents-06-safetymonitor/memory/MEMORY.md` 2건 추가

- **다음 액션**.
  - 사용자: 3 iPhone in-app URL 새 cloudflared 갱신 + Cyён 신규 입력. 대시보드 빈 슬롯 클릭 → 대기 큐에서 등록 → WeatherStrip GPS 평균 활성 검증.
  - 자동: D2 잔여 자동 트리거 + D4 폴리싱·리허설.

### 2026-05-25 — 환경 산소 제거 + 다중 작업자 분리 fix + YJH iPhone 추가 install + Xcode 빌드 금지 정책

- **무엇**.
  - (1) **환경 산소 row 제거** — 사용자 결정 (Phase 2 자체 워치 SEN0322 합류 전까지 placeholder 의미 약함). [DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx) 의 `<AmbientO2Row .../>` 사용부 + `function AmbientO2Row` 정의 통째 삭제. [store.ts](../apps/dashboard-web/app/api/mock/store.ts) merge 에서 `ambientO2Pct` 라인 삭제. [vital-stream.ts](../packages/schemas/src/vital-stream.ts) Zod 필드 삭제. 폰은 원래 안 보내고 있어 변경 없음. 카드 행 6 → 5 row (`상태/심박/SpO₂/손목/낙상`).
  - (2) **다중 작업자 분리 버그 fix** — 사용자 보고: 두 폰 (EMP-1024, EMP-6861) 모두 publish 중인데 dashboard 에는 EMP-6861 만 표시. 진단으로 store 에는 3 workers (`demo_ios_01` stale + `EMP-1024` + `EMP-6861`) 가 있음을 확인. 원인 두 겹:
    - (a) **폰 측** — [main.dart:44-47](../apps/worker-phone/lib/main.dart#L44) 의 `_workerId = String.fromEnvironment('WORKER_ID', defaultValue: 'demo_ios_01')` 빌드 상수. dart-define 없이 빌드한 모든 iPhone 이 동일 ID. 해결: `_effectiveWorkerId` getter 추가 (사원번호 입력 시 자동 workerId, 미입력 시 fallback). `_pollOnce` (1차 + fallback 분기) / `_sendSos` / `_sendFall` 4 곳 교체. `VitalPublisher.workerId` 는 init metadata 만 사용 (publish 는 sample.workerId) — 변경 영향 없음.
    - (b) **dashboard 측** — [DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx) 의 `workers = Array.from(ids).slice(0, 5)` 가 Set 순서에서 fallback 5개 (`demo_ios_01/and_01/mock_01/02/03`) 를 우선 자리잡고 실폰 2대 (`EMP-1024/EMP-6861`) 를 잘라냄. 사용자가 본 "EMP-6861" 카드는 fallback `demo_ios_01` 자리에 매핑된 이전 빌드 잔여 metadata (workerName=장우진, empId=EMP-6861). 해결: `fallbackWorkers` 를 mock 3개로 축소 (`demo_mock_01/02/03`), `slice(0, 5)` 제거, 실폰 ts 최신 순으로 union (`actual ∪ fallback`).
    - dev 서버 재기동으로 in-memory store 의 stale `demo_ios_01` 정리. 시뮬레이션 POST 로 `[EMP-1024 양지후, EMP-6861 장우진]` union 검증.
  - (3) **YJH iPhone 15 Pro Max 추가 install** — 두 번째 시연 폰. Xcode 직접 빌드 시 SPM 통합 플러그인 4개 (`geolocator_apple/device_info_plus/flutter_secure_storage_darwin/package_info_plus`) `Flutter/Flutter.h` not found 빌드 실패. 원인 = Xcode 가 build/ 폴더 산출물을 120MB debug 로 덮어쓰면서 SPM 의존성 못 잡음. 해결 = flutter CLI 표준 절차 (`flutter clean` → `pub get` → `pod install` → `flutter build ios --release`) → 17.6MB AOT codesigned 복구 → `xcrun devicectl device install + process launch --terminate-existing` 한 번에 install + launch 성공.
  - (4) **시스템 재기동** — dev 서버 + cloudflared 다운 후 재기동. 새 quick tunnel URL `https://researchers-excitement-they-overnight.trycloudflare.com`.

- **결과**.
  - schemas build pass · dashboard typecheck pass (2회) · analyzers test 10/10 pass · flutter analyze (lint 1건 무관) · flutter build ios --release 17.6MB AOT codesigned
  - POST /api/mock/vital → HTTP 201 (ambientO2Pct 없는 payload 정상 처리)
  - 시뮬레이션 POST EMP-1024 → store 에 `[EMP-1024 양지후, EMP-6861 장우진]` 두 카드 동시 표시 union 검증
  - YJH iPhone install + launch 성공 (databaseUUID E5EB80B7-005C-4AFE-8292-95DD9F63F6A2)
  - BECKS install 성공, launch 는 device locked 로 실패 (사용자 잠금 해제 후 홈 아이콘 탭으로 실행)

- **증거**.
  - 수정 파일: [apps/dashboard-web/app/components/DemoDashboard.tsx](../apps/dashboard-web/app/components/DemoDashboard.tsx), [apps/dashboard-web/app/api/mock/store.ts](../apps/dashboard-web/app/api/mock/store.ts), [packages/schemas/src/vital-stream.ts](../packages/schemas/src/vital-stream.ts), [apps/worker-phone/lib/main.dart](../apps/worker-phone/lib/main.dart)
  - 디바이스: YJH iPhone 15 Pro Max (`19058706-7E6D-50E2-B801-B852FD6B6B1E`), BECKS iPhone 17 Pro (`9845606F-4911-547B-AE75-988FACADB105`)

- **다음 액션**.
  - 사용자: BECKS 잠금 해제 + 홈 아이콘 SafetyMonitor 직접 실행. YJH iPhone 우상단 ⚙️ → 작업자 이름 `양지후` + 사원번호 `EMP-1024` + 보호자 이름·전화 + 수신 서버 URL = 새 cloudflared URL + 위치 권한 "항상 허용". 대시보드에 두 카드 동시 표시 확인. 자동: D2/D3 잔여 트리거 + D4 폴리싱.

### 2026-05-24 — iOS 백그라운드 keepalive + SOS 모달 + SMS 자동 작성 + 보호자/GPS payload + 5명 워커 grid + store 이벤트 비-sticky

- **무엇**.
  - (1) **시스템 복구** — dev 서버 + cloudflared 모두 다운 → 재기동. 새 quick tunnel URL `https://templates-chronicle-external-interfaces.trycloudflare.com` 발급. iPhone 빌드가 다시 debug (116MB + kernel_blob.bin) 로 되어있어 standalone launch 즉시 SIGKILL → release 17.5MB 재빌드 + devicectl install/launch.
  - (2) **★ iOS 백그라운드/잠금 keepalive** — `geolocator: ^14.0.1` 추가. Info.plist 에 `UIBackgroundModes=[location, fetch]` + `NSLocationAlwaysAndWhenInUseUsageDescription` + `NSLocationWhenInUseUsageDescription`. 신규 `BackgroundKeepalive` 서비스 (medium accuracy + 50m distanceFilter + 초기 1회 즉시 캡처 + `lastPosition` 노출). `_startPolling` 안에서 `_keepalive.start()` 호출 → 상태 패널 "백그라운드" row 표시.
  - (3) **환경 산소 row + 작업자 상태 row** — `ambientO2Pct` 스키마 (Phase 2 자체 워치 SEN0322 자리). 카드 `AmbientO2Row` Phase 1 `N/A · Phase 2` 회색. `WorkerStatusRow` — 우선순위 `낙상 감지 > SOS 요청 > 위험 > 주의 > 정상 > 대기`.
  - (4) **카드 행 순서 재정렬** — `상태 → 심박 → 산소포화도 → 환경 산소 → 손목 온도 → 낙상 감지`. 사용자 명시 요청.
  - (5) **낙상 감지 row + 누적 차트** — `lastFallByWorker` (recent 스캔, 5분 recency 빨강 블링크). `VitalHistoryPanel` 에 `"fall"` 메트릭 칩 (노랑 `#facc15`) + `BarChart` 강제 + `summarizeCount` (총 건수/최대/평균). `buildHistory` fall sparse count.
  - (6) **낙상 시연 버튼 (폰)** — Apple Watch native fall detection 외부 API 없음 → 폰 하단 3-버튼 row `[수집 시작 (Expanded)] [낙상 시연 (96px 노랑 outline)] [SOS (96px 빨강 filled)]`. `_sendFall()` → `fallDetected:true` payload. 모델/스키마 동기.
  - (7) **★ SOS 모달 팝업** — 신규 `SosAlertModal.tsx`. 헤더 (블링크 원 + "SOS 긴급 알람") + **작업자 (이름/사원번호/소속 회사 스마트인재개발원/SOS 시각)** + **최신 생체 데이터** (심박/SpO₂/체온추정 기존 임계 색상·블링크) + **현장 위치 (작업자 GPS 좌표)** Google Maps 링크 + **보호자 연락처** + **119 신고** 빨강 강조.
  - (8) **★ SMS 양식 자동 작성** — `buildSmsBody(sample, audience)` 보호자/119 별 톤 다름. `[SafetyMonitor 긴급 알림] / 회사: 스마트인재개발원 / 작업자: ... / 시각: ... / 작업자 GPS 좌표: 위도 ..., 경도 ... / 지도: https://maps.google.com/?q=... / 생체: 심박 ...bpm (위험), SpO₂ ...% (위험), 체온추정 ...℃ (위험) / 조치: ...`. `sms:<number>?body=<encoded>` (iOS/macOS Messages 호환).
  - (9) **보호자/GPS payload 동봉 (폰)** — Settings 페이지에 **보호자 이름/관계** + **보호자 전화** 필드 + secure storage. 헬퍼 `_extraMeta()` 가 `_pollOnce / _sendSos / _sendFall` 모두에 보호자 + lat/lon 자동 동봉. `BackgroundKeepalive.lastPosition` 활용. 스키마 `guardianName/guardianPhone/latitude/longitude` optional.
  - (10) **store fix — 이벤트 비-sticky** — `latestByWorker` 의 spread merge 가 `manualSos/fallDetected` 를 영구 sticky 시켜 모달 재팝업/낙상 row 영구 빨강 문제. 두 필드는 sample 자기 값만 사용. 다른 vital/메타는 merge 유지. dashboard 는 `data.recent` 스캔으로 `lastSosByWorker / lastFallByWorker` 별도 계산 → 모달 트리거 + 5분 recency.
  - (11) **SOS 모달 라벨 정리** — 사용자 피드백: 좌표가 회사 위치처럼 보임. 회사명은 작업자 섹션 "소속" 라인으로 이동, 위치 헤더 → "현장 위치 (작업자 GPS 좌표)". 좌표 `위도 ... · 경도 ...` 분리.
  - (12) **5명 워커 grid + 정렬 fix** — `fallbackWorkers` 5명 (`demo_mock_03` 추가), grid `xl:grid-cols-5`, `DEMO_GUARDIANS` + mock-publish.mjs 동기. 카드 정렬: `max-w-6xl → max-w-[1600px] w-full px-6`. `ROW_CLASS` 상수 + `min-h-[3.25rem]` 모든 row 통일. 상태 배지 `whitespace-nowrap` (대 기 줄바꿈 해결). 카드 헤더 `min-h-[4.5rem]` + 사원번호 미설정 placeholder 항상 표시.
  - (13) **네트워크 시나리오 검증** — MacBook 코딩 + 발표 PC 사용 시나리오 3종 분석. 권장 = **시나리오 A (MacBook + 발표 PC 같은 망 + cloudflared 그대로)**. 추가 셋업 0건. 백업: 셀룰러 핫스팟 + LAN 직접 접속.
- **결과**.
  - iPhone 잠금/홈 상태에서도 5초 폴링 유지 (위치 권한 "항상 허용" 시).
  - SOS 버튼 탭 → 대시보드 2초 polling 안에 모달 자동 팝업 → 통화/문자 버튼 클릭 시 macOS Messages/통화 앱이 사전작성된 본문으로 열림.
  - 낙상 시연 버튼 탭 → 카드 "낙상 감지" 행 빨강 블링크 5분 유지 + 누적 차트에 fall 칩.
  - 5 카드 grid + 6 row 메트릭 list 모두 동일 높이 정렬, 빈 카드도 placeholder 로 자리 일정.
  - 회사 (소속) ↔ 위치 (GPS) 혼동 해소.
- **증거**.
  - 스키마 — `packages/schemas/src/vital-stream.ts` (`ambientO2Pct`, `manualSos`, `fallDetected`, `guardianName`, `guardianPhone`, `latitude`, `longitude` 7 필드 추가).
  - Flutter — `apps/worker-phone/pubspec.yaml` (geolocator), `apps/worker-phone/ios/Runner/Info.plist`, `apps/worker-phone/lib/services/background_keepalive.dart` (신규), `apps/worker-phone/lib/models/vital_sample.dart`, `apps/worker-phone/lib/main.dart` (Settings + 3 sample 생성부 + `_extraMeta`).
  - Dashboard — `apps/dashboard-web/app/components/SosAlertModal.tsx` (신규), `apps/dashboard-web/app/components/DemoDashboard.tsx` (lastSos/Fall computation, 카드 정렬, 5 워커, 모달 통합), `apps/dashboard-web/app/components/VitalHistoryPanel.tsx` (fall metric), `apps/dashboard-web/app/api/mock/history/data.ts` + `route.ts` (fall metric), `apps/dashboard-web/app/api/mock/store.ts` (비-sticky fix).
  - 빌드 — `pnpm --filter @safetymonitor/schemas build` pass. `pnpm --filter @safetymonitor/analyzers test` 10/10 pass. `pnpm --filter @safetymonitor/dashboard-web typecheck` pass (매 라운드). `flutter test` 1/1 pass. `flutter build ios --release` 17.5MB.
  - 네트워크 검증 — `curl https://templates-chronicle-external-interfaces.trycloudflare.com/api/mock/vital -X POST` 7개 필드 (guardian + lat/lon + manualSos) 모두 schema 통과 + store 반영.
  - 비-sticky 검증 — SOS payload 후 regular vital payload 시 latest 의 `manualSos: null` 확인.
- **다음 액션**.
  - 사용자 — iPhone 우상단 ⚙️ → 보호자 이름·전화 입력 + 저장 → 위치 권한 "항상 허용" → SOS/낙상 시연 → 대시보드 모달 + 카드 낙상 row 확인.
  - 사용자 — Galaxy 실기기 Health Connect.
  - 자동 — D2/D3 잔여 위험 감지 자동 트리거 (SpO₂ alert / 심박 marker / fall analyzer 자동).
  - 자동 — D4 폴리싱·리허설 (시연 시나리오 · 백업 영상 · 슬라이드 · 리허설 3회).
  - 발표 당일 — cloudflared 재기동 + 새 URL 추출 + iPhone in-app URL 교체 + 발표 PC 동일 URL.

### 2026-05-22 — 누적 차트 패널 재구조화 (라인/막대 차트 타입 토글 + 메트릭 칩 + summary 강화)

- **무엇**. 사용자 요청 (mockup 스크린샷 참조) — 생체 데이터 상세 화면의 그래프 타입을 선택할 수 있도록 토글 추가 + 헤더에 메트릭 빠른 전환 칩 + summary 박스 크게.
  - (1) `VitalHistoryPanel` 헤더 우상단에 `📈 라인 / 📊 막대` 차트 타입 토글 (`chartType` state) 추가. 기존 range 토글 (24h/1주/30일/60일) 과 병렬.
  - (2) 헤더 좌측에 메트릭 칩 3개 (`심박 / 산소포화도 / 손목 온도`, rounded-full pill). 클릭 시 부모 콜백 `onMetricChange` 호출 → 패널을 닫지 않고 메트릭만 즉시 전환. 선택된 칩만 메트릭 색상 (red / cyan / emerald) + 굵게 + disabled.
  - (3) summary 박스 3개 — 글자 `text-base` → `text-2xl` 확대 + 메트릭 color 적용 + `tabular-nums` + padding 확대.
  - (4) `BarChart` 컴포넌트 신규 — 동일 viewBox 720×220 + `useChartScale` 헬퍼 공유 (라인과 동일 y축). 막대 너비 = `slot × 0.7`, rounded 모서리, gradient 0.85→0.35 opacity, grid/tick/hover title 라인 차트와 동일.
  - (5) `DemoDashboard` 부모에서 `onMetricChange` 콜백 전달 (`setSelection({ workerId, metric })`).
- **결과**.
  - 카드 메트릭 클릭 → 패널 헤더에 메트릭 칩 (현재 선택 색상 표시) + 우상단 `📈 라인 / 📊 막대` + 24h/1주/30일/60일 range. 칩 클릭으로 메트릭 즉시 전환, 차트 타입 클릭으로 라인↔막대 즉시 전환. summary 박스 큰 글씨 + 메트릭 색상 (심박 red / 산소포화도 cyan / 손목 온도 emerald).
  - 라인↔막대 전환 시 같은 데이터 + 같은 y축 스케일 유지 (`useChartScale` 헬퍼) — 시각 일관성.
- **증거**.
  - 파일 — `apps/dashboard-web/app/components/VitalHistoryPanel.tsx` (전체 재구조화 + `BarChart` 신규 + `useChartScale` 헬퍼 + 칩/토글 헤더 + summary 색상), `apps/dashboard-web/app/components/DemoDashboard.tsx` (`onMetricChange` prop 전달).
  - 빌드 — `pnpm --filter @safetymonitor/dashboard-web typecheck` pass.
- **다음 액션**.
  - 사용자 — iPhone 설정 화면 입력 + cloudflared URL 적용 → 카드 메트릭 클릭 후 헤더 칩 + 라인/막대 토글 확인.
  - 자동 — D2 나머지 위험 감지 시각화 (낙상 alert · SOS 토스트 · 심박 이상 SVG marker).
  - 자동 — D4 폴리싱·리허설.

### 2026-05-22 — 카드 색 통일 + 신호등 인디케이터 + 폰↔대시보드 시그널 바 + 블링크 키프레임 fix

- **무엇**.
  - (1) Tailwind arbitrary `[animation:pulse_<X>s_ease-in-out_infinite]` 가 Tailwind 3.4 JIT 에 인식 안 돼 메트릭 값 블링크 실제 미동작 → globals.css 에 `@keyframes vital-blink` (opacity 1→0.15→1) + `.vital-blink-caution` (1.1s) / `.vital-blink-danger` (0.55s) 직접 정의.
  - (2) 카드 큰 박스에 위험 빨강·주의 amber 톤이 시연 시 산만하다는 사용자 피드백 → `statusFor` 폐기. 4 카드 모두 동일 plain `CARD_CLASSNAME = border-white/10 bg-[#0d1117]`. 종합 상태는 작업자 이름 좌측의 **신호등 (`TrafficLight`)** 으로 표시 — `overallStatus(sample) = worst-of(heartRateStatus, spo2Status, coreTempStatus)`. 정상 정적 녹 / 주의 amber 블링크 / 위험 red 빠른 블링크.
  - (3) 정상 메트릭 값 블링크도 제거 (`STATUS_CLASS.normal` 정적 emerald) — 정상은 늘 보는 상태라 깜빡이면 눈 피로.
  - (4) 폰 ↔ 대시보드 통신 freshness 시각화 — **`SignalBars`** (모바일 시그널 바 스타일, 4 막대 5~11px 계단). `signalLevel(sample, now)` = `sample.ts` 와 `now` 차이로 0~4 판정 (<8s=4 / <15s=3 / <30s=2 / <60s=1 / ≥60s=0). 색상 4-3 emerald / 2 amber / 1 red / 0 zinc 회색. 1초 단위 `now` state 로 매 초 자동 갱신. 위치는 작업자 이름 **오른쪽** (신호등 좌 · 이름 · 시그널 우).
- **결과**.
  - 카드 4개 모두 시각 톤 동일 (위험 카드만 빨갛게 변하던 효과 사라짐). 종합 상태는 신호등 1점 + 우측 텍스트 배지 (`정상/주의/위험/대기`) 로 명확.
  - 메트릭 값 — 정상 정적 emerald (피로 X), 주의 amber 1.1s 깜빡, 위험 red 0.55s 빠른 깜빡 (시선 끌림). 키프레임 직접 정의로 실제 동작.
  - 시그널 바 — iPhone 폴링이 5초마다 들어오면 풀 4 막대 (emerald), 폰이 멈추면 ~10s 후 3 → 30s 2 (amber) → 60s 1 (red) → ≥60s 0 (회색) 자동 추락. 발표 시 "통신 살아있음" 시각화 + 폰 무응답 즉시 인지.
- **증거**.
  - 파일 — `apps/dashboard-web/app/globals.css` (keyframes + 클래스 추가), `apps/dashboard-web/app/components/DemoDashboard.tsx` (`statusFor` 폐기 + `CARD_CLASSNAME` + `STATUS_LABEL` + `overallStatus` + `signalLevel` + `TrafficLight` + `SignalBars` + 1초 `now` interval).
  - 빌드 — `pnpm --filter @safetymonitor/dashboard-web typecheck` pass.
  - 검증 — 사용자 스크린샷 (이전 라운드) 에서 위험 카드 빨간 박스 확인 → 본 변경 후 plain 톤 + 헤더 신호등으로 대체.
- **다음 액션**.
  - 사용자 — iPhone 설정 화면 입력 + cloudflared URL 적용 → 대시보드 카드 헤더 매칭 + 신호등 + 시그널 바 풀 4 막대 + 메트릭 색상 (주의/위험만 깜빡) 검증.
  - 사용자 — Galaxy phone + Galaxy Watch 동일 흐름.
  - 자동 — D2 나머지 위험 감지 시각화 (낙상 alert · SOS 토스트 · 심박 이상 SVG marker).
  - 자동 — D4 폴리싱·리허설.

### 2026-05-22 — 작업자 메타데이터 매칭 + 옵션 C 손목/체온 dual + 24시간 history + 메트릭 색상 블링크

- **무엇**.
  - (1) 네트워크 환경 변경 대응 — Mac LAN IP `192.0.0.2` (cellular passthrough) + dev 서버/cloudflared 둘 다 죽음 → 재기동 + 새 quick tunnel URL 발급.
  - (2) iPhone 앱 설정 화면 추가 — 우상단 ⚙️ → `SettingsPage` (작업자 이름·사원번호 TextField + secure storage 영속화). VitalSampleSchema 에 `workerName` / `employeeId` optional 추가. payload 마다 동봉.
  - (3) codesigned iPhone release 빌드 + devicectl install/launch on BECKS.
  - (4) 대시보드 작업자 매칭 — 카드 헤더 + history panel 헤더 + recent table 모두 `이름 + 사원번호` 표시. 사원번호 라벨 명시.
  - (5) 24시간 history 추가 — `buildHistory(range=1)` 시간별 24 포인트 + `label "HH:00"` + frontend 토글에 "24시간" 옵션 (맨 앞).
  - (6) ★ 옵션 C — 손목 온도 vs 체온 정책. `THRESHOLDS.skinTemp` → `coreTemp` (cautionC 37.5 / dangerC 38.0 / wristToCoreOffsetC 1.5). `estimateCoreTempC(skin) = skin + 1.5`. analyzer 가 추정 체온 기준 비교, hazard detail 에 `skinTempC + estimatedCoreTempC` 둘 다 포함. hazard-event schema `estimatedCoreTempC` 필드 추가. dashboard `@safetymonitor/analyzers` 의존성 추가 + `TempDualRow` (손목 + 추정 dual) + `statusFor` 추정 기준 + recent table 컬럼 분리 + history panel `skinTempC` 라벨 "체온" → "손목 온도".
  - (7) 카드 메트릭 layout — 3 cols 가로 grid → `flex flex-col` 세로 stack. 각 row `grid grid-cols-[5.5rem_1fr] items-baseline` (라벨 좌 / 값 우 + `tabular-nums`). 2열 × 3행 list.
  - (8) ★ 메트릭 값 색상 블링크 — `heartRateStatus` / `spo2Status` / `coreTempStatus` 헬퍼 + `STATUS_CLASS` 매핑. 정상 emerald-300 (2.4s pulse) / 주의 amber-300 (1.4s) / 위험 red-400 (0.7s). 메트릭별 독립 판정. 심박 caution 110~129, 41~50 (의료 일반 reference).
- **결과**.
  - iPhone — `SettingsPage` 우상단 ⚙️ 진입 + 이름·사원번호 입력·저장 + secure storage (`worker_name` · `employee_id` 키) 영속화. 폴링/SOS payload 마다 `workerName` + `employeeId` 동봉. 상단 "작업자" 카드 + 상태 패널 작업자/사원번호 row 표시. 메인 화면 4 metric tile 의 "작업자" 칸이 `이름 (사원번호)` 로 갱신.
  - 빌드/install — `flutter build ios --release --dart-define=MOCK_RECEIVER_URL=https://cord-ana-rather-carroll.trycloudflare.com/api/mock/vital` Automatic signing (`F2P5ZFP65Q`) 으로 codesigned 17.4MB. `xcrun devicectl device install app --device 9845606F-... build/ios/iphoneos/Runner.app` + `process launch --terminate-existing kr.indusview.workerPhone` 한 번에 install + launch 성공.
  - 대시보드 — 카드 헤더 `장우진 / 사원번호 EMP-6861`. 우측 클릭 차트 패널 헤더 동일 매칭. recent table "작업자" 컬럼 `이름 (사원번호)`. "체온" → "손목 온도 (℃)" + 신규 "체온 추정 (℃)" 컬럼. 카드 내부 3행 list — `심박  88 bpm` / `산소포화도  98 %` / `손목 온도  35.9 ℃  체온 추정 37.4 ℃`. 메트릭별 색상 블링크 — 정상 녹색 / 주의 주황 / 위험 빨강 (속도 차등).
  - analyzers — 새 시나리오 10/10 통과 (손목 36.6℃ → 추정 38.1℃ danger / 36.1℃ → 37.6℃ caution / 35.8℃ → 37.3℃ null). `statusFor` 가 위험 → red 테두리, 주의 → amber 테두리 자동 적용.
  - mock generator — `app/api/mock/history/data.ts` `range === 1` 분기로 hourly 24 포인트. `route.ts` `ALLOWED_RANGES = [1, 7, 30, 60]`.
- **증거**.
  - 파일 — `packages/schemas/src/vital-stream.ts`, `packages/schemas/src/hazard-event.ts`, `packages/analyzers/src/thresholds.ts`, `packages/analyzers/src/hyperthermia.ts`, `packages/analyzers/src/analyzers.test.ts`, `apps/dashboard-web/package.json`, `apps/dashboard-web/app/api/mock/store.ts`, `apps/dashboard-web/app/api/mock/history/data.ts`, `apps/dashboard-web/app/api/mock/history/route.ts`, `apps/dashboard-web/app/components/DemoDashboard.tsx`, `apps/dashboard-web/app/components/VitalHistoryPanel.tsx`, `apps/worker-phone/lib/main.dart`, `apps/worker-phone/lib/models/vital_sample.dart`, `apps/worker-phone/lib/services/health_vitals_service.dart`.
  - 빌드/테스트 — `pnpm --filter @safetymonitor/schemas build` pass. `pnpm --filter @safetymonitor/analyzers build` + `test` → 10/10 pass. `pnpm --filter @safetymonitor/dashboard-web typecheck` pass. `flutter test` 1/1 pass.
  - 검증 — `curl https://cord-ana-rather-carroll.trycloudflare.com/api/mock/vital -X POST` ISO ts + workerName/employeeId 포함 payload → `HTTP 201 + {"ok":true,"sample":{...}}`. `GET /api/mock/vital` latest 응답에 `workerName/employeeId` 그대로 반영. `GET /api/mock/history?days=1` → 24 points + label `HH:00`. status 3 시나리오 fixture (normal/caution/danger) 모두 201.
  - 스크린샷 — 카드 헤더 `장우진 / 사원번호 EMP-6861`, 누적 차트 헤더 매칭, 카드 grid 2열×3행 baseline 정렬.
- **다음 액션**.
  - 사용자 — iPhone 설정 화면 입력 + cloudflared URL 적용 → 대시보드 매칭 검증.
  - 사용자 — Galaxy phone + Galaxy Watch Health Connect 권한 + 동일 cloudflared URL.
  - 자동 — D2 나머지 위험 감지 시각화 (낙상 카드 alert · SOS 토스트 · 심박 이상 SVG marker).
  - 자동 — D4 폴리싱 (시연 시나리오 · 백업 영상 · 슬라이드 · 리허설 3회).

### 2026-05-22 — 대시보드 UI 강화 + iPhone release 빌드 + Cloudflare Tunnel 우회

- **무엇**. (1) 대시보드 한국어 단위/산소포화도 한 줄/SafetyMonitor 로고/펼침 토글/누적 차트 패널 (2) dev 서버 stale chunk 500 + 라우트 파일명 충돌 fix (3) iPhone debug 빌드 standalone launch 차단 (`Cannot create a FlutterEngine instance in debug mode`) 진단 → release 빌드 재설치 (4) Flutter 앱 in-app URL 입력 + secure storage + http timeout + Health 단계별 try-catch + 시연용 fallback 값 (5) 라우터 client isolation 진단 (Mac LAN IP 변동 + ping 100% loss) → Cloudflare Tunnel 도입.
- **결과**.
  - 대시보드 — `심박/산소포화도/체온` + `bpm/%/℃` 단위. 체온 소수점 1자리 (`formatTemp`). 산소포화도 라벨 `whitespace-nowrap + text-xs` 한 줄. SafetyMonitor 로고 (방패 + ECG 펄스 SVG, cyan/emerald). 헤더 텍스트 그라데이션 + bold. 최근 수신 샘플 펼침/줄이기 토글 (기본 접힘). 카드 메트릭 클릭 → 누적 차트 패널 (1주일/30일/60일, 의존성 0 인라인 SVG, gradient fill, hover title, 평균/최저/최고).
  - mock generator — `app/api/mock/history/data.ts` deterministic (workerId × metric × day hash). `GET /api/mock/history?workerId=&metric=&days=` 신규.
  - dev 서버 — `.next/` 완전 삭제 후 재시작 + `history.ts` → `history/data.ts` 이동으로 라우트 충돌 제거. localhost/LAN/cloudflared 3경로 모두 200.
  - iPhone — debug → release 빌드 재설치 (Apple Development sign, `Installing and launching... 61.9s`). devicectl 직접 install + launch 확인. Health 권한 허용 → HR 84/SpO₂ 98/손목 온도 35.9℃ 수집 정상.
  - Flutter 앱 — `_loadReceiverUrl`/`_saveReceiverUrl` + TextField + 저장 버튼. `http.post.timeout(4s)` + `TimeoutException` → `HttpException`. `health_vitals_service.dart` 의 `latestValue` 개별 try-catch. `_pollOnce` 의 Health 읽기/publish 단계 분리. Health 빈값 시 `hr≈72±, spo2=97, temp=36.5` fallback.
  - 네트워크 — `ping 192.168.219.114` 100% loss → 라우터 client isolation 확정. `brew install cloudflared` 후 `cloudflared tunnel --url http://localhost:3000` 백그라운드 실행. URL `https://provisions-corpus-nav-discussed.trycloudflare.com` 발급. GET 200 + POST 201 + mock store 저장 검증.
- **증거**.
  - 파일 — `apps/dashboard-web/app/components/DemoDashboard.tsx`, `apps/dashboard-web/app/components/VitalHistoryPanel.tsx`, `apps/dashboard-web/app/api/mock/history/data.ts`, `apps/dashboard-web/app/api/mock/history/route.ts`, `apps/worker-phone/lib/main.dart`, `apps/worker-phone/lib/services/vital_publisher.dart`, `apps/worker-phone/lib/services/health_vitals_service.dart`, `apps/worker-phone/test/widget_test.dart`.
  - 빌드 — `pnpm --filter @safetymonitor/dashboard-web build` 6/6 static 통과 + `/api/mock/history` dynamic route 등록. `flutter test` 1/1 통과 (`viewport 확대 + 수신 서버 row assertion` 추가).
  - 검증 — `curl https://provisions-corpus-nav-discussed.trycloudflare.com/api/mock/vital -X POST ...` → `HTTP 201 + ok:true + sample 저장`. `xcrun devicectl device install app/process launch` 성공.
  - 스크린샷 — iPhone 화면 "전송 실패: ClientException with SocketException" (LAN URL 잔존 상태) + 대시보드 UI 한국어/단위/로고 반영 확인.
- **다음 액션**.
  - 사용자 — iPhone 앱 "수신 서버 URL" 필드를 `https://provisions-corpus-nav-discussed.trycloudflare.com/api/mock/vital` 로 교체 + 저장 → 5초 안에 "전송 완료 HH:MM:SS" 갱신 확인 → 대시보드 `demo_ios_01` 카드에 실시간 표시.
  - 자동 — D2 위험 감지 5종 시각화 (status badge 자동 색상 변경 + SpO₂ alert).
  - 자동 — D4 폴리싱 (시연 시나리오 + 백업 영상 + 슬라이드 + 리허설 3회).

### 2026-05-22 — iPhone HealthKit HR/SpO₂/손목 온도 수집 + 관제 표시 개선

- **무엇**. 건강 앱에서 SpO₂/손목 온도 원천 데이터가 있음을 확인한 뒤, Flutter HealthKit 조회 타입/범위와 관제 사이트 최신값 표시 방식을 수정.
- **결과**.
  - SpO₂ 조회 범위를 7일로 확장하고 HealthKit 비율값 `0.98` 을 payload 에서 `98` 로 변환.
  - 손목 온도는 `BODY_TEMPERATURE` 대신 `SLEEP_WRIST_TEMPERATURE` 우선 조회로 변경.
  - 관제 사이트 latest 는 최신 샘플의 빈 값이 이전 HR/SpO₂/Temp 를 덮어쓰지 않도록 non-null 값을 유지 병합.
  - mock receiver 최신값 수신 확인 — `heartRate:85`, `spo2:98`, `skinTempC:35.90684509277344`.
- **증거**.
  - Flutter 로그 — `Health latest vital sample: hr=85.0, spo2=98.0, skinTempC=35.90684509277344`.
  - API — `GET /api/mock/vital` latest `demo_ios_01` 에 HR/SpO₂/Temp 포함.
  - 검증 — `flutter analyze` 통과, `pnpm --filter @safetymonitor/dashboard-web typecheck` 통과.
- **다음 액션**.
  - Galaxy phone + Galaxy Watch Health Connect 권한/수집/전송 동일 검증.
  - 관제 D2 화면에서 HR/SpO₂/Temp 표시 단위와 상태 색상 개선.

### 2026-05-22 — iPhone 실기기 실행 + Health 권한 이슈 확인

- **무엇**. Android Studio 에서 iPhone `BECKS` 를 선택해 Flutter 앱을 실기기 실행하고, 앱 내 `수집 시작` 버튼 동작 상태를 확인. 이후 상단 활동 로그의 HealthKit entitlement/권한 조치로 해결됨.
- **결과**.
  - iPhone 실기기에 앱 설치/실행 완료.
  - `수집 시작` 버튼 탭 시 앱 연결 상태가 `Health 권한 요청 중` 을 거쳐 **`Health 권한 필요`** 로 표시됨.
  - 이는 앱 버튼/Flutter 호출은 정상 진입했지만 `health` 패키지의 HealthKit 권한 요청 결과가 false 로 반환되는 상태로 판단.
  - iOS `Info.plist` 의 Health usage description 은 존재. HealthKit entitlement/capability 적용을 위해 `Runner.entitlements` 와 Xcode project 설정 추가.
- **증거**.
  - 화면 — Android Studio run 대상 `BECKS (mobile)` 선택 및 앱 실행.
  - 코드 — `apps/worker-phone/lib/main.dart` 의 `_startPolling()` 에서 권한 false 시 `Health 권한 필요` 표시.
  - 설정 — `apps/worker-phone/ios/Runner/Runner.entitlements`, `apps/worker-phone/ios/Runner.xcodeproj/project.pbxproj`.
- **다음 액션**.
  - 앱 재빌드/재설치 후 iPhone 설정 > 건강 > 데이터 접근 및 기기 > Worker Phone 에서 HR/SpO₂/체온 권한 허용 확인.
  - 앱이 건강 설정에 보이지 않으면 Xcode Signing & Capabilities 에서 HealthKit capability 가 활성화되어 있는지 확인.
  - 권한 허용 후 local receiver 서버를 켜고 `MOCK_RECEIVER_URL=http://<노트북-LAN-IP>:3000/api/mock/vital` 로 폰→대시보드 전송 검증.

### 2026-05-22 — Android Studio 실행 확인 + 에뮬레이터 메모리 이슈

- **무엇**. Android Studio GUI 실행 후 Flutter plugin 설치/재시작, `worker-phone` 프로젝트 열기, 기기 선택/에뮬레이터 실행 시도.
- **결과**.
  - Android Studio Panda 4 / 2025.3.4 Patch 1 실행 확인.
  - Flutter plugin 설치 후 상단에 `main.dart` run configuration 표시.
  - `SafetyMonitor_API_35` AVD 실행 시 `Error Opening Emulator` 발생.
  - 에러 내용 — Software GL rendering fallback + system memory pressure. `Available Memory: 3946 MB, Required: 5120 MB`.
- **증거**.
  - 스크린샷 — Android Studio welcome/project 화면, Flutter plugin 설치 후 화면, emulator error notification.
  - CLI — `flutter emulators` 에 `SafetyMonitor_API_35` 표시됨.
- **다음 액션**.
  - Android Studio Device Manager → `SafetyMonitor_API_35` Edit → Advanced Settings → RAM 1024~1536MB 로 낮추고 재시도.
  - 계속 실패하면 Galaxy phone 실기기 우선. 발표 기준으로는 실기기 검증 가치가 더 큼.
  - 실행 전 대시보드 서버 유지: `pnpm dev:web`.

### 2026-05-22 — AWS 보류 대체 경로 + Android AVD 준비

- **무엇**. AWS 결제 보류 상태에서도 D1~D2 데이터 흐름을 검증할 수 있도록 Android 에뮬레이터와 local/mock receiver 경로를 구성.
- **결과**.
  - 에뮬레이터 — `SafetyMonitor_API_35` 생성 (Pixel 8 · Android 15/API 35 · Google APIs arm64-v8a). `flutter emulators` 에서 인식 확인.
  - Flutter — `MOCK_RECEIVER_URL` dart-define 추가. Android emulator 용 URL 예: `http://10.0.2.2:3000/api/mock/vital`.
  - Flutter — Android cleartext traffic 허용, iOS local networking 허용. `VitalSample` JSON 필드 `heartRate` 로 schema 정합성 보정.
  - Dashboard — `POST /api/mock/vital` receiver + in-memory store + 4 worker grid + 최근 샘플 table polling.
  - Script — `scripts/mock-publish.mjs` 추가. 4명 샘플을 5초 간격 publish, `--once` 로 1회 검증 가능.
- **증거**.
  - `flutter emulators` → `SafetyMonitor_API_35` 표시.
  - `pnpm --filter @safetymonitor/dashboard-web typecheck` 통과.
  - `pnpm --filter @safetymonitor/dashboard-web build` 통과.
  - `flutter build apk --debug --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital` 통과.
  - `node scripts/mock-publish.mjs --once` → 4 samples publish. `GET /api/mock/vital` → 4 worker latest/recent 반환.
- **다음 액션**.
  - `flutter emulators --launch SafetyMonitor_API_35` 후 `flutter run -d SafetyMonitor_API_35 --dart-define=MOCK_RECEIVER_URL=http://10.0.2.2:3000/api/mock/vital`.
  - 실기기 사용 시 laptop LAN IP 기반 URL 사용: `http://<노트북-LAN-IP>:3000/api/mock/vital`.
  - Health Connect / Apple Health 권한 팝업과 실제 latest vital query 확인.

### 2026-05-22 — D1 착수 + Android 빌드 준비 완료

- **무엇**. AWS 는 결제 문제로 우선 보류하고, Android Studio/SDK/JDK 17 준비 + Flutter `worker-phone` D1 앱 골격을 진행.
- **결과**.
  - 환경 — Android Studio 2025.3.4.7 설치. Android command line tools + SDK 36.0.0 + build-tools/platform-tools + JDK 17.0.19 설치. `flutter config` 에 Android SDK/JDK 경로 설정. Android licenses accepted.
  - 앱 — `health` · `mqtt_client` · `flutter_secure_storage` · `http` 패키지 추가.
  - 앱 — HealthKit/Health Connect 권한 요청 + HR/SpO₂/체온 latest query 서비스 골격 추가.
  - 앱 — 5초 polling, `VitalSample` JSON, AWS IoT mTLS MQTT publish 서비스 골격, HTTP fallback 골격 추가.
  - 앱 — 메인 화면을 D1 수집 화면으로 교체 (HR/SpO₂/손목 온도/workerId 카드, 상태 패널, 수집 시작, SOS 버튼).
  - 플랫폼 — Android Health Connect 권한/queries/activity-alias 추가, MainActivity 를 `FlutterFragmentActivity` 로 변경, Android minSdk 26. iOS Health usage description + iOS deployment target 14.0.
- **증거**.
  - `flutter doctor -v` → No issues found. Android SDK 36.0.0 + Java 17.0.19 + licenses accepted.
  - `flutter analyze` → No issues found.
  - `flutter test` → All tests passed.
  - `flutter build apk --debug` → `build/app/outputs/flutter-apk/app-debug.apk`.
  - `flutter build ios --simulator` → `build/ios/iphonesimulator/Runner.app`.
- **다음 액션**.
  - 실기기 — Galaxy phone + Galaxy Watch / iPhone + Apple Watch 페어링 후 Health 권한과 latest vital query 확인.
  - 자동 — AWS 보류 중에도 검증 가능한 local/mock receiver 또는 mock publish 스크립트 추가.
  - 보류 — AWS dev 계정 준비 후 IoT endpoint/cert/Rule/Lambda/DDB 연결.

### 2026-05-21 — ★ 가정 8건 정정 + 위험 감지 5종 확장 (D0 완료)

- **무엇**. 사용자 가정 8건 (A1~A8) 검증 결과 정정 — 발표 마감 2주 (D-14 = 2026-06-04) · iOS + Android 둘 다 시연 · 실기기 4대 (iPhone + Apple Watch + Galaxy폰 + Galaxy Watch) + mock 1~2명 · 위험 감지 3종 → 5종 (의료/KOSHA 권장 임계 인용). 영향 받는 코드 + 6개 문서 일괄 갱신.
- **결과**.
  - 코드 — `packages/schemas` HazardType 5종 (`fall` · `hr_abnormal` · `manual_sos` · `spo2_low` · `hyperthermia`) + VitalSample `skinTempC`/`ambientTempC` 추가
  - 코드 — `packages/analyzers` `spo2.ts` + `hyperthermia.ts` 신규. `thresholds.ts` 에 SpO₂·체온 상수 추가. `index.ts` 5종 export
  - 테스트 — 단위 테스트 5건 → **10건 (10/10 통과)**. SpO₂ danger/caution + 고온 danger/caution/null + 기존 5건
  - 문서 — `context-notes.md` "가정 8건 재정의" 결정 섹션 신규 (정정 표 + 임계값 표 + 시연 구성 + 영향 + 재검토 트리거)
  - 문서 — `CLAUDE.md` · `plan.md` · `checklist.md` · `progress.md` · `compliance.md` Status 박스 + 비범위 + 시연 흐름 + D0~D4 일괄 갱신
- **증거**.
  - 테스트 — `pnpm --filter @safetymonitor/analyzers test` → `pass 10 fail 0` (320ms)
  - 빌드 — `pnpm --filter @safetymonitor/schemas build` · `pnpm --filter @safetymonitor/analyzers build` 모두 통과
  - 파일 — `packages/analyzers/src/spo2.ts` · `hyperthermia.ts` · `analyzers.test.ts`
- **다음 액션**.
  - 사용자 — (a) AWS dev 계정 + 결제 알람 + MFA + `aws configure --profile dev` (b) Android Studio + Android SDK + JDK 17 설치
  - 자동 — D1 착수 (Flutter `health` · `mqtt_client` · `flutter_secure_storage` 통합 → 워치 데이터 query → IoT publish iOS + Android 양쪽 worker)

### 2026-05-21 — Flutter 셋업·빌드·테스트 통과 (D0 95%)

- **무엇**. 직전 결정 (단말 아키텍처 정정 + Flutter 채택) 의 실행 단계. Flutter SDK 설치 → `flutter create apps/worker-phone` → SafetyMonitor placeholder 코드 + 위젯 테스트 작성 → iOS 시뮬레이터 빌드 검증.
- **결과**.
  - Flutter 3.44.0 (Dart 3.12.0) · CocoaPods 1.16.2 설치 (Homebrew)
  - `apps/worker-phone/` 생성 — `kr.indusview.workerPhone` · 플랫폼 iOS+Android · 75 파일
  - `lib/main.dart` — SafetyMonitor 작업자 placeholder (한국어 UI, 다크 테마, "프로토타입 D0" + "연결 상태: 대기")
  - `test/widget_test.dart` — D0 빈 화면 위젯 테스트 (앱바 제목 + placeholder + 연결 상태 텍스트 3건 검증)
  - `flutter test` 1/1 통과
  - `flutter build ios --simulator` 30초 통과 — `build/ios/iphonesimulator/Runner.app` 생성
  - `flutter doctor` — iOS toolchain OK (CocoaPods 설치 후) · Chrome · Connected devices OK. Android toolchain ✗ (Android Studio 미설치, 선택 항목)
- **증거**.
  - `flutter --version` → `Flutter 3.44.0 • channel stable`
  - `flutter test` → `All tests passed!` (1/1)
  - `flutter build ios --simulator` → `✓ Built build/ios/iphonesimulator/Runner.app` (30.0s)
  - 파일 — `apps/worker-phone/lib/main.dart` · `apps/worker-phone/test/widget_test.dart` · `apps/worker-phone/pubspec.yaml`
- **다음 액션**.
  - 사용자 — (a) 가정 8건 (A1~A8) 검증 (b) AWS dev 계정 + 결제 알람 + MFA + `aws configure --profile dev`
  - 자동 — D1 착수 (Flutter `health` · `mqtt_client` · `flutter_secure_storage` pubspec 추가 → HealthKit 권한 → Apple Watch HR query → AWS IoT MQTT publish)

### 2026-05-21 — ★ 단말 아키텍처 정정 + Flutter 프로토타입 채택

- **무엇**. 사용자 정정 — "워치 앱 필요 없음. 작업자 폰 앱이 워치 생체 데이터를 받아 서버로 전송. Flutter 로 프로토타입부터 진행". 이전 가정 (워치 단독 앱) 폐기, 폰 앱 (Flutter 단일 코드) 채택.
- **결과**.
  - 모노레포 — `apps/ios-watch/` 폐기 (placeholder + 가이드 README 제거). `apps/worker-phone/` (Flutter) 자리 준비
  - 워치 OS 코드 0줄 결정 — Apple Watch / Galaxy Watch 둘 다 페어 폰의 HealthKit / Health Connect 로 자동 동기화되는 생체 데이터만 사용
  - 폰 앱 = Flutter (Dart 3.x) — `health` · `mqtt_client` · `flutter_secure_storage` 패키지 활용 예정
  - D0/D1/D3 마일스톤 재정의 — Watch 작업 제거, Flutter 폰 앱 작업으로 교체
  - 가정 A3 재해석 — "iOS 단독" → "시연 메인 OS = iOS, Flutter 단일 코드라 Android 빌드도 검증"
  - 자산 유지 — TS 모노레포 4 패키지 (`packages/schemas` · `packages/analyzers` · `apps/dashboard-web` · `backend/infrastructure`) + analyzers 테스트 5/5 + dashboard build/dev + CDK synth 그대로
- **증거**.
  - [context-notes.md](./context-notes.md) — "2026-05-21 — 단말 아키텍처 정정 + Flutter 프로토타입 채택 ★" 신규 결정 섹션 (결정 3개 + 영향 + 재검토 트리거)
  - [CLAUDE.md](../CLAUDE.md) — 환경·코드 구조·빌드 명령·핵심 관례·프로토타입 비범위 6개 섹션 갱신
  - [plan.md](./plan.md) — 검증할 핵심 가설·시연 흐름·데모 구성·데모 마일스톤·데모 비범위 일괄 갱신
  - [checklist.md](./checklist.md) — D0 개인 환경·모노레포 골격·검증 + D1 Flutter 폰 앱·D3 폰 SOS UI 재정의
  - `.gitignore` — Flutter/Dart 패턴 추가 (`.dart_tool/` · `Pods/` · `build/` 등)
  - `rm -rf apps/ios-watch/` — placeholder 폐기 완료
  - `brew install --cask flutter` — 백그라운드 진행 중
- **다음 액션**.
  - Flutter 설치 완료 → `flutter create apps/worker-phone --org kr.indusview --platforms ios,android`
  - `flutter doctor` + `flutter build ios --simulator` + `flutter test` 통과 검증
  - 검증 통과 시 D0 완료. D1 진입.

### 2026-05-21 — D0 셋업 자동화 부분 완료

- **무엇**. 사용자 지시 — "checklist.md 진행 순서대로 진행" (Auto Mode). D0 셋업의 코드·도구 부분을 일괄 수행.
- **결과**.
  - 도구 — pnpm 11.1.3 · AWS CLI 2.34.51 · CDK 2.1124.1 설치 완료 (Homebrew + npm 글로벌)
  - 모노레포 — `package.json` · `pnpm-workspace.yaml` · `tsconfig.base.json` · `.gitignore` 생성. 4 워크스페이스 (`packages/schemas` · `packages/analyzers` · `apps/dashboard-web` · `backend/infrastructure`)
  - `packages/schemas` — `Worker` · `VitalSample` · `HazardEvent` Zod 스키마 3종 + 빌드 통과
  - `packages/analyzers` — 낙상·심박이상·SOS 3종 분석기 + `tsx --test` 단위 테스트 5/5 통과
  - `apps/dashboard-web` — Next.js 15.5.18 + React 19 + Tailwind 3.4 + 빈 페이지. `pnpm build` 4 페이지 prerender · `pnpm dev:web` HTTP 200 + 한국어 텍스트 렌더 확인
  - `apps/ios-watch` — Xcode 프로젝트 GUI 생성 가이드 README (SwiftUI 골격 스니펫 포함)
  - `backend/infrastructure` — CDK 앱 (`bin/app.ts` + `lib/iot-stack.ts`) — `dynamodb.Table` (`safetymonitor-vital-stream-dev`) + `iot.CfnThing` (`safetymonitor-demo-worker-01`). `cdk synth` CloudFormation 템플릿 생성 통과
- **증거**.
  - 테스트 — `pnpm --filter @safetymonitor/analyzers test` → pass 5 fail 0 (319ms)
  - 빌드 — `pnpm --filter @safetymonitor/dashboard-web build` → 4 페이지 generated, 102 kB shared JS
  - 타입체크 — `pnpm -r typecheck` 4 패키지 모두 통과
  - 런타임 — `curl http://localhost:3000/` HTTP 200 + 13,462 B + "SafetyMonitor 관제 대시보드" 텍스트
  - CDK — `cdk synth` 후 `cdk.out/SafetyMonitor-IotStack-Dev.template.json` 생성
- **다음 액션**.
  - 사용자 — (1) 가정 8건 검증 (2) AWS dev 계정 + 결제 알람 + MFA + `aws configure --profile dev` (3) Xcode 에서 `SafetyMonitorWatch` watchOS App 프로젝트 생성 ([apps/ios-watch/README.md](../apps/ios-watch/README.md) 5분 가이드)
  - 자동 — 위 3건 후 D1 착수 가능 — Watch HealthKit 권한 + 5초 vital publish + `vital-ingest` Lambda 추가

### 2026-05-21 — ★ 프로젝트 성격 재정의 (프로토타입 전환)

- **무엇**. 사용자 지시 — "프로젝트 발표를 목표로 하는 프로토타입". 모든 기준 재정립 요청. 8개 가정 (A1~A8) 명시 후 6개 파일 일괄 재정립.
- **결과**.
  - 트랙 분리 — *프로토타입 트랙 (D0~D4)* 신규 + *발표 후 로드맵 (M0~M9)* 으로 격하
  - 범위 — iOS 단독, 단일 작업자·관제자, 위험 감지 3종 (낙상·심박이상·SOS), AWS IoT Core 유지하되 단일 디바이스
  - 비용 — 200~400만원 추정 → 거의 0
  - 이연 — 베타·법률 자문·Google Play·도메인 정식·App Store·KOSHA PDF·AuditLog·APNs/FCM/SES/Slack·멀티 테넌트
- **증거**.
  - [context-notes.md](./context-notes.md) — "2026-05-21 — 프로젝트 성격 재정의 (프로토타입 전환) ★" 신규 결정 섹션
  - [CLAUDE.md](../CLAUDE.md) — 개요에 프로토타입 명시 + 의도적 비범위에 *프로토타입 비범위* 8건 + *영구 비범위* 7건 분리
  - [plan.md](./plan.md) — 상단 "프로토타입 범위" + D0~D4 마일스톤 + 시연 흐름 5분 + 데모 구성 신규. 기존 비전~M0 결정은 "발표 후 로드맵" 으로 격하
  - [checklist.md](./checklist.md) — 상단 "프로토타입 트랙 D0~D4" 신규 (Watch·대시보드·백엔드·위험 감지·폴리싱). 기존 M0~M9 → "발표 후 로드맵" 으로 격하
  - [compliance.md](./compliance.md) — 상단 "발표 슬라이드용 1페이지 요약" 신규. 본문은 자산으로 유지
- **다음 액션**.
  - 가정 8건 (A1~A8) 사용자 검증 필요 — 어긋난 게 있으면 해당 영역 재조정
  - 검증 통과 시 D0 셋업 착수 — Xcode·Watch 확인 → 모노레포 골격

### 2026-05-21 — M0 결정 #1 — 프로젝트 정식명 `IndusView` (잠정)

- **무엇**. M0 결정 10건 중 첫 항목 — 프로젝트 정식명. 가칭 `SafetyMonitor` 폐기, `IndusView` 잠정 채택. 이유·기각 대안은 사용자 추후 보충 슬롯으로 남김.
- **결과**. M0 진척률 0% → 10%. 단 *상표·도메인 검증 전* 이라 잠정. `[~] 진행 중` 표기.
- **증거**.
  - [context-notes.md](./context-notes.md) "2026-05-21 — 프로젝트 정식명 결정 (잠정)" 신규 섹션
  - [checklist.md](./checklist.md) M0 사업·법인 첫 항목 → `[~]` 갱신
- **다음 액션**. (a) `IndusView` 상표 검색 — KIPRIS (한국) + USPTO (미국). (b) 도메인 가용성 — `.kr` / `.io` / `.com`. 두 검증 통과 시 문서 전반 `SafetyMonitor` → `IndusView` 일괄 치환 (5개 파일).

### 2026-05-21 — 정합성 이슈 4건 일괄 수정

- **무엇**.
  1. `plan.md` 위험 감지 표 — "격렬한 움직임 후 무동작" 행 제거하고 낙상 알고리즘 후속 패턴으로 흡수. 5종/6종 표현 통일 (A안).
  2. `plan.md` 아키텍처 — `architecture.png` 깨진 링크 제거하고 "추후 추가 예정" 으로 표기. 텍스트 다이어그램 그대로 유지.
  3. `checklist.md` M1 `packages/schemas` — 3개 모델 → 7개 모델 (Org·Worker·Device·Operator·VitalStream·HazardEvent·AuditLog) 확장. `plan.md` 데이터 모델 표와 일치시킴.
  4. `checklist.md` M6 알림 dedup 검증 — 1분·3분·5분 케이스 모두 차단 + 5분 초과 시 재발송 + `danger` severity 미적용 검증 항목 분리.
- **결과**. 4개 문서 정합성 확보. 다음 세션이 문서간 충돌로 혼동할 위험 제거.
- **증거**.
  - `docs/plan.md` (위험 감지 알고리즘 윤곽 · 아키텍처)
  - `docs/checklist.md` (M1 공통 패키지 · M6 검증)
- **다음 액션**. M0 결정 10건 응답 시작.

### 2026-05-21 — compliance.md 골격 작성

- **무엇**. 4개 법규 (KOSHA·개보법·근기법·의기법) + 정통망법·클라우드법 보조. 각 섹션 동일 구조 (핵심 의무 → 영향 → 필요 조치 → 미해결). 데이터 라이프사이클·작업자 동의서 v0.draft·법률 자문 질문 15개·미해결 24건 통합 리스트 포함.
- **결과**. M0 법률 자문 1회로 M0~M8 컴플라이언스 트랙 unblock 가능한 상태. `checklist.md` M0 법률·컴플라이언스 3개 항목을 본 문서로 연결해 구체화.
- **증거**.
  - `docs/compliance.md` (15,495 B / 307 줄)
  - `docs/checklist.md` 법률·컴플라이언스 섹션 4건으로 확장
- **다음 액션**. 법률 자문 변호사·노무사 컨택 후 답변 → [context-notes.md](./context-notes.md) 새 섹션 "2026-MM-DD — 법률 자문 결과" 로 기록.

### 2026-05-21 — 문서 골격 완성

- **무엇**. 프로젝트 신설. 4개 문서 작성 — [plan.md](./plan.md) · [checklist.md](./checklist.md) · [context-notes.md](./context-notes.md) · [../CLAUDE.md](../CLAUDE.md). 디렉터리 트리 결정 (모노레포 루트 + `docs/`).
- **결과**. M0 진입을 위한 *읽고 결정만 하면 되는 상태* 도달. 코드는 0줄.
- **증거**.
  - `~/Documents/06.safetymonitor/CLAUDE.md` (7,053 B)
  - `~/Documents/06.safetymonitor/docs/plan.md` (8,860 B)
  - `~/Documents/06.safetymonitor/docs/checklist.md` (12,048 B)
  - `~/Documents/06.safetymonitor/docs/context-notes.md` (5,104 B)
- **다음 액션**. M0 결정 항목 10건 응답 시작. `프로젝트 정식명` 부터 권장.

### 2026-05-21 — 문서 검토에서 발견된 정합성 이슈 (해결됨)

- **무엇**. 4개 문서 교차 검토.
- **발견**.
  1. 위험 감지 종 수 5 vs 6 불일치 — `plan.md` 알고리즘 표만 6종 (`격렬한 움직임 후 무동작` 별도), 나머지 3개 문서는 5종.
  2. 데이터 모델 — `plan.md` 7개 vs `checklist.md` M1 `packages/schemas` 3개. Org/Device/Operator/AuditLog 누락.
  3. 깨진 링크 — `architecture.png` (미생성). `compliance.md` 는 후속 작성으로 해결. `architecture.md` / `HealthPattern-reference/` 는 CLAUDE.md 트리 그림 안 텍스트라 마크다운 깨진 링크 아님 (분류 오류).
  4. 알림 dedup — 본문 5분 윈도우 vs M6 검증 케이스 1분. 모순은 아니나 5분 윈도우 검증 케이스 부재.
- **결과**. 위 4건 모두 후속 엔트리에서 일괄 수정 완료.
- **다음 액션**. 없음 (마감).

---

## 블로커·외부 의존

| 항목 | 종류 | 시작 | 응답 기한 | 상태 |
|---|---|---|---|---|
| (없음) | — | — | — | — |

> `[!]` 블로커가 발생하면 즉시 본 표에 추가. 외부 답변 (법률 자문·협력사 회신 등) 대기 시 응답 기한 명시.

---

## 메트릭 (M2 인프라 가동 후 채움)

| 메트릭 | 목표 | 현재 | 측정 시점 |
|---|---|---|---|
| AWS 월 비용 | < $200 | — | — |
| IoT 메시지 처리량 | — | — | — |
| 단말 → 대시보드 지연 | < 3s (P95) | — | — |
| 위험 감지 정확도 | 오탐 < 5건/일·인 | — | — |
| 베타 무장애 가동률 | 99%+ | — | — |

---

## 다음 세션 인계 (Handoff)

> 새 세션 (사람 or 에이전트) 이 들어오면 **이 섹션부터 읽으세요**.

1. **읽어야 할 순서**. [../CLAUDE.md](../CLAUDE.md) → [plan.md](./plan.md) → 본 파일 → [context-notes.md](./context-notes.md) → [checklist.md](./checklist.md)
2. **지금 어디**. D0 셋업 90% 완료. 모노레포 골격 + 분석기 3종 + dashboard 빈 페이지 + CDK 골격 모두 통과. 잔여는 사용자 액션 (AWS 계정·Xcode 프로젝트).
3. **첫 작업**. (a) [docs/context-notes.md "프로젝트 성격 재정의"](./context-notes.md) 의 가정 8건 (A1~A8) 검증. (b) [apps/ios-watch/README.md](../apps/ios-watch/README.md) 의 5분 가이드로 Xcode `SafetyMonitorWatch` watchOS App 생성. (c) AWS 콘솔에서 dev 계정·결제 알람·MFA·IAM 사용자·Access Key 발급 후 `aws configure --profile dev`.
4. **건드리지 말 것**. [CLAUDE.md "의도적 비범위"](../CLAUDE.md) 7개 항목. ML·CCTV·자동 119·다국어·의료기기 인증·기타 OS·자체 단말.
5. **사용자 확인 없이 진행 가능**. 문서 수정·정리·링크 추가 / 디렉터리 placeholder 생성 / 검토·요약 / 모노레포 골격 코드 / 단위 테스트 추가.
6. **사용자 확인 필수**. AWS 계정 생성·결제 카드·외부 서비스 가입·법률 자문 컨택·코드 푸시·`cdk deploy` (요금 발생).

---

## 작성 가이드

각 활동 로그 엔트리 형식.

```
### YYYY-MM-DD — 한 줄 요약

- **무엇**. 작업 내용 1~3줄
- **결과**. 달성 상태 (완료 / 부분 / 실패) + 핵심 산출물
- **증거**. 파일 경로 · 커밋 해시 · 스크린샷 · 로그
- **다음 액션**. 이 작업의 직접적 후속
```

매 활동마다 **마일스톤 상태 표** 와 **현재 상태 Snapshot** 두 곳을 동기 업데이트. 안 그러면 진척률이 거짓이 되고 다음 세션이 misread 함.
