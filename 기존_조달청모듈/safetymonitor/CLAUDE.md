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

- **라이브** = `vitalguard-dashboard-00405-hjm` (커밋 `5aca8429` · 09-23 10:1x · 서빙 digest
  `sha256:ba4bd410…` **대조 일치** · env 33 · 검증 **2093/2093 @아카이브(5aca842 고정) · 루트 pnpm test**
  · 라우트 5종 ok · CCTV번들 ✅ 1/17 · 사후 90초 5xx 0 · DB타임아웃 0).
  **수집 시점 경보의 체온 임계를 화면과 맞췄다.**
  ```
  전     store.ts:115  coreTempStatus(피부온)  → 위험 = 피부온+0.5 >= 38.5 ⟹ 피부온 38.0
  후                   skinTempStatus(피부온)  → 위험 = 피부온 38.5   (화면·집계·내보내기와 같다)
  ⟹ 텔레그램 ❤️생체 위험이 38.0 에 울고 화면은 그것을 「주의」로 칠하던 것이 끝났다
  ```
  09-18 에 `피부온+0.5` 변환을 걷어낼 때 **이 한 줄만 옛 경로에 남았다.** 주석이 그 자리를
  「의도해서 남긴 곳」으로 적고 있어서 다음 사람이 믿게 돼 있었다 — 주석도 같이 고치고 가드 시험을 세웠다.
  ⚠ **경보가 줄어든다.** [DATA] 실측 — 과거 vital 경보 398건 중 피부온 38.0~38.5 구간이 30건,
  그중 **체온 단독 28건이 사라진다**(체온으로 운 34건의 82% · 08-25~09-22 29일 · 약 1건/일).
  사후에 「경보가 줄었다」가 보이면 장애가 아니라 이 변경이다.
  ⚠ **그 28건이 헛경보였다고 확정하지 않는다** — 정답 귓속 체온이 0건이라 못 증명한다.
  재료는 한쪽을 가리킨다(주변 공기 34℃ 이상 24/28 · 28건 전부 32.5℃ 초과 · 심박 평균 97.4,
  위험선 130 에 한 번도 안 닿음). 그래도 「잘 봐서」인지 「못 봐서」인지는 이 자료로 못 가른다.
  ★ **판정을 새로 정한 게 아니라 두 경로를 맞춘 것이다** — 38.0/38.5 자체는 여전히 잠정값이다
    (`Severity.kt:45` 가 직접 「잠정값이고 실측이 쌓이면 재조정한다」고 적고 있다).

- (직전) **라이브** = `vitalguard-dashboard-00404-4d2` (커밋 `35e78a23` · 09-21 14:2x · 서빙 digest
  `sha256:054f26fd…` **대조 일치** · env 33 · 검증 **2091/2091 @아카이브(35e78a2 고정) · 루트 pnpm test**
  · 사후 90초 5xx 0 · DB타임아웃 0).
  **앱 코드는 0줄 바뀌었다** — 문서 2 + 배포 도구 2 뿐이라 화면은 00403 과 같다.
  목적이 기능이 아니라 **절차 검증**이었다(새 게이트 기본값 · 새 CCTV 번들 가드가 실제 경로에서 도는가).
  ```
  얻은 것  _CAM03_GATE 기본값이 아무도 안 넘겨도 치환에 들어간다(09-11 구멍이 닫혔다)
           라이브 번들 ✅ 1/17 · page-68eb9368a69b79dd.js · 음성 통제 yahboom-2 → 0/17
  ⛔ 걸린 것 가드 호출이 상대경로라 배포 안에서 깨졌다 — 「No such file or directory」
           가드 자체는 멀쩡(손으로 돌리면 ✅). 깨진 건 **제자리에서 부르는 것**. 수리 98ff7da8
  ```
  ★ 09-09 의 「배포 방식(루트 pnpm test)만 2건 실패」가 사라졌다(1642/2 → 2091/0).

