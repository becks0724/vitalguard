# 관리자 회원가입(승인제) — 컨텍스트 노트

작업 중 내린 결정과 근거. 계속 덧붙인다.

## 배경 — 현재 인증 구조
- 단일 관리자: `.env`의 `ADMIN_ID`(기본 admin)+`ADMIN_PASSWORD` 하나만 검증(admin-auth.ts).
- 로그인: POST /api/admin/login → verifyCredentials(env 비교) → 랜덤 세션토큰 발급(메모리 Map, 8h TTL) → sessionStorage.
- 세션 Map 은 token→expiresAt 뿐, **신원·역할 정보 없음**.
- 사용자 목록·가입 개념 없음 → 회원가입은 신규 기능.

## 결정 (2026-06-22)
1. **가입 권한 = 승인제.** 신규 가입자는 status=pending 으로 저장, 승인 후에만 로그인. (사용자 선택)
2. **자체 ID/PW 먼저**, Google OAuth 는 다음 단계. (사용자 선택)
3. **부트스트랩(최초 승인자) = 기존 env 관리자.** env admin = role 'owner', 항상 유효, 승인/거절 권한 보유. → "첫 관리자는 누가 승인하나" 해결.
4. **비번 해시 = Node 내장 crypto.scrypt** (의존성 추가 없음). 형식 `scrypt$N$r$p$saltB64$hashB64` 자가기술형 — 파라미터 변경 호환.
5. **세션에 role/username 부여.** 세션 Map 값을 number(expiresAt) → {expiresAt, role, username} 으로 확장. owner 전용 API(/api/admin/users)는 verifyOwner 로 게이트.
6. **verifyBasicAuth/validateSession 시그니처 유지** — 16개 라우트가 verifyBasicAuth(sync, boolean) 의존. 세션 값 타입만 내부 변경하고 외부 동작 불변 → DB 로그인 도입의 async 파급을 로그인 라우트에 한정.
7. **로그인 검증 분리** — env owner 검증은 admin-auth(sync) 유지, DB 승인자 검증은 로그인 라우트가 db+password 직접 호출(admin-auth 가 db 를 import 하지 않게 — 결합도 최소).

## users 테이블 스키마
```
id SERIAL PK
username TEXT UNIQUE NOT NULL      -- 로그인 ID
name TEXT                          -- 이름(가입 필수, 앱 검증)
company TEXT                       -- 회사(상호) (가입 필수, 앱 검증)
phone TEXT                         -- 연락처 (가입 필수, 앱 검증)
email TEXT                         -- 관리자 이메일 (가입 필수, 앱 검증)
password_hash TEXT NOT NULL        -- scrypt 자가기술형
role TEXT NOT NULL DEFAULT 'admin' -- 'admin'(가입자) / 'owner'는 env 계정 전용(DB 미저장)
status TEXT NOT NULL DEFAULT 'pending' -- pending / approved / rejected
created_at TEXT DEFAULT now-ISO
approved_at TEXT
approved_by TEXT                   -- 승인한 owner username
```

### 가입 항목 확장 (2026-06-22, 사용자 요청)
- 필수 6항목: **회사(상호)·관리자 아이디·관리자 비밀번호·이름·연락처·관리자 이메일**.
- DB 컬럼은 nullable(TEXT), **"필수"는 앱 레벨(register 라우트 + 가입 폼)에서 검증** — NOT NULL 마이그레이션 부담 회피.
- 기존 설치 호환: initSchema 에 `ALTER TABLE users ADD COLUMN IF NOT EXISTS company/phone/email` 추가(멱등). 스키마는 프로세스당 메모이즈라 **dev 서버 재시작 시 ALTER 반영**.
- 이메일: 형식만 검증(a@b.c), **UNIQUE 미적용**(요건은 "필수"이지 유일성 아님). username 만 UNIQUE.
- 연락처: 숫자·+·-·공백 7~20자.

## Phase C — Google OAuth (2026-06-22)
- **수동 OAuth(Authorization Code), 의존성 0** — code 를 서버에서 구글과 직접 교환 → id_token 은 신뢰 채널 수신이라 페이로드 디코드만으로 sub/email/name 추출(서명 재검증 라이브러리 불필요).
- **기존 세션 재사용** — Auth.js 미도입. 콜백이 createSession 으로 토큰 발급 → httpOnly 쿠키(vg_handoff)로 잠깐 넘긴 뒤 /api/auth/handoff 가 sessionStorage 로 옮김(Authorization: Bearer 모델 유지).
- **승인제 유지** — 구글 신규도 status=pending. 단 구글은 회사·연락처를 안 주므로 **인증 후 추가정보 입력 폼**(사용자 선택)에서 받아 createGoogleUser. 신원은 HMAC 서명 쿠키(vg_gsignup, 10분)로 무상태 전달.
- **CSRF** — state 를 vg_oauth_state 쿠키(sameSite=lax, https면 secure)로 더블서밋 검증.
- **계정 모델** — users.auth_provider('password'|'google'), google_sub UNIQUE(부분 인덱스), password_hash nullable(구글 전용은 null → 비번 로그인 차단). username=email(구글).
- **role** — 구글 로그인은 항상 'admin'. owner 는 env 계정 전용(구글로 owner 안 됨).
- 리다이렉트 URI(콘솔 등록): `…run.app/api/auth/google/callback`, `http://localhost:3000/api/auth/google/callback`. origin 은 host 헤더+x-forwarded-proto 로 추정(local=http, run.app=https).
- 남은 것: 라이브용 GOOGLE_CLIENT_ID/SECRET 을 Secret Manager + Cloud Run --set-secrets 로 주입 후 재배포.

