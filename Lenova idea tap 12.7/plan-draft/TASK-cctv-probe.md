# 작업 지시 — 앱 CCTV 측정 화면 (배터리 실측용)

작성: Claude / 수신: 코덱스(astra) / 2026-09-13
근거: `artifacts/design-constraints.md` §11-2·11-3

---

## ⛔ 먼저 — 작업 경로

```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/Lenova idea tap 12.7/app/vitalguard_field
```

**건드리면 안 되는 곳**
| 경로 | 이유 |
|---|---|
| `lib/app.dart` · `lib/ui/**` · `lib/data/**` | **본 앱이다. 한 줄도 고치지 마라** |
| `기존_조달청모듈/safetymonitor/` | 서버다. 이 작업과 무관 |

**하지 마라**
- ⛔ **새 패키지 추가 금지.** `dart:io` 의 `HttpClient` 만 쓴다 — `live_gateway.dart:3,28` 선례가 있다.
- ⛔ **티켓 값을 로그·화면 제목·예외 메시지에 찍지 마라.** 접근 자격이다.
- ⛔ 라이브 서버에 **쓰기(POST/PUT/DELETE) 금지.** 이 화면은 GET 만 한다.
- ⛔ 커밋하지 마라.

---

## 왜 만드나

태블릿에 CCTV 를 넣을지 정하려면 **배터리를 얼마나 먹는지** 알아야 한다.
웹(크롬 · 관제 대시보드)으로는 이미 쟀다.

| 구간 | 전류 |
|---|---|
| CCTV 탭 · 영상 없음 | 1.177 A |
| CCTV 탭 · CAM-03 실영상 30fps | **1.550 A** (+0.372 A · 32%) |

**그런데 이 값을 앱에 그대로 쓸 수 없다**(§11-3). 네 가지가 다르다.
그중 제일 큰 것 — **앱의 V-01 은 MJPEG 연속 스트림이 아니라 「스냅샷 갱신」이다.**
초당 수십 프레임 디코딩과 몇 초에 한 장은 부하 성격이 다르다.

**그래서 앱에서 직접 재야 한다.** 이 화면은 그것만을 위한 것이다.

---

## 격리 — 본 앱에 섞지 마라

`main.dart` 에 이미 선례가 있다(`:35-47`).

```dart
this.diagnostics = const bool.fromEnvironment('VG_DIAGNOSTICS');
if (!diagnostics) return const FieldApp();
```

**같은 방식으로 플래그를 하나 더 둔다.** `VG_DIAGNOSTICS` 분기보다 **먼저** 본다.

```dart
// 측정용 임시 화면. 측정이 끝나면 이 분기와 cctv_probe_screen.dart 만 지우면 원래대로다.
this.cctvProbe = const bool.fromEnvironment('VG_CCTV_PROBE');
```

- `main.dart` 변경은 **이 분기뿐**이다. 그 밖은 건드리지 마라.
- `DiagScreen` 을 고치지 마라 — 거기에 버튼을 달면 P4 화면과 섞인다.

---

## 만들 것 — `lib/cctv_probe_screen.dart` 한 파일

### 화면 구성

| 영역 | 내용 |
|---|---|
| 입력 | **URL**(전체 주소) · **티켓**(선택) · **주기**(3 / 5 / 10초 중 선택) |
| 실행 | `[시작]` `[정지]` 두 버튼 |
| 표시 | 받은 이미지 한 장(최신) |
| 계기 | 받은 프레임 수 · 마지막 바이트 크기 · 마지막 왕복 ms · 마지막 오류 |

입력칸은 **`TextField` 로 사람이 붙여넣는다.** 주소를 코드에 박지 마라 — 내가 그 값을 모르고,
현장마다 다르다.

### 동작

주기마다 한 번 GET 한다. **직전 요청이 아직 안 끝났으면 건너뛴다**(겹쳐 쏘지 마라).

```dart
final req = await client.getUrl(uri);
if (ticket.isNotEmpty) req.headers.set('Authorization', 'Bearer $ticket');
final res = await req.close();
```

### ★ 응답 형식이 둘이다 — `Content-Type` 으로 갈라라

| Content-Type | 처리 |
|---|---|
| `image/jpeg` · `image/png` 등 | 본문 전체를 받아 그대로 표시 |
| `multipart/x-mixed-replace; boundary=…` | **첫 파트만 읽고 연결을 끊는다** |

두 번째가 이 작업의 핵심이다. **MJPEG 스트림을 열어두면 그건 「스냅샷 갱신」이 아니라
「연속 스트림」이고, 그러면 웹과 같은 것을 재게 된다.**

첫 파트만 읽는 방법: 스트림을 바이트로 받으면서 `boundary` 다음의 헤더 블록(`\r\n\r\n`)을
지나 본문을 모으다가, **다음 `boundary` 를 만나면 거기서 멈추고 `res.detachSocket()` 또는
구독 취소로 연결을 닫는다.** 한 프레임을 얻으면 더 읽지 않는다.

⚠ `Content-Length` 파트 헤더가 있으면 그 길이만큼만 읽으면 된다 — 있으면 그걸 쓰고,
없을 때만 boundary 탐색으로 간다.

### 계기 표시

측정은 **내가 adb 로 전류를 잰다.** 앱은 조건을 유지하기만 하면 된다.
다만 다음은 화면에 보여라 — 무엇을 재고 있는지 확인해야 한다.

```
프레임 12장 · 마지막 48.3KB · 왕복 132ms · 주기 5초
```

오류가 나면 **멈추지 말고 계속 시도**하되 마지막 오류를 표시해라
(현장 네트워크는 끊겼다 붙는다).

---

## 검증

1. `dart analyze` 무경고.
2. **본 앱 테스트 25건이 그대로 통과**하는지 확인해라 — 하나라도 깨지면 격리에 실패한 것이다.
3. 빌드가 되는지만 확인하면 된다. **실기기 측정은 내가 한다.**

```
flutter build apk --debug --dart-define=VG_CCTV_PROBE=true
```

---

## 끝나면

작업 완료 신호 규칙대로 `astra-done.txt` 에 한 줄 남기고, 답변에 아래를 적어라.

- `main.dart` 에서 **정확히 몇 줄** 바꿨는지
- 첫 파트만 읽고 끊는 부분을 **어떻게** 구현했는지 (이게 제일 중요하다)
- 본 앱 테스트 결과
