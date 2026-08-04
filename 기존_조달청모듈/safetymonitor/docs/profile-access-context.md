# 내 정보(부서/직책) + 관리자 메뉴 권한 제어 + 댓글 작성자 (컨텍스트 노트)

작성일 2026-06-26.

## 요청 3건
1. 내 정보 수정에 **부서/직책** 기입 항목 추가.
2. **관리자 메뉴 접근 권한 제한** — owner가 (결제권자 등에게) 개별 부여.
3. 캘린더 댓글에 **이름/직책/사원번호/날짜/시간** 표시.

## 보안 결정 (사용자 선택)
- 게이팅 모델 = **owner 개별 부여**(admin_access 플래그). 직책은 본인 편집(표시용)이라 직책 자체로 권한을 주면 **자가취득** 취약점 → 권한은 owner만 부여하는 별도 플래그로 분리.
- **UI 숨김만이 아니라 서버에서도 강제**(hasAdminMenuAccess) — 메뉴를 가려도 API 직접 호출이 가능하면 의미 없으므로.

## 구현
- DB(users) — `department`, `job_title`, `admin_access`(BOOLEAN, 기본 false) ALTER 추가. `setUserAdminAccess(id, value)`. `updateUserProfile`에 부서/직책. `setUserProfileFields(id, dept, title)`(id 기준 — 관리자 직접 수정용).
- DB(calendar_media_comment) — `author_title`(직책 스냅샷) ALTER 추가.
- `lib/admin-auth.ts` — `hasAdminMenuAccess(request)`: owner면 true, 아니면 users.admin_access 조회. env 직접 자격(getSession이 owner 처리)도 허용.
- 서버 강제 적용(8개) — `/api/admin/{workers,preview,export,export-xlsx,fall-candidates,fall-export,fall-label,site-info}`가 `verifyBasicAuth` → `hasAdminMenuAccess`로 교체. (폴링·알림·캘린더 등 일반 사용자용 엔드포인트는 verifyBasicAuth 유지.)
- `/api/admin/profile` — GET이 department/job_title/admin_access/role 반환, POST가 부서/직책 저장.
- `/api/admin/users` — `grant_admin`/`revoke_admin`/`set_profile` 액션(owner 전용, set_profile은 빈값 null 정규화), publicUser에 부서/직책/admin_access.
- `/api/calendar/media/comment` — resolveAuthor가 job_title→author_title 캡처. owner 기본 직책 "시스템 관리자"(데모 표시용), 작성자 식별자 = username(사번 대용).
- Client — MyProfileModal 부서/직책 입력(본인); UserManagementModal '부서/직책' 컬럼 **인라인 편집**(셀 클릭→input→저장/취소, owner가 각 사용자 값 직접 수정·폴링 중 draft 보존) + '관리자권한' 컬럼 부여/회수 토글; DemoDashboard 마운트 시 /api/admin/profile로 adminAccess 받아 `canAdminMenu`(owner||adminAccess)로 관리자 dock 항목 게이팅; 댓글 표시에 직책 + "사번" 라벨.
- 부서/직책 입력 경로 2가지(2026-06-26 추가) — ① 사용자 본인 '내 정보 수정' ② owner가 '사용자 관리'에서 직접. 둘 다 같은 users.department/job_title 갱신.

## 2026-06-26 후반 추가 (로그인 칩·사원번호·비밀번호 게이트·한화면 모달 — 라이브 `00011`~`00013`)

- **헤더 로그인 상태 칩**(DemoDashboard) — 'POST /api/mock/vital' 개발용 라벨 자리. **표시 전용 div(클릭 없음)** — 칩 클릭으로 내 정보 직접 진입하던 보안문제 해소. 접속점(초록 ping) + 이름/직책/사번/아이디(owner는 '관리자·소유자'). 마운트 시 /api/admin/profile 응답에서 loginInfo(name/job_title/employee_id/username) 캡처.
- **사원번호(`users.employee_id`)** 신규 — ALTER 추가 + UserRow + updateUserProfile + /api/admin/profile GET/POST. MyProfileModal에 '사원번호' 입력칸(아이디와 2열). (기존 "사번=username 대용"에서 실제 필드로 승격.)
- **비밀번호 게이트(step-up 인증)** — dock '내 정보' 클릭 → `ProfileGateModal`에서 비번 재확인 후 진입. `/api/admin/verify-password`(POST, Bearer) — 현재 세션 사용자 비번 재확인(owner=verifyCredentials, admin=verifyPassword 해시), **새 토큰 미발급**. 공용 관제 화면 무단 조회·수정 방지.
- **내 정보 모달 한 화면** — 비밀번호 변경 섹션 기본 접힘(펼치기 토글) + 아이디·사번 2열 → 662px(<720px viewport) 적합. + (버그수정) `save` useCallback 의존성에 employeeId 포함.
- 게이트 적용 대상 = role=admin만(dock '내 정보'는 admin 전용 노출). owner는 자가수정 비대상이라 게이트 불필요.

## 2026-08-04 — env 관리자(owner, id `admin`)에도 '내 정보' 추가

