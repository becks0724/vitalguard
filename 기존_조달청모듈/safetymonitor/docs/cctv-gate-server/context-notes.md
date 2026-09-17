# CAM-03 서버 중계 — 컨텍스트 노트 (결정과 근거)

```
09-16 18:0x  착수. 설계 = 사용자 문서(design-20260916.md). 앱 코드 0 변경이 설계의 핵심 제약이다.
09-16 18:0x  이 설계는 같은 날 codex 3차가 §13 에서 짚은 「외부 공유 저장소면 다중 인스턴스가 된다」 그 대안이다 —
             7월 cctv-ai 가 프레임을 프로세스 메모리에 둬서 단일 상시 인스턴스·과금이 됐고, 이번엔 DB 한 행에 둔다.
09-16 18:1x  ⛔ 이 워크트리(tmp-507e)에서 만들지 않는다 — db.ts 가 origin/main 과 2,071줄 갈려 ensureSchema 를 건드리면 충돌한다.
             origin/main 에서 feat/cctv-gate-server 브랜치 + 새 워크트리. node_modules 는 abalone 것을 심볼릭 링크(pnpm install 금지).
             기준선(내 변경 전 tsc·test)을 먼저 떠 둔다 — 링크 때문에 깨지는 게 있으면 내 탓이 아님을 가른다
09-16 18:1x  설계에 없는 라우트 둘을 더 만든다 — 웹이 gateApi 에 stats3(PPE 줄)·connection3(연결 토글)도 부른다.
             stats3 없으면 PPE 줄이 「수신 대기」로 죽는다. connection3 은 서버가 젯슨을 못 부르니 GET {enabled:true} · POST 501
09-16 18:1x  설계의 PUSH_FPS=0.2(5초 1장)와 PPE_LIVE_TTL 3초는 서로 어긋난다 — 5초마다 오는데 3초 지나면 stale 이면 늘 stale.
             서버 TTL 기본을 15초(push 간격 3배)로 둔다. env CCTV_FRAME_STALE_SEC 로 조정
09-16 18:1x  푸셔 쿼리에 worker·unknown 이 없다 — 오늘 낮에 고친 worker_count 가 서버 중계에서는 person_count 로 떨어진다.
             서버는 있으면 받도록 만들고, 젯슨 1줄(쿼리에 worker·unknown 추가)을 §5 에 적는다
09-16 18:1x  로컬 E2E 의 한계 — .env.local 에 DATABASE_URL 이 없어 데모 모드이고, 프로덕션 DB 로 쓰기 시험은 L-04 위반.
             DB 경로는 단위 테스트(순수 함수) + 소스 가드로 덮고, 실 E2E 는 배포 뒤 실측으로 넘긴다
09-16 18:3x  기준선을 초록으로 만들려고 @safetymonitor/* 링크만 새 워크트리 패키지로 돌리고 dist 를 빌드했다.
             남은 tsc 18줄은 framer-motion·uqr 미설치(abalone 에 없는 새 의존성) — 내 범위 밖. 합격선 = 「새 오류 0」
09-16 18:4x  내 테스트가 두 번 틀렸다 — ① 서명 뒤집기가 원문을 그대로 돌려놓았다(slice 산수) → 「안 바꾼 표가 통과함」을
             통제군으로 먼저 확인하도록 고침 ② stats3 음성 가드 정규식이 정답 코드에 걸렸다 → json(frame.stats 로 좁힘.
             둘 다 「초록이어야 할 것이 빨강」이 아니라 「빨강이어야 할 것이 초록」이 될 뻔한 쪽이었다
09-16 18:4x  connection3 은 501 — 서버는 젯슨을 못 부른다. 그게 이 설계의 요점이라 숨기지 않고 말한다
09-16 18:4x  E2E 는 배포 뒤로 — DB 없는 맥에서 라우트를 돌릴 수 없고 프로덕션 DB 쓰기는 금지
09-17 09:5x  ⛔ 과금 근거 정정([M/L] 지적). 「Cloud Run 무료 한도 안이라 ≈$0」은 틀렸다 — 대시보드가 minScale=1 이라
             인스턴스가 요청과 무관하게 이미 24시간 청구되고(월 ≈262만 vCPU-초 ≫ 무료 18만), 젯슨 push 17,280/일은
             그 위에서 처리된다. 맞는 근거 = 「이미 산 인스턴스의 한계비용」 — 요청 과금 월 ≈$0.21(52만 건 · 100만당 $0.40).
             ⚠ 설계 문서 §6 도 같은 틀(request-based 무료 한도)로 ≈$0 을 냈다 — 결론은 살고 근거 줄은 한계비용으로 읽는다.
             ⚠ 조건 변화 = 대시보드를 minScale=0 으로 내리면 젯슨 push 가 인스턴스를 계속 깨워 비용 구조가 바뀐다. 그때 재측정.
             못 잰 것 = 현재 총 요청량(무료 200만 중 얼마나 찼는지). $0.21 은 한도를 넘겼다고 본 최악값이라 안전한 방향.
             결론이 맞아서 근거를 다시 안 봤다 — codex 3차가 §13 에서 짚은 것과 같은 자리.
```
09-17 10:13  env 감시(ingest3 503→401) 울림 · 00391-5q8 · env 33. [WATCH.APP] 로그의 「20초 간격 curl 503 ×10」은 이 감시였다 — 401 보고 멈춤.
09-17 10:18  restart ① — scp 로 `~/vg_edge_poc/gopro_ppe_edge.py` 교체(백업 `.bak-0917-b1c824d771b0`) · sha1 12c1413e9728 대조 · py_compile · systemctl restart.
             health `build.code_sha` 로 판정(`code_sha` 최상위 키는 없다 — `build` 안에 있다). 통제군 = env 0 · pushed 0 · frames/infers 오름.
