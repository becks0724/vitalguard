# CAM-03 서버 중계(가스포드 방식) — 체크리스트

설계 정본 = `design-20260916.md` (사용자 작성 · 09-16). 이 파일은 그 설계를 코드로 옮기는 진행표다.

## 0. 착수 전 확인 (실측)
- [x] 288커밋 뒤 측정 — `db.ts` 2,071줄/56 hunk 갈림 → **origin/main 에서 새 브랜치 `feat/cctv-gate-server` · 새 워크트리 `cctv-gate/`**
- [x] 푸셔 POST = `{CCTV_BASE}/cctv/ingest3?drawn=1&persons&violations&compliance&hardhat&no_hardhat&engine` · `Content-Type: image/jpeg` · 인증 없음 · keep-alive
  - ⚠ `worker`·`unknown` 이 없다 — 젯슨 1줄 추가 항목(§5). 서버는 있으면 받고 없으면 비운다
- [x] 앱 티켓 라우트 `:82` = `CAM03_GATE_API ?? NEXT_PUBLIC_CAM03_GATE_API` — 런타임 env 우선 → 앱 코드 0 변경 성립
- [x] 웹이 gateApi 에 부르는 경로 = `stream3` · `stats3` · `connection3`(POST control) — 설계에 없는 `stats3`·`connection3` 도 만든다
- [x] URL `https://vitalguard-dashboard-7r2vb5q5qa-du.a.run.app` · `CAM03_GATE_API`·`CCTV_INGEST_TOKEN`·`PPE_LIVE_TTL` 전부 없음(배포 때 넣는다)

## 1. 서버 — lib
- [x] `lib/cctv-ticket.ts` `verifyTicket()` — 서명(개인키에서 공개키 유도) · nbf(+skew) · exp · aud · scp
- [x] jti 1회 소비를 DB 로 — `consumeCctvTicketJti` · INSERT … ON CONFLICT DO NOTHING RETURNING · 만료분 2% 확률 정리
- [x] `cctv_frame(camera_id PK → cctv_camera, jpg BYTEA, captured_at, stats JSONB, updated_at)` — ensureSchema 멱등
- [x] 단위 테스트 — `cctv-ticket-verify.test.ts` 7건(왕복·변조·다른 키·kid·시계·카메라/범위·형식) · `cctv-frame.test.ts` 7건

## 2. 서버 — 라우트 `/api/cctv-gate/cctv/*`
- [x] `POST ingest3` — `Authorization: Bearer <CCTV_INGEST_TOKEN>` 상수시간 비교 · `image/jpeg` · 256KB 상한 · UPSERT
- [x] `GET stream3` — 티켓 검증 · jti 소비 · 단발 `image/jpeg` + `X-Captured-At` · TTL 초과 503 stale
- [x] `GET stats3` — ⚠ 설계 문서에 없음. 웹 PPE 줄이 `${gateApi}/cctv/stats3` 를 부르므로 필요 · 화이트리스트 형태 유지
- [x] 라우트 배선 가드 — `2026-09-16-cctv-gate-server.guard.test.ts` 6건 (soft 모드 금지 · 문 하나 · 검증 뒤 소비 · 단발 JPEG · 화이트리스트 · 폴링)
- [x] `POST connection3` — 서버는 젯슨을 못 부르므로 501 (조용한 200 금지 · 표 검증은 그대로)

## 3. 웹 — `CctvGateStream` MJPEG → 5초 스냅샷 폴링
- [x] `CctvGateStream` — 5초 폴링 · `readFirstJpeg`(단발 image/jpeg 와 게이트 multipart 첫 프레임 둘 다) · 503 → 「현장 장비 신호 없음」
- [x] 장기 연결 0 — `RENEW_MARGIN_MS` 제거 · 요청마다 8초 상한 · 가드가 고정

