plugins {
    id("com.android.application") version "9.1.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.0" apply false
    // 기존 vitalguard_app/android/wear 모듈과 같은 호스트 프리뷰 테스트 버전.
    id("com.android.compose.screenshot") version "0.0.1-alpha16" apply false
}
