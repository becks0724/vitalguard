# 「젯슨 구조 개편」 설계 대비 진척 — 2026-09-17 10:1x

팀원이 전달한 설계(`design-20260916.md`)의 절 번호를 그대로 따라 항목마다 상태를 적는다.
```
✅ 끝남 · 🔄 진행 중 · ⏳ 대기(선행 조건 있음) · ⛔ 막힘 · ⚠ 설계와 다르게 한 곳
```

## §5-1 젯슨 (팀원 영역 · 변경 3줄) — 담당 [M/L] · 그 세션 승인 대기

| 항목 | 상태 | 근거 |
|---|---|---|
| `Environment=CCTV_BASE=…/api/cctv-gate` | ⏳ | restart ② 에서 · 서버 env 완료 알림 뒤 |
| `Environment=PUSH_FPS=0.2` (5초 1장) | ⏳ | 같은 drop-in · PUSH_WORKERS 기본 2 → 합산 5초 계산 확인됨 |
| `Environment=CCTV_INGEST_TOKEN` | 🔄 | 토큰은 젯슨 `~/.cctv_ingest_token` 에 생성됨(600 · 64자 · sha256 앞 a53d83c8) · drop-in 은 `EnvironmentFile` 로 (유닛 파일에 값 직접 안 적음) |
| 푸셔 `conn.request` 에 `Authorization: Bearer` 1줄 | ⏳ | restart ① 에서 · 서버와 무관하게 먼저 가능(CCTV_BASE 없으면 안 보냄) |
| 기존 push 워커·경로 `/cctv/ingest3`·쿼리 그대로 | ✅ | 라이브 파일 816-826행 확인 — `drawn·persons·violations·compliance·hardhat·no_hardhat·engine` |
| ⚠ 쿼리에 `worker`·`unknown` 추가 | ⏳ | **설계에 없음.** 없으면 관제웹 「작업자 N명」이 서버 경로에서 person_count 로 떨어진다 · [M/L] 이 restart ① 에 같이 |
| 게이트 `:8443` 랜용으로 남기거나 끔 | ⏳ | 1차는 남긴다 — 웹이 아직 게이트를 본다. 2차(웹 전환) 뒤 결정 |

## §5-2 서버 (dashboard-web · astra 작업) — 담당 [CCTV/ML] · 코드 ✅ · 배포 🔄

| 항목 | 상태 | 근거 |
|---|---|---|
| 라우트 ① `POST /api/cctv-gate/cctv/ingest3` | ✅ | `b7ce7b73` · Bearer 상수시간 비교 · `image/jpeg` 아니면 415 · 256KB 초과 413 · `cctv_frame` UPSERT · 201 · 추론·메모리 보관 없음 |
| 라우트 ② `GET /api/cctv-gate/cctv/stream3` | ✅ | 게이트 `_verify` 와 같은 순서(kid→서명→nbf→exp→aud→scp) · jti 는 DB 소비 · 단발 `image/jpeg` + `X-Captured-At` · TTL 초과 503 `stale` |
| ⚠ 라우트 `GET stats3` | ✅ | **설계에 없음.** 관제웹 PPE 줄이 `${gateApi}/cctv/stats3` 를 부른다 · 게이트 화이트리스트와 같은 형태 |
| ⚠ 라우트 `POST connection3` | ✅ | **설계에 없음.** 서버는 젯슨을 못 부르므로 501 (조용한 200 금지) |
| 티켓 응답 `gateApi` → env `CAM03_GATE_API` · 코드 변경 0 | ✅ 코드 / ⏳ env | `app/api/app/admin/cctv-ticket/route.ts:82` 가 런타임 env 우선 — 확인 · env 등록은 배포 뒤 [WATCH.APP] |
| 테이블 `cctv_frame` (ensureSchema 멱등) | ✅ 코드 / 🔄 DB | `lib/db.ts` initSchema · `updated_at DEFAULT NOW_ISO`(설계의 `now_iso` 자리) · 운영 DB 생성은 새 리비전 첫 쿼리 때 — [WATCH.APP] 이 CREATE 실행-ROLLBACK 으로 사전 검사 완료 |
| 테이블 `cctv_ticket_jti` | ✅ 코드 / 🔄 DB | 같음 · INSERT 충돌 = 재사용 · 2% 확률 만료분 정리 |
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
| 1 | 한 행 5초 UPDATE 의 bloat | ⏳ | 배포 뒤 하루 두고 `pg_stat_user_tables` 의 n_dead_tup·autovacuum 시각으로 |
| 2 | jti 소비를 DB 로 · 만료 정리 | ✅ | 구현됨(소비 때 2% 확률 `DELETE … WHERE exp < now-60`) |
| 3 | Cloud Run 콜드스타트 (설계: 「dashboard 는 min 0」) | ✅ 해당 없음 | ⚠ **설계 전제가 틀림** — 실측 `minScale=1`. 콜드스타트 없음 |
| 4 | 관제웹 MJPEG 제거 | ✅ | 가드 테스트가 `RENEW_MARGIN_MS` 부재·`POLL_MS=5000` 를 고정 |
| 5 | `PUSH_FPS=0.2` 동작 (워커 2 · 위상) | ⏳ | restart ② 뒤 `pushed` 증가율(분당 ≈12)로 |
| 6 | 업로드 본문 상한 | ✅ | 256KB 서버 차단 · Cloud Run 32MB 안 |

