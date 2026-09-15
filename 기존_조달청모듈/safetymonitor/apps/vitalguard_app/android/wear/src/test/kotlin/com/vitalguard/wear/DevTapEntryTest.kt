// 09-15 개발자(진단) 화면 진입 계약 — 설정 톱니바퀴 10회 연타 한 곳뿐이고 요약 화면에는 없다
package com.vitalguard.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DevTapEntryTest {

    private val settings = File("src/main/kotlin/com/vitalguard/wear/ui/SettingsPage.kt").readText()
    private val vital = File("src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt").readText()
    private val login = File("src/main/kotlin/com/vitalguard/wear/ui/LoginScreen.kt").readText()
    private val main = File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText()

    /**
     * 통제군 — 아래 가드 여럿이 "없음" 을 주장한다. 파일을 못 읽거나 비어 있으면 그 주장이
     * 공짜로 통과한다. 네 파일 모두 읽기가 살아 있는지부터 못박는다.
     */
    @Test
    fun `통제군 - 읽은 네 파일이 실제로 그 화면들이다`() {
        assertTrue("SettingsPage 를 못 읽었다", settings.contains("fun SettingsPage(") && settings.contains("fun GearIcon("))
        assertTrue("VitalScreen 을 못 읽었다", vital.contains("fun VitalScreen(") && vital.contains("detectTapGestures("))
        assertTrue("LoginScreen 을 못 읽었다", login.contains("fun LoginPage("))
        assertTrue("MainActivity 를 못 읽었다", main.contains("VerticalPager(state = pagerState)"))
    }

    @Test
    fun `요약 화면에는 진단 진입이 없다 - 길게 누르기도 연타도`() {
        assertFalse("요약에 길게 누르기가 남아 있다", vital.contains("onLongPress"))
        assertFalse("요약에 진단 진입이 남아 있다", vital.contains("onOpenDiagnostics"))
        assertFalse("요약에 연타 카운터가 남아 있다", vital.contains("devTaps"))
    }

    @Test
    fun `톱니 연타 10회가 진단 화면을 연다`() {
        assertTrue("연타 수 상수가 10 이 아니다", settings.contains("private const val DEV_TAP_COUNT = 10"))
        // 여는 호출이 연타 분기 안에 있어야 한다 — 상수만 맞고 배선이 빠지면 영영 안 열린다.
        val branch = settings.substringAfter("if (n >= DEV_TAP_COUNT) {").substringBefore("} else {")
        assertTrue("연타 분기가 진단 화면을 열지 않는다", branch.contains("onOpenDiagnostics()"))
        assertTrue("연타 분기가 카운터를 안 되돌린다 — 다음 탭마다 또 열린다", branch.contains("devTaps = 0"))
    }

    @Test
    fun `세는 자리가 톱니다 - 화면 아무 곳이 아니다`() {
        // 탭 처리기와 톱니 그리기가 같은 블록 안에 있어야 "톱니를 눌렀다" 가 된다.
        val target = settings.substringAfter(".width(GEAR_TAP_WIDTH)").substringBefore("if (loggedIn)")
        assertTrue("표적 안에 탭 처리기가 없다", target.contains("detectTapGestures("))
        assertTrue("표적 안에 톱니가 없다", target.contains("GearIcon("))
    }

    @Test
    fun `진단 진입 지점은 앱 전체에서 한 곳뿐이다`() {
        val calls = listOf(settings, vital, login, main).sumOf { Regex("onOpenDiagnostics\\(\\)").findAll(it).count() }
        assertEquals("onOpenDiagnostics() 호출이 한 곳이 아니다 — 우발 진입 경로가 늘었다", 1, calls)
        // 배선이 톱니까지 실제로 이어져 있나 — 한 칸이라도 끊기면 영영 안 열린다.
        assertTrue("MainActivity 가 0번 면에 진단을 안 넘긴다", main.contains("onOpenDiagnostics = { showDiagnostics = true }"))
        assertTrue("LoginPage 가 톱니로 안 넘긴다", login.contains("onOpenDiagnostics = onOpenDiagnostics"))
    }

    @Test
    fun `연타 간격 상한이 있다 - 없으면 며칠에 걸친 탭이 쌓여 우발 진입한다`() {
        assertTrue("간격 상한 상수가 없다", settings.contains("private const val DEV_TAP_WINDOW_MS = 1_500L"))
        // 창은 타임스탬프가 아니라 효과 자체다 — 탭마다 키가 바뀌어 대기가 다시 걸린다.
        val effect = settings.substringAfter("LaunchedEffect(devTaps) {").substringBefore("\n    }")
        assertTrue("대기가 상한을 안 쓴다", effect.contains("delay(DEV_TAP_WINDOW_MS)"))
        assertTrue("대기가 끝나도 카운터가 안 풀린다", effect.contains("devTaps = 0"))
    }

    @Test
    fun `남은 횟수를 5회부터 라벨 자리에 보여 준다`() {
        assertTrue("표시 시작 지점 상수가 없다", settings.contains("private const val DEV_TAP_HINT_FROM = 5"))
        assertTrue("표시 조건이 없다", settings.contains("devTaps >= DEV_TAP_HINT_FROM"))
        assertTrue("남은 횟수를 안 센다", settings.contains("\${DEV_TAP_COUNT - devTaps}번 남음"))
        // 세지 않을 때는 원래 라벨로 돌아와야 한다 — 안 그러면 "설정" 이 영영 사라진다.
        assertTrue("평소 라벨이 사라졌다", settings.contains("else \"설정\""))
    }
}
