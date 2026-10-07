import java.util.Properties
import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// No Compose/AndroidX UI dependencies: their R classes would shadow the installed
// Flutter application's resource IDs inside its instrumented process.
val signingFile = file(providers.gradleProperty("releaseSigningProperties").get())
val keys = Properties().apply { signingFile.reader(Charsets.UTF_8).use { load(it) } }
check(listOf("storeFile", "storePassword", "keyAlias", "keyPassword").all { !keys.getProperty(it).isNullOrBlank() })
android {
    namespace = "com.vitalguard.field.compatibilityprobe"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.vitalguard.field.compatibilityprobe"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "readonly-compatibility-check"
    }
    signingConfigs {
        create("release") {
            val path = File(keys.getProperty("storeFile"))
            storeFile = if (path.isAbsolute) path else File(signingFile.parentFile, path.path)
            storePassword = keys.getProperty("storePassword")
            keyAlias = keys.getProperty("keyAlias")
            keyPassword = keys.getProperty("keyPassword")
        }
    }
    buildTypes { release { signingConfig = signingConfigs.getByName("release"); isDebuggable = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17 } }
dependencies { implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2") }
