# 계정 찾기(ID/PW) — 체크리스트 (2026-08-15 착수)

목적 = 로그인 화면에서 **아이디를 찾고, 비밀번호를 되찾을 수 있게** 한다.
방식 = **관리자 승인**(사용자 결정 2026-08-15 · 도메인 없음 → 이메일 경로 배제, 근거 = context-notes C-2).

흐름.

| 단계 | 누가 | 무엇 |
|---|---|---|
| ① 아이디 찾기 | 사용자 | 이름 + 이메일 일치 → 마스킹 ID 표시(관리자 개입 0) |
| ② 재설정 신청 | 사용자 | ID + 이름 + 이메일 일치 → 요청 생성(pending) |
| ③ 승인 | owner | 사용자 관리 화면에서 처리 → 임시 비번 **1회 노출** |
| ④ 복구 | 사용자 | 임시 비번(24h)으로 로그인 → "내 정보"에서 변경 |

## Phase 0 — 전수 확인 (완료)

- [x] 찾기·재설정 라우트 부재 확인 — `/api/admin/*` 21개 중 0건
- [x] owner 액션 6종에 비번 되돌리기 없음 확인
- [x] ★ 라이브 `EMAIL_FROM` 미설정 확인 → 임의 수신자 메일 배달 불가(`00275-bvr` 실측)
- [x] ★ `lib/email-verify.ts` 가 `globalThis` Map = `maxScale=4` 에서 인스턴스별로 갈림 → 재사용 금지 판정
- [x] `/api/admin/profile` 이 비번 변경 경로를 이미 가짐 확인(현재 비번 검증) → 변경 라우트 신설 불필요
- [x] 방식 결정(관리자 승인) · 도메인 부재 확인

## Phase 1 — 구현 (완료)

### 데이터
- [x] `users.temp_password_expires_at TEXT` 멱등 ALTER
- [x] `password_reset_request` 테이블 + `status='pending'` 부분 유니크 인덱스
- [x] db.ts 함수 5종 — `findUsernamesByNameEmail` · `createPasswordResetRequest` ·
      `listPasswordResetRequests` · `approvePasswordReset`(트랜잭션) · `rejectPasswordReset`

### 서버
- [x] `lib/account-recovery.ts` — 마스킹 · 임시 비번 생성 · 만료 판정(순수 함수)
- [x] `POST /api/admin/find-id` — 이름+이메일 → 마스킹 ID 목록(미인증 · 10회/10분)
- [x] `POST /api/admin/password-reset` — 신청(미인증 · 5회/10분 · 구글/작업자 계정 차단)
- [x] `GET/POST /api/admin/password-reset/manage` — `verifyUserAdmin` 게이트, 목록·승인·거절
- [x] `login/route.ts` — 임시 비번 만료 시 403 + 유효 시 `mustChangePassword` 동봉
- [x] `db.ts updateUserProfile` — 비번 변경 시 만료 해제(한 곳에서)

### 화면
- [x] `AccountRecovery.tsx` 신규 — 아이디 찾기 / 재설정 신청 탭(한·영)
- [x] `login-styles.ts` 신규 — 입력 스타일 공유(두 폼이 갈라져 어긋나는 것 방지)
- [x] `LoginScreen.tsx` — 하단 "아이디·비밀번호 찾기" 링크 + `recovery` 모드 + 임시 비번 안내
- [x] `UserManagementModal.tsx` — 요청 패널 + 승인·거절 + 임시 비번 1회 표시 + 요약바 카운트

## Phase 2 — 검증 (완료)

- [x] `lib/account-recovery.test.ts` — 10개(마스킹 경계·한글·정책 통과·혼동문자·만료 경계)
- [x] `lib/2026-08-15-account-recovery.guard.test.ts` — 9개(권한 게이트 위치·평문 미저장·
      트랜잭션·만료 순서·마스킹·rate limit·계정종류 차단)
