// 자동 시작 리시버 — 되살릴 조건·액션 범위·매니페스트 선언을 못 박는다
package com.vitalguard.wear

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 종전엔 앱 소유 리시버가 **0개**라 재부팅·재설치 뒤 수집이 조용히 멈췄다(09-01 워치8 실측).
 * 화면은 평소와 같아 아무도 모른다 — 그래서 규칙을 테스트로 박는다.
 */
class RestartReceiverTest {
    private val manifest = File("src/main/AndroidManifest.xml").readText()

    @Test
    fun `부팅과 앱교체에서만 되살린다`() {
        assertTrue(RestartReceiver.shouldRestart(Intent.ACTION_BOOT_COMPLETED, true, true))
        assertTrue(RestartReceiver.shouldRestart(Intent.ACTION_MY_PACKAGE_REPLACED, true, true))
        // ⚠ 액션을 넓히면 Android 12+ 백그라운드 FGS 제한에 걸린다 — 이 둘만 면제 대상이다.
        assertFalse("잠금 부팅까지 받았다", RestartReceiver.shouldRestart(Intent.ACTION_LOCKED_BOOT_COMPLETED, true, true))
        assertFalse("화면 켜짐에도 반응한다", RestartReceiver.shouldRestart(Intent.ACTION_SCREEN_ON, true, true))
        assertFalse("액션 없이도 시작한다", RestartReceiver.shouldRestart(null, true, true))
    }

    @Test
    fun `자격이 없으면 수집을 켜지 않는다`() {
        // 자동 로그아웃(미착용 90분) 뒤 재부팅한 워치는 조용히 있어야 한다 — 올릴 곳 없는 표본만 쌓인다.
        assertFalse(RestartReceiver.shouldRestart(Intent.ACTION_BOOT_COMPLETED, false, true))
        assertFalse(RestartReceiver.shouldRestart(Intent.ACTION_MY_PACKAGE_REPLACED, false, true))
    }

    @Test
    fun `권한이 없으면 물러선다 - 부팅 직후 즉사를 막는다`() {
        // 권한 0개에서 FGS(health) 승격은 SecurityException 으로 즉사한다(c7b188f).
        assertFalse(RestartReceiver.shouldRestart(Intent.ACTION_BOOT_COMPLETED, true, false))
    }

    @Test
    fun `매니페스트가 리시버와 부팅 권한을 선언한다`() {
        assertTrue(
            "RECEIVE_BOOT_COMPLETED 가 없다 — 선언이 없으면 부팅 브로드캐스트가 아예 안 온다",
            manifest.contains("android.permission.RECEIVE_BOOT_COMPLETED"),
        )
        val receiver = manifest.substringAfter("<receiver").substringBefore("</receiver>")
        assertTrue("리시버 이름이 다르다", receiver.contains(".RestartReceiver"))
        // 시스템이 보내는 protected broadcast 라 exported 가 false 면 아예 도달하지 않는다.
        assertTrue("exported 가 아니라 브로드캐스트가 안 온다", receiver.contains("""android:exported="true""""))
        assertTrue("부팅 액션이 없다", receiver.contains("android.intent.action.BOOT_COMPLETED"))
        assertTrue("앱 교체 액션이 없다", receiver.contains("android.intent.action.MY_PACKAGE_REPLACED"))
    }

    @Test
    fun `권한 판단은 액티비티와 같은 함수를 쓴다`() {
        // 각자 복사해 두면 한쪽만 조건이 바뀌어도 다른 쪽이 부팅 직후 죽는다.
        val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())
        assertTrue(
            "액티비티가 권한 판단을 따로 들고 있다",
            activity.contains("CollectorService.canStartHealthFgs(this)"),
        )
        val receiver = uncommented(File("src/main/kotlin/com/vitalguard/wear/RestartReceiver.kt").readText())
        assertTrue(
            "리시버가 권한 판단을 따로 들고 있다",
            receiver.contains("CollectorService.canStartHealthFgs(context)"),
        )
    }
}
