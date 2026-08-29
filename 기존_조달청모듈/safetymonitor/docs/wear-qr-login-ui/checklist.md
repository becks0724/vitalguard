# 워치 QR 로그인 — LoginScreen QR 모드 체크리스트 (2026-08-29 · [WATCH.DESIGN])

분담 = [docs/device-login/checklist.md](../device-login/checklist.md) 대로. 서버·`DeviceLoginClient`·MainActivity 배선은
[WATCH.APP], **이 트랙은 `ui/LoginScreen.kt` 의 QR 모드 UI 와 프리뷰만** 다룬다.

- [x] [WATCH.APP] 에 분담·UI 계약(`LoginMode`/`QrPhase`/`QrLoginUiState`·콜백 2개)·`expiresInSec` 제안 발신.
- [x] `LoginUiState` 확장 — `mode`(기본 QR)·`qr`. 기존 필드·`maskedPassword` 앵커 유지(LoginTest).
- [x] `QrLoginPane` — 흰 카드 + 검은 모듈(Canvas · quiet zone 4모듈) · 코드 글자 · 카운트다운 · [직접 입력]·[취소].
- [x] 단계별 화면 — LOADING(코드 받는 중) · WAITING · EXPIRED([재발급]) · ERROR([다시 시도]).
- [x] 프리뷰 4장(454) + Watch9(480) — `WearPageShots.kt`·`WearWatch9Shots.kt`. 행렬은 결정적 샘플(실 uqr 출력 고정).
- [x] `scripts/wear-shots.sh` → PNG 판독 — 둥근 가장자리 잘림 0(오류 문구는 카드 안으로 옮겨 해결) · 칸 ≈6px · **OpenCV 가 실제 URL 로 디코드**.
- [ ] 갤러리 재생성 → 아티팩트 같은 URL 재배포 → 사용자 확인.
- [x] `./gradlew :wear:testDebugUnitTest` — Login 계열 18/18(신규 QrLoginScreenTest 4).
- [ ] 커밋 `git commit -- <내 파일>` → SHA 를 [WATCH.APP] 에 전달(push 는 그쪽).
- [ ] 실기(그쪽 배선 후) — 로그아웃 → QR → 폰 스캔 → /pair 승인 → 워치 로그인 · 측정 창과 안 겹치게.