## 로그인 판정 순서 (login route)
1. env owner 일치 → 세션(role owner) 발급, 200.
2. 아니면 DB findUserByUsername.
   - 없음/비번불일치 → 401.
   - status=pending → 403 "승인 대기".
   - status=rejected → 403 "가입 거절됨".
   - status=approved → 세션(role admin) 발급, 200.
3. 무차별 대입 잠금(기존 ip:id 로직) 그대로 적용.

## 리스크/후속
- 세션 메모리 보관 — 인스턴스 1개라 데모 OK. 재시작·스케일 시 로그인 유실 → 다중 사용자 운영 시 DB 세션 검토.
- 캠퍼스 DB 평문 연결(sslmode=disable) — 해시 저장이라 평문 비번은 안 새지만 전송 구간 비암호화. 상용화 시 SSL.
- 가입 자체에도 rate limit 검토(현재 로그인만 잠금).

## 회원가입 보안 강화 (2026-06-23)

사용자 요청 7항목 — ① 비번 8자 경고 잔존 버그 ② ID 중복확인 ③ 연락처 3박스+통신사 ④ 이메일 id+도메인 선택 ⑤ 이메일 인증 발송·확인 ⑥ 인증번호 입력란(이메일 하단) ⑦(=①).

### 결정
1. **비번 8자 버그 원인 = 잔존(stale) error** — 검증이 제출 시 `setError`인데 입력 onChange가 error 미클리어 → 8자 미만으로 한 번 제출하면 8자 채워도 메시지 잔존. **수정 = 입력값 기반 라이브 판정**(`pwTooShortLive`/`pwMismatchLive`, 8자 채우면 즉시 사라짐) + pw onChange 에서 `setError(null)`.
2. **이메일 인증 발송 = Resend HTTP API**(사용자 선택) — 의존성 0(fetch), `RESEND_API_KEY`+`EMAIL_FROM`. 키 미설정 시 **개발 폴백**(콘솔+`devCode` 반환, NODE_ENV!=production 한정). Cloud Run 은 HTTPS 아웃바운드라 동작 확실.
3. **인증 강제 = 인증 완료해야 가입**(사용자 선택) — 클라 제출 게이트 + **서버 register 가 `isVerified(email)` 미충족 시 403**(방어 다중화). 이메일 변경 시 클라가 emailVerify 리셋 + 서버는 합성 이메일 재검증.
4. **인증코드 저장 = 메모리**(`lib/email-verify.ts`, 세션 Map 과 동일 모델) — 코드 TTL 10분·재발송 쿨다운 60초·시도 5회·인증완료 TTL 30분·가입 성공 시 `consumeVerified`. 다중 인스턴스 운영 시 DB 백엔드 검토.
5. **ID 중복확인** = `GET /api/admin/check-username?u=`(형식·예약어·중복), per-IP 30/분 스로틀(enumeration 완화). 서버 register 도 동일 검증 유지(클라 우회 차단).
6. **연락처** = `[010▾][0000][0000]` + 통신사(SKT/KT/LG U+/알뜰폰). 합성 `010-0000-0000` 저장, **carrier 컬럼 신규**. 기존 phone regex(`[0-9+\-\s]{7,20}`) 통과.
7. **이메일** = 로컬부 입력 + 도메인 셀렉트(naver/gmail/daum/hanmail/nate/kakao/직접입력). 합성 `id@domain`.
8. **DB** = users 에 `carrier TEXT`·`email_verified BOOLEAN DEFAULT false` 추가(멱등 ALTER). 가입 성공 시 email_verified=true.

### 신규/수정 파일
- 신규 — `lib/email.ts`(Resend 발송), `lib/email-verify.ts`(코드 저장), `app/api/admin/email/send-code/route.ts`, `app/api/admin/email/verify-code/route.ts`, `app/api/admin/check-username/route.ts`
- 수정 — `lib/db.ts`(컬럼·createUser), `app/api/admin/register/route.ts`(인증 강제·carrier), `app/components/LoginScreen.tsx`(폼 재구성·라이브검증), `.env.example`(RESEND)

### 검증
tsc 0 · 단위 44/44 · API e2e(:3100)= 중복확인(admin→reserved/신규→ok) · 발송(devCode) · **미인증 register 403** · 틀린코드 거부 · 인증 후 register 201 · DB carrier=SKT·email_verified=true·status=pending · dev-browser UI(폼 필드·옵션 렌더 + **비번 7자 경고→8자 사라짐 버그수정 확인**).

### 남은 것(라이브 반영 시)
- `RESEND_API_KEY`+`EMAIL_FROM` 을 `.env.local` 설정 + Secret Manager 등록 → Cloud Run `--update-secrets` 재배포. (미설정이면 운영에서 발송 실패 — 데모는 dev 폴백.)
- Resend 임의 수신자 발송은 **발신 도메인 검증** 필요(미검증 시 onboarding@resend.dev 로 가입 계정 본인 메일에만).
- (선택) 인증코드/세션 DB 백엔드(현재 메모리 — 인스턴스1 데모 OK).
