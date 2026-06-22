# 관리자 회원가입(승인제) — 체크리스트

> 근거·결정은 [context-notes.md](context-notes.md). 진행하며 체크.
> 결정: 가입 권한 = **승인제** / 진행 = **자체 ID/PW 먼저**(Google 은 다음 단계).

## Phase A — 백엔드 ✅ 완료 (2026-06-22)
- [x] `users` 테이블 (db.ts initSchema) — username UNIQUE·password_hash·name·role·status·created_at·approved_at·approved_by
- [x] db 함수 — createUser / findUserByUsername / listUsers / setUserStatus
- [x] `lib/password.ts` — crypto.scrypt 해시·검증(의존성 없음) + 단위 테스트
- [x] `admin-auth.ts` — 세션 값에 role/username 부여, getSession·verifyOwner 추가(verifyBasicAuth·validateSession 시그니처 유지)
- [x] `POST /api/admin/register` — 신규 가입(status=pending) + 입력 검증·중복 차단·예약어 차단
- [x] `POST /api/admin/login` — env owner 우선 → 실패 시 DB 승인자 검증, pending=403
- [x] `GET/POST /api/admin/users` — owner 전용, 목록 조회 + 승인/거절
- [x] 검증 — tsc 0 · password 테스트 · dev curl(가입201→미승인403→틀린비번401→승인200→승인후 role=admin→owner전용 401)

## Phase B — UI ✅ 완료 (2026-06-22)
- [x] LoginScreen 회원가입 폼 토글(아이디·이름·비번·확인) → 가입 → "승인 대기" 안내
- [x] LoginGate — 로그인 응답 role 저장(sessionStorage) + getSessionRole, 로그아웃 시 정리
- [x] owner 전용 "사용자 관리" 모달(UserManagementModal) — pending 목록 승인/거절 + 처리된 계정
- [x] DemoDashboard — owner 만 "사용자 관리" 탭 노출 + 모달 연결
- [x] 검증 — tsc 0 · 테스트 44/44 · 브라우저 E2E(가입→미승인차단→owner승인→승인계정 로그인→역할별 탭 노출)

## Phase C — Google OAuth ✅ 구현 완료 (2026-06-22, 라이브 시크릿만 남음)
- [x] GCP OAuth Client ID/Secret 발급(사용자) + redirect URI 2개(local·run.app) → `.env.local`
- [x] `lib/google-oauth.ts` — 동의 URL·code 교환·id_token 파싱(의존성 0) + HMAC 서명 쿠키
- [x] `/api/auth/google`(state 발급·redirect) · `/callback`(검증·교환·분기) · `/complete`(추가정보→pending) · `/handoff`(세션 쿠키→sessionStorage)
- [x] users 테이블 `google_sub`·`auth_provider` + `password_hash` nullable + findUserByGoogleSub·createGoogleUser
- [x] LoginScreen 구글 버튼 실연결 + 추가정보(회사·연락처) 폼 + 콜백 메시지 / LoginGate 핸드오프
- [x] 검증 — tsc 0 · 테스트 44/44 · 서버측(시작 307·추가정보 201·DB 적재·잘못된쿠키 400). 구글 동의 화면은 사용자 수동 테스트.
- [ ] (라이브) Secret Manager 에 GOOGLE_CLIENT_ID/SECRET 등록 + Cloud Run --set-secrets 재배포
