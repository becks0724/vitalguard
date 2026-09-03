# 관리자 앱 — 결정과 근거

작업하며 계속 덧붙인다. 다음 세션이 "왜 이렇게 했나" 를 여기서 찾는다.

## 2026-09-03 · 착수

### 왜 별도 프로젝트인가
현행 작업자 앱(`apps/vitalguard_app`)에 flavor 로 넣으면 관리자 APK 가 Wear OS Kotlin
모듈(12,037줄)을 끌고 다닌다. 대상도 다르다 — 작업자 앱은 착용자용, 이쪽은 관리자용이다.

### ★ 왜 네이티브 브리지를 안 쓰는가
현행 작업자 앱은 로그인조차 `MethodChannel('vitalguard/bridge')` 로 네이티브를 거친다
(`vitalguard_app/lib/main.dart:103`). 그 브리지는 **iOS `VitalBridge.swift` 에만 구현**돼 있어
안드로이드에서는 "네이티브 브리지 연결에 실패했습니다" 가 뜬다(2026-09-03 노트10 실측).

관리자 앱은 생체를 **수집하지 않는다** — 서버가 이미 모아 둔 것을 보기만 한다. 그래서
HTTP 로 서버에 직접 붙고 네이티브 코드를 한 줄도 안 쓴다. 노트10 블로커가 설계로 사라진다.

### ★★ 판정을 클라이언트가 하지 않는다
`/api/app/admin/workers` 가 `tone`·`label`·`counts` 를 **이미 판정해서** 내려준다
(그 라우트가 관제웹 화면과 같은 `lib/worker-signal.ts` 를 쓴다).
앱은 그 값을 그리기만 한다. 앱이 임계를 따로 두면 같은 작업자가 웹과 앱에서 다른 색으로 뜬다 —
CLAUDE.md "임계·색은 관제웹에서 가져온다" 가 막으려는 지점이고 구 앱에서 실제로 그 사고가 났다.

⟹ 그래서 작업자 앱의 `vital_range.dart`(임계 117줄)를 **안 가져온다.** 가져오면 판정이 둘이 된다.
   가져오는 것은 `theme.dart` 색 토큰뿐이다.

### 신선도 기준 — 이미 맞아 있다
`/api/app/admin/workers` 는 `vitalAgeMs` 를 쓰고, 그 함수는 2026-08-15 에
`heartRateMeasuredAt` 기준으로 옮겨졌다(`lib/vital-age.ts:48`). 2026-09-03 에 알림도 같은
기준으로 옮겨졌다(`c3a8bf8`). ⟹ 화면·알림·앱 셋이 같은 기준이다. 앱에서 따로 맞출 것이 없다.

### 토큰 보관
refresh 는 30일짜리 자격증명이고 이 앱은 **전 작업자 생체**를 본다. 분실 폰을 전제로
Keystore 백업 저장소(`flutter_secure_storage`)를 쓴다. `shared_preferences` 는 평문 XML 이라 안 쓴다.
access 는 15분이라 메모리에만 둔다.

### 이번 범위에서 뺀 것
- **쓰기 동작 전부**(경보 ack·작업자 호출) — 서버 라우트가 없다. 넣으려면 서버부터다.
- **작업자별 상세 화면** — 여기서부터 작업자 앱 위젯(`metric_tile` 235줄 · `status_ring` 148줄 ·
  `heart_rate_trend` 640줄)을 그대로 쓸 수 있다. 그 위젯들은 브리지가 아니라 `VitalRow` 라는
  평범한 뷰모델을 받으므로(`metric_tile.dart:2`) 어댑터 한 함수만 새로 쓰면 된다.
  이번엔 목록만 만들면 되므로 안 가져왔다 — 필요해지면 그때 가져온다.

### ⚠ `flutter analyze` 가 이 레포에서 죽는다 — `dart analyze` 를 쓴다
```
flutter analyze  →  Unhandled exception: FormatException: Unterminated string (at character 585)
dart analyze     →  No issues found!
```
통제군으로 갈랐다 — **같은 코드를 한글 없는 경로에 복사하면 `flutter analyze` 도 통과한다.**
원인은 코드가 아니라 경로다(`기존_조달청모듈` 의 멀티바이트가 분석 서버 LSP 프레이밍의
Content-Length 와 어긋난다). 이 레포 전체에 해당하므로 **검증은 `dart analyze` 로 한다.**
