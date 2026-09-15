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
