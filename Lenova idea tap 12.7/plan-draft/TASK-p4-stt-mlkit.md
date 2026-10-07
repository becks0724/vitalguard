# 작업 지시 2 — 온디바이스 STT · ML Kit 한글 필기인식

작성: Claude / 수신: 코덱스(astra) / 2026-09-12
선행: `TASK-p4-touch-reflect.md` 를 끝낸 뒤에 시작할 것.

## 배경 — 왜 이게 중요한가

요구사항 14: **"타이핑은 한 손 파지에 불편하니 펜으로 한글을 그리면 타이핑 변환. STT 도 좋음."**

그런데 **레노버 OS 손글씨는 실측으로 기각됐다.**
`네이버 구글` → `네ㅇ뻐7ㄱㅜ그리`. 한글 음절을 조합하지 못한다(`research/device-facts.md` §5-1).

그래서 남은 후보가 이 둘뿐이다. **둘 다 안 되면 요구사항 14 가 미달로 남는다.**

닫아야 할 항목: `[미검증] 5` (온디바이스 한국어 STT), `[미검증] 6` (ML Kit 한글 인식률)

---

## ★★ 절대 규칙 — 패키지·의존성을 임의로 추가하지 마라

태곤 님의 전역 규칙이다. **네 승인 정책이 `never` 여도 이 규칙이 위다.**

- `flutter pub add` · `pubspec.yaml` 의존성 추가 **금지**
- `build.gradle.kts` 에 새 `implementation(...)` 추가 **금지**
- `npm/pnpm/pip/yarn/npx` **금지**

필요하면 **무엇이 왜 필요한지 보고만 하고 멈춰라.** 태곤 님이 Socket 검사 후 설치한다.
"테스트만 해보자" 식의 임시 설치도 금지다.

---

## 작업 A — 온디바이스 한국어 STT  **(패키지 불필요 · 바로 진행)**

Android 순정 `SpeechRecognizer` 를 **플랫폼 채널로 직접 호출**한다. 외부 패키지가 필요 없다.
이 기기는 **API 36** 이라 온디바이스 API(API 31+)를 다 쓸 수 있다.

### 재야 할 것 5가지

| # | 측정 | 어떻게 |
|---|---|---|
| 1 | 온디바이스 인식기가 **있는가** | `SpeechRecognizer.isOnDeviceRecognitionAvailable(context)` |
| 2 | **한국어 모델이 깔려 있는가** | `ACTION_GET_LANGUAGE_DETAILS` 또는 온디바이스 인식 시도 후 오류코드 |
| 3 | ★ **진짜 온디바이스인가** | **비행기모드에서 인식되는지.** 이게 핵심이다 |
| 4 | 한국어 인식 품질 | 아래 문장 5개를 읽고 결과를 그대로 기록 |
| 5 | 부분 결과 지연 | `onPartialResults` 첫 도착까지 ms |

**3번이 핵심인 이유**: 이 기기는 **셀룰러가 없다**(`telephony` feature 부재).
현장에서 Wi-Fi 가 끊기는 게 정상 시나리오다.
**인식할 때마다 네트워크를 타는 STT 는 이 앱에서 쓸 수 없다.**

> ⚠ **정정(태곤 님 지적)** — "셀룰러가 없다" 는 **모델을 번들하면 제약이 아니다.**
> 온디바이스 모델을 `assets/` 에 넣으면 네트워크와 무관하게 돈다.
> 그러니 결론은 "STT 가 어렵다" 가 아니라 **"모델 번들 방식으로 가야 한다"** 다.
> 3번이 재는 것은 **"이 인식기가 매 인식마다 서버를 타는가"** 이지 배포 방식이 아니다.

### 4번에 쓸 문장 — 현장 어휘로 (임의로 바꾸지 말 것)

```
1. 3번 구역 안전난간 파손 확인했습니다
2. 크레인 작업 중지 요청합니다
3. 가스 농도 초과 경보 발생
4. 작업자 두 명 안전대 미착용
5. 오후 두시 십오분 점검 완료
```

