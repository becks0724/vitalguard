# 워치 QR 로그인 — 결정과 근거

- **방식 = 기기 승인(Device Authorization)** — 워치는 표시·폴링만, 자격은 폰 브라우저에서. 폰 앱·페어링·삼성 폰 의존 0(워치 단독 노선 R-28).
  Wear RemoteInput 은 Galaxy Wearable 페어링된 안드로이드 폰에서만 떠서 기각.
- **토큰은 QR 로 안 나간다** — QR 엔 코드(사용자 코드)만. 토큰은 워치가 start 때 받은 `secret`(32B · 서버엔 sha256 만)을 든 poll 에만.
  QR 을 찍어 가도, 코드를 훔쳐 봐도 토큰을 못 가져간다. poll 은 secret 불일치를 404 로 답한다(코드 존재 여부 유출 금지).
- **자격 검증은 login 과 한 함수** — `authenticateAppLogin` + `loginLockRemainingMs/recordLoginResult`(잠금 키 `app:` 접두 그대로).
  분기하면 두 판정이 어긋난다(이 레포 단골 결함). 발급도 `signAppJwt` 그대로(30일 · 회수 방식 불변).
- **코드 저장은 DB** — Cloud Run 다중 인스턴스. 5분 만료·1회 소비·start 는 IP 당 토큰버킷(`consumeToken`).
- **QR 은 서버가 uqr 로 행렬을 낸다** — 워치엔 라이브러리를 안 넣는다(Canvas 로 정사각형만). 2FA 때 승인된 의존(uqr · 의존성 0) 재사용.
- **/pair 는 로그인 화면과 같은 레이아웃**(사용자 지시) — `LoginShaderBackground`·글래스 카드·로고·`INPUT_CLASS`·`LiquidMetalButton` 을
  같은 컴포넌트/상수에서 가져온다(복사 금지 — 한쪽만 바뀌면 어긋난다). 사진 컬럼·구글 버튼·회원가입·언어 토글은 뺀다(승인 화면엔 불필요).
- **화면에 승인 대상 코드를 크게** — 남의 워치를 승인하는 실수 방지. 승인 후 워치 이름·계정을 보여 준다.
