# TASK — 9/23 실기기 검증에서 나온 앱 후속 3건 (astra)

## ⛔ 작업 경로
`Lenova idea tap 12.7/app/vitalguard_field` 안에서만. `lib/data/outbox_controller.dart` 는 건드리지 마라. `flutter test`/`flutter build` 는 돌리지 말고 `dart analyze` 까지만(테스트 실행은 claude 가 한다). git commit 금지.

## 배경 (9/23 실측 · 근거는 `plan-draft/p4-touch-reflect-qa/태블릿 앱 제작 기록.updated.md` 9/23 절)
1. 현장 요약이 403 을 한 번 받으면 `_forbidden` 이 걸려 30초 타이머를 끊고 새로고침 버튼도 사라진다(`lib/ui/site/site_screen.dart:96-123, 279-300`). 관리자가 관제웹에서 `admin_access` 를 켜도 앱 재시작 전엔 「접근 권한 없음」이 남았다.
2. 로그인 응답이 허용 역할이 아니면 `_accept` 가 세션을 버리고 403 을 던지는데(`lib/data/field_coordinator.dart:81-96`) 서버 세션은 폐기하지 않아 `mobile_app_session` 행이 만료(30일)까지 남는다. `signOut()` 은 `gateway.logout(token)` 을 부른다(같은 파일).
3. 현장 정보(`site`)는 로그인·세션 복원·재검증 때만 `_loadSite()` 로 받는다(`:148, :234, :277`). 관리자가 현장을 배정해도 앱 재시작 전엔 헤더가 「현장 정보 없음」이다.

## 바꿀 것

### A. 403 상태에서도 수동 새로고침을 살린다 (`site_screen.dart`)
- `_forbidden` 이어도 `새로고침` 버튼(`Key('$prefix-refresh')`)을 그대로 보이고 누를 수 있게 한다. 자동 타이머는 지금처럼 멈춘 채 둔다.
- `_refresh()` 는 `_forbidden` 이어도 **수동 호출**이면 진행한다(타이머 호출은 계속 막는다). 성공하면 `_forbidden=false` 로 풀고 `_sync()` 로 타이머를 다시 건다. 실패(403 유지)면 지금 상태 그대로.
- 안내 문구: 403 일 때 `_forbiddenMessage` 아래에 「권한이 바뀌었으면 새로고침을 눌러 다시 조회합니다.」 한 줄을 붙인다.
- 네 상세(작업자·가스·AED·기상)의 `_receipt` 도 같은 `_refresh` 를 쓰므로 같이 살아난다 — 별도 코드 금지.

### B. 로그인 거부 시 서버 세션도 폐기한다 (`field_coordinator.dart` `_accept`)
- `!_allowed(session.user)` 분기에서 토큰 버리기 **전에** `gateway.logout(session.accessToken)` 을 best-effort 로 부른다(try/catch, 실패해도 흐름·예외·메시지 동일). 세션 복원(`initialize`) 경로에서 거부될 때도 같은 코드가 돈다 — 그 경우도 폐기한다.
- 서버가 이미 죽인 세션(401) 이어도 조용히 지나간다.

### C. 현장 정보를 재시작 없이 갱신한다
- `FieldController` 계약(`lib/data/contracts/field_contracts.dart` `siteStatus()` 옆)에 `Future<void> refreshSite();` 추가. `FieldCoordinator` 구현: `site = await _loadSite(); _notify();` (epoch 검사·오프라인 예외는 `_loadSite` 규칙 그대로. 실패하면 기존 `site` 유지하고 예외를 그대로 던진다).
- `SiteScreen` 의 **수동** 새로고침(버튼)은 `refreshSite()` 를 먼저 부르고(실패해도 계속) 이어서 `siteStatus()` 를 부른다. 30초 타이머 호출은 `siteStatus()` 만(현장 정보까지 30초마다 부르지 않는다).
- 앱이 전경으로 돌아올 때(`didChangeAppLifecycleState(resumed)`)는 `_sync()` 가 이미 `_refresh()` 를 부르므로, 그 경로도 **수동과 같은 취급**(refreshSite 포함)으로 한다. 즉 「사용자 조작 또는 전경 복귀」= 현장 정보 + 상태, 「타이머」= 상태만.
- 셸 헤더는 `c.site` 를 이미 AnimatedBuilder 로 보므로 `_notify()` 만으로 갱신된다 — 확인만 해라.

## 테스트 (작성만 · 실행은 claude)
- `test/site_screen_test.dart` 또는 신규 `test/site_refresh_recovery_test.dart`:
  1. 403 → 화면에 「접근 권한 없음」+ 새로고침 버튼 **있음·활성** → 게이트웨이를 200 으로 바꾸고 버튼 탭 → 자료 표시·`_forbidden` 해제·타이머 재개(다음 주기에 `siteStatus` 호출 수 증가).
  2. 403 상태에서 타이머 시간만 지나면 `siteStatus` 호출이 늘지 않는다(자동 재시도는 여전히 없음).
  3. 수동 새로고침은 `siteInfo`(refreshSite)를 1회 + `siteStatus` 1회 부르고 헤더 현장명이 새 값으로 바뀐다. 타이머 주기 호출은 `siteInfo` 를 부르지 않는다.
  4. 전경 복귀(`didChangeAppLifecycleState(resumed)`)는 `siteInfo` 를 부른다.
- `test/` 인증 쪽(기존 거부 테스트가 있는 파일에 추가): 허용되지 않은 role 로그인 → `gateway.logout` 이 그 access token 으로 1회 호출됨 · 결과(403 예외·토큰 번들 null·`AuthStage.denied`)는 종전과 동일 · logout 이 던져도 동일.
- 기존 테스트 중 「403 이면 새로고침 버튼이 없다」류 기대가 있으면 새 규칙으로 고쳐라(`common_states_test.dart`, `site_screen_test.dart`, `aed_weather_screen_test.dart`, `workers_screen_test.dart`, `gas_screen_test.dart` 확인).
- Mock 게이트웨이(`lib/data/mock/mock_gateway.dart`)와 테스트 fake 에 `siteInfo`/`logout` 호출 기록이 없으면 추가해라.

## 끝나면 답변에 적어라
- `git diff --stat -- .` · `dart analyze` 결과
- 바꾼 동작 요약(A/B/C 각각 어느 함수)
- 수정/신규 테스트 파일과 케이스 수
- 네가 임의로 정한 것 · 「미확인」
