# P4 순정 STT 실측 결과와 ML Kit Digital Ink 조사

작성 Codex · 2026-09-12 · `TASK-p4-stt-result.md`와 원시 로그를 반영. 기존 A·B·C 조사·구현 이력 보존.

**결과:** 순정 `createOnDeviceSpeechRecognizer`가 **비행기모드 ON·Wi-Fi OFF·활성 네트워크 OFF**에서
`ko-KR`로 인식됨을 확인했다. **사용자 결정으로 순정 STT를 후보 선택·확인과 함께 채택**한다.
**sherpa-onnx·ML Kit은 채택 불요**이며 설치 요청을 취소한다. ML Kit의 기존 조사 결과는 유지한다.
`[미검증] 5`는 실측으로 닫고, `[미검증] 6`은 **ML Kit 인식률을 검증한 것이 아니라 채택 불요로 종료**한다.

## A 순정 STT 진단 구현과 실측 결과

### 구현한 것

- `MainActivity.kt`: `vitalguard/stt` MethodChannel의 `isOnDeviceAvailable/start/stop`, `vitalguard/stt_events` EventChannel의 `partial/final/error`. 진단 보조 이벤트로 환경·가용성·지원 언어·상태·취소를 전달한다. `readLog`는 원시 JSONL 반출용 보조 메서드다.
- **`createOnDeviceSpeechRecognizer`만** 사용한다. 일반 인식기로 온라인 폴백하지 않는다. 한국어 `ko-KR`, 부분결과 요청, 자유 발화 모델을 사용한다. 인식할 문장 5개를 바꾸지 않는다.
- 마이크는 `ActivityCompat.requestPermissions`로 네이티브에서 요청한다. RECORD_AUDIO 및 환경 관찰용 ACCESS_NETWORK_STATE/ACCESS_WIFI_STATE, RecognitionService 패키지 가시성을 매니페스트에 선언했다. 새 Gradle·Dart 의존성은 없다.
- API 33+ `checkRecognitionSupport`로 **설치됨/다운로드 대기/다운로드 가능** 언어 목록을 원문으로 표시한다. 다운로드 가능한 언어를 설치 완료로 간주하지 않는다. 모델 다운로드를 실행하지 않는다. 지원 조회 실패 자체를 한국어 미지원으로 단정하지 않는다. [Android RecognitionSupport](https://developer.android.com/reference/android/speech/RecognitionSupport)
- 비행기모드는 `Settings.Global.AIRPLANE_MODE_ON`에서 직접 읽고 Wi-Fi·활성 네트워크도 함께 기록한다. **비행기모드가 ON이어도 Wi-Fi가 켜져 있을 수 있다.** 시작·콜백·종료와 주기적 환경 관찰을 남긴다. 이는 물리적 네트워크 격리를 완전히 감시하는 장치는 아니다.
- 첫 부분결과 지연은 **startListening 직전의 단조 시계부터 첫 onPartialResults 콜백까지**다. 마이크 권한 대기 시간은 제외한다. 발화 시작 기준의 인식 지연과는 다르며, 빈 부분결과도 기록한다. 부분결과가 오지 않으면 0ms 대신 ‘미수신’이다.
- 진단용으로 무응답 시 종료하는 상한을 두었다. 이 상한은 측정된 성능이 아니다. 화면 이탈·백그라운드·취소에서 인식기를 해제하고 늦은 콜백이 다음 측정을 덮지 않게 측정 ID를 확인한다.
- `stt_screen.dart`는 읽을 문장과 인식 문자열 후보를 나란히 표시한다. 오인식·띄어쓰기를 수정하지 않고 일치율도 계산하지 않는다. 표본 0은 ‘미측정’이다. 실제 콜백은 앱 내부 `files/p4-stt.jsonl`에 저장하며 **원음은 저장하지 않는다**. ‘원시기록 복사’로 내보낼 수 있다.

**지시서의 오류코드 오기 보정:** `ERROR_NO_MATCH=7`, `ERROR_LANGUAGE_NOT_SUPPORTED=12`, `ERROR_LANGUAGE_UNAVAILABLE=13`이다. 13은 지원하는 언어가 아직 내려받아지지 않는 등 현재 사용 불가 상태다. 앱은 실제 onError 숫자를 그대로 기록한다. 마이크 권한 거절·진단 타임아웃을 SpeechRecognizer의 실제 오류코드인 것처럼 만들어 붙이지 않는다. [Android SpeechRecognizer 상수](https://developer.android.com/reference/android/speech/SpeechRecognizer)

### 수행한 확인과 원시 로그 대조

태곤 님이 직접 문장을 읽었다. Claude는 지시서에서 `dart analyze` 무경고·`flutter test` **4/4**,
빌드·설치·실행·마이크 권한 부여 완료, **새 의존성 0개**를 보고했다. 권한은 이번에 `adb shell pm grant`로
부여했다. Codex는 [보존된 251개 원시 이벤트](raw/p4-stt-2026-09-12.jsonl)를 모두 읽고 결과를 대조했다.
과거 Codex의 SDK 캐시·adb 소켓 샌드박스 차단은 준비 당시 이력이며 현재 실측 대기 상태가 아니다.

| 항목 | 온라인 조건 | 오프라인 조건 |
|---|---|---|
| 엔진·언어 | `createOnDeviceSpeechRecognizer` · `ko-KR` | 동일 |
| 설정 | 비행기모드 OFF · Wi-Fi ON · 활성 네트워크 ON | **비행기모드 ON · Wi-Fi OFF · 활성 네트워크 OFF** |
| 비교 대상 최종 결과 | 5문장, 문장별 1건 | 5문장, 문장별 1건 |
| 1순위 원문 일치 | **5건 중 1건** | **5건 중 1건** |
| 후보 목록에 원문 포함 | **5건 중 2건** | **5건 중 3건** |
| 별도 인식 오류 | **1건 · code=7 · ERROR_NO_MATCH** | **0건** |
| 첫 부분결과 평균, ms 정수부 | **2,506 ms** | **2,246 ms** |

`available=true`, 설치된 `ko-KR`, 양 조건 동일한 온디바이스 엔진을 로그에서 확인했다.
오프라인 최종 5건은 시작·종료의 네트워크 조건이 모두 같고 환경 변경 표시도 false다.
전체에는 final 10건 외 **온라인 error 1건(7)·cancelled 1건**도 있다. 이를 숨기지 않고 최종 결과 비교와 구분한다.
평균은 최종 결과 각 5건의 첫 부분결과 ms **정수부**이며 취소·오류 시도는 포함하지 않는다.

**원문 10건 표와 각 첫 부분결과 ms:** [device-facts.md §5-4](device-facts.md).
온라인 `안전대 미착용`→`안전띠 적용`은 부정 소실·의미 반전이 실제로 발생한 사례다.
동일 문장이 오프라인에서는 맞았으므로 네트워크 상태의 인과로 설명하지 않는다.
조건당 5문장 최종 결과 1회씩이며 **5건 중 1건/3건**을 보편적 정확도나 향상 배수로 표현하지 않는다.

**설계 반영:** I-4는 최대 5개 중 실제 반환된 후보(이번 로그 3~5개)를 보여주고 고르게 하는 규칙이다.
후보에 정답이 없으면 재발화·펜 기록 경로를 제공한다. I-5는 선택·수정 결과를 확인하기 전 저장·전송 금지다.
후보 포함 건수가 사용자 선택 성공률을 뜻하지는 않는다. 현장 소음 품질·장기 안정성은 여전히 별도 검증 범위다.

### 재현 경로 (실측 완료)

앱 디렉터리 `Lenova idea tap 12.7/app/vitalguard_field`에서 다음 순서로 실행한다. 기존 의존성만 사용하고 자동 pub 단계를 피하기 위해 Flutter 명령에 `--no-pub`를 붙였다. 새 의존성이 필요하다는 오류가 나오면 임의 설치하지 않는다.

```bash
dart analyze
flutter test --no-pub
flutter build apk --debug --no-pub
/Users/rlaxorhs77/Library/Android/sdk/platform-tools/adb install -r build/app/outputs/flutter-apk/app-debug.apk
/Users/rlaxorhs77/Library/Android/sdk/platform-tools/adb shell am start -n com.vitalguard.field/com.vitalguard.vitalguard_field.MainActivity
```

진단 헤더의 **STT 측정**을 누른다. 먼저 가용성·한국어 설치 언어 보고를 확인하고, 비행기모드를 켠 뒤 **Wi-Fi도 끄고** 돌아온다. 화면의 비행기모드 ON·Wi-Fi OFF·활성 네트워크 없음 표시를 확인한다. 마이크 권한을 허용하고 문장별 ‘측정 시작’을 누른 다음 **‘말씀하세요’가 나오면 사람이 직접** 아래 문장을 읽는다.

1. 3번 구역 안전난간 파손 확인했습니다
2. 크레인 작업 중지 요청합니다
3. 가스 농도 초과 경보 발생
4. 작업자 두 명 안전대 미착용
5. 오후 두시 십오분 점검 완료

문장마다 최종 결과 또는 오류를 받은 뒤 다음 문장을 선택한다. ‘원시기록 복사’로 JSONL을 보존한다. 개발용 APK의 기록은 다음 읽기 명령으로도 가져올 수 있다.

```bash
adb exec-out run-as com.vitalguard.field cat files/p4-stt.jsonl
```

화면 원문·숫자 오류·부분결과 지연·시작/종료 환경을 함께 기록해야 한다. 비행기모드 실패만으로 ‘서버를 반드시 탄다’고 단정하지 않는다. 한국어 모델 부재·권한 거절·서비스 오류도 원인 후보이며 실제 오류코드와 설치 언어 보고로 구분한다. 이 시험은 **인식 시 네트워크 의존성**을 확인하며 모델 배포 방식은 별개다.

## B ML Kit Digital Ink 공식 문서 조사

**[확정] 채택 불요:** 순정 STT가 인식 시 네트워크 없이 동작하고 후보 선택·확인을 함께 쓰기로 했으므로
이 과제에서 ML Kit을 **쓸 필요가 없어졌다**. 사용 불가 판정이 아니다. 아래 조사 자체는 유효한 근거로 보존한다.

**공식 설치 경로 표에서 Digital Ink는 동적 다운로드만 지원하고 Bundled 열은 비어 있다.** ‘APK 설치 직후부터 네트워크 사용이 전혀 없어야 한다’는 조건을 공식 모델 배포 방식으로 만족시킬 수 있다는 근거는 없다. 반면 미리 다운로드한 모델로 오프라인 인식하는 기능은 문서화되어 있다. 당시 조사에서는 배포 조건을 구분했고, 현재 제품 결정은 위의 **채택 불요**다. [Google 모델 설치 경로](https://developers.google.com/ml-kit/tips/installation-paths), [Digital Ink 동작](https://developers.google.com/ml-kit/vision/digital-ink-recognition)

| 조사 항목 | 확인 결과 | 근거 |
|---|---|---|
| 정확한 좌표·현재 최신 버전 | **`com.google.mlkit:digital-ink-recognition:19.0.0`**. 확인일 공식 현재 버전 표의 최종 갱신일 **2025-08-29**. Android 가이드도 같은 버전 명시 | [공식 릴리스 목록](https://developers.google.com/ml-kit/release-notes), [Android 가이드](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android) |
| 한국어 식별자 | 텍스트 모델 **`ko`**, 제스처 분류 **`ko-x-gesture`**. 이번 텍스트 후보는 `ko`이며 `ko-Hang`를 새로 가정하지 않음 | [공식 베이스 모델 표](https://developers.google.com/ml-kit/vision/digital-ink-recognition/base-models) |
| 다운로드 | `RemoteModelManager.download`로 첫 사용 전에 다운로드. `isModelDownloaded`로 준비 여부 확인, 삭제도 명시적 관리 | [Android 모델 관리](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android#managing_model_downloads) |
| APK assets 사전 번들 | **공식 지원 경로 없음**. 모델은 RemoteModel이며 공개 builder는 모델 식별자를 받음. 개발자 임의 ONNX/asset 파일을 읽는 계약이 아님 | [설치 경로 표](https://developers.google.com/ml-kit/tips/installation-paths), [DigitalInkRecognitionModel API](https://developers.google.com/android/reference/com/google/mlkit/vision/digitalink/recognition/DigitalInkRecognitionModel) |
| 모델 크기 | 공식 설명은 **언어당 약 20MB 저장공간**. 한국어 특정 버전의 정확한 다운로드 바이트는 미측정 | [Android 가이드 모델 관리](https://developers.google.com/ml-kit/vision/digital-ink-recognition/android#managing_model_downloads) |
| 앱 용량 증가 | 동적 모델은 APK 자체 대신 앱별 저장공간을 차지. SDK·전이 의존성으로 인한 정확한 APK 증가량은 ABI·빌드 설정을 포함한 비교 빌드 없이 확인 못 함 | [설치 방식별 용량 차이](https://developers.google.com/ml-kit/tips/installation-paths) |
| 라이선스·이용 조건 | ML Kit 이용약관과 Google APIs Terms of Service 적용. 문서의 코드 예제 Apache 2.0 표기를 SDK·모델의 자유 재배포 허가로 확대하지 않음 | [ML Kit Terms & Privacy](https://developers.google.com/ml-kit/terms) |

Google Maven 원문 메타데이터 URL은 웹 도구에서 열기 실패했다. 버전은 **Google의 현재 버전 표와 Android 가이드**를 대조해 확인했다. 패키지나 모델을 설치해 검증한 결과는 아니다.

**배포 조건 구분:**

- 신규 설치 후 네트워크를 전혀 쓰지 못함: Digital Ink의 공식 동적 모델 경로는 맞지 않는다. 비공개 모델 파일 복사·SDK 내부 캐시 주입을 대안으로 제안하지 않는다.
- 사무실 등에서 모델을 준비한 뒤 현장에서 오프라인 사용: 문서상 가능하지만 사용자 운영 조건으로 채택된 것은 아니다. 앱 재설치 시 다운로드 모델이 제거된다는 수명도 고려해야 한다. [공식 설치 경로](https://developers.google.com/ml-kit/tips/installation-paths)
- 인식 처리 자체의 온디바이스 동작과 SDK 전체의 네트워크 통신은 다르다. 공식 약관은 입력·인식 결과를 서버에 보내지 않는다고 설명하면서 업데이트 확인·이용/성능 지표 통신도 명시한다. ‘SDK가 영구히 네트워크를 전혀 쓰지 않음’으로 일반화하지 않는다. [공식 Terms & Privacy](https://developers.google.com/ml-kit/terms)

**ML Kit 코드·Gradle 의존성·모델 다운로드는 모두 미실행**이다. 순정 STT 채택에 따라 이번 과제의 추가 설치 요청은 취소한다.

## C 순정과 오픈소스 폴백 판정

새 조사를 하지 않았다. 기준은 기존 [grok-02-input-offline.md §E.4](grok-02-input-offline.md)의 sherpa-onnx 한국어 스트리밍 Zipformer와 whisper.cpp 비교다. 최신 지시대로 sherpa-onnx의 ONNX는 **assets 번들 전제**이며 ML Kit의 RemoteModel 다운로드와 섞지 않는다.

**현재 판정: 순정 STT 채택, 오픈소스 폴백 불요(사용자 결정).** 오프라인 한국어 인식을 실측했고, 낮은 1순위 원문 일치와 의미 반전에는 **후보 선택(I-4)·확인 후 저장(I-5)**으로 대응한다. sherpa-onnx·whisper.cpp 새 조사·코드·설치는 하지 않는다. 이는 소표본을 근거로 모든 현장 정확도를 보장하는 결론이 아니다.

## 진단 코드 작성 이력

| 파일 | 행 | 변경 |
|---|---|---|
| `app/vitalguard_field/android/app/src/main/kotlin/com/vitalguard/vitalguard_field/MainActivity.kt` | 68 | 채널 연결. 환경 읽기 125행, 한국어 지원 조회 150행, 권한 요청 211행, 순정 인식 230행, 원시 이벤트 기록 291행 |
| `app/vitalguard_field/android/app/src/main/AndroidManifest.xml` | 2 | 마이크·환경 관찰 권한, RecognitionService query는 44행 |
| `app/vitalguard_field/lib/stt_screen.dart` | 10 | 고정 문장 5개, 측정 상태·원문 기록·진단 화면 |
| `app/vitalguard_field/lib/diag_screen.dart` | 264 | STT 측정 진입 버튼 |
| `app/vitalguard_field/test/stt_measurements_test.dart` | 43 | 권한 거절·원문 보존·오류/늦은 콜백 테스트. 후속 실행은 Claude가 전체 4/4 통과 보고 |
| `research/device-facts.md` | 426 | §5-4 온라인·오프라인 실측 결과·원시 로그·소표본 한계. §5-1 원문 유지 |

진단 구현 당시 `pubspec.yaml`·`pubspec.lock`·Gradle 의존성의 불변을 확인했다. 당시 정적 검사 기록은 `plan-draft/p4-stt-qa/verification.json`이며 과거의 차단·미측정 상태를 담은 이력이다. 이번에는 지정 문서 5개만 결과에 맞춰 갱신하고 앱 코드·의존성·원시 로그는 수정하지 않는다.

## 이번 결과 반영과 DOCX 동기화 상태

이번 지시서에 따라 수정한 원본은 문서 **5개**다. 앱 코드·의존성·옵시디언은 수정하지 않았고,
원시 JSONL 251행과 device-facts의 §5-1은 변경 전과 동일함을 확인했다.

| 파일 | 주요 행 | 반영 |
|---|---|---|
| `research/device-facts.md` | 426, 463, 473, 499 | §5-4 실측 완료, 온라인/오프라인 원문 표, 재현·원시 로그 |
| `research/p4-stt-mlkit-report.md` | 5, 25, 84, 111 | 실측 결과와 순정 채택, ML Kit 조사 보존·채택 불요, 폴백 불요 |
| `artifacts/design-constraints.md` | 257, 264, 269 | I-1 관측 근거·I-4 후보 선택·I-5 확인 저장 |
| `tab_plan.md` | 155, 385, 811, 991 | 미검증 상태·규칙·결정 현황·변경 이력 0.5 |
| `app_uIuX_plan.md` | 46, 290, 533 | 규칙표·R-06 후보 선택/확인·변경 이력 0.8 |

**DOCX 동기화 미완료:** 지정된 `python3 tools/md2docx.py tab_plan.md app_uIuX_plan.md`만 실행했다.
성공 문구가 출력됐지만 두 DOCX의 SHA-256은 변경 전과 같고 내부에 I-4·I-5가 없어 실제 갱신되지 않았다.
해당 실행 시점의 LibreOffice 크래시 기록에는 `_RegisterApplication` 경로의 `SIGABRT`가 남았다.
락·전용 프로필이 있는 변환기를 사용했으며 이번 실패의 원인을 동시 실행으로 단정하지 않는다.
`soffice` 직접 호출·변환기 변경·반복 실행·패키지 설치는 하지 않았다. 새 DOCX와 페이지 렌더 검증은 미완료다.
