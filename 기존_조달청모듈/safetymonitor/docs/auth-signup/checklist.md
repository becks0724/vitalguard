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
- [x] (라이브) Secret Manager 에 GOOGLE_CLIENT_ID/SECRET 등록 + Cloud Run 배포 (rev 00007-7n7 에 9 시크릿 연결, 2026-06-23)

## Phase D — 회원가입 보안 강화 ✅ 완료 (2026-06-23, 커밋 `7c10ec6`)
- [x] 비밀번호 8자 경고 잔존 버그 수정 — 제출 setError 잔존 → 입력값 라이브 판정(8자 채우면 사라짐)
- [x] 관리자 ID 중복 확인 버튼 + `GET /api/admin/check-username`(형식·예약어·중복 + per-IP 스로틀)
- [x] 연락처 3박스([010▾][0000][0000]) + 통신사 선택(SKT/KT/LG U+/알뜰폰) → `carrier` 컬럼
- [x] 이메일 = 로컬부 입력 + 도메인 선택박스(naver/gmail/daum/… /직접입력)
- [x] 이메일 인증(Resend HTTP API, 의존성 0) — 코드 발송·확인, **인증 완료해야 가입**(서버 isVerified 403 이중방어)
- [x] `lib/email.ts`(발송·키없으면 devCode 폴백)·`lib/email-verify.ts`(코드 메모리·TTL·쿨다운·시도제한)
- [x] users 테이블 `carrier`·`email_verified` 컬럼 멱등 ALTER
- [x] 검증 — tsc 0·테스트 44/44·API e2e(중복확인·발송·미인증403·인증·201·DB)·UI 라이브
- [x] (라이브) `RESEND_API_KEY` Secret Manager 등록 + Cloud Run 재배포 (rev 00007-7n7, 2026-06-23). `EMAIL_FROM`=onboarding@resend.dev 기본값(도메인 미보유 → Resend 계정 본인 이메일만 발송). 도메인 인증 후 `services update --update-env-vars EMAIL_FROM=…`(재빌드 불필요)로 실발송 전환 예정.

## Phase E — 회사(상호) B2B 승인 기업 선택 ✅ 완료 (2026-06-23, 커밋 `ff6887f`)
- [x] 자유 입력 → 승인 기업 드롭다운 / `lib/companies.ts` 단일 소스(개발사 편집) + isAllowedCompany
- [x] 승인 기업 = (주)바이탈가드·VitAlGuard·스마트인재개발원·조달청·고용노동부
- [x] 서버 검증 — register·google/complete 가 목록 외 회사 거부(400)
- [x] 일반·구글 가입 폼 둘 다 셀렉트 + appearance-none 디자인 통일 / 검증(미승인 400·승인 201·UI)

## Phase F — 사용자 관리 확장 + 내 정보 수정 ✅ 완료 (2026-06-23, 커밋 `4aba061`)
- [x] 사용자 관리 모달 — DB 스키마 전체 컬럼 테이블(통신사·인증·경로 포함)
- [x] 사용자 탈퇴(하드 삭제, deleteUser) + 확인창, owner 전용
- [x] DB 실시간 동기화 — 5초 폴링 + 새로고침 + 최근 갱신 시각
- [x] 내 정보 수정 모달(MyProfileModal, admin 전용 '내 정보' 탭) — 이름·회사·연락처·통신사 + 비번변경
- [x] `/api/admin/profile` GET·POST — 세션 username 기준 본인 행만 / 비번변경은 현재 비번 검증
- [x] `updateUserProfile`(db) / 검증 — tsc 0·API e2e(조회·수정·비번변경·owner403·비인증401)·UI

## Phase G — 가입 구조 개편(VG관리자/회원사 관리자 2분기) 🚧 진행 중 (2026-07-30)

> **계획.** 가입을 유형별로 나눈다. VitAlGuard 관리자와 회원사 관리자를 구분해 저장하고,
> 승인 권한을 `.env` 단독에서 "권한을 부여받은 VG관리자" 까지 넓힌다. 작업자 자체가입은 만들지 않는다.
> **A안 채택** — `role` 문자열은 `owner`/`admin`/`worker` 그대로 두고 `org_type` 컬럼으로 구분한다.
> 이유는 [context-notes.md](context-notes.md) 참조(배포된 iOS 앱이 role 3종만 해석 — 늘리면 로그인 불가).
>
> **성공 기준.** ① VG관리자·회원사 관리자로 각각 가입 신청이 저장되고 유형이 구분된다
> ② 권한을 받은 VG관리자가 승인/거절할 수 있고, 권한 없는 회원사 관리자는 403 이다
> ③ 아이디 4~20자·비번 8~19자(생년월일·연락처 포함 금지)가 서버·클라 양쪽에서 걸린다
> ④ tsc 0 · lint 0 err · 단위 테스트 전건 통과 · `next build` 성공

- [ ] `lib/account-policy.ts` 신규 — 아이디(4~20자·공백/제어문자 금지·예약어)·비밀번호(8~19자·생년월일/연락처 포함 금지) 단일 소스 + 단위 테스트
- [ ] `lib/db.ts` — `users` 에 `birth_date`·`org_type`(기본 `member`) 멱등 ALTER + `UserRow`·`createUser` 확장
- [ ] `lib/admin-auth.ts` — 승인 권한 게이트 `verifyUserAdmin`(owner 또는 VG관리자+`admin_access`)
- [ ] `POST /api/admin/register` — 가입 유형(`orgType`)·생년월일 수신·검증, 새 아이디/비번 정책 적용
- [ ] `GET /api/admin/check-username` — 새 아이디 정책으로 교체
- [ ] `GET/POST /api/admin/users` — 게이트를 `verifyUserAdmin` 으로, 응답에 유형·생년월일 추가
- [ ] `POST /api/auth/google/complete` — 유형 선택 추가(기본 `member`)
- [ ] `LoginScreen` — 가입 유형 선택(VitAlGuard 관리자 / 회원사 관리자) + 생년월일 필드 + 새 정책 문구
- [ ] `UserManagementModal` — 유형·생년월일 열 추가
- [ ] `DemoDashboard` — '사용자 관리' 탭 노출을 승인 권한자까지 확대
- [ ] `MyProfileModal` / `POST /api/admin/profile` — 비밀번호 변경에 같은 정책 적용
- [ ] 검증 — tsc · lint · test · `next build`
- [ ] (별건, 승인 후) 기존 실가입자 4명(장우진·김태곤·양지후·김수영) `org_type='vitalguard'` 백필
- [ ] (별건, 승인 후) 작업자 계정의 관제웹 로그인 차단(`/api/admin/login` 에서 `role='worker'` 403)

## 라이브 배포 ✅ 완료 (2026-06-23, rev 00007-7n7)
- [x] `RESEND_API_KEY`·`GOOGLE_CLIENT_ID/SECRET` Secret Manager 등록 (`EMAIL_FROM`은 onboarding 기본값 유지 — 도메인 미보유)
- [x] `gcloud builds submit`(Cloud Build 2m58s) + `gcloud run deploy --update-secrets RESEND_API_KEY` → 이번 세션 기능 라이브 반영 (시크릿 9종·env 보존, 라이브 검증 = HTTP 200·check-username·로그인 401·회원가입 폼 캡처)
- [ ] (선택, 도메인 확보 후) Resend 도메인 인증 + `EMAIL_FROM` 갱신 → 임의 가입자 실발송