- [x] **가드 변이 검증** — 마스킹을 일부러 제거하니 해당 가드만 실패, 복원 후 통과(가드가 실제로 잡는다)
- [x] `tsc --noEmit` 0건 · `eslint .` 0 error(경고 5건은 기존 scripts) · `npm test` **806/806**
- [x] `next build` 성공 — 새 라우트 3개 등록 확인
- [x] 로컬 렌더 확인 — 로그인 링크 · 아이디 찾기 · 비밀번호 찾기 탭 전환
- [x] ~~로컬 e2e~~ → **라이브 e2e 로 대체·완료**(2026-08-15, 사용자 실행). 로컬은 `.env.local` 의
      `DATABASE_URL` 이 프로덕션이라 폼 제출이 곧 라이브 INSERT 이고 `ensureSchema()` 가 DDL 을
      실행해 하지 않았다. 배포 후 사용자가 실계정으로 전 구간을 돌려 대신 확인됐다

## Phase 3 — 배포·라이브 검증 (완료)

- [x] 배포 `00277-lpg`(커밋 `9464777` · 내 몫 `b327223`) — 범위 5커밋, digest 서빙 대조 일치
- [x] `ensureSchema` 가 새 컬럼·테이블 생성 확인 — `temp_password_expires_at` ·
      `password_reset_request` · `idx_prr_pending` 3종 전부
- [x] 라우트 — find-id 404/400 · manage GET·POST 미인증 401 · 신청 400 · 로그인 화면 링크·탭 렌더
- [x] **★ 전 구간 왕복 완주**(요청 id=1) — 신청 13:34:17 → **승인 13:52:28(처리자 `admin` = env owner)**
      → 임시 비번 로그인 → 비밀번호 변경 → `temp_password_expires_at` **자동 NULL 복귀 확인**
      · 설계 D-3(비번 변경 시 만료 해제)이 실제로 동작했다
- [x] **승인자가 env owner 였다는 점이 설계 확인이기도 하다** — 신청자(admin6861)는 비번을 잃은
      당사자라 로그인해서 자기 요청을 승인할 수 없다. 부트스트랩 계정이 그 탈출구로 실제 기능했다

## Phase 4 — 후속

- [x] `60a9def`(요청 제한 5→10 · 429 대기시간 안내) **라이브 반영 완료** — `00278-lx8`(commit-sha `60a9def`,
      2026-08-15 13:54:48 KST). 배포 주체는 옆 세션(협의 결과), 저는 검증만 맡았다.
      **정상 경로 5종 회귀 0** — find-id 400·404 · reset 400 · manage GET·POST 401.
      토큰 소모는 404 한 번뿐이다(두 라우트 모두 형식 검증이 `consumeToken` 보다 앞이라 400 은
      버킷을 안 건드리고, manage 는 rate limit 대상이 아니다)
- [ ] 429 실화면(“약 60초 후”) 관측 — **억지로 만들지 않는다.** 제한이 per-IP 라 확인하려고 10회를
      태우면 같은 공인 IP 의 실사용자가 막힌다. **관측 조건 = 사용자가 자연히 10회를 소진하는 상황**.
      `IP_MAX 5→10` 반영 자체는 같은 이유로 못 재고 **digest 대조로 갈음**했다
- [ ] (선택) owner 텔레그램 알림 — 봇은 라이브지만 범위 밖이라 미구현
- [ ] (선택·도메인 확보 시) 이메일 링크 방식 — `password_reset_request` 재사용, 승인 주체만 사람→토큰

## 하지 않기로 한 것

- [x] ~~이메일 재설정 링크~~ — 도메인 확보 후 재검토(테이블은 재사용 가능하게 설계)
- [x] ~~비밀번호 변경 강제 화면~~ — 클라 게이트는 우회되고 서버 전면 강제는 범위 밖. **만료로 대체**
- [x] ~~텔레그램 알림~~ — 범위 밖. 모달 60초 폴링으로 충분, 필요 시 다음 단계