09-17 10:19  restart ② — `~/.cctv_ingest.env`(umask 077 · 600) + drop-in `cctv-pusher.service.d/ingest.conf`(EnvironmentFile · CCTV_BASE=…/api/cctv-gate · PUSH_FPS=0.2).
             45초에 pushed 8 · push error 0 · Cloud Run 201 ×12/55초(5.00초 간격 · ≈30ms · ≈37KB) · DB captured_at 01:20:56→01:21:41 · age 2.9초.
             『fps 바꾸려고 재기동 말 것』은 지켰다 — 재기동은 코드·env 교체라 불가피했고 GoPro 는 두 번 다 살아남았다(reconnects 0).
09-17 10:2x  `zone` 키([M/L] 지적) — 구역이 꺼지면 젯슨 `_zone_stats` 가 worker_count 에 person_count 를 넣고 키는 그대로다. 서버 표에 「worker 이름으로 person 값」이
             쌓이는 것을 가르려면 구역 상태가 같이 와야 한다. 푸셔 `"zone": 1 if _zone["poly"] else 0`(무잠금 읽기 — 참/거짓뿐이라 최악이 한 프레임 늦은 값) +
             서버 `parseIngestStats` → `zone_on`(있을 때만 · false 로 채우면 「구역 꺼짐」으로 읽히므로 옛 푸셔는 키 없음). 서버 쪽은 다음 배포.
09-17 10:2x  토큰 회전엔 젯슨 재기동이 필요하다([M/L]) — `CCTV_INGEST_TOKEN` 은 import 때 읽고 `hdrs` 는 워커 시작 때 만든다. PPE_ENGINE 과 같은 성질.
09-17 10:2x  젯슨 `.build`(commit·deployed_at)는 배포 스크립트가 심는 표식이라 scp 로 안 바뀐다 — health 가 `commit 7ea27558` 을 계속 보였다.
             파일은 `1f3987d2 / 2026-09-17T01:22:16Z` 로 고쳤고(백업 `.build.bak-0917`) import 때 읽으므로 다음 재기동까지 health 는 옛 값. `code_sha` 가 정본.
09-17 10:2x  실행 주체 — 설계는 젯슨을 팀원([M/L]) 몫으로 뒀으나 사용자 지시로 [CCTV/ML] 이 실행. [M/L] 은 커밋 점검(sha1 일치 · 비밀 0 · 35+12 통과) 후 [WATCH.APP] 에 「38 맞다」.
09-17 10:2x  ⚠ 테스트 게이트 거짓 실패 — node:test 보고가 `# fail` 이 아니라 `ℹ fail` 이라 grep 이 비어 「실패」로 읽었다. 20/20 통과였다. 게이트는 exit code + `ℹ fail 0` 둘 다로.