- **직전** = `vitalguard-dashboard-00403-cdd` (커밋 `6e8ffe7d` · 09-21 10:32 · 서빙 digest
  `sha256:86ac4222…` **대조 일치** · env 33 · 배포·기록 `session_01HnBtBj…`).
  **캘린더 표시본(잉크)을 같은 오리진으로 읽게 고쳤다** — 프리사인 GET 응답에는
  `Access-Control-Allow-Origin` 이 없어 서버는 200 인데 브라우저만 끊겼다(확장 로그의 503 은
  스토리지 상태가 아니었다). 신규 `apps/dashboard-web/app/api/calendar/media/ink/route.ts` 로 서버가 읽어 넘긴다.
  다운로드(⬇)는 네비게이션이라 무관해 `download-url` 은 안 건드렸다.
  전문 = `harness/5-observability/run-log.md` 09-21 절.
  ★ **09-18 CCTV 건과 같은 계열이다** — `curl` 은 CORS 를 안 본다.

- **직전** = `vitalguard-dashboard-00402-t5n` (커밋 `df2a9fe1` · 09-18 18:2x · 서빙 digest
  `sha256:1ce21792…` **대조 일치** · env 33 · 검증 **아카이브(df2a9fe 고정) · 2061/2061** ·
  트래픽 자동 추종 · ALLOW_DIRTY 강행(손대지 않는 2파일)).
  **CAM-01 관제웹 노출 + 체온 판정 정정 + 관제웹→젯슨 Tailscale 직결.** 화면 확인 완료.
  ```
  ★ 09-18 은 배포 4회 · push 8회다. 아래 셋이 한 흐름이다.
  00398-k2z  CAM-01 게이트 라우트 4개(ingest1·stream1·stats1·connection1) + 체온 판정
             ⛔ 실패 — 번들의 게이트 주소가 **다른 호스트**라 브라우저가 CORS 로 막았다
                우리 검증은 전부 초록이었다. `curl` 은 CORS 를 안 본다([[L-118]] 계열)
  00400-j9g  `_CAM03_GATE=/api/cctv-gate` (상대경로) → 같은 출처가 되어 화면이 떴다
  00402-t5n  `_CAM03_GATE`·`CAM03_GATE_API` 둘 다 `https://jetson-1.tailnet.invalid:8443`
             ⟹ 서버 중계(5초 1장·과금)를 젯슨 직결(연속·과금 0)로 되돌렸다
             ★ duckdns 가 16:41 에 죽어 있었다(NAT-PMP 2시간 갱신 중단) — 개선이자 복구다

  체온 판정   `피부온 + 0.5` 를 심부체온이라 부르던 것을 걷어냈다(근거 커밋 0건 · 실측 필요값 1.71)
             문자  체온추정 26.0℃(위험) → 피부온 25.5℃ (심부체온 아님)(주의)
             집계  위험 427 → 350 · 주의 8582 → 8461   ← 프로덕션 30일 82,887행 실측
             ⚠ 임계 38.0/38.5 도 워치에서 가져온 **잠정값**이다. 근거 없는 상수를 뺀 것이지
               옳은 값을 찾은 것이 아니다. `store.ts:115` 수집 시점 경보는 아직 옛 경로.
             ⛔ **그 값을 정하려던 09-18 오후 촬영(S2)이 폐기됐다** — 귀 체온 라벨 2/16 에서 중단.
               작업(사다리·배선) 중에 15분마다 체온계를 꺼내 3회 재는 일정이 현실적으로 불가능했다.
               앉아서 쟀던 S1 감각으로 짠 설계다. 워치 자료 70행만 남았다(HR 94~134 ·
               피부온 35.53~40.06 · 착용 false 13건). **임계값은 여전히 미결이다.**
               다음 설계 = 작업 중 0개 · 작업 전 3개 · 작업 후 9개([WATCH.DESIGN]).

  라우트 8/8  ingest1·stream1·stats1·connection1 · 3번 넷 — 전부 401
             통제군 ingest9 404  ← **「404 아님」으로 읽지 않는다**. 기대값을 열거해 판정한다
  라이브 번들  17개 전수([CCTV/ML] · [M/L] 교차 확인 일치) —
             tailnet 1 · yahboom-1 1 · **/api/cctv-gate 0 · 7r2vb5q5qa 0 · duckdns 0**
             통제군 CAM-03 1 · CAM-01 1   ← 0 이면 「안 잰 것」으로 본다
             박힌 값 `ld="https://jetson-1.tailnet.invalid:8443"`
             ⚠ 루트에서 받으면 로그인 화면 덩어리만 온다(내가 그 0 에 한 번 속았다).
  게이트      jetson-1.tailnet.invalid:8443 · 인증서 Tailscale 발급(2026-10-27 까지)
             CORS 정상 Origin 만 허용(통제군 evil.example.com → 헤더 없음)
             ⚠ **테일넷 기기에서만 보인다** — 공개 DNS 응답 0. 맥·태블릿은 가입돼 있다
  서버 중계    **꺼짐**(`CCTV_BASE=` 빈 값 · 과금 0). 안전망이 없으니 장애 시 복구가 두 단계다
             ① 리비전 되돌리기 ② 젯슨 `ingest.conf` 복구([CCTV/ML])
  젯슨 수치 정본 = `cctv-ai/edge/jetson-etc/README.md` ①~⑨.
             서버중계 끈 시각  2호기 18:22:00 · 1호기 18:23:38 · 서버 마지막 도착 09:23:36 UTC
             2호기 fps 원인   `jetson-clocks` 미복제(9.8 → 25 fps) — 엔진 경고는 원인이 아니었다
             줄의 진범        골격선(`bd1829f8`) · 깜빡임은 오진
                            ★ 매 프레임 · 45명 중 44개가 테두리 관절이었다(드문 결함이 아니다)
  젯슨        2호기(`yahboom-ipcctv`) 신설 · 두 대 `03bd7738e022` 동일
             ⛔ 두 대의 `machine-id` 가 같았다(제조사 동일 이미지) — 신원으로 기계를 가르지 말 것
  ```
- (직전) **라이브** = `vitalguard-dashboard-00397-cmd` (커밋 `dd481446` · 09-17 16:0x · 서빙 digest
  `sha256:56d35856…` **대조 일치** · env 33 · 검증 **아카이브(dd48144 고정) · 2057/2057** ·
  사후 90초 5xx 0·DB타임아웃 0 · 트래픽 자동 추종 · ALLOW_DIRTY 강행(손대지 않는 2파일)).
  **CAM-01 을 새 IP캠으로 — 젯슨 게이트 직결.** 화면 확인 완료(사용자).
  ```
  CAM-01   「정문 출입구」 객체감지(cctv-ai) → 「사무실(IP캠)」 PPE(젯슨 게이트 :8443 → :8445)
           카메라 TP-Link VIGI C340S · 192.168.219.48 · RTSP · 젯슨이 추론까지 하고 게이트로 냄
  DB       ensureSchema 가 cctv_site·cctv_camera 시드(멱등 · ON CONFLICT DO NOTHING)
           ★ 배포 전 롤백 시험으로 실측 — 실제로 늘어나는 것은 **cctv_camera 1행(CAM-01)** 뿐.
             cctv_site 는 SITE-01 이 이미 있어 0행. 기존 행은 안 건드린다.
  가드      CAM-01 의 gateApi 금지 해제(젯슨에 stream1 이 생겼으므로) · CAM-02 금지는 유지
  라이브 번들  「사무실(IP캠)」 1 · 「정문 출입구」 0 · duckdns 1
             통제군 심부체온 10 · ZZZNOTPRESENT 0
  젯슨 게이트 로그(10분 · [CCTV/ML] 실측) —
    192.168.219.44  stream1 8건 200 · stats1 28건 200      ← 관제웹이 CAM-01 을 실제로 받는다
    192.168.219.44  stream3 5건 · 간격 중앙 52초            ← STREAM_MODE 정상(표 만료마다 재연결)
    100.64.0.3   stream3 137건                          ← 태블릿(Tailscale)이 CAM-03 시청 중
    401·403·404 0건                                        ← unknown camera 없음 = DB 시드 통과
  운영 DB 사후 — cctv_camera 에 CAM-01 1행 신규(06:57:58Z) · CAM-03 은 09-09 행 그대로.
    배포 전 롤백 시험의 「새 행 1」과 수가 일치.
  ```

- (직전) **라이브** = `vitalguard-dashboard-00396-6qz` (커밋 `3e825f28` · 09-17 15:2x · 서빙 digest
  `sha256:0645edf0…` **대조 일치** · env 33 · 트래픽 자동 추종).
  **09-17 오후에 env `CAM03_GATE_API` 만 네 번 움직였다 — 이미지는 00393-tg9 하나로 계속 같다.**
  ```
  00394-jt4  cctv-gate.example.invalid:8443        사설 · Tailscale 되돌림(사용자 결정)
  00395-hws  tablet-cam.example.invalid:8443 공인 · 포트포워딩 시험
  00396-6qz  cctv-gate.example.invalid:8443        사설 · ★확정(태블릿 영상 확인)
  ```
  ★ **태블릿은 게이트 직결이 어느 이름으로도 안 된다.** 이름 문제가 아니라 망 문제다.
  ```
  태블릿 위치   AICAM_301A (사무실 랜 192.168.219.x 가 아니다)
  공인 이름     안 됨 — 젯슨과 같은 회선(112.155.56.x)이라 나갔다 돌아올 수 없다
  사설 이름     안 됨 — AICAM_301A → 192.168.219.0/24 경로 없음(두 망 격리 · 09-17 태블릿 브라우저 실측)
  ⟹ 남는 길 셋   Tailscale 초당 1.1장(현재) · 서버 중계 초당 0.2장 · 사무실 Wi-Fi 초당 10장(미시도)
  ```
  ⚠ **서버 중계 주기는 5초에서 올리지 않는다.** 1초=월 2.7만원이 현실 상한이고, 사람이 부드럽다고
  느끼는 초당 5장은 월 12만원을 써도 **왕복 지연 때문에 구조상 안 된다**(사진 갱신이라 영상이 아니다).
  `cctv_frame` 이 있는 DB 는 학교 서버(`project-db-campus.smhrd.com`)라 **부하를 우리가 통제 못 한다** —
  지금 주기에서만 깨끗한 것이 실측됐다(90분 1,694회 · 죽은 행 5 · 544KB).
  ⏳ 미시도 = 태블릿을 사무실 Wi-Fi 에 붙이기. 되면 비용 0 · Tailscale 불필요 · 관제웹과 같은 속도.

- (직전) **라이브** = `vitalguard-dashboard-00394-jt4` (커밋 `3e825f28` · 09-17 12:5x · 서빙 digest
  `sha256:0645edf0…` **대조 일치** · env 33(이름 그대로, `CAM03_GATE_API` 값만 바뀜) · HTTP 200 ·
  라우트 5종 ok · 검증 **아카이브(3e825f2 고정) · 2057/2057** · 사후 90초 5xx 0·DB타임아웃 0 ·
  트래픽 자동 추종 · ALLOW_DIRTY 강행(손대지 않는 2파일)).
  **사용자 결정 09-17 — 지금은 Tailscale 방식으로 되돌린다.** 서버 중계는 지우지 않고 폴백으로 남긴다.
  이미지 배포 = `00393-tg9`, env 되돌림 = `00394-jt4`(같은 digest).
  ```
  왜        서버 중계는 설계상 5초 1장(요청 단위 과금) · 젯슨 게이트 직결은 초당 ~10장
  ⚠ 회귀   09-16 폴링 전환(6cd3fe3e)이 게이트 경로까지 5초 1장으로 만들었다 — 00390~00392 에 실려 있었다
  수리      12852cdb — content-type 으로 가름. image/jpeg=5초 폴링 / multipart=표 만료까지 흘려 받음
  웹        CAM03_GATE 기본값(duckdns) — 빌드 인자 안 넘김
  앱        CAM03_GATE_API=https://cctv-gate.example.invalid:8443 (서버 경로에서 되돌림)
  라이브 번들 실측(청크 17개 · 1,987,933 B) —
    duckdns.org:8443   적중 1      /api/cctv-gate     적중 0
    "malformed stream" 적중 1      ← 수리본에만 있는 문자열(옛 판 소스 0 · 배포본 소스 1)
    통제군 「심부체온」 10 · ZZZNOTPRESENT 0 · "no frame" 1 · "--frame" 1
  ⚠ 표지가 주석에만 있으면 minify 에서 사라진다 — `multipart` 적중 0 은 「수리 없음」이 아니다.
    판정은 **동작 코드의 문자열 리터럴**로 한다.
  ⚠ 팀원이 우리 조율 밖에서 배포한다(00392-6dq = 279881795+rlaxorhs77-eng@users.noreply.github.com 02:45:29Z).
    `--ongoing` 0건만으로 부족 — **착수 직전에 라이브 리비전을 한 번 더 읽는다.**
  ```

- (직전) **라이브** = `vitalguard-dashboard-00391-5q8` (커밋 `127b880e` · 09-17 01:1x · 서빙 digest
  `sha256:7c729072…` **대조 일치** · env **33**(직전 30 → CAM-03 서버 중계 3종 추가) · HTTP 200 ·
  라우트 5종 ok · 검증 **아카이브(127b880 고정) · 2012/2012** · 트래픽 자동 추종(보정 없음) ·
  ALLOW_DIRTY 강행(손대지 않는 2파일)).
  **CAM-03 을 젯슨 직결에서 서버 중계로 — 시청 경로에서 Tailscale·DuckDNS·포트포워딩이 빠진다.**
  이미지 배포 = `00390-hfj`, env 3종 갱신 = `00391-5q8`(같은 digest, env 만 다름).
  ```
  신규 라우트  /api/cctv-gate/cctv/{ingest3,stream3,stats3,connection3}
  신규 표      cctv_frame(카메라당 최신 1행) · cctv_ticket_jti(표 1회 소비) — 운영 DB 에 생성됨
  env 3종      CAM03_GATE_API=…7r2vb5q5qa-du.a.run.app/api/cctv-gate · CCTV_FRAME_STALE_SEC=15
               CCTV_INGEST_TOKEN=<시크릿 v1>
  라이브 실측  ingest3 토큰없음 401 · 틀린토큰 401 · stream3·stats3 표없음 401 "ticket required"
               통제군 없는 라우트 zzz9 → 404 (401 이 진짜 판정이라는 뜻)
  ⚠ env 얹기 전 ingest3 는 503 이었다 — 「503 = env 안 먹음」이 설계된 신호다(사후관찰 5xx 3건의 정체)
  ⚠ 1차에서 웹 화면은 아직 젯슨 게이트를 본다(CAM03_GATE 는 duckdns 기본값 그대로). 서버 경로는 앱만.
  ⏳ cctv_frame 행 0 — 젯슨 push 전환은 [M/L] 담당, 아직 안 켜짐
  ```

- (직전) **라이브** = `vitalguard-dashboard-00389-mcd` (커밋 `9e30a726` · 09-15 19:0x · 서빙 digest
  `sha256:ca32cc8e…` **대조 일치** · env 30 유지(직전 30) · HTTP 200 · 라우트 5종 ok · 사후 90초 5xx 0건·DB타임아웃 0건 ·
  검증 **아카이브(9e30a72 고정) · 루트 pnpm test 1992/1992** · commit-sha 라벨 = APPROVED_AT ·
  ALLOW_DIRTY 강행(손대지 않는 2파일) · 트래픽 자동 추종이라 보정 없음).
  ⚠ 표기가 **00373 → 00389 로 여러 리비전 낡아 있었다** — [[L-129]]④ 재발. 라이브는 `describe` 로 읽는다.
  **화면 PPE 모델명을 엣지가 보낸 값으로 — `YOLO26s v5` 하드코딩 → `YOLO26s v7d`.**
  라이브 번들 실측(청크 17개 · 1,986,989 B) —
  ```
  x=(null==d?void 0:d.engine)?"YOLO26s ".concat(d.engine):lu.ppe     ← 새 경로가 실렸다
  lu={object:"YOLOv8",ppe:"YOLO26s v5"}                              ← 폴백 보존(Hexmon 클립 경로용)
  'YOLO26s' 총 2건 = 템플릿 1 + 폴백 1
  ⚠ 계수는 `grep -o | wc -l` 로 — 번들은 한 줄이라 `grep -c` 는 전부 1 로 보인다(09-15 실제로 오판)
  ```
  **CAM-03 게이트 치환은 이제 기본값이 낸다(`6e33c79c`).** 아무도 안 넘겼는데 빌드 3/5 줄에
  `_CAM03_GATE=https://cctv-gate.example.invalid:8443` 이 찍혔고, 번들 `duckdns 적중 1`
  (통제군 「심부체온」 1 · 없는 문자열 0). 09-11 에 이틀 죽었던 인자다.
  체인 실측(배포 후) — 티켓 200(ttl 60초) → 게이트 `/cctv/stats3` 200 `{"engine":"v7d",...}` ·
  통제군 `person_count` 2 · `violation_count` 2(0 이 아니므로 업스트림을 읽고 있다) ·
  CORS preflight 200 `Access-Control-Allow-Origin` = 대시보드 Origin, `Authorization` 허용
  (통제군 — 허용목록 밖 Origin 에는 그 헤더가 안 붙는다).
  ⛔ **브라우저 렌더 육안 확인은 미완** — 변경 주인([CCTV/ML])이 본다. 위는 전부 체인 증거지 화면이 아니다.
  ⚠ **DuckDNS 가 사설 IP(192.168.219.47)를 가리키므로 시청은 같은 LAN 안으로 한정**(09-09 사용자 승인). 외부 시청은 별도 결정 사항.

