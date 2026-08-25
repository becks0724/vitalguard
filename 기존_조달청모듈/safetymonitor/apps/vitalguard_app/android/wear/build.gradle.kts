// 갤럭시워치 단독 수집기(1단계 = 실측 프로브) — 삼성 Health Sensor SDK 1.4.1 링크 검증용 모듈
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.vitalguard.wear"
    compileSdk = 36

    defaultConfig {
        // Data Layer(폰 ↔ 워치 JWT 전달)가 같은 applicationId·서명을 요구한다 — 폰 앱과 일치시킨다.
        applicationId = "com.vitalguard.vitalguard_app"
        minSdk = 30            // Wear OS 3(워치4) 이상 — Sensor SDK 지원 하한
        targetSdk = 36         // 갤럭시워치8 = Wear OS 6 = Android 16
        versionCode = 1
        versionName = "0.1-probe"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    // 삼성 Health Sensor SDK — 로컬 AAR (원본: 조달청-공모전 관련자료/samsung health sdk/1.4.1)
    implementation(files("libs/samsung-health-sensor-api-1.4.1.aar"))
    // 구글 Health Services — 삼성 SDK 없이(파트너 승인 없이) 되는 범위를 실측하기 위한 대조군
    implementation("androidx.health:health-services-client:1.0.0")
    // health-services 의 ListenableFuture 는 빈 스텁(9999.0-empty)으로 풀린다 — 실물 guava 를 명시
    implementation("com.google.guava:guava:33.3.1-android")

    // Wear Compose — 화면과 미리보기(@WearPreviewDevices)의 토대
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // Material 3 Expressive — 원형 게이지(CircularProgressIndicator 세그먼트/호)가 여기 있다
    implementation("androidx.wear.compose:compose-material3:1.5.0")
    implementation("androidx.wear.compose:compose-foundation:1.5.0")
    // @WearPreviewDevices 등 워치 전용 미리보기 애너테이션
    implementation("androidx.wear.compose:compose-ui-tooling:1.5.0")
    // WearDevices 상수(LARGE_ROUND·SMALL_ROUND) — 전이 의존으로는 컴파일 경로에 안 들어온다
    // 앰비언트(항상 켜짐) — 화면이 꺼질 때 시계로 돌아가지 않고 앱이 어두운 채 남는다.
    // ⚠ FLAG_KEEP_SCREEN_ON 만으로는 안 된다(08-25 실측: 플래그가 걸려 있는데도 시계 복귀).
    implementation("androidx.wear:wear:1.3.0")
    implementation("androidx.wear:wear-tooling-preview:1.0.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    // JVM 단위테스트에는 android.jar 의 org.json 이 없다 — 시험 전용으로 실물을 넣는다
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
