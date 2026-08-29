// 워치 QR 로그인 화면 — 기본 모드·카운트다운·"흰 카드 위 검은 칸"(반전 QR 금지)을 못 박는다
package com.vitalguard.wear

import com.vitalguard.wear.ui.LoginMode
import com.vitalguard.wear.ui.LoginUiState
import com.vitalguard.wear.ui.QR_QUIET_MODULES
import com.vitalguard.wear.ui.countdownText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class QrLoginScreenTest {
    private val screen = uncommented(File("src/main/kotlin/com/vitalguard/wear/ui/LoginScreen.kt").readText())

    @Test
    fun `로그인 진입 기본 모드는 QR 이다`() {
        // 08-29 사용자 지시 — "로그인 방법을 QR 로 변경". 직접 입력은 예비 경로다.
        assertEquals(LoginMode.QR, LoginUiState().mode)
    }

    @Test
    fun `카운트다운은 m_ss 이고 음수는 0 이다`() {
        assertEquals("4:59", countdownText(299))
        assertEquals("0:05", countdownText(5))
        assertEquals("0:00", countdownText(-3))
    }

    @Test
    fun `QR 은 흰 카드 위 검은 칸으로만 그린다`() {
        // 반전 QR(검정 바탕에 흰 칸)은 폰 카메라 앱이 못 읽는 경우가 있다 — 카드 배경 White · 칸 Black 을 고정한다.
        val card = screen.substringAfter("fun QrCard(").substringBefore("fun SmallPill(")
        assertTrue("카드 배경이 흰색이 아니다", card.contains("Color.White"))
        assertTrue("칸을 검정으로 안 그린다", card.contains("drawRect(Color.Black"))
        assertTrue("여백(quiet zone)이 ISO 권장 4모듈 미만이다", QR_QUIET_MODULES >= 4)
    }

    @Test
    fun `카운트다운은 상태값에서만 온다 — 화면이 시계를 읽지 않는다`() {
        // 시계를 읽으면 스크린샷 검증이 비결정이 된다(TimeText 전례 · 9/14 diff).
        assertTrue(!screen.contains("System.currentTimeMillis") && !screen.contains("LaunchedEffect"))
    }
}
