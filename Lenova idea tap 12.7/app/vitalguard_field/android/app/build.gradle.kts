import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    // Properties.load(InputStream) 은 ISO-8859-1 로 읽어 보관 폴더명의 한글이 깨진다. Reader 로 UTF-8 을 준다.
    keystorePropertiesFile.reader(Charsets.UTF_8).use { keystoreProperties.load(it) }
}
val hasReleaseSigning = listOf("storeFile", "storePassword", "keyAlias", "keyPassword").all {
    !keystoreProperties.getProperty(it).isNullOrBlank()
}
if (!hasReleaseSigning) {
    // CI 와 다른 개발자 환경에서도 빌드할 수 있도록 디버그 서명으로 폴백한다.
    logger.warn("key.properties 가 없거나 서명 값이 누락되어 release 를 디버그 키로 서명한다. 배포본으로 쓰지 마라.")
}

android {
    namespace = "com.vitalguard.vitalguard_field"
    // Android 16. 기기가 API 36 이고, targetSdk 36 이어야 방향 고정 금지·edge-to-edge 강제를
    // 실제로 겪는다(tab_plan.md §2.2·§5.3 C-3). flutter 기본값에 맡기지 않고 못박는다.
    compileSdk = 36
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.vitalguard.field"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = 26      // 기기는 36 이지만 하한을 지나치게 올릴 이유가 없다
        targetSdk = 36
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                // 상대경로는 android/ 기준으로 풀고, 절대경로는 그대로 사용한다.
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // 같은 키로 서명해야 태블릿에서 앱을 지우지 않고 덮어쓰기 업데이트할 수 있어
            // 초안과 로그인 상태가 보존된다.
            signingConfig = signingConfigs.getByName(if (hasReleaseSigning) "release" else "debug")
            // R8 이 안 쓰는 ML Kit 인식기를 '없는 클래스' 로 보고 빌드를 세운다. proguard-rules.pro 참조.
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// ML Kit 네이티브 의존성 — 태곤 님 승인 2026-09-12.
//
// ⚠ Socket 검사를 못 했다. pub 생태계는 Socket 미지원이고, ML Kit 은 Maven Central 이 아니라
//   Google Maven(dl.google.com/dl/android/maven2)에만 있어 `socket package score maven` 이 404 다.
//   (양쪽을 직접 조회해 확인했다.) 대신 소스로 검증했다 —
//   Dart 래퍼는 네트워크 호출이 없고 AndroidManifest 가 권한을 하나도 요구하지 않으며
//   모델 전달이 `com.google.mlkit:*`(번들)이다.
dependencies {
    // ★ 한국어 OCR 모델 — **번들**. 약 4MB 가 APK 에 들어가고 네트워크가 필요 없다.
    //   플러그인이 이 좌표를 compileOnly 로만 선언하므로(플러그인 build.gradle) 앱이 직접 넣어야
    //   실제로 번들된다. 넣지 않으면 한국어 인식이 런타임에 실패한다.
    //   ★ 이것이 Digital Ink 와 갈리는 지점이다 — 그쪽은 번들 옵션이 아예 없어 기각됐다.
    //     (셀룰러 유무가 아니라 **전달 방식**이 기준이다. 번들이면 네트워크와 무관하다.)
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")

    // 서류 스캐너 — 여러 장·자동 경계검출·원근 교정·PDF 출력. 정식 16.0.0(베타 아님).
    // ⚠ **모델·스캔로직·UI 를 Play 서비스가 최초 1회 내려받는다.** 앱에는 약 300KB 만 들어간다.
    //   그래서 기기를 현장에 내보내기 전 **사무실 Wi-Fi 에서 한 번 실행해 받아두어야** 한다.
    //   앱이 준비 여부를 확인해 안 됐으면 말해야 한다 — 현장에서 조용히 실패하면 안 된다(N-1).
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0")
}
