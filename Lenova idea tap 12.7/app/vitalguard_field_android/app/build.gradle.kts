plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.android.compose.screenshot")
}

android {
    namespace = "com.vitalguard.field"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.vitalguard.field"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.3-stage2b"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("boolean", "VG_MOCK", providers.gradleProperty("vgMock").orNull.equals("true", true).toString())
    }
    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
            resValue("string", "app_name", "VitAlGuard 현장 (dev)")
        }
        release {
            // 4단계: 기존 release 키스토어 연결. 이 단계에는 서명 설정을 넣지 않는다.
        }
    }
    buildFeatures { compose = true; buildConfig = true
        resValues = true   // AGP 9 는 resValue 를 쓰려면 명시해야 한다(debug 앱 이름 (dev))
    }
    experimentalProperties["android.experimental.enableScreenshotTest"] = true
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17 } }

// 오프라인 작성 중 최신 버전을 추정해서 고정하지 않는다. 최초 빌드에서 안정판만 선택한다.
// 검증자는 -PnavigationComposeVersion=<확인한 안정판>으로 고정할 수 있다.
configurations.configureEach {
    resolutionStrategy.componentSelection.all {
        if (candidate.group == "androidx.navigation" &&
            Regex("(?i).*(alpha|beta|rc|snapshot|dev).*").matches(candidate.version)) {
            reject("Stage 1 requires stable AndroidX Navigation")
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.navigation:navigation-compose:" + providers.gradleProperty("navigationComposeVersion").getOrElse("latest.release"))
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    // 촬영 파일럿과 동일한 CameraX / 번들 한국어 OCR / Play 서비스 서류 스캔.
    implementation("androidx.camera:camera-core:1.6.2")
    implementation("androidx.camera:camera-camera2:1.6.2")
    implementation("androidx.camera:camera-lifecycle:1.6.2")
    implementation("androidx.camera:camera-view:1.6.2")
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0")
    // 런타임 JSON은 Android 내장 org.json. 아래 JVM 구현은 테스트에만 들어간다.
    testImplementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    debugImplementation("androidx.compose.ui:ui-tooling")
    screenshotTestImplementation(composeBom)
    screenshotTestImplementation("androidx.compose.ui:ui-tooling")
    // 파일럿에서 쓰는 validation API 조합을 유지한다(플러그인은 alpha16).
    screenshotTestImplementation("com.android.tools.screenshot:screenshot-validation-api:0.0.1-alpha15")
}
