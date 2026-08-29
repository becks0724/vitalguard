# 워치 QR 로그인(기기 승인 흐름) — 체크리스트 (2026-08-29 사용자 지시 · [WATCH.APP])

배경 = 갤럭시워치 화면이 좁아 아이디·비번 입력이 어렵다. 워치가 QR(+코드)을 보이고, 폰이 스캔해 **관제웹 로그인과 같은
화면**에서 아이디·비번을 넣으면 워치가 토큰을 받는다(RFC 8628 형태). 계정·JWT 발급·회수 방식은 그대로.

## 서버(apps/dashboard-web)
- [x] `lib/device-login.ts` — 코드 생성(8자 · 혼동 글자 제외 · `XXXX-XXXX`)·정규화·TTL 300s·secret 해시(순수 · 시험 가능).
- [x] DB `app_device_login`(code PK · secret_hash · status pending|approved|consumed|expired · token · worker · 시각) + 헬퍼 3개(`lib/db.ts`).
- [x] `POST /api/app-auth/device/start` — IP 레이트리밋 → 코드·secret·만료·`pairUrl`·QR 행렬(uqr `encode` · 의존 추가 0).
- [x] `POST /api/app-auth/device/approve` — `{code,id,password}` → **login 과 같은** `authenticateAppLogin`+잠금(`app:` 키) → `signAppJwt` → 코드에 묶음(1회).
- [x] `GET /api/app-auth/device/poll?code&secret` — pending|approved(+token·worker · 즉시 consumed)|expired. secret 불일치 = 404 로 위장(존재 유출 금지).
- [x] `/pair` 페이지 — **관제웹 로그인 화면과 같은 레이아웃**(셰이더 배경·글래스 카드·로고·문구·글래스 입력·LiquidMetal 버튼).
      코드는 `?code=` 로 채우고 직접 입력도 가능 · 승인 대상 코드 크게 표시 · 성공/실패 문구.
- [x] 가드 5 + 단위시험 4 — 변이 **7/8 검출**(미검출 1 = `?? null` 덧붙임 · 동작 불변 등가 변이). 추가 2종(잠금 카운트 무력화·403/401 병합)도 검출.
- [x] typecheck 0 · lint 0 오류 · **1485/1485** → 커밋 → push. 배포는 사용자 `/deploy`(워치 쪽이 붙기 전엔 서버만 먼저 나가도 무해 — 추가 라우트·테이블뿐).

## 워치(:wear · WATCH.DESIGN 과 분담)
- [x] `pipeline/DeviceLoginClient.kt` — start/poll · secret 메모리만 · 사번 없는 승인 거부 · JVM 시험 6 (`a3e907e`).
- [x] `LoginScreen` QR 모드(기본) — 흰 카드 140dp · 41×41 · 코드·카운트다운·[직접 입력|취소]·만료/오류 (WATCH.DESIGN `20423d3`) ·
      MainActivity 배선(start→1초 카운트다운·4초 poll→saveSession · 취소/전환/onStop 에 Job 취소 · 가드 3) (`7c32197`) · `:wear` 262/262 · assembleRelease 21:53.
- [x] 승인 시 `ConfigStore.saveSession` → 기존 로그인 성공 경로 그대로 · 직접 입력 유지(취소 → 재진입이 QR).
- [ ] 실기 1회(폰 카메라 → /pair → 승인 → 워치 로그인) · 재설치가 필요하므로 측정 창과 안 겹치게.
