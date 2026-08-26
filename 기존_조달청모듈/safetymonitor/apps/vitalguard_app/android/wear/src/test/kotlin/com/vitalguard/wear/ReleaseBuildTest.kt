// 릴리스 빌드 구성 가드 — 서명·키 유출·릴리스 전용 lint 회귀를 빌드 스크립트 텍스트로 못 박는다
package com.vitalguard.wear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 이 가드가 초록이면 보장되는 것.
 *  ① 릴리스 변종에 서명 설정이 붙는다(없으면 AGP 가 installRelease 를 아예 안 만든다 = 워치에 못 넣는다).
 *  ② 그 키가 **디버그 키가 아니다** — 폰 앱(app/build.gradle.kts)은 릴리스를 디버그 키로 서명하는데,
 *     워치는 단독 노선이라 그 절충을 물려받지 않는다.
 *  ③ 키 자료가 빌드 스크립트에 **적혀 있지 않다** — key.properties 에서 읽는다.
 *  ④ 키 파일들이 .gitignore 에 걸려 있다.
 *  ⑤ fragment 제약이 남아 있다 — 릴리스에서만 도는 lintVitalRelease 가 fatal 로 막던 그 자리다.
 */
class ReleaseBuildTest {
    private val gradle = File("build.gradle.kts").readText()
    private val gitignore = File("../.gitignore").readText()

    @Test
    fun `릴리스 변종에 서명 설정이 붙는다`() {
        assertTrue(
            "buildTypes 의 release 블록이 없다 — AGP 기본 release 는 미서명이라 설치가 안 된다",
            gradle.contains("""getByName("release")"""),
        )
        assertTrue(
            "release 에 signingConfig 대입이 없다",
            gradle.contains("""signingConfigs.findByName("release")"""),
        )
        assertTrue(
            "signingConfigs 에 release 를 만드는 자리가 없다",
            gradle.contains("""create("release")"""),
        )
    }

    @Test
    fun `릴리스를 디버그 키로 서명하지 않는다`() {
        assertFalse(
            "워치 릴리스가 디버그 키를 물려받는다 — 폰 앱의 TODO 절충을 따라가면 안 된다",
            gradle.contains("""signingConfigs.getByName("debug")"""),
        )
        assertFalse(
            "빌드 스크립트가 디버그 키스토어를 직접 가리킨다",
            gradle.contains("debug.keystore"),
        )
    }

    @Test
    fun `키 자료가 빌드 스크립트에 박혀 있지 않다`() {
        // 비밀번호는 key.properties 에서만 온다. 리터럴 대입이 보이면 레포에 키가 샌 것이다.
        listOf("storePassword", "keyPassword").forEach { field ->
            val literal = Regex("""$field\s*=\s*"""")
            assertFalse(
                "$field 에 리터럴 문자열이 대입돼 있다 — 커밋되면 키가 샌다",
                literal.containsMatchIn(gradle),
            )
            assertTrue(
                "$field 가 key.properties 에서 오지 않는다",
                gradle.contains("""$field = wearKeyProps.getProperty("$field")"""),
            )
        }
    }

    @Test
    fun `키 파일이 gitignore 에 걸려 있다`() {
        assertTrue("key.properties 가 .gitignore 에 없다", gitignore.contains("key.properties"))
        assertTrue("*.jks 가 .gitignore 에 없다", gitignore.contains("*.jks"))
    }

    @Test
    fun `키가 없어도 디버그 빌드는 돈다`() {
        // key.properties 가 없는 사람(다른 머신·CI)에게도 assembleDebug 는 그대로 돌아야 한다.
        // 그러려면 signingConfig 생성이 파일 존재 여부로 감싸져 있어야 한다.
        assertTrue(
            "key.properties 부재를 견디는 분기가 없다 — 키 없는 환경에서 configure 가 깨진다",
            gradle.contains("takeIf { it.exists() }") && gradle.contains("if (wearKeyProps != null)"),
        )
    }

    @Test
    fun `fragment 제약이 남아 있다`() {
        // androidx.wear:wear:1.3.0 이 fragment 1.2.4 를 딸려온다. 1.3.0 미만은 registerForActivityResult
        // 계약과 맞지 않아 lintVitalRelease 가 fatal 로 막는다 — 릴리스에서만 드러나는 자리다.
        assertTrue(
            "fragment 제약이 사라졌다 — assembleRelease 가 lintVitalRelease 에서 다시 막힌다",
            gradle.contains("""implementation("androidx.fragment:fragment:1.8.5")"""),
        )
        assertTrue(
            "제약이 constraints 블록 밖에 있다",
            gradle.contains("constraints {"),
        )
    }

    @Test
    fun `릴리스에 R8 을 켜지 않는다`() {
        // 삼성 SDK 는 트래커 타입·ValueKey 를 문자열로 짚는다. 켤 거면 keep 규칙 + 실기 재측정이 먼저다.
        assertTrue(
            "isMinifyEnabled 명시가 없다 — 기본값에 기대면 다음 사람이 조용히 켠다",
            gradle.contains("isMinifyEnabled = false"),
        )
    }
}
