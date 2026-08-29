pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.0.1" apply false
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
    // Kotlin 2.0+ 부터 Compose 컴파일러는 Kotlin 과 같은 버전의 플러그인이다 — 버전 맞춤 불필요
    id("org.jetbrains.kotlin.plugin.compose") version "2.3.20" apply false
    // 워치 @Preview → PNG (Compose Preview Screenshot Testing · alpha) — :wear 만 적용한다
    id("com.android.compose.screenshot") version "0.0.1-alpha15" apply false
}

include(":app")

include(":wear")
