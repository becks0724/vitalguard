# 「젯슨 구조 개편」 설계 대비 진척 — 2026-09-17 10:1x

팀원이 전달한 설계(`design-20260916.md`)의 절 번호를 그대로 따라 항목마다 상태를 적는다.
```
✅ 끝남 · 🔄 진행 중 · ⏳ 대기(선행 조건 있음) · ⛔ 막힘 · ⚠ 설계와 다르게 한 곳
```

## §5-1 젯슨 (팀원 영역 · 변경 3줄) — 담당 [CCTV/ML](사용자 지시 09-17 「젯슨 진행해줘」) · ✅ 09-17 10:20 완료 · [M/L] 점검 통과

| 항목 | 상태 | 근거 |
|---|---|---|
| `Environment=CCTV_BASE=…/api/cctv-gate` | ✅ | restart ② 10:19:58 · drop-in `/etc/systemd/system/cctv-pusher.service.d/ingest.conf` · 프로세스 `/proc/PID/environ` 에 3종 실측 |
| `Environment=PUSH_FPS=0.2` (5초 1장) | ✅ | 45초에 `pushed 8` · Cloud Run ingest3 201 ×12 / 55초 = 정확히 5초 간격 · 지연 ≈30ms · 본문 ≈37KB |
| `Environment=CCTV_INGEST_TOKEN` | ✅ | `~/.cctv_ingest.env`(600 · 83B) → `EnvironmentFile=` · 유닛·drop-in 에 값 없음 · 서버 401→201 로 토큰 일치 실증 |
| 푸셔 `conn.request` 에 `Authorization: Bearer` 1줄 | ✅ | 커밋 `1f3987d2`(tmp-507e 38번째 · [M/L] 점검 통과) · restart ① 10:18:42 `code_sha 12c1413e9728` · 통제군 `pushed 0` · 백업 `.bak-0917-b1c824d771b0` |
| 기존 push 워커·경로 `/cctv/ingest3`·쿼리 그대로 | ✅ | 라이브 파일 816-826행 확인 — `drawn·persons·violations·compliance·hardhat·no_hardhat·engine` |
| ⚠ 쿼리에 `worker`·`unknown` 추가 | ✅ | **설계에 없음.** 같은 커밋 · 운영 DB `cctv_frame.stats` 에 `worker_count`·`unknown_count` 실측 · **+ `zone` 키**([M/L] 지적 — 구역 꺼지면 worker=person 값) · 서버 수용(`zone_on`)은 다음 배포 |
| 게이트 `:8443` 랜용으로 남기거나 끔 | ⏳ | 1차는 남긴다 — 웹이 아직 게이트를 본다. 2차(웹 전환) 뒤 결정 |

## §5-2 서버 (dashboard-web · astra 작업) — 담당 [CCTV/ML] · 코드 ✅ · 배포 ✅ 00390-hfj(이미지 127b880e) → 00391-5q8(env 33)

| 항목 | 상태 | 근거 |
|---|---|---|
| 라우트 ① `POST /api/cctv-gate/cctv/ingest3` | ✅ | `b7ce7b73` · Bearer 상수시간 비교 · `image/jpeg` 아니면 415 · 256KB 초과 413 · `cctv_frame` UPSERT · 201 · 추론·메모리 보관 없음 |
| 라우트 ② `GET /api/cctv-gate/cctv/stream3` | ✅ | 게이트 `_verify` 와 같은 순서(kid→서명→nbf→exp→aud→scp) · jti 는 DB 소비 · 단발 `image/jpeg` + `X-Captured-At` · TTL 초과 503 `stale` |
| ⚠ 라우트 `GET stats3` | ✅ | **설계에 없음.** 관제웹 PPE 줄이 `${gateApi}/cctv/stats3` 를 부른다 · 게이트 화이트리스트와 같은 형태 |
| ⚠ 라우트 `POST connection3` | ✅ | **설계에 없음.** 서버는 젯슨을 못 부르므로 501 (조용한 200 금지) |
| 티켓 응답 `gateApi` → env `CAM03_GATE_API` · 코드 변경 0 | ✅ | `app/api/app/admin/cctv-ticket/route.ts:82` 가 런타임 env 우선 · `CAM03_GATE_API` 00391-5q8 에 실림(plain) |
| 테이블 `cctv_frame` (ensureSchema 멱등) | ✅ | `lib/db.ts` initSchema · `updated_at DEFAULT NOW_ISO`(설계의 `now_iso` 자리) · 운영 DB 생성은 새 리비전 첫 쿼리 때 — [WATCH.APP] 이 CREATE 실행-ROLLBACK 으로 사전 검사 완료 |
| 테이블 `cctv_ticket_jti` | ✅ | 같음 · INSERT 충돌 = 재사용 · 2% 확률 만료분 정리 |
| 관제웹 MJPEG → 5초 스냅샷 폴링 | ✅ | `6cd3fe3e` · ⚠ 파일은 `CctvQuadView.tsx:195` 가 아니라 **`CctvGateStream.tsx`**(게이트 렌더러가 분리돼 있음) · 단발 JPEG 와 게이트 multipart 첫 프레임 둘 다 받음 |
| ⚠ stale TTL | ✅ | 설계의 `PPE_LIVE_TTL` 3초는 5초 push 와 어긋나 늘 stale → 기본 15초(`CCTV_FRAME_STALE_SEC`) |
| 테스트 | ✅ | 20건(티켓 검증 7 · 헬퍼 7 · 배선 가드 6) · tsc 새 오류 0 · lint 0 errors · 전체 2,013 중 실패 2 = 기준선(의존성 미설치) |