- (직전) **라이브** = `vitalguard-dashboard-00373-hm8` (커밋 `9f46a9c0` · 09-12 23:2x · 서빙 digest
  `sha256:31455442…` **대조 일치** · env 30 유지(직전 30) · HTTP 200 · 라우트 5종 ok · 사후 90초 5xx 0건·DB타임아웃 0건 ·
  검증 **아카이브(9f46a9c 고정) · 루트 pnpm test 1658/1658** · commit-sha 라벨 = APPROVED_AT ·
  ALLOW_DIRTY 강행(손대지 않는 2파일) · 트래픽 자동 추종이라 보정 없음).
  **CCTV CAM-03 게이트 주소 복구 — 애플리케이션 코드 0줄.** 09-11 `00371` 빌드부터 빌드 치환 `_CAM03_GATE` 가 빠져
  CAM-03 이 옛 cctv-ai 폴백(=OFF·404)으로 떨어져 있었다. `NEXT_PUBLIC_*` 은 **빌드타임**이라 이미지 재빌드로만 복구된다.
  ⚠ **소스 가드(`2026-09-09-cctv-gate-wiring.guard.test.ts`)로는 안 잡힌다** — 가드가 보는 것은 배선(소스)이고 빠진 것은 치환(빌드 산출물)이라,
  1658/1658 초록인 채 기능만 죽어 있었다. 판정은 **라이브 번들 검색**으로만 된다.
  라이브 실측 = 청크 17개 중 `app/page-86bacf8cf0d3c286.js` 에 `gateApi:"https://cctv-gate.example.invalid:8443"` **적중 1**
  (통제군 「심부체온」 1 적중 · 없는 문자열 0 적중). 게이트 쪽 = preflight 200 · 표 없이 `stream3` **401** · 인증서 12-08 · 푸셔 29.9fps.
  ⚠ **DuckDNS 가 사설 IP(192.168.219.47)를 가리키므로 시청은 같은 LAN 안으로 한정**(09-09 사용자 승인). 외부 시청은 별도 결정 사항.

