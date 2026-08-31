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
- [x] 커밋 `20423d3` → [WATCH.APP] 이 push(origin/main `3dc788e` · 실조회) · 그쪽 배선 `7c32197` 이 계약(LOADING→WAITING(code·size·rows·expiresInSec)→1초 secondsLeft→승인 시 saveSession→`login = LoginUiState()` · EXPIRED 는 phase 만 · onQrRefresh/onSwitchMode/onCancel) 그대로 쓰는 것 확인.
- [x] **실기 성공(08-29 22:13:15)** — 00339-m8n 라이브 후 사용자 지시로 즉시 진행. 22:12:11 `pm install -r`(HEAD 2b02bad 릴리스 서명 · 면제 유지) → 22:12:46 start(코드 V2U6-WEQZ · 41×41) → 4초 poll → 22:12:55 iPhone 카메라 스캔 → `/pair` → 22:13:11 approve → 22:13:14 poll approved → 22:13:15 `QR 로그인 성공 worker=EMP-6861` → 22:14:38 `/api/app/vital` 업로드 재개. 실기 QR 화면 캡처 = 프리뷰와 동일 배치. adb 종료 22:15:32.

## 08-31 · 워치8 40mm 적용
- [x] 페어링(IPv6 링크로컬)·설치·실측(438×438·340dpi=206dp·SM-L325N)
- [x] 신규 설치 FGS(health) 크래시 → 권한 가드 + 허용 콜백 시작 + 테스트 2건
- [x] QR 카드 유도식 min(140, 지름−78) → 128dp · 수정 후 원 밖 0픽셀 실측
- [x] WearWatch8Shots 프리뷰 레일 8장 · 전체 렌더 54장
- [x] 실기 재설치·수정 전후 캡처 → 아티팩트 기기별 구분 갱신
- [ ] QR 로그인 라이브(폰 스캔→승인) — 사용자 진행 대기
- [ ] 배터리 1h 보정(착용) — 325mAh · 추정 ~9%/h 검증

## 08-31 · 자동 로그아웃(미착용 90분)
- [x] ConfigStore.offBodySince 영속 앵커 + OffBodySource.observed
- [x] CollectorService — 콜백 앵커 기록/해제 · tick 만료 검사 · 시작 정산 · shouldAutoLogout
- [x] MainActivity.onResume — 백그라운드 로그아웃의 화면 반영
- [x] AutoLogoutTest 6건
- [ ] 실기 확인 — 워치 벗어 두고 90분 후 QR 로그인 화면 복귀(배터리 측정과 병행 가능)
