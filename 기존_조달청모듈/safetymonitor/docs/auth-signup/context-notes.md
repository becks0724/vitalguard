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

## 회사(상호) B2B 승인 기업 선택 (2026-06-23)
- 자유 입력 → **승인 기업 드롭다운**(B2B — 승인된 기업만 가입). `lib/companies.ts` `ALLOWED_COMPANIES` **단일 소스**(개발사가 배열 편집으로 추가/삭제) + `isAllowedCompany`.
- 목록 = (주)바이탈가드·VitAlGuard·스마트인재개발원·조달청·고용노동부.
- **서버 검증** — `register`·`google/complete` 가 목록 외 회사 거부(400) → API 직접 호출 우회 차단. 일반·구글 가입 폼 둘 다 셀렉트.
- 향후 owner가 화면에서 기업 추가/삭제하려면 DB 테이블+관리 UI 필요(현재는 코드 관리). 커밋 `ff6887f`.

## 사용자 관리 모달 확장 (2026-06-23, owner)
- 카드형 → **DB 스키마 그대로 전체 컬럼 테이블**(ID·아이디·이름·회사·연락처·통신사·이메일·인증·경로·역할·상태·가입일·승인일·승인자). password_hash·google_sub 만 제외.
- **사용자 탈퇴(하드 삭제)** — `deleteUser`(DELETE) + 확인창, owner 전용 `POST action:'delete'`. owner(env)는 DB 행 없어 락아웃 위험 0.
- **DB 실시간 동기화** — 5초 폴링 + 새로고침 버튼 + 최근 갱신 시각.
- users API `publicUser` 에 carrier·email_verified·auth_provider 추가. 커밋 `4aba061`.

## 내 정보 수정 (2026-06-23, 가입 회원=admin)
- 헤더 '내 정보' 탭(role==admin 전용) → `MyProfileModal`. 이름·회사(승인목록)·연락처(3박스)·통신사 수정 + **비밀번호 변경**(현재 비번 검증 후).
- 아이디·이메일은 **읽기 전용**(식별·인증 정보 — 이메일 변경은 재인증 필요, v1 제외).
- `/api/admin/profile` GET(프리필)·POST(수정) — **세션 username 기준 본인 행만**(클라가 보낸 id 신뢰 안 함). owner는 DB 행 없어 자가 수정 대상 아님(403/editable:false). `updateUserProfile`(db). 커밋 `4aba061`.
- (★ UI 교훈) 셀렉트는 `appearance-none`+커스텀 화살표 없으면 macOS 네이티브로 각지게 렌더(로그인 폼·내 정보 모달 둘 다 동일 패턴으로 통일). 전화 3박스는 `flex-1`+`min-width:auto` 로 모달 가로 오버플로 → **고정 폭**(prefix w-20/mid·last w-24)으로 해결.

## DB 컬럼 추가 (2026-06-23)
- users 테이블 `carrier TEXT`·`email_verified BOOLEAN DEFAULT false` 멱등 ALTER. 기존 가입분(옛 폼)은 carrier=null·email_verified=false, 신규 가입분만 채워짐(정상).

## 검증 도구 (2026-06-23)
- **dev-browser**(SawyerHood) 로컬 설치·적용(커밋 `62e1c02`, `.claude/settings.json` 자동승인). 이 머신은 npm 없는 pnpm 전용이라 데몬 런타임을 `pnpm -C ~/.dev-browser install` + `playwright install chromium` 로 직접 구성(`.claude/skills/dev-browser/SKILL.md` 환경 노트). 라이브 관제웹 검증에 사용.

## 가입 구조 개편 — VG관리자/회원사 관리자 2분기 (2026-07-30)

사용자 요청 = 가입을 "VitAlGuard 관리자 / 회원사 관리자 / 작업자" 로 구분. 작업자 자체가입은 **미구현 확정**
(관제웹 사용자는 협력사 관리자이고, 작업자↔웨어러블 매칭은 차후 관제웹에서 디바이스 모델명·이름으로 직접 매칭).

### ★ A안 채택 — role 을 늘리지 않고 `org_type` 컬럼으로 구분
`role` 에 `vg_admin` 같은 값을 추가하면 **이미 배포된 iOS 앱이 로그인 불가**가 된다.
앱은 서버 role 을 `owner`/`admin`/`worker` 셋만 해석하고(`VitAlGuardPreviewApp.swift` `modeForServerRole` 14255행,
`normalizedAppServerRole` 3965행), 모르는 값이면 아이디 접두사로 추정(`modeForLoginID` 14244행)한 뒤
그마저 실패하면 "서버 계정 역할을 앱 모드로 해석할 수 없습니다" 로 **로그인 자체가 실패**한다.
→ `role` 은 그대로 두고 `users.org_type`(`vitalguard`|`member`)을 신설한다. 앱·워치 코드 변경 0, 재배포 불필요.
확장 경로도 열려 있다 — 나중에 앱이 이 구분을 알아야 하면 앱 JWT 에 클레임을 추가하면 되고,
구버전 앱은 모르는 클레임을 무시한다.