숫자·단위·현장 용어가 섞여 있다. **일상 대화문으로 재면 현장 성능을 못 잰다.**

### 구현

- `android/app/src/main/kotlin/com/vitalguard/vitalguard_field/MainActivity.kt`
  에 `MethodChannel` + `EventChannel`
  - 채널: `vitalguard/stt` (method) · `vitalguard/stt_events` (event)
  - 메서드: `isOnDeviceAvailable` · `start` · `stop`
  - 이벤트: `partial` · `final` · `error`(오류코드 **숫자 그대로**)
- `AndroidManifest.xml` 에 `android.permission.RECORD_AUDIO` 추가
  - ⚠ 런타임 권한 요청은 `ActivityCompat.requestPermissions` 로 **네이티브에서** 처리.
    `permission_handler` 같은 패키지를 쓰지 마라.
  - `<queries>` 에 `android.speech.RecognitionService` 가 필요할 수 있다(API 30+ 패키지 가시성).
- `lib/stt_screen.dart` — 진단 화면(`diag_screen.dart`) 헤더에 `STT 측정` 버튼으로 진입.
  `장갑 측정` 버튼 옆에 같은 방식으로 붙이면 된다.

### 화면이 지켜야 할 것 (진단 화면과 같은 원칙)

- **표본이 0이면 "미측정" 으로 표시**한다. `–`(해당 없음)와 **다른 말**이다.
- **오류코드를 숫자 그대로** 보여준다. "인식 실패" 로 뭉개지 마라 —
  `ERROR_NO_MATCH(7)` 와 `ERROR_LANGUAGE_UNAVAILABLE(12)` 는 **완전히 다른 결론**이다.
- 읽은 문장과 **인식 결과를 나란히** 보여준다. 일치율을 네가 계산해 붙이지 마라 —
  **원문 그대로 보여주면 내가 읽는다.**
- 비행기모드 여부를 화면이 **직접 읽어서** 표시한다(`Settings.Global.AIRPLANE_MODE_ON`).
  "비행기모드로 쟀다" 는 말은 화면이 증명해야지 사람 기억에 맡기면 안 된다.

---

## 작업 B — ML Kit Digital Ink  **(의존성 필요 → 조사만 하고 멈춰라)**

`com.google.mlkit:digital-ink-recognition` 이 필요하다. **이건 Gradle 의존성 추가다.**
**코드를 쓰지 말고 `build.gradle.kts` 도 건드리지 마라.** 아래를 조사해 **보고만** 해라.

| 조사 항목 | 왜 필요한가 |
|---|---|
| 정확한 artifact 좌표와 **현재 최신 버전** | 설치 요청에 정확히 적어야 한다 |
| **한국어 모델 식별자** (`ko`? `ko-Hang`?) | 모델이 언어별로 따로다 |
| 모델 **다운로드 방식** | 런타임 다운로드면 **현장에서 못 받는다**(셀룰러 없음) |
| **오프라인 사전 번들**이 가능한가 | 불가능하면 **이 기기에선 쓸 수 없다** |
| 모델 크기 · 앱 용량 증가 | |
| 라이선스 | |

> ★ **다운로드 방식이 결론을 가른다 — ML Kit 에 한해서다.**
> ML Kit 은 모델을 **런타임에 내려받는 구조**로 알려져 있다. 사전 번들이 정말 안 되면
> 셀룰러 없는 이 기기에서 **현장 도착 후 처음 쓸 때 실패**한다.
> 그러면 ML Kit 은 **플랜 B 로 못 쓰고**, 요구사항 14 는 "펜 잉크를 그대로 저장" 으로만 남는다.
> 이건 제품 결정이라 **네가 정하지 말고 근거만 가져와라.**
>
> ⚠ 대조 — **`sherpa-onnx` 는 ONNX 파일을 `assets/` 에 넣으면 되므로 번들이 자연스럽다.**
> 두 기술의 사정이 다르다는 점을 섞지 마라.

