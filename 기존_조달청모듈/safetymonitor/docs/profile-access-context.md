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
- DB(users) — `department`, `job_title`, `admin_access`(BOOLEAN, 기본 false) ALTER 추가. `setUserAdminAccess(id, value)`. `updateUserProfile`에 부서/직책.
- DB(calendar_media_comment) — `author_title`(직책 스냅샷) ALTER 추가.
- `lib/admin-auth.ts` — `hasAdminMenuAccess(request)`: owner면 true, 아니면 users.admin_access 조회. env 직접 자격(getSession이 owner 처리)도 허용.
- 서버 강제 적용(8개) — `/api/admin/{workers,preview,export,export-xlsx,fall-candidates,fall-export,fall-label,site-info}`가 `verifyBasicAuth` → `hasAdminMenuAccess`로 교체. (폴링·알림·캘린더 등 일반 사용자용 엔드포인트는 verifyBasicAuth 유지.)
- `/api/admin/profile` — GET이 department/job_title/admin_access/role 반환, POST가 부서/직책 저장.
- `/api/admin/users` — `grant_admin`/`revoke_admin` 액션(owner 전용), publicUser에 부서/직책/admin_access.
- `/api/calendar/media/comment` — resolveAuthor가 job_title→author_title 캡처. owner 기본 직책 "시스템 관리자"(데모 표시용), 작성자 식별자 = username(사번 대용).
- Client — MyProfileModal 부서/직책 입력; UserManagementModal '관리자권한' 컬럼 + 부여/회수 토글; DemoDashboard 마운트 시 /api/admin/profile로 adminAccess 받아 `canAdminMenu`(owner||adminAccess)로 관리자 dock 항목 게이팅; 댓글 표시에 직책 + "사번" 라벨.

## 검증 결과 (통과)
- tsc=0, next build=0.
- 댓글 author_title "시스템 관리자" 캡처 + 화면 표시(이름·직책·사번·시각).
- 권한 부여/회수 — 실 가입 사용자(admin) 대상 grant→true, revoke→false, 원복.
- 서버 강제 — /api/admin/workers 미인증=401, owner=200.
- owner 관리자 메뉴 노출=1.

## 한계(코드/빌드로만 확인)
- 가입이 **이메일 인증 게이트**라 스크립트로 비-관리자 브라우저 세션 생성 불가 → "비-관리자가 메뉴 안 보임 / 게이트 엔드포인트 403" 거부 경로는 build+tsc+로직(hasAdminMenuAccess가 admin_access=false면 false 반환)으로 확인. MyProfileModal 부서/직책 자가저장도 role=admin 계정 필요(owner는 모달 비대상)라 build로 확인.
- "사번"은 관리자 계정에 실제 사번이 없어 username을 식별자로 표시. 별도 사번 필드가 필요하면 프로필에 추가 가능.
