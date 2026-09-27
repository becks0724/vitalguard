# TASK — 관제 서버: 캘린더 미디어 download-url 라우트에 앱 로그인 JWT 허용 · 2026-09-27

## 범위
- 프로젝트 `기존_조달청모듈/safetymonitor/apps/dashboard-web/` (라이브 클론 · 브랜치 main). **이 폴더 안에서만 수정.** 빌드·네트워크·배포 금지(클로드가 함).
- 태곤 님 결정(2026-09-27): 태블릿 현장 앱이 워크 캘린더에 서버 사진을 그리려면 `GET /api/calendar/media/download-url?id=` 를 앱 로그인 JWT 로 부를 수 있어야 한다. 지금은 `verifyBasicAuth(request)` 만 통과시켜 앱 토큰이 401.

## 할 일
1. `app/api/calendar/media/download-url/route.ts` 의 인증을 같은 폴더 `app/api/calendar/media/route.ts` GET 과 **똑같은 방식**으로 넓힌다: `verifyBasicAuth(request)` 또는 `verifyAppJwt(bearerToken(request)) !== null` 허용, 실패 시 그 파일과 같은 401 응답 형태(`diagnoseAppAuth` 의 `action` 포함). 다른 동작(프리사인·파일명·리터럴 URL 반환)은 손대지 않는다.
2. 앱 JWT 로 들어온 경우 **현장 범위**를 지켜야 하면(같은 폴더 GET 이 `listCalendarMedia` 에 무엇을 넘기는지, 앱 JWT 가 site 제한을 갖는지 `lib/admin-auth.ts`·`lib/db.ts` 에서 확인) 같은 규칙을 적용한다. 규칙이 없으면 없다고 적고 넓히지 않는다.
3. 가드 테스트 추가: `lib/2026-09-27-calendar-download-url-app-jwt.guard.test.ts` — 기존 `lib/2026-08-20-calendar-*.guard.test.ts` 의 소스 문자열 검사 방식 그대로. 검사 항목: (a) 라우트가 `verifyAppJwt` 분기를 갖는다 (b) `verifyBasicAuth` 분기도 남아 있다 (c) 401 응답이 `action` 을 준다.
4. `node --test` 등 테스트 실행은 하지 말 것(클로드가 돌림). 수정 파일 목록과 판단 근거를 `../../Lenova idea tap 12.7/plan-draft/astra-done.txt` 끝에 덧붙인다.
