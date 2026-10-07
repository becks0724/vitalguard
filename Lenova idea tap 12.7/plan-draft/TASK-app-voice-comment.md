# 작업 지시 — 앱: 녹음(음성 댓글)

작성: Claude / 수신: 코덱스(astra) / 2026-09-13
근거: 태곤 님 결정 — *"녹음본 코멘트 댓글처럼 같이 그 현장사진에 대해서 올라가게끔"* · **댓글 하나로 들어간다**
서버측: `TASK-server-voice-comment.md` **완료·검증 통과**(test 1786/1786)

---

## ⛔ 작업 경로

```
/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/Lenova idea tap 12.7/app/vitalguard_field
```

**건드리면 안 되는 곳**
| 경로 | 이유 |
|---|---|
| `조달청_rlaxorhs77eng/기존_조달청모듈/**` | 읽기 전용 |
| `조달청_rlaxorhs77eng-alerts/**` · `-newdb/**` | 서버 트리 |
| `lib/ui/cctv/**` · `lib/cctv_probe_screen.dart` · `lib/data/cctv_image_reader.dart` | CCTV 작업. 손대지 마라 |
| `lib/ui/record/record_editor.dart` 의 잉크 로직 | 방금 끝난 잉크 작업 |

**하지 마라** — ⛔ **새 패키지 금지** · ⛔ 커밋 · ⛔ 배포

---

## ★ 패키지를 쓰지 마라 — 이 프로젝트에는 선례가 있다

Flutter 기본으로는 녹음이 안 된다. 그렇다고 `record`·`flutter_sound` 를 추가하지 마라.
**이 앱은 이미 네이티브를 직접 부른다.**

| 선례 | 채널 | 파일 |
|---|---|---|
| STT | `vitalguard/stt` + `vitalguard/stt_events` | `MainActivity.kt` |
| 촬영·OCR | `vitalguard/capture` | **`CaptureNative.kt`** (클래스로 분리) |

**`CaptureNative.kt` 와 같은 방식으로 `RecorderNative.kt` 를 만든다.**
`MainActivity.configureFlutterEngine` 에서 `captureNative = CaptureNative(this, …)` 하듯 생성해라.

- 안드로이드 **`MediaRecorder`** 를 쓴다. 기본 출력이 **AAC / MPEG-4(m4a)** 이고,
  서버가 받는 `audio/mp4` 와 정확히 맞는다.
- **`RECORD_AUDIO` 권한은 이미 있다**(`AndroidManifest.xml:3` · STT 가 쓴다). 추가하지 마라.
  다만 **런타임 권한 요청**은 필요하다 — `CaptureNative` 가 카메라 권한을 어떻게 받는지 보고 같은 방식으로.

---

## 서버 계약 (확정됨 — 이대로 맞춰라)

```
POST /api/app-media   (multipart/form-data · 기존 업로드 라우트)
  file        오디오 바이트 (audio/mp4 = m4a)
  commentOf   원본 사진 id      ★ 필수
  audioMs     길이(밀리초)      선택
→ 200 { ok: true, comment: {...} }
```

| 규칙 | |
|---|---|
| **오디오는 댓글로만** | `commentOf` 없이 오디오를 보내면 **400** |
| 크기 | **10 MiB** 초과 시 **413** |
| 인증 | 앱 JWT 필수. 없으면 **401** |
| 권한 | **남의 사진에도 댓글을 달 수 있다** — 잉크(작성자만)와 다르다 |
| 없는 사진 / 잉크본 지정 | **404 / 400** |

---

## 1. 네이티브 — `RecorderNative.kt`

채널 이름: **`vitalguard/recorder`**

| 메서드 | 하는 일 |
|---|---|
| `start` | 녹음 시작. 앱 캐시 디렉터리에 임시 파일 |
| `stop` | 정지. **파일 경로 · 길이(ms) · 바이트 크기** 반환 |
| `cancel` | 정지하고 **파일 삭제** |
| `play` / `stopPlay` | 미리듣기 (`MediaPlayer`) |

- 포맷: `MPEG_4` 컨테이너 + `AAC` 인코더. 샘플레이트·비트레이트는 **음성에 맞게** 정해라
  (말소리다. 음악이 아니다). **무엇으로 정했고 왜인지 보고해라.**
