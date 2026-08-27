// 갤럭시워치 단독 수집기(1단계 = 실측 프로브) — 삼성 Health Sensor SDK 1.4.1 링크 검증용 모듈
// ⚠ Gradle Kotlin DSL 에서는 `java` 가 JavaPluginExtension 을 가리켜 `java.util.Properties` 가 안 풀린다.
//   import 로 짚어야 한다.
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// 릴리스 서명 키는 레포에 안 들어간다 — `key.properties` 와 `*.jks` 는 .gitignore 대상이다.
// 파일이 없으면 signingConfig 를 **만들지 않는다**. 그래야 키 없는 사람도 assembleDebug 는 그대로 돈다
// (릴리스만 미서명이 되고, 그 사실은 `signingReport` 에 Config: null 로 드러난다).
val wearKeyProps =
    project.file("key.properties").takeIf { it.exists() }?.let { f ->
        Properties().apply { f.inputStream().use { load(it) } }
    }

android {
    namespace = "com.vitalguard.wear"
    compileSdk = 36

    defaultConfig {
        // 종전 근거("Data Layer 가 같은 applicationId·서명을 요구한다")는 **지금 코드에 해당하지 않는다.**
        // 실측 = play-services-wearable 의존 0건 · DataClient/MessageClient/CapabilityClient 참조 0건.
        // 워치는 단독(standalone)으로 LTE 직결 업로드한다 → 폰 앱과 **서명을 맞출 필요가 없다**.
        // applicationId 는 서버 적재분과의 연속성 때문에 그대로 둔다(바꾸면 기존 설치본과 별개 패키지가 된다).
        applicationId = "com.vitalguard.vitalguard_app"
        minSdk = 30            // Wear OS 3(워치4) 이상 — Sensor SDK 지원 하한
        targetSdk = 36         // 갤럭시워치8 = Wear OS 6 = Android 16

        // ONNX Runtime 이 ABI 4종의 .so 를 싣는다 — 실측 x86 19.4 · x86_64 19.4 · arm64-v8a 16.8 ·
        // armeabi-v7a 11.8 MB. 실기가 정하는 문제라 추측하지 않고 물었다(2026-08-27 · SM-L355N).
        //     abilist   = armeabi-v7a,armeabi
        //     abilist64 = (비어 있음)          ← 이 워치는 32비트 전용이다
        // 그래서 armeabi-v7a 하나만 남긴다. x86 계열(에뮬레이터 전용) 38.8MB + arm64 16.8MB 제거.
        // ⚠ 64비트 워치(워치7 이후 Exynos W1000 계열)를 지원 대상에 넣으면 arm64-v8a 를 되살려야
        //   한다 — 없으면 그 기기에서 **설치 자체가 실패**한다. 기기를 늘릴 때 이 줄을 먼저 본다.
        ndk { abiFilters += listOf("armeabi-v7a") }
        versionCode = 1
        versionName = "0.1-probe"
    }

    signingConfigs {
        // 워치 전용 키. 폰 앱(app/build.gradle.kts)은 릴리스를 **디버그 키로** 서명하는데,
        // 단독 노선이라 둘이 갈라져도 무방하다(위 applicationId 주석의 실측 근거).
        if (wearKeyProps != null) {
            create("release") {
                storeFile = file(wearKeyProps.getProperty("storeFile"))
                storePassword = wearKeyProps.getProperty("storePassword")
                keyAlias = wearKeyProps.getProperty("keyAlias")
                keyPassword = wearKeyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("release") {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            // ⚠ R8 을 켜지 않는다. 삼성 SDK 는 트래커 타입·ValueKey 를 문자열/리플렉션으로 짚는다 —
            //   켤 거면 keep 규칙을 쓰고 **실기에서 SpO₂·피부온이 살아 있는지 재측정한 뒤** 켠다.
            isMinifyEnabled = false
        }
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
    // ⚠ androidx.wear:wear:1.3.0 이 androidx.fragment:1.2.4 를 딸려온다.
    //   registerForActivityResult 는 fragment 1.3.0+ 를 요구한다 — 그 아래 버전의 FragmentActivity 는
    //   super.onRequestPermissionsResult() 를 안 부르고 잘못된 요청코드를 쓴다.
    //   **릴리스 빌드에서만 도는 lintVitalRelease 가 이걸 fatal 로 잡는다**(디버그는 그냥 통과한다).
    //   이 앱의 MainActivity 는 ComponentActivity 라 실사용 경로는 아니지만, 낡은 fragment 를
    //   클래스패스에 두는 것 자체가 함정이므로 제약으로 올린다.
    constraints {
        implementation("androidx.fragment:fragment:1.8.5") {
            because("androidx.wear:wear:1.3.0 의 fragment 1.2.4 는 ActivityResult 계약과 맞지 않는다")
        }
    }

    // 삼성 Health Sensor SDK — 로컬 AAR (원본: 조달청-공모전 관련자료/samsung health sdk/1.4.1)
    implementation(files("libs/samsung-health-sensor-api-1.4.1.aar"))

    // 낙상 ML 3종 모듈(com.vitalguard.ml)의 추론 런타임. 모듈은 assets/*.onnx 를 읽는다.
    // ⚠ 애플워치판은 Core ML 이라 런타임 의존이 0인데, 이쪽은 이 한 줄이 필요하다.
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.20.0")
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
    // 워치 텍스트 입력 = RemoteInput. 워치엔 Compose 텍스트 필드가 없다(Wear M3 1.5.0 실측 0건) —
    // 시스템 입력 화면(키보드·필기·음성)을 띄우는 이 경로가 워치에서 글자를 받는 정식 수단이다.
    implementation("androidx.wear:wear-input:1.1.0")
    // 진행 중 활동(OngoingActivity) — 운동 앱이 "시계로 안 돌아가게" 쓰는 정식 수단.
    // ⚠ 이 의존이 실제로 시계 복귀를 막는지는 실기에서 재고 판정한다(추정으로 두지 않는다).
    implementation("androidx.wear:wear-ongoing:1.0.0")
    implementation("androidx.wear:wear-tooling-preview:1.0.0")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    // JVM 단위테스트에는 android.jar 의 org.json 이 없다 — 시험 전용으로 실물을 넣는다
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
