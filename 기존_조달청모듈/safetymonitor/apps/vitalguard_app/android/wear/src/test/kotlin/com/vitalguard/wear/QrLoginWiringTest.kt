// QR 로그인 배선 가드 — MainActivity 가 start→poll→saveSession 을 잇고, secret 을 저장·로그하지 않으며, 떠나면 끊는다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.DeviceLoginClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * KEEP_SCREEN_ON 규칙이 사는 한 자리(09-07 · 사용자 승인 C안). AmbientTest·OngoingActivityTest 가
 * 이 함수를 부른다 — 같은 룰이 두 곳에 흩어지면 어느 것도 안 읽힌다.
 *
 * 계약 = **QR 로그인 화면 동안만** 화면을 깨워 둔다.
 *   ⓐ 화면이 꺼지면 onStop 이 폴링을 끊어 승인 전에 QR 이 만료된다
 *      (09-07 워치8 실측 6/6 실패 · 승인 16~25초 vs 화면 타임아웃 15초).
 *   ⓑ 그렇다고 상시로 걸면 앰비언트 진입이 사라진다
 *      (08-25 실측: 100초를 기다려도 mWakefulness=Awake · 앰비언트 콜백 0건).
 * 그래서 거는 자리는 **한 곳뿐**이고, 그 자리는 QR 게이트 안이며, 해제가 반드시 있어야 한다.
 */
internal fun assertKeepScreenOnScopedToQr(rawActivity: String) {
    val c = uncommented(rawActivity)
    val add = Regex("""addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)""")
    assertEquals(
        "화면 유지 플래그를 거는 자리는 QR 게이트 한 곳뿐이어야 한다 — 상시로 걸면 앰비언트가 죽는다",
        1,
        add.findAll(c).count(),
    )
    assertTrue(
        "화면 유지 플래그가 QR 게이트 밖에서 걸린다",
        c.contains("if (qrAwake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)"),
    )
    assertTrue(
        "QR 게이트가 로그인 면(페이저 0번)에 묶여 있지 않다",
        c.contains("val qrAwake = !showLogin && !showDiagnostics && pagerState.currentPage == 0 &&"),
    )
    // ★ IDLE 을 빼는 것이 이 게이트의 핵심이다(09-09). 로그인이 0번 **면**이 되면서
    //   그 면은 앱을 열면 늘 보인다 — 단계를 안 가리면 로그인을 마친 뒤에도 참이라 화면이 영영 안 꺼진다.
    assertTrue(
        "QR 게이트가 진행 단계를 안 가린다 — IDLE 까지 참이면 화면이 안 꺼진다",
        c.contains("(login.qr.phase == QrPhase.LOADING || login.qr.phase == QrPhase.WAITING)"),
    )
    assertTrue(
        "화면 유지 플래그 해제가 없다 — QR 을 벗어나도 앰비언트가 안 살아난다",
        c.contains("clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)"),
    )
}

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
        // 로그인 진입은 0번 면 한 곳뿐이다 — QR 이 그려지는 자리가 하나여야
        // 화면 깨우기 조건(currentPage == 0)이 성립한다(09-09).
        assertTrue("0번 면의 [로그인]이 QR 을 시작하지 않는다", c.contains("onStart = { login = LoginUiState(); startQrLogin() }"))
        assertTrue("0번 면에서 로그아웃을 못 한다", c.contains("onLogout = { logout() }"))
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

    /**
     * ★ 09-09 — 로그인이 페이저 0번 면이 되면서 **onStop 만으로는 부족해졌다.**
     * 페이지를 넘겨도 액티비티는 살아 있어 onStop 이 오지 않는다 → 폴링이 뒤에서 계속 돈다.
     * "백그라운드 폴링 없음" 계약을 페이지 이탈에서 다시 세운다.
     */
    @Test
    fun `로그인 면을 벗어나면 폴링이 끊긴다 - 페이지 넘김에는 onStop 이 안 온다`() {
        val c = src()
        assertTrue(
            "페이지 이탈이 폴링을 안 끊는다",
            Regex("LaunchedEffect\\(pagerState\\.currentPage\\)[\\s\\S]{0,200}?qrJob\\?\\.cancel\\(\\)").containsMatchIn(c),
        )
    }

    /** 로그인이 끝나면 요약(1번)으로 내려간다 — QR 승인·직접 입력 모두 신원이 생기는 것으로 끝난다(09-09 사용자 지시). */
    @Test
    fun `로그인 완료가 요약 페이지로 데려간다`() {
        val c = src()
        assertTrue(
            "로그인 뒤 요약으로 안 내려간다",
            Regex("LaunchedEffect\\(workerId\\)[\\s\\S]{0,220}?animateScrollToPage\\(1\\)").containsMatchIn(c),
        )
    }

    /** 화면이 꺼지면 폴링이 죽는다 — QR 이 떠 있는 동안만 화면을 깨워 둔다(09-07 사용자 승인 C안). */
    @Test
    fun `QR 화면 동안만 화면을 깨워 둔다`() {
        assertKeepScreenOnScopedToQr(src())
    }
}