## §8 변경 범위·순서

| 순서 | 담당(설계) | 실제 담당 | 무엇 | 상태 |
|---|---|---|---|---|
| 1 | astra | [CCTV/ML] | `verifyTicket` · 표 2개 · 라우트(2→4) · 테스트 | ✅ `b7ce7b73` |
| 2 | claude | — | 재현본 curl E2E | ⛔ **못 함** — 이 맥에 DB 없음 · 운영 DB 쓰기는 금지 → 배포 뒤 라이브 실측으로 대체 |
| 3 | astra | [CCTV/ML] | MJPEG → 스냅샷 폴링 | ✅ `6cd3fe3e` |
| 4 | 태곤 님 승인 후 claude | [WATCH.APP] | main 배포 + Cloud Run env | 🔄 **빌드 중** `b67371dc`(10:04~) · 시크릿 `CCTV_INGEST_TOKEN` v1 등록·바인딩 ✅ · `CAM03_GATE` 는 1차에서 duckdns 유지(웹은 게이트 그대로 · 앱만 서버 경로) |
| 5 | 팀원 | [M/L] | 젯슨 env 3줄 + 헤더 1줄 → 재기동 | ⏳ [M/L] 세션 승인 3건(과금·역할·시점) 대기 · restart ①(코드) → ②(env) 로 분리 |
| 6 | claude | 사용자 | 태블릿(AICAM_301A)에서 CCTV — Tailscale 없이 보이는 첫 증거 | ⏳ 5 뒤 |

## §8 하지 말 것

| 항목 | 상태 |
|---|---|
| `cctv-ai` 를 다시 켜지 않는다 | ✅ 안 켬 |
| 게이트 `:8443` 을 바깥에 여는 방향으로 되돌리지 않는다 | ✅ 안 함 |
| 스키마를 DDL 파일·직접 SQL 로 바꾸지 않는다 — 정본은 `ensureSchema` | ✅ 따름 · ⚠ **팀원 `feat/newdb-cutover` 가 정반대(ensureSchema 삭제 · DDL 파일)** — 그 브랜치가 들어오면 `cctv_frame` 을 SQL 로, jti 를 `recordCctvTicket` 기록의 `used_at` 으로 옮긴다(제가 · 1~2시간) |

## §9 배터리 실측 — 범위 밖 (태블릿 세션 몫) · 새 구조가 되면 어느 망에서든 가능

## 합계

```
설계 항목 26   ✅ 15 · 🔄 3 · ⏳ 7 · ⛔ 1
⚠ 설계와 다르게 한 곳 6  — stats3·connection3 추가 · stale 15초 · worker/unknown 쿼리 · 폴링 파일 위치 · minScale 전제 · 비용 근거
설계 밖에서 한 것       — 토큰을 채팅 없이 생성(젯슨 파일 → 파이프 → Secret Manager) · worker_count 회귀 방지 체리픽(09fa0b49)
```