## §5-3 앱 — 변경 0

| 항목 | 상태 | 근거 |
|---|---|---|
| `gateApi` 가 서버 주소로 오면 지금 코드가 그대로 붙는다 | ✅ 확인 | 앱 리더는 `image/*` 단발 수용(설계 :118 인용) · 티켓 라우트 env 우선 확인 · **실기기 확인은 §8-6** |

## §6 비용

| 항목 | 상태 | 근거 |
|---|---|---|
| A안 ≈ $0 | ✅ 결론 / ⚠ 근거 정정 | 무료 한도 근거는 틀림 — 대시보드 `minScale=1` 이라 인스턴스는 이미 청구 중. 맞는 근거 = 이미 산 인스턴스의 한계비용(요청 과금 월 ≈$0.21). `minScale=0` 으로 내리면 재측정 |
| cctv-ai 다시 안 켬 | ✅ | minScale 0 · ingress internal 그대로 |

## §7 확인 필요 (설계 전 실측할 것)

| # | 항목 | 상태 | 근거 |
|---|---|---|---|
| 1 | 한 행 5초 UPDATE 의 bloat | ⏳ | push 시작 09-17 01:20Z · 09-18 같은 시각에 `pg_stat_user_tables` 의 n_dead_tup·autovacuum 시각으로 |
| 2 | jti 소비를 DB 로 · 만료 정리 | ✅ | 구현됨(소비 때 2% 확률 `DELETE … WHERE exp < now-60`) |
| 3 | Cloud Run 콜드스타트 (설계: 「dashboard 는 min 0」) | ✅ 해당 없음 | ⚠ **설계 전제가 틀림** — 실측 `minScale=1`. 콜드스타트 없음 |
| 4 | 관제웹 MJPEG 제거 | ✅ | 가드 테스트가 `RENEW_MARGIN_MS` 부재·`POLL_MS=5000` 를 고정 |
| 5 | `PUSH_FPS=0.2` 동작 (워커 2 · 위상) | ✅ | 실측 12건/55초 · 간격 5.00초(01:20:41 → :46 → :51 → :56 → 01:21:01) · 워커 둘이 겹쳐 쏘지 않음 |
| 6 | 업로드 본문 상한 | ✅ | 256KB 서버 차단 · Cloud Run 32MB 안 |

## §8 변경 범위·순서

