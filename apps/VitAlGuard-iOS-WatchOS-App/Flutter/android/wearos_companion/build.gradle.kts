plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.yangjeehoo.vitalguard.flutter"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.yangjeehoo.vitalguard.flutter"
        minSdk = 30
        targetSdk = 36
        versionCode = 80
        versionName = "8.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
}