- (직전) **라이브** = `vitalguard-dashboard-00372-r9t` (커밋 `4595afcd` · 09-11 16:45 · 서빙 digest
  `sha256:dc0455c4…` **대조 일치** · env 30 유지(직전 30) · HTTP 200 · 라우트 5종 ok · 사후 90초 5xx 0건·DB타임아웃 0건 ·
  검증 **아카이브(4595afc 고정) · 루트 pnpm test 1658/1658**(`ARCHIVE_SKIP` 1파일 10건 제외 — 워킹트리 기준값은 1668) ·
  commit-sha 라벨 = APPROVED_AT · ALLOW_DIRTY 강행(손대지 않는 2파일) · 트래픽 자동 추종이라 보정 없음).
  **의존성 보안 상향만 — 애플리케이션 코드 0줄.** `next 15.5.21→15.5.25`(critical 2: 인증 없는 RCE·이미지 최적화 RCE) ·
  `js-yaml 4.3.1→4.3.2` · `sharp 0.34.5→0.35.4`(각 high 1). `ignoreGhsas` 는 안 건드림 — 이 레포 방침이 "덮지 않고 올린다".
  ⚠ **원인은 CI 가 22시간 죽어 있던 것**이다 — `Verify safetymonitor` 가 2단계 `pnpm audit` 에서 exit 1 나면서
  빌드·타입·린트·그래프·테스트 **4단계가 통째로 안 돌았다**. 09-10 이후 main 커밋은 검증을 통과한 적이 없다.
  배포 후 CI 7단계 전부 초록(run 34573849805 @ `4595afc`). 그동안 깨진 건 없었지만 **그건 운이지 검증이 아니다.**
  라이브 실측(화면) = HTML 렌더 정상(title·스크립트 21개·에러 문구 0 · 404 통제군 정상). 고권한 로그인 뒤 눈 확인은 여전히 미완.
  ⚠ **표기가 3리비전 낡아 있었다** — 이 줄이 `00369-gsw` 인 동안 실서빙은 `00371-w2x`(팀원 `dbf1199`, CLOVA 전환)였다.
  `00370`·`00371` 은 표기가 갱신되지 않았다([[L-129]]④ 재발 — 라이브는 `describe` 로 읽는다).
  직전 라이브 = `00371-w2x`(dbf1199).
  ⚠ **`Secret scan` 은 여전히 실패 중이다**(이 배포와 무관) — gitleaks `generic-api-key` 오탐 2건,
  둘 다 `.test.ts` 안의 `test-` 접두 더미(`newdb/actor.test.ts:56` · `2026-09-03-mobile-two-factor.guard.test.ts:33`).
  `.gitleaksignore` 는 모든 브랜치 스캔에 걸리는 설정이라 한 세션이 정하지 않는다 — 사용자 판단 대기.