**증상.** 관리자 계정으로 로그인하면 dock 에 '내 정보'가 없었다. 가입 회원(role=admin)만 쓰던 기능이라 위 2026-06-26 절이 "owner 는 자가수정 비대상"으로 못 박아 둔 것이 그대로 남아 있었다.

**원인.** owner 는 자격이 환경변수(`ADMIN_ID`/`ADMIN_PASSWORD`)여서 `users` 행이 없다 → 저장할 자리가 없어 `/api/admin/profile` GET 이 `editable:false`, POST 가 403 이었고 dock 항목도 `role === "admin"` 게이트에 걸려 있었다.

**결정 1 — `users` 에 owner 행을 만들지 않는다.** 만들면 '사용자 관리' 목록에 승인/거절 대상으로 뜨는데, 거절해도 로그인은 env 로 계속된다(로그인 라우트가 env 를 먼저 본다). 화면과 실제가 어긋나는 상태를 만들지 않으려고 프로필만 담는 단일행 `owner_profile` 테이블로 분리했다. 비밀번호 컬럼은 두지 않는다 — 자격의 단일 소스는 env.

**결정 2 — 검증은 세 경로가 한 함수를 쓴다.** env owner·로컬 데모 회원·DB 회원이 각각 복사본을 갖고 있으면 한쪽만 느슨해진다. 라우트 안 `normalizeProfile(body, orgType)` 하나로 모았다. ★ 이 함수는 **라우트 파일 안**에 둔다 — lib 으로 빼면 `companies.test.ts` 의 "가입·프로필 라우트는 유형 게이트를 쓴다" 가드가 호출부를 못 본다.

**결정 3 — owner 의 `org_type` 은 `vitalguard` 고정.** 서비스 운영 주체 계정이라 회사(상호) 선택지도 자사 하나. 가입 절차가 없어 DB 에 유형이 없으므로 라우트 상수로 정한다.

**결정 4 — 이메일 칸은 owner 에서 그리지 않는다.** 가입·인증 절차가 없어 값 자체가 없다. 빈 readonly 칸을 두면 "입력하면 저장되는 값"으로 읽힌다.

**⚠ 하나만 동일하지 못한 항목 — 비밀번호 변경.** `ADMIN_PASSWORD` 는 배포 환경변수(Cloud Run env)라 앱에서 바꿀 수 없다. 조용히 무시하면 "바꿨다고 생각했는데 옛 비번이 그대로"가 되므로 서버가 400 + 사유를 돌려주고 모달도 안내만 그린다. DB 오버라이드 해시를 두는 방식은 ① 오버라이드 후에도 env 비번이 계속 유효해 "바꿨는데 옛 비번도 통한다"가 되거나 ② env 를 무효화하면 DB 장애 시 owner 가 잠긴다 — 어느 쪽도 이 요청 범위에서 임의로 고를 문제가 아니라 별도 결정으로 남긴다.

**파급(같은 값을 쓰던 자리).** 로그인 칩과 캘린더 댓글 작성자 표기가 하드코딩 "관리자"·"시스템 관리자" 대신 등록값을 쓴다(미등록이면 종전 기본값 유지). 사번 중복 검사 `employeeIdTakenByOther` 는 `users ∪ owner_profile` 을 본다 — 한쪽만 보면 두 계정이 같은 사번을 갖고 생체·알람 귀속이 갈린다.

**검증.** `tsc` 0 · `lint` 0 · `test` 544 pass. 데모 모드(`DATABASE_URL` 미설정) 로컬 서버에서 로그인 → dock → 비번 게이트 → 모달 저장 → 서버 재조회 → 칩 반영까지 브라우저 실측, 거부 4종(비번변경 400 · 타유형 상호 400 · 연락처 형식 400 · 미인증 401). DDL·UPSERT·UNION 은 실 Postgres 에 `BEGIN`→실행→`ROLLBACK`(`to_regclass` = null) — 프로덕션 DB 무변경(L-04).

## 검증 결과 (통과)
- tsc=0, next build=0.
- 댓글 author_title "시스템 관리자" 캡처 + 화면 표시(이름·직책·사번·시각).
- 권한 부여/회수 — 실 가입 사용자(admin) 대상 grant→true, revoke→false, 원복.
- 서버 강제 — /api/admin/workers 미인증=401, owner=200.
- owner 관리자 메뉴 노출=1.

## 한계(코드/빌드로만 확인)
- 가입이 **이메일 인증 게이트**라 스크립트로 비-관리자 브라우저 세션 생성 불가 → "비-관리자가 메뉴 안 보임 / 게이트 엔드포인트 403" 거부 경로는 build+tsc+로직(hasAdminMenuAccess가 admin_access=false면 false 반환)으로 확인. MyProfileModal 부서/직책 자가저장도 role=admin 계정 필요(owner는 모달 비대상)라 build로 확인.
- ~~"사번"은 관리자 계정에 실제 사번이 없어 username을 식별자로 표시~~ → **해소(2026-06-26): `users.employee_id` 사원번호 필드 추가, 내 정보 수정에서 입력.** 댓글 표시는 여전히 author_id(username) 기준.
