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
- [x] **실기 성공(08-29 22:12~22:15 · WATCH.DESIGN 실행 · 서버 00339-m8n · 워치 HEAD 2b02bad 설치 22:12:11)** —
      start 22:12:46(`V2U6-WEQZ`) → iPhone 카메라 첫 판독 → /pair 22:12:55 → approve 22:13:11 → poll approved 22:13:14 →
      워치 `QR 로그인 성공 worker=EMP-6861` 22:13:15 → 업로드 재개 22:14:38. 여백·ECC 조정 불필요. 화이트리스트 유지 확인.
- [ ] ⚠ **자격 소실 의심 1건만 남음**(19:45~19:53 · 로그 버퍼 밖 · 원인 미상 · 사용자 조작 정황).
      22:10 건은 **사용자가 실기 준비로 직접 로그아웃한 것으로 확인**([WATCH.DESIGN] 08-29 · 사건 아님 · 추적 종결).
      다음 건이 사용자 조작 없이 나면 `ConfigStore`(prefs 이름·모드) · 설정 페이지 로그아웃 버튼 오터치 · 프로세스 재시작 경로를 조사한다.
- [ ] 참고 — 22:14:20·:26 Macintosh UA 의 approve 2건(소비된 코드라 404 · 무해 · 맥 브라우저의 /pair 탭 추정).