- **라이브** = `vitalguard-dashboard-00369-gsw` (커밋 `6c523ebb` · 09-10 11:4x · 서빙 digest
  `sha256:fb47ca9b…` **대조 일치** · env 29 유지 · HTTP 200 · 사후 90초 5xx 0건·DB타임아웃 1건(기존 간헐 기저 범위) ·
  검증 **tsc·test 워킹트리(= 6c523ebb · 1668/1668 · SKIP_VERIFY)** · commit-sha 라벨 = HEAD · clean 진입 · 세션에서 스크립트 직접 실행(이번엔 분류기 차단 없음)).
  **로그인 뒤 현장 선택 단계의 2단계 인증 안내문구 — 로고와 제목 사이 가운데(my-6)·글 가운데 정렬**(`8248d44d` · 09-10 사용자 지시 · 브랜치 dev 서버 실측 위 24px/아래 24px·가로 중심 일치).
  함께 나간 것(L-59) = 팀원 `4d2968be` fix(db) 유휴 커넥션 회수 중단 + keepAlive + 새 접속 멎음 1회 재시도 + 웜풀 계측(+가드 2) — 배포 범위 00368(639f5f9)→6c523ebb 2커밋.
  ⚠ **트래픽이 또 리비전에 고정(pinned)돼 있었다** — 팀원 리비전 `00368-7d7`(639f5f9)은 만들어졌지만 서빙되지 않은 채였고, 스크립트가 `00369` 로 0%→100% 전환했다(정상 절차 메시지). 09-09 와 같은 재발 · 고정 원인 미확인.
  라이브 실측(화면) = 미완 — 안내문구 정렬은 고권한 계정 로그인 뒤 눈 확인이 남음(09-09 지도 탭 등록 버튼 건도 미완).
  직전 라이브 = `00367-5m5`(154ed4a) → 표기상 `00368-7d7` 은 서빙 안 됨.

