// 요약 화면 수신 막대 — 심박 값의 나이 → 칸 수·색, 낡음 문턱은 CollectorService.HR_STALE_MS 와 한 수
package com.vitalguard.wear

import com.vitalguard.wear.ui.SIGNAL_LIVE_SEC
import com.vitalguard.wear.ui.SIGNAL_OK_SEC
import com.vitalguard.wear.ui.VgColors
import com.vitalguard.wear.ui.signalColor
import com.vitalguard.wear.ui.signalLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class SignalBarsTest {
    @Test
    fun `나이가 어릴수록 칸이 많고 낡으면 한 칸이다`() {
        assertEquals(4, signalLevel(SIGNAL_LIVE_SEC, collecting = true))
        assertEquals(3, signalLevel(SIGNAL_OK_SEC, collecting = true))
        // 낡기 직전(HR_STALE_MS 미만)은 2칸, 낡은 순간부터 1칸 — 관제웹 "연결끊김" 과 같은 경계.
        assertEquals(2, signalLevel(CollectorService.HR_STALE_MS / 1000 - 1, collecting = true))
        assertEquals(1, signalLevel(CollectorService.HR_STALE_MS / 1000, collecting = true))
    }

    @Test
    fun `수집 안 하거나 값이 없으면 0칸이다`() {
        assertEquals(0, signalLevel(null, collecting = true))
        assertEquals(0, signalLevel(3, collecting = false))
    }

    @Test
    fun `색은 칸 수를 따른다`() {
        assertEquals(VgColors.Normal, signalColor(4))
        assertEquals(VgColors.Normal, signalColor(3))
        assertEquals(VgColors.Caution, signalColor(2))
        assertEquals(VgColors.Danger, signalColor(1))
        assertEquals(VgColors.Idle, signalColor(0))
    }

    @Test
    fun `요약 화면에 심박 범위 글자가 없다`() {
        // 08-29 사용자 지시 — 범위는 상세 페이지에 있으니 요약에서 지운다.
        val screen = uncommented(File("src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt").readText())
        assertFalse("요약이 아직 범위(\$lo-\$hi)를 그린다", screen.contains("\"\$lo-\$hi\""))
    }
}
