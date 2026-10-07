# 2차 리서치 — 입력기술·오프라인 아키텍처

- 조사일: 2026-09-12
- 조사 주체: Grok (피어 의뢰 #2, effort xhigh)
- 대상 기기 전제 (1차·실측): TB373FU, Android 16 / API 36, 논리 866×1385 dp, Wi-Fi only, LTE 없음, 건설현장 순찰(지하·밀폐 포함)
- 원칙: 수치·주장은 출처 URL. 확인 못 한 것은 **확인 불가**. 패키지는 최신 버전 / 마지막 업데이트 / likes / 유지보수. 권고는 근거와 포기점을 함께.

---

# D. 한글 필기 → 텍스트 (오프라인 가능한 대안) ★최우선

MyScript iink는 한글을 지원하지만 **상용 라이선스 + 기동·실행에 인터넷**이라 이 조건과 충돌한다. 대안을 전수한다.

## D.1 Google ML Kit Digital Ink Recognition

### ⓐ 한국어(ko) 지원 여부

**지원한다.** 공식 베이스 모델 목록에 **Korean, Korean script / 텍스트 인식기 BCP-47 코드 `ko`**, 제스처 분류기 `ko-x-gesture`.

- https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models
- Swift 상수 `DigitalInkRecognitionModelIdentifier.ko` — “한국어, 한국어 자판”: https://developers.google.com/ml-kit/reference/swift/mlkitdigitalinkrecognition/api/reference/Constants?hl=ko
- 언어 태그 예: `DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US")` 패턴. 한글은 `"ko"` 또는 `"ko-KR"` 파싱. `"ko"`가 공식 표.

OCR(사진 속 글자)용 Text Recognition v2에도 한국어 `ko` / Kore 스크립트가 있다. 그건 **카메라 이미지**용이며 Digital Ink와 **다른 API**다. 혼동하지 말 것.

https://developers.google.com/ml-kit/vision/text-recognition/v2/languages

### ⓑ 완전 온디바이스·오프라인 동작 여부

**모델 다운로드 이후에는 완전 오프라인.** 공식:

> Digital ink recognition works fully offline… The user's handwriting stays on the device, recognition is performed without any network connection.

https://developers.google.com/ml-kit/vision/digital-ink-recognition

최초 1회(또는 언어 추가 시) 모델 다운로드에만 네트워크가 필요하다. 다운로드 후 현장(지하)에서는 네트워크 없이 인식된다. **MyScript와 결정적으로 다른 점.**

### ⓒ 무료인지

**온디바이스 ML Kit API는 호출 과금이 없다.** Google이 온디바이스 ML Kit를 무료로 제공한다. Digital Ink도 이 범주.

- 개요: https://developers.google.com/ml-kit
- Digital Ink 페이지에 사용량·가격 행이 없다 (클라우드 Vision API가 아님).

주의:

- Flutter 플러그인 `google_mlkit_*` 는 **Google 공식 패키지가 아니라** 커뮤니티(`flutter-ml.dev`) 래퍼다. 플러그인 라이선스는 MIT, 엔진은 Google ML Kit 네이티브 SDK.
- ML Kit **GenAI** API(Gemini Nano)는 별도 약관·기기 제한. Digital Ink와 무관.

**포기점:** 무료인 대신 정확도·어휘를 OEM 계약(MyScript)만큼 튜닝할 수 없다. 도메인 사전(건설 용어) 주입 API는 공식 Digital Ink에 **확인 불가**(pre-context 문자열만 문서화).

### ⓓ 모델 크기·다운로드 방식·최초 네트워크

- 언어당 **약 20 MB**. 공식: “Around 20MB of storage is required per language.”
  https://developers.google.com/ml-kit/vision/digital-ink-recognition/android
- `RemoteModelManager.download(model, DownloadConditions)` 로 온디맨드.
- 앱 첫 실행(Wi-Fi 있는 사무실/숙소)에서 `ko` 모델을 받아 두고, 이후 현장은 오프라인.
- `DownloadConditions`로 Wi-Fi 전용 다운로드를 걸 수 있음 (Android ML Kit 공통).
- 태블릿 8 GB / 128~256 GB 저장에서 20 MB는 부담 없음.

배포 시 모델을 APK에 프리로드하는 공식 방법은 Digital Ink 문서에 **확인 불가**(동적 다운로드가 기본). 현장 반입 전에 한 번 켜서 받게 하는 온보딩이 실무.

### ⓔ Flutter 플러그인 실사용 가능 여부

| 패키지 | 버전 | 업데이트 | likes | 유지보수 |
|---|---|---|---|---|
| **google_mlkit_digital_ink_recognition** | **0.16.1** | 2026-08-17 (약 18일 전) | **37** | **유지됨.** flutter-ml.dev. Android compileSdk 36, AGP 9, 네이티브 `com.google.mlkit:digital-ink-recognition` 19.0.0. **Google 공식이 아님. README에 production as-is 면책.** |
| digital_ink_recognition_mlkit | 0.1.1 | 2026-07-30 | 적음 | 경량 포크. likes·채택 적음. 1순위 아님. |

https://pub.dev/packages/google_mlkit_digital_ink_recognition

한국어 실제 동작 보고: 플러그인 README/이슈에서 **한국어 전용 성공담을 이 조사에서 문서로 확인하지는 못함 (확인 불가)**. 다만 네이티브 SDK가 `ko`를 공식 지원하고 플러그인은 languageCode로 BCP-47을 그대로 넘긴다. 실기기에서 `languageCode: 'ko'` + 모델 다운로드 후 한 문장 테스트가 최종 검증.

**권고:** 이 플러그인을 쓰되, 커뮤니티 래퍼 리스크를 인정하고 **네이티브 ML Kit를 Platform Channel로 직접 감쌀 탈출구**를 설계에 남겨 둔다. 포기점: 공식 지원 채널이 없음.

### ⓕ 문장 단위 인식이 되는지

**자모 단위가 아니라 유니코드 문자열 시퀀스로 나온다.** 공식: “Converts handwritten text to sequences of unicode characters.” Ink(여러 stroke)를 넣으면 후보 문자열이 여러 개 반환된다. Gboard 손글씨와 같은 기술이라고 명시.

https://developers.google.com/ml-kit/vision/digital-ink-recognition

한글은 음절 단위로 조합되므로, 사용자가 단어·짧은 문장을 이어서 쓰면 한 덩어리 문자열로 나오는 것이 설계 의도다. 영어 예시도 단어 단위 전사가 나온다.

한계:

- **긴 단락·여러 줄 노트를 한 번에 넣는 벤치마크는 공식 문서에 없음 (확인 불가).** 실무는 문장 단위로 `recognize()`를 끊는 편이 안전.
- 정확도 향상: writing area + **pre-context**(앞에 이미 확정된 문장)를 넘길 수 있다. 플러그인 README도 동일.
- 제스처 모델(`ko-x-gesture`)은 삭제선·동그라미 등. 텍스트 모델과 별개.

사용자 핵심 요구(한글 단어·문장을 통으로)에 **부합하는 API 형태**다. 음절 CNN(아래 D.3)과 달리 문장 입력을 전제로 한다.

### ⓖ 인식 정확도 실사용 후기·벤치마크

- 공식 CER/WER 벤치마크(한글 Digital Ink): **확인 불가.**
- 정성: Gboard 손글씨 엔진과 동일 기술. Gboard 한글 손글씨는 실사용이 많다. 현장 악필·안전모·장갑·기울인 태블릿에서는 떨어질 수 있음 — 수치 **확인 불가**.
- 후보 n-best(`RecognitionCandidate` + score)를 UI에 보여 고르게 하는 것이 실무.

**D.1 권고:** 오프라인 한글 필기→텍스트의 **1순위**. 사무실 Wi-Fi에서 `ko` 20 MB를 받고, 현장은 완전 오프라인. 포기점: MyScript급 도메인 튜닝·상용 SLA 없음. 커뮤니티 Flutter 래퍼.

---

## D.2 Gboard 손글씨 · Android Scribe

### 텍스트필드 포커스 → Gboard 손글씨 (개발 없이)

**된다. OS/IME 기능이지 앱 SDK가 아니다.**

1. 기기에 Gboard가 있고 기본 키보드.
2. Gboard 설정 → 언어 → 한국어 → **필기 입력 레이아웃** 사용 설정.
3. 앱의 일반 `TextField`에 포커스 → 지구본으로 필기 키보드 전환 → 손가락/펜으로 씀.

공식 고객센터(한국어): “필기 입력은 일부 언어에서만 제공” / 언어에서 필기 레이아웃이 보이면 그 언어는 지원.

https://support.google.com/gboard/answer/2842292?hl=ko

Gboard 손글씨 지원 언어는 과거 보도 기준 97개. 한국어는 Gboard 언어 목록에 필기 옵션이 있는 것이 일반적. **이 TB373FU + 현재 Gboard 빌드에서 한국어 필기 타일이 실제로 있는지는 실기기 확인 (확인 불가 — 웹만으로는 이 대기 Gboard 버전을 모름).**

한계:

- 사용자가 IME를 바꾸고, 필기 레이아웃을 켜야 함. 현장 근로자에게 지구본 전환을 가르치는 비용.
- 앱이 잉크를 소유하지 않음 → 서식·서명 이미지·스트로크 보존 불가.
- **오프라인:** Gboard 손글씨 엔진은 온디바이스(ML Kit와 동일 계열). 언어팩이 깔려 있으면 오프라인으로 동작하는 것이 설계. 이 대기에서 한국어 필기 팩이 프리로드됐는지는 **확인 불가**.

서명·점검 메모처럼 **잉크 자체를 증거로 남겨야 하면 이 경로만으로는 부족**하다. 텍스트 필드 빠른 입력 보조로는 유효.

### Android 14+ Scribe (`startStylusHandwriting`)

Android 14(API 34)+ : 아무 앱의 `EditText`/`WebView` 텍스트 필드에 펜을 대면 IME 손글씨 모드로 전환.

https://developer.android.com/develop/ui/views/touch-and-input/stylus-input/stylus-input-in-text-fields

조건:

- API 34+ (이 대기 API 36 → OS 조건 충족)
- 호환 스타일러스 (이 대기 Tab Pen Plus, TOOL_TYPE_STYLUS 실측됨)
- **IME가 Android 14 stylus handwriting API를 구현**

한국어 지원은 **OS가 아니라 IME**. Gboard가 해당 API를 구현하고 한국어 필기를 켜 두면 Scribe 경로로 한글이 들어간다. Gboard가 태블릿에서 스타일러스 손글씨를 롤아웃한 보도:

https://www.facebook.com/9to5Google/posts/the-gboard-stylus-handwriting-support-that-we-first-enabled-in-august-is-now-rol/752354643603862/

**Lenovo ZUI 17 + Gboard + 한국어 Scribe 조합의 공식 보장: 확인 불가.** 실기기에서 `TextField`에 펜을 대 보는 것이 한 줄 테스트.

### Flutter에서 Scribe

1차에서 짚은 **#175886은 2026-09 기준으로 여전히 Open**(Android Scribe 우산 이슈). 다만 **기본 경로는 이미 프레임워크에 있다.**

- `Scribe.isFeatureAvailable()` / `Scribe.startStylusHandwriting()` — API 33+ 채널, 실제 가용 체크는 API 34.
  https://api.flutter.dev/flutter/services/Scribe/startStylusHandwriting.html
- `EditableText.stylusHandwritingEnabled` / `TextField`가 자동 처리.
  https://api.flutter.dev/flutter/widgets/EditableText/stylusHandwritingEnabled.html
- 엔진 TODO: “Scribe stylus gestures should be supported here.” → **제스처(삭제선 등)는 미완.**

**네이티브 `EditText`를 PlatformView로 띄우면** Android 기본 Scribe가 붙는다. 공식 문서가 EditText 기본 활성화를 말하므로, PlatformView 경로는 Flutter 미완 부분을 우회한다.

**권고:**

- 점검 항목의 **짧은 텍스트 필드**: Flutter `TextField` + `stylusHandwritingEnabled: true` + Gboard. 개발 비용 최소.
- **서명·자유 필기 캔버스**: ML Kit Digital Ink (D.1). Scribe는 텍스트필드 전용.
- 포기점: Scribe는 잉크 보존·오프라인 모델 통제가 앱 손이 아님.

---

## D.3 그 외 오프라인 한글 필기인식 오픈소스

**문장 단위·Flutter 실무에 넣을 만한 것은 없다.** 있는 것은 연구/토이/음절 OCR이다.

| 프로젝트 | 수준 | 왜 안 쓰나 |
|---|---|---|
| IBM tensorflow-hangul-recognition 계열, kitae0522/hangul-recognition, joonilahn/Korean-Character-Recognition | 음절 이미지 분류 (2350자 등) | 문장 분할·실시간 스트로크 없음. Python/TF. Flutter 바인딩 없음. |
| star14ms/Korean-Handwriting-Detection | 음절 완성, **문장 변환은 미완성** | README가 문장 단계를 미완으로 명시. |
| WritePad HWRE (phatware) | 다국어 엔진, GPL-3.0 | 상용 앱에 GPL 오염. 한글 품질·Android 최신 빌드 **확인 불가**. |
| TinyML Korean HTR 논문 (2025) | 연구 | 제품 SDK 아님. |
| Xournal++ HTR | 영어 등 | 한글 프로덕션 아님. |

**결론: 없다.** 오프라인 한글 **문장** 필기인식의 실무 선택지는 **ML Kit Digital Ink `ko`** 또는 **Gboard/Scribe**(IME에 위임) 뿐이다. 자체 모델을 학습해 온디바이스에 올리는 것은 연구 과제이지 이 일정 안의 대안이 아니다.

---

# E. 한국어 STT — 오프라인 우선

## E.1 `SpeechRecognizer` + `EXTRA_PREFER_OFFLINE`

- `RecognizerIntent.EXTRA_PREFER_OFFLINE` (API 23): 오프라인 엔진만 쓰라는 **힌트**. “Depending on the recognizer implementation, these values may have no effect.”
  https://developer.android.com/reference/android/speech/RecognizerIntent
- 기본값은 false (네트워크 또는 오프라인 모두 허용).
- 언어: `EXTRA_LANGUAGE` = `"ko-KR"` (BCP 47).
- **한국어 온디바이스가 되는지는 OEM·Google 앱·언어팩에 달림.** 공식 “한국어 오프라인 보장” 문서는 없음.
- API 33+에서 `EXTRA_PREFER_OFFLINE`만 넣고 `createSpeechRecognizer()`를 쓰면 일부 기기에서 실패한다는 보고 (Pixel 등 사용자 설정 의존).
  https://stackoverflow.com/questions/79764646/android-google-recognizer-intent-extra-prefer-offline-and-api-33

조건:

1. `SpeechRecognizer.isRecognitionAvailable(context)`
2. 가능하면 `isOnDeviceRecognitionAvailable(context)` (API 31)
3. Google 앱 / Gboard **오프라인 음성 인식 언어팩**에서 한국어가 내려받아져 있어야 함. 경로 예: 설정 → Google → 음성 → 오프라인 음성 인식. ZUI에서의 정확한 메뉴 **확인 불가**.
4. 이 대기(Lenovo ZUI, telephony 없음)에 한국어 온디바이스 ASR이 프리인스톨됐는지는 **실측 필요. 확인 불가.**

**권고:** 이 API를 “있으면 쓰고 없으면 자체 엔진”으로 분기. 유일한 STT로 삼지 말 것.

## E.2 `SpeechRecognizer.createOnDeviceSpeechRecognizer()` (API 31+)

- 팩토리. `isOnDeviceRecognitionAvailable`이 false면 `UnsupportedOperationException`.
  https://developer.android.com/reference/android/speech/SpeechRecognizer
- **지원 언어 목록을 OS가 공개 문서로 고정하지 않음.** 기기 구현체(보통 Google On-Device ASR)가 설치한 언어만 된다.
- 한국어 지원 현황(2026-09, 전 기기 공통): **확인 불가.** Pixel 계열은 영어 중심으로 온디바이스가 먼저 깔리는 경향. 한국어 언어팩은 사용자가 받는 경우가 많음.
- 이 대기에서 한 줄: `adb shell`로 `isOnDeviceRecognitionAvailable` + `ko-KR` listen 테스트.

## E.3 Flutter `speech_to_text`

| | |
|---|---|
| 패키지 | `speech_to_text` |
| 버전 | **7.4.0** stable / 7.5.0-beta.1 |
| 업데이트 | 2026-05-19 (약 3개월 전). 베타 2개월 전 |
| likes | **1.62k** |
| 유지보수 | **유지됨** (csdcorp.com). Windows/macOS 확장 중 |

https://pub.dev/packages/speech_to_text

오프라인:

- `SpeechListenOptions(onDevice: true)` — 플랫폼에 오프라인 인식을 요청 (2.6.0부터).
- Android에서는 결국 시스템 `SpeechRecognizer` + OEM 엔진. **패키지가 한국어 모델을 내장하지 않음.**
- `localeId: 'ko_KR'` (기기 설치 로케일 목록에서 고름).

한국어 동작 사례: 온라인 모드에서는 한국 앱에서 널리 쓰임. **오프라인 한국어 성공 사례를 이 조사에서 문서로 특정하지 못함 (확인 불가).** `onDevice: true`가 언어팩 없으면 에러 콜백.

**권고:** UI/권한/부분 결과 래퍼로 쓰되, 오프라인 보장은 E.4 엔진.

## E.4 오프라인 대안 — whisper.cpp / sherpa-onnx

### sherpa-onnx (1순위 자체 엔진)

| | |
|---|---|
| 패키지 | `sherpa_onnx` |
| 버전 | **1.13.8** |
| 업데이트 | 2026-09-11 (약 12시간 전) |
| likes | **121** |
| 유지보수 | **매우 활발** (k2-fsa). 완전 오프라인 ONNX |

https://pub.dev/packages/sherpa_onnx  
https://github.com/k2-fsa/sherpa-onnx/

한국어 모델 (공식 pretrained 표):

- `sherpa-onnx-streaming-zipformer-korean-2024-06-16` — **한국어 스트리밍**
- `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` — 중/영/일/**한**/광

https://github.com/k2-fsa/sherpa-onnx/

Dimensity 8300 + 8 GB:

- Zipformer 스트리밍 small/20M급은 Cortex-A7 타깃 모델도 있는 수준. 8300은 그 이상.
- 실시간성: **스트리밍 Zipformer는 현실적.** SenseVoice·Whisper large는 발화 후 처리에 가깝다.
- 모델 크기: 스트리밍 Zipformer 한국어는 보통 **수십~200 MB 급** (정확한 MB는 배포 아카이브마다 다름 → 채택 시 HuggingFace/GitHub 릴리스에서 확정. 여기서 단정하지 않음).
- Vosk Small Korean 참고(다른 엔진): Galaxy A35에서 60초 오디오 2.71초 (RTF 0.045). 8300이면 이보다 여유. 출처는 Termux-STT 표(Vosk, sherpa가 아님) — 간접 증거.

https://pypi.org/project/termux-stt/

**포기점:** APK/에셋에 모델을 넣거나 최초 Wi-Fi에서 받아야 함. 마이크 권한·포그라운드 서비스. 커뮤니티 패키지(unverified uploader).

### whisper.cpp Flutter 바인딩

| 패키지 | 버전 | 업데이트 | likes | 비고 |
|---|---|---|---|---|
| whisper_edge | 0.2.0 | 2026-09-06 | 적음 | 공식에 가까운 cpp 바인딩. tiny 32 MB / base 60 / small 190 / large-v3-turbo 574 MB |
| whisper_cpp_flutter_plus | 0.4.1 | 2026-08-18 | 적음 | whisper.cpp v1.9.2, CJK voice-length 개선 언급 |

Whisper 다국어는 한국어를 포함한다. **실시간 스트리밍보다 녹음 후 전사에 강함.** 현장 “지금 말한 한 줄”에는 Zipformer가 맞고, 사고 녹취 전체 전사에는 Whisper small이 맞다.

8300에서 small-q5(190 MB)는 가능하나 발열·지연은 **실측 필요. 확인 불가.** tiny/base는 한국어 품질이 떨어질 수 있음.

### 권고 (STT)

1. **1차:** `speech_to_text` + `onDevice: true` + `ko_KR` — 시스템 엔진이 있으면 공짜·가벼움.
2. **폴백(현장 필수):** `sherpa_onnx` + 한국어 스트리밍 Zipformer. 모델은 출고 전 Wi-Fi에서 다운로드.
3. 긴 녹취: Whisper small 오프라인 (선택).
4. 포기점: 앱 용량 +20~200 MB, 자체 엔진 유지보수.

## E.5 건설현장 80~100 dB에서 STT를 살리는 실무

공식 “100 dB 한글 STT 벤치마크”는 **확인 불가**. 음성학·현장 무전 실무에서 반복되는 기법:

1. **STT를 유일한 입력으로 두지 말 것.** 펜 메모·체크리스트·템플릿이 주력, 음성은 보조.
2. **푸시투토크.** 상시 리스닝은 소음에 열린다. 버튼 누른 구간만 인식.
3. **입 가까이.** 태블릿 하단 마이크(이 대기 듀얼 마이크)보다 블루투스 핀마이크/무전 헤드셋. 기기 스펙상 3.5 mm 없음 → USB-C/BT.
4. **VAD + 노이즈 억제.** sherpa-onnx는 speech enhancement / VAD 모듈이 있음. 원 파형 그대로 Zipformer에 넣지 말 것.
5. **도메인 문장 고정.** “이상 없음”, “균열 발견”, “즉시 보고”처럼 **짧은 정형 발화**. 자유 좌담은 포기.
6. **부분 결과 + 사용자 확인.** 오인식된 한 줄을 펜으로 고치게.
7. **SNR.** 80~100 dB 연속 소음에서 어떤 클라우드 STT도 급락한다. 오프라인 소형 모델은 더 심하다. **정확도 목표를 현장 문장 템플릿 매칭으로 낮추는 것이 정직한 설계.**

---

# F. Flutter 오프라인 우선 아키텍처 (2026-09)

## F.1 로컬 DB 비교

조회 기준: 2026-09-12 pub.dev.

| 패키지 | 최신 | 업데이트 | likes | 유지보수 | 권고 |
|---|---|---|---|---|---|
| **drift** | **2.35.0** | 2026-09-09 (33시간 전) | **2.46k** | **건전.** Simon Binder, Stream/PowerSync 스폰서. SQLite. | **기본 선택** |
| **sqflite** | (fluttergems 2026-05: Good) | 활발 | **~5.5k** | **건전.** 로우 SQL. | Drift 아래 엔진으로  suff. 직접 쓸 이유 적음 |
| **objectbox** | **5.3.2** (6.0 preview) | ~2026-05 (3개월) / GitHub 2026-09-07 | **1.58k** | **건전, 상용.** Sync 내장. 웹 없음. | 자체 서버 동기화 엔진이 필요할 때만 |
| **hive** (원본) | 2.2.3 | 장기간 정체 | 높음(레거시) | **원 저자 이탈. 신규 금지.** | 기존 코드만 |
| **hive_ce** | **2.19.3** | 2026-02-03 (약 7개월) | **564** | 커뮤니티 계속. 원본보다 낫지만 Drift보다 릴리스가 뜸. | 설정·캐시 KV만 |
| **isar** (원본) | v4 안정 신뢰 부족 | 저자 공백 | — | **사실상 중단.** | 신규 금지 |
| **isar_community** | **3.3.2** | 2026-03-23 (5개월) | **159** | v3 버그픽스 포크. v4 아님. | 프로토타입 한정 |

출처:

- https://pub.dev/packages/drift
- https://pub.dev/packages/objectbox
- https://pub.dev/packages/hive_ce
- https://pub.dev/packages/isar_community
- 2026 유지보수 가이드: https://luci-studio.com/blog/the-flutter-local-database-landscape-in-2026-a-maintenance-first-guide-fe6d267c/

**권고: Drift.**

- 순찰 데이터는 관계형(현장→점검표→항목→사진→서명→업로드 큐). SQL·트랜잭션·마이그레이션이 맞다.
- 웹이 당장 없어도 SQLite 파일은 수명·감사·내보내기에 유리.
- 포기점: 코드젠(`build_runner`), NoSQL 한 줄 대비 초반 보일러플레이트.

ObjectBox Sync를 쓰면 서버를 ObjectBox 클라우드에 묶는다. 조달청 자체 API면 이득이 없고 종속만 생긴다.

## F.2 업로드 큐·재시도

### `workmanager`

| | |
|---|---|
| 버전 | **0.10.10** |
| 업데이트 | 2026-09-07 (4일 전) |
| likes | **2.42k** |
| 퍼블리셔 | fluttercommunity.dev |
| 유지보수 | **건전.** 0.9에서 한동안 정체 후 0.10 라인으로 회복 |

https://pub.dev/packages/workmanager

Android 구현은 WorkManager. 제약: `NetworkType.connected`, 충전, 배터리 최적화 예외.

현장 실무 패턴:

1. Drift 테이블 `outbox(id, type, payload_path, bytes_meta, attempts, next_at, status)`.
2. 사진/서명은 **파일로 먼저 로컬 저장**, outbox에는 경로만.
3. 앱 포그라운드: connectivity_plus로 네트워크 복귀 시 즉시 drain.
4. 앱 백그라운드: workmanager OneOff + 주기적 (OEM이 잡을 수 있음. 삼성/레노버 배터리 최적화 안내).
5. 서버는 **멱등 키**(client_uuid)로 중복 POST를 흡수.
6. 실패: 지수 백오프, 401이면 큐 중지 후 재로그인.

`native_workmanager`(brewkits, 1.8.0, 2026-09-11)는 HTTP 워커를 네이티브로 돌려 Flutter 엔진을 안 띄운다. likes·채택은 workmanager보다 훨씬 적음. **표준은 workmanager.** 대용량만 네이티브 업로드를 검토.

포기점: 레노버 태블릿 OEM 킬러가 WorkManager를 미룰 수 있음. 사용자에게 “배터리 최적화 제외” 온보딩.

## F.3 이미지 캐시와 1시간 만료 프리사인 URL

`cached_network_image` **3.4.1**, likes **6.96k**, **약 2년 미갱신**. 커뮤니티는 메모리 릭·스크롤 이슈 300+ 미해결이라고 본다.

https://pub.dev/packages/cached_network_image  
포크: `cached_network_image_ce` 4.10.0, likes 96, 활발. https://github.com/Erengun/flutter_cached_network_image_ce

**프리사인 URL 문제:** 캐시 키가 URL이면 1시간 후 다른 URL이 되어 **캐시 미스 + 만료 URL 재요청 실패**.

실무:

1. **캐시 키 = 객체 ID** (예: `inspection/photo/uuid`), URL이 아님.
2. 오프라인 표시용은 다운로드 시점에 **원본 바이트를 앱 문서 디렉터리에 저장** (Drift에 path). `cached_network_image`의 HTTP 캐시만으로 부족하다.
3. 온라인 시: ID로 새 프리사인을 받아 오되, 로컬 파일이 있으면 네트워크를 안 탄다.
4. 썸네일/원본을 분리. 목록은 썸네일만 로컬.

`cached_network_image`만으로 **충분하지 않다.** 업로드·다운로드 원본은 파일 스토어가 소스 오브 트루스.

## F.4 충돌 해결

오프라인 단 메모 vs 서버.

순찰 앱에 맞는 패턴:

1. **이벤트 소싱(권고).** “메모를 덮어쓰기”가 아니라 `note_added`, `photo_attached` append-only. 서버는 이벤트 합의. 충돌이 거의 안 생긴다.
2. 불가피한 필드 충돌(같은 체크 항목을 두 단말이 고침):
   - **Last-write-wins + updated_at** — 구현 싸고 데이터 손실.
   - **서버 권위, 로컬은 재조회** — 현장 입력이 날아갈 수 있음. 순찰에는 부적합.
   - **수동 머지 UI** — 비용 큼. 관리자 수정 vs 현장 수정에만.
3. **클라이언트 UUID**를 PK로 써서 오프라인 생성 행이 서버에서 새 행으로 들어가게.
4. 버전 컬럼(`row_version`)으로 409를 받고, 현장 앱은 로컬 값을 새 이벤트로 재제출.

CRDT/PowerSync는 Drift와 잘 붙지만 인프라 비용. 1차 납품은 append-only + UUID면 충분.

---

# G. Android 16 + Flutter 태블릿 적응형 레이아웃

## G.1 API 36 방향 고정 금지 — 조건과 예외

**조건 (공식):** 앱이 **targetSdk 36+** 이고, 디스플레이 **smallest width >= 600 dp**.

이 대기 최소폭 866 dp → **정통으로 적용**. `screenOrientation` portrait/landscape 등과 `setRequestedOrientation()`의 고정 값이 **무시**. 리사이즈·멀티윈도우 강제.

https://developer.android.com/about/versions/16/behavior-changes-16  
https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability  
https://android-developers.googleblog.com/2025/01/orientation-and-resizability-changes-in-android-16.html

**예외는 있다. “예외가 없다”는 틀린 말.**

1. **sw < 600 dp** (대부분 폰). 우리 기기 해당 없음.
2. **게임** (`android:appCategory="game"`). 순찰 앱은 게임이 아님. 거짓 표시는 스토어 정책 위반.
3. **사용자가** 기기 화면비 설정에서 앱 기본 동작을 명시적으로 선택.
4. **임시 옵트아웃** `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY=true`
   - target 36에서만. **target 37(Android 17)에서는 제거.**
   - Flutter 문서: Android 16은 옵트아웃 가능, 17은 불가.
     https://docs.flutter.dev/release/breaking-changes/android-large-screens-restrictions-ignored
   - 옵트아웃해도 “방향 고정”이 대형 화면에서 완전히 부활하지 않는다는 주의 문구가 적응형 가이드에 있음. 호환 모드(레터박스)로 돌아갈 뿐, **영구 설계로 쓰지 말 것.**

Play 타깃 API 일정: Unity 토론이 인용한 표 — API 36 대형화면 2026-08 전후, API 37에서 옵트아웃 삭제 2027-08 전후. 정확한 Play 강제일은 콘솔 공지가 우선.

**권고:** 옵트아웃으로 시간을 벌지 말고 **세로·가로·멀티윈도우를 모두 레이아웃한다.** 포기점: 고정 세로 디자인 시안을 버린다.

## G.2 Edge-to-edge 강제

- Android 15(API 35): edge-to-edge 기본, `windowOptOutEdgeToEdgeEnforcement`로 옵트아웃 가능.
- **Android 16(API 36): 그 옵트아웃이 deprecated·비활성. 타깃 36은 빠져나갈 수 없다.**
  https://developer.honor.com/en/docs/adaptation_guide/guides/android_16_compatibility_adaptation_guide_eng
- Flutter: 기본 SystemUiMode가 edge-to-edge로 정렬 중.
  https://docs.flutter.dev/release/breaking-changes/default-systemuimode-edge-to-edge
  옵트아웃 트릭은 16에서 크래시 위험이 있다고 Flutter가 경고.

실무:

1. `SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge)`
2. `SystemChrome.setSystemUIOverlayStyle`로 상태바/내비 아이콘 밝기.
3. 콘텐츠는 **`SafeArea`만 맹신하지 말 것.** `MediaQuery.paddingOf(context)` / `viewPadding` / `viewInsets`(IME)를 Scaffold `padding`에 더한다.
4. 리스트 하단 FAB는 `viewPadding.bottom` 위로.
5. 가로 모드에서 카메라 펀치홀·캡 영역 — 이 대기 실측 inset은 이 파일에 없음. `MediaQuery`로 런타임 처리.

## G.3 적응형 레이아웃

Material 3 window size class (공식 Android):

| Width class | Breakpoint |
|---|---|
| Compact | < 600 |
| Medium | 600–839 |
| Expanded | 840–1199 |
| Large | 1200–1599 |
| Extra large | ≥ 1600 |

https://developer.android.com/develop/adaptive-apps/guides/use-window-size-classes

이 대기: 세로 ~866 dp → **Expanded width에 근접(840+). 가로 1385 dp → Large.** 폰용 Compact 레이아웃은 타깃이 아님.

### `flutter_adaptive_scaffold`

**0.3.3+1, 2025-05-06, flutter.dev, `discontinued`.** likes 952.

https://pub.dev/packages/flutter_adaptive_scaffold/versions

**설계에 넣지 말 것.**

대안:

- 프레임워크 `NavigationBar` / `NavigationRail` + `LayoutBuilder`/`MediaQuery.sizeOf`.
- 소규모 헬퍼: `window_size_classes` 1.1.1 (likes 2, 7개월) — 검증 약함.
- `material_layout` 0.0.1 (17일, likes 적음) — 너무 새로움.
- `responsive_reflow` 2.0.0 (46일) — M3 브레이크포인트 재구현.

**권고: 패키지 없이 `sizeOf` 분기.** 브레이크포인트만 M3 숫자를 복사. 포기점: 기성 AdaptiveScaffold 위젯을 다시 짠다. 이득: discontinued에 안 묶임.

상태 보존 (회전·리사이즈):

1. `android:configChanges`에 orientation/screenSize/smallestScreenSize/screenLayout — Activity 재생성 억제. Flutter 임베딩 기본도 상당 부분 처리.
2. 위젯 트리에서 **탭 인덱스·폼·잉크를 `AutomaticKeepAliveClientMixin` / 상위 `ChangeNotifier` / Drift**에 둔다. `MediaQuery`가 바뀌어도 State 객체를 새로 만들지 않게 키를 안정적으로.
3. `RestorationMixin`은 프로세스 킬 대비.
4. 회전 시 `setState`로 레이아웃만 바꾸고 컨트롤러는 유지.

## G.4 한 손·엄지 도달 (12.7인치)

12.7인치 866×1385 dp에서 **한 손 엄지가 화면 전체를 덮는다는 연구는 없음.** 관련 가이드:

- Material / Android 대형화면: 주요 터치 타깃을 **가장자리에 반복**하지 말고, 이동 동선은 하단에. 공식 “thumb reach mm for 12.7"” 수치는 **확인 불가**.
- 태블릿은 보통 **두 손 파지 또는 한쪽 팔에 거치**. 한 손 파지는 짧은 확인 탭 정도.
- Reachability 패턴 (삼성 원핸드, iOS): 화면을 아래로 당김. Android 표준 API는 아님.
- Fitts의 법칙: 자주 쓰는 확정/저장/위험(SOS)은 **하단 중앙~파지 쪽 하단 모서리**, 최소 48×48 dp, 실제로는 56–64 dp.
- 상단 앱바 아이콘은 두 번째 손(또는 펜). 펜이 주 입력인 이 앱은 **엄지보다 펜 동선**이 중요 — 캔버스는 중앙, 도구 팔레트는 좌/우 레일(가로 모드 NavigationRail).

권고 배치 (12.7, 펜+장갑 가정):

- 하단: 저장 / 다음 항목 / SOS (엄지+펜 모두).
- 좌·우 레일: 도구(펜/지우개/사진). 가로 Expanded에서 상시.
- 상단: 현장명·동기화 상태. 한 손 필수 아님.
- 포기점: 모바일 앱처럼 모든 CTA를 하단에만 몰면 가로 와이드에서 낭비. 브레이크포인트별로 CTA 위치를 바꾼다.

---

# H. 푸시 알림

## H.1 Flutter + FCM 표준 (SOS·낙상)

| | |
|---|---|
| 패키지 | `firebase_messaging` |
| 버전 | **16.6.0** |
| 업데이트 | 2026-08-24 (약 11–17일) |
| likes | **3.95k** |
| 퍼블리셔 | firebase.google.com |
| 유지보수 | **공식, 건전** |

https://pub.dev/packages/firebase_messaging

구성:

1. Android 13+ `POST_NOTIFICATIONS` 런타임.
2. 채널: `sos` (IMPORTANCE_HIGH), `fall`, `default`.
3. 페이로드: **notification + data**. 백그라운드는 시스템이 알림을 그리고, 데이터로 화면 라우팅.
4. SOS/낙상: `priority: high` / Android `priority: max`, 소리·진동, 잠금화면 표시.
5. 포그라운드: `FirebaseMessaging.onMessage`에서 로컬 알림(flutter_local_notifications 등)으로 재표시. FCM 포그라운드는 헤드업이 기본이 아님.
6. 토큰을 서버에 등록. 태블릿 1대 1토큰. Wi-Fi only이므로 토큰 갱신·등록 실패를 Drift에 큐.

포기점: Firebase 종속. 공공 클라우드 반입이 안 되면 자체 푸시(MQTT/자체 FCM 대체)로 갈려야 함 — 그 경우 이 절은 재설계.

## H.2 Android 16 풀스크린 인텐트·중요 알림

**Android 16에서 FSI를 새로 금지한 공식 문서는 찾지 못함.** 큰 칼은 **Android 14**부터다.

- `USE_FULL_SCREEN_INTENT`는 특수 앱 접근. Play는 **통화·알람 핵심 앱만** 자동 허용. 2025-01-22부터 타깃 14+에 강제.
  https://source.android.com/docs/core/permissions/fsi-limits  
  https://support.google.com/googleplay/android-developer/answer/16965181
- `NotificationManager.canUseFullScreenIntent()`로 검사. 없으면 `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`.
- SOS/낙상 앱이 “calling or alarm”으로 Play 선언이 승인될지는 **정책 심사. 확인 불가.** 승인 실패가 기본 가정.
- Android 16에서 FSI가 권한 true여도 안 뜨는 개별 버그 보고가 있음. 의존하지 말 것.
  https://stackoverflow.com/questions/79702414/android-16-not-allowing-full-screen-intents-on-app

**권고:** SOS는 FSI를 **시도**하되 폴백을 본체로.

- HIGH 채널 + 전체 화면이 아닌 헤드업 + 강한 소리 + 진동 + 잠금화면 vis.
- 필요 시 포그라운드 서비스(특별 용도 또는 마이크) — Play 정책 별도.
- `USE_FULL_SCREEN_INTENT`를 매니페스트에 넣고 온보딩에서 `canUseFullScreenIntent()`가 false면 설정으로 안내.

Android 13+ 알림 권한, 14+ FSI, 15+ 포그라운드 서비스 유형. 16은 edge-to-edge·방향이 더 큰 변화.

## H.3 Wi-Fi 끊김 후 놓친 알림

FCM은 기기가 오래 오프라인이면 **메시지를 버린다** (TTL, 보통 notification 우선순위·접힘). “복귀 시 자동으로 다 쌓여 있다”는 가정이 틀리다.

실무:

1. 서버가 SOS/낙상을 **DB에 보관** (읽음 여부).
2. 앱이 네트워크 복귀·포그라운드 진입 시 **REST로 missed inbox**를 당김 (`since=last_sync_at`).
3. FCM은 깨우기용. 본문은 항상 서버가 소스.
4. 높은 우선순위 data-only는 Doze에서 제한. 완전 의존 금지.
5. 로컬에 이미 처리한 event_id는 중복 표시하지 않음.

태블릿이 LTE가 없으므로 **현장에서는 푸시가 도착하지 않는 것이 정상**. SOS는 같은 현장 Wi-Fi AP·메쉬가 있을 때만 실시간. 없으면 로컬 사이렌 + 복귀 후 서버 전달.

---

# 설계에 바로 넣는 결정 (근거 요약)

| 결정 | 선택 | 버리는 것 |
|---|---|---|
| 한글 필기→텍스트 | **ML Kit Digital Ink `ko`**, 20 MB 사전 다운로드 | MyScript(네트워크 라이선스), 자작 HTR |
| 짧은 텍스트 필드 | Flutter `TextField` + Scribe/Gboard | 모든 입력을 캔버스로 |
| 오프라인 STT | 시스템 on-device 시도 + **sherpa-onnx 한국어 Zipformer 폴백** | STT 단일 입력, Whisper를 실시간 1순위로 |
| 로컬 DB | **Drift** | Isar 원본, Hive 원본, flutter_adaptive_scaffold식 중단 패키지 |
| 업로드 | Drift outbox + **workmanager 0.10** | URL을 캐시키로 쓰는 이미지 캐시 |
| 레이아웃 | M3 size class 직접 분기, 방향 고정 포기, edge-to-edge | PROPERTY_COMPAT를 장기 의존 |
| 알림 | FCM high + 서버 inbox 재동기화. FSI는 최선노력 | FSI·FCM TTL을 생명 안전의 유일한 경로 |

실기기에서 아직 안 한 검증 (확인 불가 → 다음 스프린트):

1. ML Kit `ko` 모델 다운로드·한글 문장 인식 품질
2. Gboard 한국어 필기 타일 + Scribe가 ZUI 17.5에서 켜지는지
3. `SpeechRecognizer.isOnDeviceRecognitionAvailable` + `ko-KR`
4. sherpa Zipformer 한국어 RTF·소음
5. `canUseFullScreenIntent()` 값