- **라이브** = `vitalguard-dashboard-00367-5m5` (커밋 `154ed4a` · 09-09 18:2x · 서빙 digest
  `sha256:e7e94fb8…` **대조 일치** · env 29 유지 · HTTP 200 · 라우트 5종 ok · 사후 90초 5xx 0건·DB타임아웃 0건 ·
  검증 **tsc·lint·test 워킹트리(= 154ed4a · SKIP_VERIFY)** · commit-sha 라벨 = HEAD · clean 진입 · 태곤 님이 `!` 로 직접 실행(분류기가 세션 실행을 막음)).
  **작업자 지도 보기에서 "+ 작업자 등록" 숨김**(`eddc8d1b` · 09-09 사용자 지시 — 지도 모드에는 슬롯이 안 보여 눌러도 결과가 없다 · 슬라이딩 토글과 같은 조건).
  함께 나간 것(L-59) = 팀원 CCTV 게이트 11커밋 병합(`afcd6aeb` 까지 · 낙상 폴러 403 백오프 포함) — 배포 범위 00364→154ed4a 30커밋·52파일.
  ⚠ **트래픽이 `00364-t94` 에 고정(pinned)돼 있었다** — 팀원 리비전 `00365`·`00366` 은 만들어졌지만 서빙되지 않은 상태였고, 스크립트가 5/5 에서 `00367` 로 0%→100% 전환했다(정상 절차 메시지). 이후 배포는 latest 자동 추종.
  라이브 실측(화면) = 미완 — 지도 탭 전환 시 등록 버튼 사라짐은 로그인 뒤 눈 확인이 남음.
  직전 라이브(표기상) = `00365-krk` → 실제 서빙은 `00364-t94`.

