// 09-15 개발자(진단) 화면 진입을 길게 누르기에서 10회 연타로 바꾼 계약을 고정한다
package com.vitalguard.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DevTapEntryTest {

    private val src = File("src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt").readText()

    /**
     * 통제군 — 아래 가드는 전부 "없음" 을 주장한다. 파일을 못 읽거나 비어 있으면
     * 그 주장이 공짜로 통과한다. 읽기가 살아 있는지부터 못박는다.
     */
    @Test
    fun `통제군 - 읽은 파일이 실제 VitalScreen 이다`() {
        assertTrue("VitalScreen.kt 를 못 읽었다", src.length > 5_000)
        assertTrue("본 화면이 아니다", src.contains("fun VitalScreen("))
        assertTrue("제스처 배선이 없다", src.contains("detectTapGestures("))
    }

    @Test
    fun `길게 누르기로는 더 이상 열리지 않는다`() {
        assertFalse("onLongPress 가 남아 있다 — 두 경로가 공존하면 바꾼 뜻이 없다", src.contains("onLongPress"))
    }

    @Test
    fun `연타 10회가 진단 화면을 연다`() {
        assertTrue("연타 수 상수가 10 이 아니다", src.contains("private const val DEV_TAP_COUNT = 10"))
        // 여는 호출이 연타 분기 안에 있어야 한다 — 상수만 맞고 배선이 빠지면 영영 안 열린다.
        val branch = src.substringAfter("if (n >= DEV_TAP_COUNT) {").substringBefore("} else {")
        assertTrue("연타 분기가 진단 화면을 열지 않는다", branch.contains("onOpenDiagnostics()"))
        assertTrue("연타 분기가 카운터를 안 되돌린다 — 다음 탭마다 또 열린다", branch.contains("devTaps = 0"))
    }

    @Test
    fun `진단 진입 지점은 한 곳뿐이다`() {
        assertEquals(
            "onOpenDiagnostics() 호출이 한 곳이 아니다 — 우발 진입 경로가 늘었다",
            1,
            Regex("onOpenDiagnostics\\(\\)").findAll(src).count(),
        )
    }

    @Test
    fun `연타 간격 상한이 있다 - 없으면 교대 내내 누른 탭이 쌓여 우발 진입한다`() {
        assertTrue("간격 상한 상수가 없다", src.contains("private const val DEV_TAP_WINDOW_MS = 1_500L"))
        // 창은 타임스탬프가 아니라 효과 자체다 — 탭마다 키가 바뀌어 대기가 다시 걸린다.
        val effect = src.substringAfter("LaunchedEffect(devTaps) {").substringBefore("\n    }")
        assertTrue("대기가 상한을 안 쓴다", effect.contains("delay(DEV_TAP_WINDOW_MS)"))
        assertTrue("대기가 끝나도 카운터가 안 풀린다", effect.contains("devTaps = 0"))
    }

    @Test
    fun `남은 횟수를 5회부터 보여 준다`() {
        assertTrue("표시 시작 지점 상수가 없다", src.contains("private const val DEV_TAP_HINT_FROM = 5"))
        assertTrue("표시 조건이 없다", src.contains("if (devTaps >= DEV_TAP_HINT_FROM)"))
        assertTrue("남은 횟수를 안 센다", src.contains("\${DEV_TAP_COUNT - devTaps}번 남음"))
    }
}
