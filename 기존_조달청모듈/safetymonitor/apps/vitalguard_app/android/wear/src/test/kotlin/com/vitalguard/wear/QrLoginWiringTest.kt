// QR 로그인 배선 가드 — MainActivity 가 start→poll→saveSession 을 잇고, secret 을 저장·로그하지 않으며, 떠나면 끊는다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.DeviceLoginClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **QR 승인은 직접 로그인과 같은 성공 경로로 들어가고, secret 은 코루틴 밖으로 안 나간다.**
 * 되돌아가는 방식이 배선(호출이 빠지거나 다른 경로로 저장)이라 소스를 읽어 못 박는다(HrWatchdogTest 수법).
 */
class QrLoginWiringTest {
    private fun src(): String {
        val f = listOf("src/main/kotlin/com/vitalguard/wear/MainActivity.kt", "wear/src/main/kotlin/com/vitalguard/wear/MainActivity.kt")
            .map(::File).firstOrNull { it.exists() } ?: throw AssertionError("MainActivity.kt 를 못 찾았다")
        return uncommented(f.readText()).replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
    }

    @Test
    fun `배선 — 진입·재발급·모드전환·취소가 startQrLogin 과 Job 취소로 이어진다`() {
        val c = src()
        assertTrue("로그인 진입이 QR 을 시작하지 않는다", c.contains("onLogin = { login = LoginUiState(); showLogin = true; startQrLogin() }"))
        assertTrue("[재발급]이 안 이어졌다", c.contains("onQrRefresh = { startQrLogin() }"))
        assertTrue("모드 전환이 폴링을 안 끊는다", Regex("onSwitchMode = \\{ qrJob\\?\\.cancel\\(\\); login = login\\.copy\\(mode = LoginMode\\.MANUAL").containsMatchIn(c))
        assertTrue("취소가 폴링을 안 끊는다", c.contains("onCancel = { qrJob?.cancel(); showLogin = false; login = LoginUiState() }"))
    }

    @Test
    fun `폴링 — 4초 상수로 poll 하고, 승인이면 직접 로그인과 같은 saveSession 경로`() {
        val fn = src().substringAfter("private fun startQrLogin()").substringBefore("override fun onStop()")
        assertTrue("poll 주기가 상수가 아니다", fn.contains("DeviceLoginClient.POLL_INTERVAL_MS"))
        assertTrue("poll 에 secret 을 안 넘긴다", fn.contains("client.poll(s.code, s.secret)"))
        assertTrue("승인 저장 경로가 직접 로그인과 다르다", fn.contains("cfg.saveSession(p.token, p.workerId, p.workerName)"))
        assertTrue("승인 뒤 화면을 안 닫는다", fn.contains("login = LoginUiState()") && fn.contains("showLogin = false"))
        assertTrue("만료가 phase 만 바꾸지 않고 code·rows 를 지운다", fn.contains("login.qr.copy(phase = QrPhase.EXPIRED, secondsLeft = 0)"))
        assertEquals(4_000L, DeviceLoginClient.POLL_INTERVAL_MS)
    }

    @Test
    fun `secret 은 저장·로그되지 않고, 화면을 떠나면 폴링이 끊긴다`() {
        val c = src()
        assertFalse("secret 을 저장한다", Regex("saveSession\\([^)]*secret").containsMatchIn(c))
        assertFalse("secret 을 로그에 싣는다", Regex("Log\\.[iwed]\\([^\\n]*secret").containsMatchIn(c))
        val stop = c.substringAfter("override fun onStop()").substringBefore("\n    }")
        assertTrue("onStop 이 QR 폴링을 안 끊는다", stop.contains("qrJob?.cancel()"))
    }
}