- 직전 = `vitalguard-dashboard-00365-krk` (커밋 `2cfc8a7` · 09-09 13:1x · 서빙 digest
  `sha256:bee06637…` **대조 일치** · **env 29**(28→29 · `CCTV_TICKET_KEY` 신규) · HTTP 200 · 라우트 5종 ok ·
  검증 **1644/1644 @ 아카이브(2cfc8a7 고정)** · commit-sha 라벨 = APPROVED_AT 일치 · DIRTY 진입(타 세션 미커밋 1)).
  **CCTV CAM-03 젯슨 직결 게이트**([CCTV/ML] 8건 cherry-pick + 통합수리 1건 · 배포 [WATCH.APP]) —
  CAM-03 영상을 cctv-ai(Cloud Run)를 안 거치고 젯슨에서 브라우저가 직접 받는다. 로그인·현장 인가를 서버가 판정해
  Ed25519 티켓을 발급하고, 표는 URL 이 아니라 `Authorization` 헤더로 보낸다(canvas 렌더 — `<img>` 는 헤더를 못 붙인다).
  범위에 팀원 **「담당자 지정 위험구역 기능 제거」**(09-08 팀 결정)·워치 화면 순서 변경·문서 다수가 함께 실렸다(50파일 +17,407/−825).
  라이브 검증 = **번들 `gateApi:"https://cctv-gate.example.invalid:8443"` 적중**(청크 17/17 · 통제군 `심부체온 추정 준비 중` 1 유지).
  ⚠ **영상은 학원 LAN 안에서만 보인다** — 게이트가 사설 IP(192.168.219.46)를 가리킨다(공용망이라 포트포워딩 불가 · 사용자 승인).
    **밖에서 CAM-03 이 "연결 중" 인 것은 정상**이고, 화면으로는 주소가 박혔는지 못 가른다(안 박혀도 "일시 중단" 이라 둘 다 영상 없음).
    실제 호출까지 보려면 LAN 밖 개발자도구에서 `OPTIONS …:8443/cctv/stats3` 요청이 나가는지 본다.
  ⚠ 사후 90초 DB타임아웃 1건(`[aed/inspections]`) = **기존 간헐**(7일간 `00362`·`00223`·`00352` 에 걸쳐 나옴 · 재발 0 · 라우트 현재 정상).
  직전 라이브 = `00364-t94`(구 이미지 + `CCTV_TICKET_KEY` 시크릿만 · 반쪽 구간 회피용) → 그 전 `00363-tt2`.

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

- **재서명 — ✅ 완료(08-27 09:10).** 만료 08-27 10:09 → **09-03 09:09 KST**. 폰·워치 둘 다 설치.
  `wdm` 도 함께 실려 닫혔다(`413942c` · 09:19 도착분부터 `watch_device_model=Watch6,18`).
  ⚠ **다음 만료 09-03 09:09 · 미리 알림 09-01.** 워치 코드 변경은 이 창에 묶는다(재설치가 세션을 끊는다).
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
- 08-31 ~ 09-08 트랙(00345~00363) → [claude-md-archive-20260910.md](docs/claude-md-archive-20260910.md) (최근 이동분이 파일 위쪽)
- 08-26 ~ 08-31 트랙(00322~00344) → [claude-md-archive-20260831.md](docs/claude-md-archive-20260831.md) (최근 이동분이 파일 위쪽)
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
- **담당자 지정 위험구역(지도에 원을 그려 진입 경보)** — 2026-09-08 팀 결정으로 **제거**. `danger_zone` 표·`/api/danger-zones`·
  `danger_zone` 경보 종류·지도 배치 UI 전부 삭제(신 DB 도 069 로 표·kind 제거). 영상 기반 위험구역 침입(vision-ppe-plan)은 별개 개념이다.

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
