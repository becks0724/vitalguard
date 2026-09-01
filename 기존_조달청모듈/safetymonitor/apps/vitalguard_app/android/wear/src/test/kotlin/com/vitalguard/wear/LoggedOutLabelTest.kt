// 로그아웃 표기 — 이름 자리·푸터 우선순위·앰비언트에서의 반영을 못 박는다
package com.vitalguard.wear

import com.vitalguard.wear.ui.VitalUiState
import com.vitalguard.wear.ui.uploadStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 자동 로그아웃은 **워치를 벗어둔 사이**에 일어난다 — 그 순간 사람은 화면을 안 본다.
 * 그래서 다시 찼을 때 화면이 스스로 말해야 한다. 종전엔 이름만 사라져 라벨이 "심박수" 로
 * 되돌아갔고, 그것이 평소 화면과 완전히 같아 **수집이 멈춘 줄 모르는** 상태가 됐다(08-31 사용자 지적).
 */
class LoggedOutLabelTest {
    private val screen = uncommented(File("src/main/kotlin/com/vitalguard/wear/ui/VitalScreen.kt").readText())
    private val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())

    @Test
    fun `로그아웃은 이름 자리에 뜨고 색이 평소와 다르다`() {
        val row = screen.substringAfter("private fun StatusRow").substringBefore("private fun ")
        assertTrue("이름 자리가 로그아웃을 말하지 않는다", row.contains("""if (state.loggedOut) "로그아웃""""))
        // 같은 자리에 같은 색으로 글자만 바뀌면 못 알아본다 — 색이 갈려야 한 눈에 읽힌다.
        assertTrue(
            "로그아웃 라벨이 평소와 같은 색이다",
            row.contains("if (state.loggedOut) VgColors.Caution else state.severity.color()"),
        )
    }

    @Test
    fun `푸터는 로그아웃을 착용보다 먼저 본다`() {
        val footer = screen.substringAfter("private fun FooterLine").substringBefore("@Composable")
        val loggedOut = footer.indexOf("state.loggedOut ->")
        val notWorn = footer.indexOf("!state.worn ->")
        assertTrue("푸터에 로그아웃 분기가 없다", loggedOut >= 0)
        assertTrue("푸터에 착용 분기가 사라졌다", notWorn >= 0)
        // 로그아웃 상태에서 "착용하면 시작됩니다" 는 거짓이다 — 차도 자격이 없어 전송이 안 된다.
        assertTrue("착용 안내가 로그아웃보다 먼저 걸린다", loggedOut < notWorn)
    }

    @Test
    fun `화면은 매 틱 prefs 를 다시 읽는다 - 앰비언트에서 onResume 이 안 오므로`() {
        val loop = activity.substringAfter("LaunchedEffect(Unit) {").substringBefore("vitals = VitalUiState(")
        assertTrue("폴링 루프가 세션을 다시 읽지 않는다", loop.contains("cfg.token != null"))
        assertTrue("로그아웃일 때 이름을 안 지운다", loop.contains("workerName = if (live) cfg.workerName else null"))
    }

    @Test
    fun `로그아웃 신호가 화면 상태로 전달된다`() {
        assertTrue("VitalUiState 에 loggedOut 을 안 넘긴다", activity.contains("loggedOut = workerId == null"))
    }

    @Test
    fun `로그아웃이면 전송 자리를 비운다`() {
        // 자격이 없어 못 보내는 중에 "전송 1시간" 이 뜨면 보내고 있는 것으로 읽힌다.
        assertEquals("", uploadStatus(VitalUiState(loggedOut = true, queued = 3, lastUploadAgeSec = 3600)).first)
        // 통제군 — 로그인 상태에서는 종전 문구 그대로다.
        assertEquals("대기 3건", uploadStatus(VitalUiState(queued = 3)).first)
        assertEquals("전송 1h", uploadStatus(VitalUiState(lastUploadAgeSec = 3600)).first)
    }

    @Test
    fun `기본값은 로그인 상태다 - 미리보기와 옛 호출부가 안 깨진다`() {
        assertEquals(false, VitalUiState().loggedOut)
    }
}