- **최대 3분**에서 자동 정지하고 그 사실을 Flutter 로 알려라. 10MiB 상한에 걸리지 않게 하는 안전장치다.
- 녹음 중 앱이 백그라운드로 가면 **정지**해라(마이크를 붙잡고 있지 마라).

## 2. 계약 — 기존 `comment` 옆에 음성 버전

```dart
// field_contracts.dart:101 에 이미 있다
Future<MediaComment> comment(String mediaId, String text);
```

**같은 자리에** 음성 버전을 더해라.

```dart
Future<MediaComment> voiceComment(String mediaId, Uint8List audio, {int? durationMs});
```

- `live_gateway.dart` 에 구현. **기존 업로드(`upload`)가 multipart 를 어떻게 만드는지 먼저 읽고
  그 방식을 재사용해라.** 새 HTTP 경로를 만들지 마라.
- `mock_gateway.dart` 도 짝을 맞춰라 — 모의 모드에서 앱이 죽으면 안 된다.
- `field_coordinator.dart` 에도 기존 `comment`(`:484`) 옆에 같은 모양으로.

## 3. 화면 — 코멘트 입력에 녹음 버튼

R-06 확정 구조는 **타이핑이 기본, 아이콘 버튼으로 대체 수단**이다.
STT 버튼이 이미 있는 자리(`lib/ui/record/record_input.dart`)에 **녹음 아이콘을 나란히** 둬라.

### 흐름

```
[마이크 아이콘] → 녹음 중(경과 시간 · 정지 버튼) → 정지
   → 미리듣기 가능 · [전송] [다시 녹음] [취소]
   → 전송하면 그 사진의 댓글로 올라간다
```

⚠ **녹음하자마자 자동 전송하지 마라.** 확인 없이 보내면 잘못 녹음된 것이 그대로 증빙으로 남는다.
**반드시 들어보고 보낼 수 있어야 한다.**

### 상태 표시 — 말해야 할 것

| 상황 | 문구 |
|---|---|
| 권한 거절 | 마이크 권한이 필요합니다 |
| 녹음 중 | 경과 시간 `0:07` 를 **초 단위로 갱신** |
| 3분 도달 | 최대 3분까지 녹음됩니다 |
| 전송 실패(네트워크) | 사유를 그대로 · **녹음은 지우지 마라** |
| 401 / 403 / 404 | 각각 다른 문장 |

⚠ **전송 실패 시 녹음 파일을 버리지 마라.** 현장 네트워크는 끊긴다.
다시 시도할 수 있어야 한다. 기존 오프라인 처리(`status` 흐름)를 **읽고 맞춰라** —
새 큐를 만들지 말고 기존 방식과 어긋나지 않게 해라. 어떻게 했는지 보고해라.

## 4. STT 와 섞지 마라

**STT 는 글자로 바꾸고, 녹음은 소리 그대로 남긴다.** 다른 수단이다.
녹음한 것을 STT 에 넣지 마라. 녹음 중에 STT 를 돌리지 마라(마이크가 하나다).
**둘 중 하나가 돌고 있으면 다른 하나를 못 켜게** 해라.

---

## 검증

1. `dart analyze` 무경고
2. **`flutter test` 전부 통과** — 현재 **82건**이다. 깨지면 고쳐라(무엇을 검증하던 테스트인지 유지)
3. **새 테스트** — ⓐ 녹음→정지→전송이 `voiceComment` 를 부른다 ⓑ 전송 실패 시 녹음이 보존된다
   ⓒ STT 와 녹음이 동시에 안 켜진다 ⓓ 취소하면 파일이 지워진다 ⓔ 모의 모드에서 안 죽는다
4. ⚠ **너는 `flutter test` 와 `flutter build` 를 못 돌린다** — 샌드박스가 `127.0.0.1` 소켓 생성을
   막는다(이전 작업에서 확인됨). **거기까지만 하고 그렇게 보고해라. 내가 돌린다.**
   `dart analyze` 는 되니 그것만은 반드시 무경고로 만들어라.

---

## 끝나면

답변에 적어라 (`astra-done.txt` 는 내가 대신 적는다).

- 바꾼 파일과 줄 수
- **오디오 포맷 설정값과 그 근거**
- 런타임 권한 요청을 **어디를 보고 따라했나**
- **전송 실패 시 녹음 보존을 어떻게 했나** (기존 오프라인 흐름과의 관계)
- STT 와의 배타 처리를 어떻게 했나
- `dart analyze` 결과
- **네가 임의로 정한 것 전부**
