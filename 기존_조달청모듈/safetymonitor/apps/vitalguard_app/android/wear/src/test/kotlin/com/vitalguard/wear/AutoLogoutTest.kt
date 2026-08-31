// 자동 로그아웃(미착용 90분) — 문턱·tick 탑승·영속 앵커·화면 반영을 못 박는다
package com.vitalguard.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AutoLogoutTest {
    private val service = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
    private val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())

    @Test
    fun `문턱은 1시간 30분이고 경계를 포함한다`() {
        assertEquals(90 * 60 * 1000L, CollectorService.AUTO_LOGOUT_OFF_BODY_MS)
        val t0 = 1_000_000L
        assertFalse("앵커 0(착용 중)을 만료로 봤다", CollectorService.shouldAutoLogout(0L, t0))
        assertFalse(
            "만료 1ms 전을 만료로 봤다",
            CollectorService.shouldAutoLogout(t0, t0 + CollectorService.AUTO_LOGOUT_OFF_BODY_MS - 1),
        )
        assertTrue(
            "정확히 90분을 만료로 안 봤다",
            CollectorService.shouldAutoLogout(t0, t0 + CollectorService.AUTO_LOGOUT_OFF_BODY_MS),
        )
    }

    @Test
    fun `만료 검사는 tick 에 탄다 - 별도 알람이 아니라`() {
        // tick 은 suspend 에서도 CPU 를 깨우는 실측 보증 경로다. 검사가 여기서 빠지면 규칙이 죽는다.
        val tick = service.substringAfter("private val tick =").substringBefore("private fun scheduleTick")
        assertTrue("tick 이 checkAutoLogout 을 안 부른다", tick.contains("checkAutoLogout("))
    }

    @Test
    fun `벗음은 앵커를 영속하고 재시작이 시계를 되돌리지 않는다`() {
        val cb = service.substringAfter("offBody.start").substringBefore("scheduleTick()")
        assertTrue("벗음 콜백이 앵커를 안 적는다", cb.contains("config.offBodySince = System.currentTimeMillis()"))
        assertTrue("기존 앵커 보존 가드가 없다", cb.contains("if (config.offBodySince == 0L)"))
        assertTrue("착용 콜백이 앵커를 안 지운다", cb.contains("config.offBodySince = 0L"))
    }

    @Test
    fun `서비스 시작이 죽어 있던 사이를 정산한다`() {
        // 재부팅·프로세스 사망 중에 90분이 지났으면 다음 기동 즉시 로그아웃돼야 한다.
        val start = service.substringAfter("override fun onStartCommand").substringBefore("offBody.start")
        assertTrue("onStartCommand 시작 정산이 없다", start.contains("checkAutoLogout("))
    }

    @Test
    fun `만료는 자격을 지운다`() {
        val fn = service.substringAfter("private fun checkAutoLogout").substringBefore("private ")
        assertTrue("clearSession 호출이 없다", fn.contains("config.clearSession()"))
    }

    @Test
    fun `백그라운드 로그아웃이 화면 신원에 반영된다`() {
        val resume = activity.substringAfter("override fun onResume").substringBefore("override fun")
        assertTrue(
            "onResume 가 token 부재를 신원 상태에 반영하지 않는다",
            resume.contains("token == null") && resume.contains("workerId = null"),
        )
    }
}
