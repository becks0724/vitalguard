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