| 순서 | 담당(설계) | 실제 담당 | 무엇 | 상태 |
|---|---|---|---|---|
| 1 | astra | [CCTV/ML] | `verifyTicket` · 표 2개 · 라우트(2→4) · 테스트 | ✅ `b7ce7b73` |
| 2 | claude | — | 재현본 curl E2E | ✅ **라이브로 대체**(재현본은 ⛔ — 이 맥에 DB 없음 · 운영 DB 쓰기 금지) · 09-17 01:20~01:21Z Cloud Run 201 ×12 + DB `captured_at` 전진 + 무토큰 401 · 틀린토큰 401 · 표 없는 stream3 401 |
| 3 | astra | [CCTV/ML] | MJPEG → 스냅샷 폴링 | ✅ `6cd3fe3e` |
| 4 | 태곤 님 승인 후 claude | [WATCH.APP] | main 배포 + Cloud Run env | ✅ 00390-hfj(digest 7c729072 · 127b880e) → 00391-5q8(env 3종) · 아카이브 2012/2012 · 시크릿 `CCTV_INGEST_TOKEN` v1 등록·바인딩 ✅ · `CAM03_GATE` 는 1차에서 duckdns 유지(웹은 게이트 그대로 · 앱만 서버 경로) |
| 5 | 팀원 | [CCTV/ML] | 젯슨 env 3줄 + 헤더 1줄 → 재기동 | ✅ 사용자 지시로 이 세션이 실행 · restart ①(코드 · 통제군 pushed 0) → ②(env · pushed 8/45초) · [M/L] 은 코드 점검 |
| 6 | claude | 사용자 | 태블릿(AICAM_301A)에서 CCTV — Tailscale 없이 보이는 첫 증거 | ✅ 09-17 11:30 사용자 육안 통과 · 서버: 표 발급 20 · stream3 200 ×20(UA `Dart/3.13`) · jti 0→20 · 젯슨 게이트에는 그 창에 태블릿 요청 0(게이트 80건은 전부 `192.168.219.44` = 관제웹 PC) · ⚠ 공인 IP 는 젯슨과 같은 `112.155.56.x`(같은 건물 회선)라 「다른 망」 판별엔 못 씀 |

## §8 하지 말 것

| 항목 | 상태 |
|---|---|
| `cctv-ai` 를 다시 켜지 않는다 | ✅ 안 켬 |
| 게이트 `:8443` 을 바깥에 여는 방향으로 되돌리지 않는다 | ✅ 안 함 |
| 스키마를 DDL 파일·직접 SQL 로 바꾸지 않는다 — 정본은 `ensureSchema` | ✅ 따름 · ⚠ **팀원 `feat/newdb-cutover` 가 정반대(ensureSchema 삭제 · DDL 파일)** — 그 브랜치가 들어오면 `cctv_frame` 을 SQL 로, jti 를 `recordCctvTicket` 기록의 `used_at` 으로 옮긴다(제가 · 1~2시간) |

## §9 배터리 실측 — 범위 밖 (태블릿 세션 몫) · 새 구조가 되면 어느 망에서든 가능

## 합계

```
09-16 집계  설계 항목 26   ✅ 15 · 🔄 3 · ⏳ 7 · ⛔ 1
09-17 10:2x 이 문서의 모든 표 행 35  ✅ 32 · 🔄 0 · ⏳ 3 · ⛔ 0   ← 세는 범위가 09-16(26)과 다르다(그때는 §5·§7·§8 일부만). 두 줄을 빼기로 읽지 말 것.
            09-17 11:3x 태블릿 ✅(서버 경로) → 회귀 수리 배포 ✅ 14:0x 00394-jt4 → 사용자 결정으로 **A(Tailscale 되돌림) 완료**
            남은 ⏳ 3 = 태블릿 Tailscale 실측(A-4 · 사용자) · 게이트 8443 처분(2차 뒤) · bloat(09-18)
            ⚠ 2차(웹도 서버 경로)는 **보류**다 — 사용자 결정 「지금은 Tailscale, 현장은 포트포워딩」(portforward-plan-20260917.md)
⚠ 설계와 다르게 한 곳 6  — stats3·connection3 추가 · stale 15초 · worker/unknown 쿼리 · 폴링 파일 위치 · minScale 전제 · 비용 근거
설계 밖에서 한 것       — 토큰을 채팅 없이 생성(젯슨 파일 → 파이프 → Secret Manager) · worker_count 회귀 방지 체리픽(09fa0b49)
                        · 푸셔 `zone` 키 + 서버 `zone_on`(구역 꺼짐 = worker 값이 person 값 · [M/L] 지적) · 젯슨 `.build` 표식 갱신(다음 재기동부터 반영)
젯슨 실행 주체 변경     — 설계는 팀원([M/L]) · 사용자 지시(09-17 「env 반영되면 [M/L]에 알리고 젯슨 진행해줘」)로 [CCTV/ML] 이 실행 · [M/L] 은 커밋 점검
```
