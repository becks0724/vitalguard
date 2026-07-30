# VitAlGuard 8.4 (84) — 안전한 모바일 로그인·데이터 연동

릴리스 날짜: 2026-07-30

## 한국어

VitAlGuard 8.4는 관제 웹 로그인 창을 여는 기존 흐름을 iPhone 및 Android 휴대폰의 앱 내 보안 로그인으로 전환합니다. 모바일 앱은 PostgreSQL에 직접 연결하지 않으며, HTTPS 모바일 인증 API만 사용합니다.

- 15분 액세스 토큰과 회전 갱신 토큰, 기기별 로그아웃 및 로그인 시도 제한을 추가했습니다.
- 401 응답은 `action: reauth|none` 계약을 사용합니다. `reauth`일 때만 휴대폰 세션과 워치 로그인 문맥을 함께 정리하고, 실측 backlog는 재로그인 뒤 재전송합니다.
- 비밀번호는 로그인 요청에만 사용하고 저장하지 않습니다. iPhone은 Keychain, Android는 Android Keystore 기반 저장소에 세션 토큰만 보관합니다.
- Apple Watch와 Wear OS는 비밀번호·갱신 토큰을 보관하지 않습니다. 휴대폰이 최소 로그인 문맥을 동기화하고, 워치 실측값은 Watch → Phone → API 경로로만 전달합니다.
- iPhone·Watch 설정의 연동 URL은 앱 관리형 HTTPS 주소로 표시되며 수정할 수 없습니다.
- 기존 Apple Watch 실측값 freshness·범위 검증을 유지하고, 모의 값은 전송 경로에서 제외합니다.
- 역할(owner/admin/worker)에 따라 모바일 API 및 화면 범위를 제한하도록 세션 역할 정보를 적용했습니다.
- iPhone, Apple Watch, Widget, Flutter Android Phone, Wear OS 버전을 8.4 / 84로 정렬했습니다.

운영 전제: PostgreSQL 연결 문자열과 JWT 비밀값은 Cloud Run Secret Manager에서만 관리합니다. 모바일 바이너리, Git, 문서, `.env.local`에는 비밀값을 넣지 않습니다.

## English

VitAlGuard 8.4 replaces the dashboard-web login handoff with secure in-app login on iPhone and Android phones. Mobile clients never connect to PostgreSQL directly; they use the HTTPS mobile authentication API.

- Added 15-minute access tokens, rotating refresh tokens, per-device logout, and login-attempt throttling.
- 401 responses now use the `action: reauth|none` contract. Only `reauth` clears the phone session and wearable identity context; measured backlog is retained for retransmission after sign-in.
- Passwords are used only for the login request and are never persisted. iPhone stores session tokens in Keychain; Android uses Android Keystore-backed secure storage.
- Apple Watch and Wear OS do not retain passwords or refresh tokens. The paired phone synchronizes minimal identity context, and measured vitals flow only through Watch → Phone → API.
- The connection URL in iPhone and Watch settings is now an app-managed, read-only HTTPS endpoint.
- Preserved Apple Watch freshness/range gates and excluded mock values from the transmission path.
- Applied owner/admin/worker role context to limit mobile API and UI scope.
- Aligned iPhone, Apple Watch, Widget, Flutter Android Phone, and Wear OS versions to 8.4 / 84.

Operational requirement: PostgreSQL connection data and JWT secrets remain only in Cloud Run Secret Manager. Never place secrets in mobile binaries, Git, documentation, or `.env.local`.

## Validation status / 검증 상태

- Dashboard workspace typecheck: passed.
- iPhone + Watch + Widget simulator build: passed.
- Flutter and Android build: pending because the local Flutter SDK is not installed.
- TestFlight archive/upload: requires the release signing profile and is intentionally performed by the account owner.