## 4. 검증
- [x] tsc 새 오류 0(기준선 18줄 = framer-motion·uqr 미설치, 링크된 node_modules 한계) · lint 0 errors · test 2,013 중 실패 2 = 기준선 그대로 · 내 20건 통과
- [ ] 로컬 E2E — ⛔ 이 맥에 DB 가 없다(.env.local DATABASE_URL 없음 · 프로덕션 DB 쓰기는 L-04 위반). 배포 뒤 라이브에서 실측한다

## 5. 배포·젯슨 — 사용자 결정 09-17 「① 내 것 먼저 · 오늘 배포·태블릿 실측」

```
합치는 순서   내 브랜치 먼저 main 에. 팀원 feat/newdb-cutover(ensureSchema 삭제 · DDL 파일)가 들어오면
             cctv_frame 은 SQL 파일로, jti 는 recordCctvTicket 기록의 used_at 도장으로 옮긴다 — 제가 한다(1~2시간)
astra        = 팀원(rlaxorhs77) 세션. 원격 브랜치 전수에 cctv-gate 흔적 0 — 팀원 쪽이 같은 걸 만든 흔적은 없다
역할          push·배포 = [WATCH.APP](/deploy 는 그 세션에서 승인) · 젯슨 = [M/L](오늘 gopro_ppe_edge.py 를 쥐고 있음 ·
             worker/unknown 1줄 포함) · 토큰 생성·검증 = [CCTV/ML]
토큰 경로     젯슨 ~/.cctv_ingest_token(600 · 개행 없음) → 파이프로 Secret Manager CCTV_INGEST_TOKEN — 채팅을 거치지 않는다
1차 범위      서버 배포 + Cloud Run env(앱이 서버 경로로) + 젯슨 push. 웹 빌드 인자는 duckdns 그대로(웹은 폴링만 바뀜)
             → 태블릿 실측 통과 뒤 웹 빌드 인자 전환(2차)
```

```
Cloud Run env (배포 때 함께)
  CAM03_GATE_API=https://vitalguard-dashboard-7r2vb5q5qa-du.a.run.app/api/cctv-gate   ← 앱 티켓 응답의 gateApi
  CCTV_INGEST_TOKEN=<새로 발급 · Secret Manager>                                   ← 젯슨 → 서버
  CCTV_FRAME_STALE_SEC=15                                                          ← (선택) 기본 15
빌드 인자  CAM03_GATE=https://vitalguard-dashboard-7r2vb5q5qa-du.a.run.app/api/cctv-gate   ← 웹 NEXT_PUBLIC_CAM03_GATE_API
젯슨 유닛  Environment=CCTV_BASE=<위 gateApi 와 같은 값> · PUSH_FPS=0.2 · 푸셔 헤더 Authorization: Bearer <CCTV_INGEST_TOKEN>
           + 쿼리에 worker·unknown 추가 (없으면 관제웹 작업자 수가 person_count 로 떨어진다)
⚠ 순서 = 서버 배포(라우트가 먼저 있어야 젯슨 POST 가 404 가 아니다) → Cloud Run env → 젯슨
```
- [ ] 서버 배포([WATCH.APP] · /deploy) + env `CAM03_GATE_API`·`CCTV_INGEST_TOKEN`(secret)·`CCTV_FRAME_STALE_SEC` — 웹 빌드 인자는 1차엔 duckdns 유지
- [ ] 젯슨([M/L]) — drop-in `ingest.conf`(EnvironmentFile=~/.cctv_ingest.env · CCTV_BASE · PUSH_FPS=0.2) + 푸셔 Authorization 헤더 + 쿼리 worker·unknown → restart 한 번
- [ ] 다른 망(AICAM_301A)에서 CCTV 뜨는지 실측 = Tailscale 없이 보이는 첫 증거

## 하지 말 것 (설계 §8)
- `cctv-ai` 를 다시 켜지 않는다 · 게이트 `:8443` 을 바깥에 여는 방향으로 돌아가지 않는다 · 스키마는 `ensureSchema` 로만