(기각) B안 = role 확장 + 앱 응답에서만 옛 값으로 번역. 번역 지점이 로그인 하나가 아니다 —
앱 JWT role 을 직접 비교하는 `assignment/chat/route.ts:70`·`calendar/media/route.ts:160` 에서 누락하면
**에러 없이 권한만 조용히 사라진다**. (기각) C안 = 앱 업데이트. 심사 제출 불가 상태 + 구버전 잔존 기간 로그인 불가.

### 결정
1. **승인 권한** — `.env` owner 는 부트스트랩으로 남기고, 실 운영 승인은 **`admin_access` 를 받은 VG관리자**가 한다.
   `/api/admin/users` 게이트를 `verifyOwner` → `verifyUserAdmin`(owner 또는 VG관리자+admin_access)으로 확대.
   부여/회수(`grant_admin`/`revoke_admin`)와 서버 강제는 이미 있어 새로 만들 것이 없다.
2. **아이디 형식 자유** — 4~20자(국내 통용), 공백·제어문자만 금지, 한글·대문자·특수기호 허용.
   **예약어 금지는 유지**(admin/owner/root… — env owner 그림자 계정 방지). 로그인 라우트는 형식 검증을 하지 않으므로
   길이를 좁혀도 기존 계정 로그인에 영향 없다.
3. **비밀번호** — 8자 이상 **20자 미만**(=8~19자, 요청 문구 그대로). 대문자·특수기호 허용.
   생년월일(`YYYYMMDD`/`YYMMDD`)·연락처(전체 11자리/뒤 8자리)가 **포함되면 거부**. 가입·비번변경 양쪽 적용.
4. **생년월일** — `users.birth_date` 신규. 비번 판정 입력이라 폼에서 비밀번호보다 위에 둔다.
5. **정책 단일 소스** — 아이디·비번 규칙이 서버 2곳(register·check-username)+클라 1곳으로 흩어져 있었다.
   `lib/account-policy.ts` 순수 함수로 모으고 세 곳이 같은 함수를 쓴다.
6. **회사(상호) 목록** — 현행 코드 상수(`lib/companies.ts`) 유지. 회원사 테이블·관리 UI 는 이번 범위 밖.
7. **현장 스코프 권한**("협력사 관리자는 해당 현장건만") — **2단계로 분리**. DB 에 현장 엔티티가 없다
   (`site_info_daily` 는 `snapshot_date UNIQUE` 로 날짜당 1행 = 단일 현장 전제). 이건 가입 변경이 아니라
   멀티 현장 도입이라 조회 계층 전반이 대상이다. ⚠ 그때 앱도 함께 봐야 한다 —
   앱은 role=`admin` 이면 현장정보 저장·캘린더 수정 권한을 주므로(`appServerRoleCanManageDashboard` 3977행)
   회원사 관리자도 앱에서는 관리자 권한을 갖는다.
8. **사번(`employee_id`)은 이번 변경에 안전** — 아이디 자유화로 `EMP-한글` 이 생길 수 있으나,
   ① 생체데이터를 만드는 작업자 계정은 여전히 관리자가 사번을 지정해 만들고
   ② 관리자 사번의 용도는 사진 소유권 문자열 비교뿐이며
   ③ 앱·서버 어디에도 사번을 URL 쿼리에 넣는 코드가 없다(전부 JSON 본문·JWT) → 인코딩 문제도 없다.

### 별건으로 분리한 것(각각 사용자 승인 후)
- 기존 실가입자 4명(장우진·김태곤·전 팀원·김○○) `org_type='vitalguard'` 백필 — 라이브 DB 쓰기.
- **작업자 계정의 관제웹 로그인 차단** — 지금 `/api/admin/login` 은 DB 계정이면 `user.role` 을 보지 않고
  무조건 admin 세션을 발급한다(`login/route.ts:112`). 앱용 작업자 계정으로 관제웹에 들어가진다.
  수정은 조건문 2줄이고 앱 로그인(`/api/app-auth/login`)과는 무관하지만, 적용 전 라이브에서
  `role='worker'` 계정 목록을 읽어 실사용자가 없는지 확인해야 한다.

## 현재 상태 / 다음 (2026-06-23 종합)
- **전부 origin/main 푸시 완료**(`ff6887f`·`4aba061` + 직전 `7c10ec6` 회원가입 보안·`62e1c02` dev-browser). tsc 0·테스트 44/44·lint 에러 0.
- **라이브(Cloud Run) 미반영** — GitHub 만 반영. 라이브 배포 시 `gcloud builds submit`+`run deploy` 필요.
- **이메일 실발송**은 `RESEND_API_KEY`(+`EMAIL_FROM`) Secret Manager 등록 후 재배포해야 동작(미설정 시 로컬은 devCode 폴백·운영은 발송 실패).
- 기존 보류 — Google OAuth 라이브 시크릿(GOOGLE_CLIENT_ID/SECRET), Phase 5(폰·워치 수신 URL → Cloud Run).