네 샌드박스가 네트워크 차단이면 웹 조회가 안 될 수 있다. **안 되면 안 된다고 보고해라.**
추측으로 버전 번호를 지어내지 마라.

---

## 작업 C — 오픈소스 STT 폴백  **(이미 조사됨 · 중복 조사 금지)**

`research/grok-02-input-offline.md` **§E.4** 에 이미 정리돼 있다. **다시 조사하지 마라.**
요약(그 문서가 정본이다):

| 후보 | 패키지 | 한국어 모델 | 성격 |
|---|---|---|---|
| **sherpa-onnx** (1순위) | `sherpa_onnx` 1.13.8 · likes 121 · k2-fsa | `sherpa-onnx-streaming-zipformer-korean-2024-06-16` | **스트리밍 실시간**. 완전 오프라인 ONNX |
| whisper.cpp | `whisper_edge` 0.2.0 / `whisper_cpp_flutter_plus` 0.4.1 (likes 적음) | 다국어에 한국어 포함 | **녹음 후 전사**에 강함 |

- 우리 요구(요구사항 14)는 **"타이핑 대신 말로 한 줄"** → **스트리밍 Zipformer** 쪽이다.
  Whisper 는 성격이 다르다(긴 녹취 전사).
- ⚠ `sherpa_onnx` 는 grok 조사에서 **unverified uploader** 로 표시됐다.
  **설치 전 Socket 검사가 필요하다** — 네가 설치하지 마라.
- 모델은 **`assets/` 번들**을 전제로 한다. 런타임 다운로드에 기대지 않는다.

**네가 할 일은 조사가 아니라 이것뿐이다**: 작업 A 결과가 나온 뒤,
**순정으로 충분한지 / 폴백이 필요한지**를 실측값으로 판정해 보고하라.
순정이 되면 **오픈소스는 아예 필요 없다.** 미리 패키지를 깔지 마라.

---

## 빌드·설치·측정

```
cd "/Users/rlaxorhs77/Desktop/조달청 프로젝트/조달청_rlaxorhs77eng/Lenova idea tap 12.7/app/vitalguard_field"
dart analyze                      # 무경고여야 한다
flutter test                      # 통과해야 한다
flutter build apk --debug
export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
adb install -r build/app/outputs/flutter-apk/app-debug.apk
adb shell am start -n com.vitalguard.field/com.vitalguard.vitalguard_field.MainActivity
```

⚠ **`applicationId`(`com.vitalguard.field`) 와 Kotlin 패키지(`com.vitalguard.vitalguard_field`)가
다르다.** `am start` 는 **뒤쪽**을 써야 한다. 지금 고치지 마라 — 측정이 초기화된다.

adb·빌드가 네 환경에서 안 되면 **거기까지 하고 보고해라.** 내가 돌리겠다.

**마이크 입력은 사람이 말해야 한다.** 화면을 띄워 놓고 **태곤 님께 무엇을 읽어 달라고 할지**
명확히 보고해라. 합성 입력으로 대신하려 하지 마라 — 터치에서 이미 그 함정을 겪었다
(`adb input swipe` 가 `pressure 0` 을 보내 필압 판정을 오염시켰다).

---

## 지켜야 할 것

- **숫자·버전을 지어내지 마라.** 확인 못 했으면 "확인 못 함" 이라고 써라.
- **인식 결과를 다듬지 마라.** 틀린 그대로 기록해야 판단할 수 있다.
- 측정값은 `research/device-facts.md` 에 **§5 입력** 절 아래로 넣되,
  기존 레노버 OS 손글씨 기각 기록(§5-1)을 **지우지 마라.** 그 옆에 나란히 둔다.
- 끝나면 **파일·행 단위로 보고**하고, **못 한 것과 그 이유**를 반드시 말해라.
