# ML Kit 텍스트 인식 — 우리는 한국어 인식기만 쓴다(capture_ocr.dart:357 TextRecognitionScript.korean).
# google_mlkit_text_recognition 플러그인은 5개 문자 체계를 모두 참조하지만 우리 의존성에는
# 한국어(라틴 포함)만 들어 있어, release 의 R8 이 나머지를 '없는 클래스' 로 보고 빌드를 세운다.
# 실제로 쓰지 않는 인식기이므로 경고만 끈다. keep 이 아니라 dontwarn 이다 — 코드가 들어가지 않는다.
-dontwarn com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions$Builder
-dontwarn com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
-dontwarn com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions$Builder
-dontwarn com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
-dontwarn com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions$Builder
-dontwarn com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions

# ML Kit 문서 스캐너 — 2026-09-16: debug 는 정상이나 release APK 는 실행 즉시 크래시한다.
# 핵심 스택: GmsDocumentScanning.getClient → zztp.<init> 의 requireNonNull 에서 NPE.
# 문서 스캐너 두 패키지만 keep 한 빌드도 같은 지점에서 크래시했다. configuration.txt 에 규칙이 들어갔고
# mapping 에서 클래스명도 유지됐으므로, 스캐너 클래스 제거가 원인은 아니었다.
# javap 로 zztp 생성자 바이트코드를 확인: requireNonNull 대상은 두 번째 인자
# com.google.mlkit.common.sdkinternal.SharedPrefManager 다.
# zzty.create 바이트코드에서 이 인자를 MlKitContext.getInstance().get(SharedPrefManager.class) 로
# 얻는 것을 확인했으며, 이 호출이 null 을 반환했다.
# com.google.mlkit:common:18.11.0 AAR 의 proguard.txt 는 @com.google.android.apps.common.proguard.UsedBy*
# 어노테이션이 붙은 것만 keep 하므로 SharedPrefManager 컴포넌트 등록 경로를 보호하지 못한다.
# 이 경로는 R8 fullMode(-allowaccessmodification) 에서 제거된다.
# 아래 두 규칙으로 ML Kit 전체와 gms internal mlkit_* 전체를 keep 한 빌드는 크래시 없이 기동했다.
# APK 크기는 86.9MB → 87.0MB 로 실측 증가량은 0.1MB 다.
# 실측 차이가 0.1MB 라 범위 탐색을 위한 반복 빌드 비용이 이득보다 커서 keep 범위를 좁히지 않았다.
# dontwarn 이 아니라 keep 이다 — 코드가 들어간다.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
