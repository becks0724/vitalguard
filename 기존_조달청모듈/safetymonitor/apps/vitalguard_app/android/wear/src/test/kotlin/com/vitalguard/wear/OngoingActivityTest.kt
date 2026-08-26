// 진행중활동 가드 — 이게 빠지면 앱이 약 3분 뒤 시계 화면으로 내려간다(08-26 실측)
package com.vitalguard.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **수집 중에는 앱이 화면에 남는다.**
 *
 * 실측 근거(08-26 · 착용 + 충전기 밖 · 15초 간격 20회 관찰).
 *   앰비언트만  = t=180s 무렵 시계 화면으로 복귀(앰비언트 진입 11:16:10 → 해제 11:17:09 → 시계)
 *   진행중활동 = t=285s 까지 20/20 표본 전부 앱 유지(mWakefulness=Dozing)
 * 즉 앰비언트는 "화면을 어둡게 유지" 까지만 하고, "시계로 안 내려가기" 는 이쪽이 한다. 둘 다 필요하다.
 */
class OngoingActivityTest {
    private val service = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
    )
    private val gradle = File("build.gradle.kts").readText()

    @Test
    fun `진행중활동을 실제로 등록한다`() {
        assertTrue("wear-ongoing 의존이 없다", gradle.contains("androidx.wear:wear-ongoing"))
        assertTrue("OngoingActivity 를 만들지 않는다", service.contains("OngoingActivity.Builder("))
        // ★ build() 만 하고 apply() 를 안 부르면 **아무 일도 안 일어난다**(예외도 로그도 없다).
        assertTrue("apply(this) 가 없다 — 만들기만 하고 등록을 안 한다", service.contains(".apply(this)"))
    }

    @Test
    fun `알림 id 를 두 곳에 따로 적지 않는다`() {
        // 어긋나면 진행중활동이 어느 알림에도 안 붙고 조용히 효과가 사라진다.
        assertTrue("id 상수가 없다", service.contains("private const val FGS_NOTIFICATION_ID"))
        assertTrue(
            "OngoingActivity 가 상수를 안 쓴다",
            service.contains("OngoingActivity.Builder(this, FGS_NOTIFICATION_ID, builder)"),
        )
        val fg = service.substringAfter("startForeground(").substringBefore(")")
        assertTrue("startForeground 가 상수를 안 쓴다", fg.contains("FGS_NOTIFICATION_ID"))
    }

    @Test
    fun `진행중활동이 NotificationCompat 위에 올라간다`() {
        // OngoingActivity.Builder 는 플랫폼 Notification.Builder 를 못 받는다(바이트코드 확인).
        assertTrue(
            "NotificationCompat.Builder 를 안 쓴다 — OngoingActivity 가 붙을 수 없다",
            service.contains("androidx.core.app.NotificationCompat.Builder(this, CH)"),
        )
        assertFalse(
            "포그라운드 알림이 플랫폼 Builder 로 되돌아갔다",
            service.contains("Notification.Builder(this, CH)"),
        )
    }

    @Test
    fun `탭하면 우리 화면으로 돌아온다`() {
        assertTrue("터치 인텐트가 없다 — 진행중활동을 눌러도 앱이 안 열린다", service.contains("setTouchIntent("))
        assertTrue("터치 인텐트가 MainActivity 를 안 가리킨다", service.contains("Intent(this, MainActivity::class.java)"))
        // PendingIntent 는 API 31+ 에서 가변/불변을 명시해야 한다 — 없으면 런타임에 던진다.
        assertTrue("PendingIntent 가변성 플래그가 없다", service.contains("FLAG_IMMUTABLE"))
    }

    @Test
    fun `앰비언트와 함께 쓴다 - 둘은 서로를 대체하지 않는다`() {
        // 앰비언트 = 화면을 어둡게 유지. 진행중활동 = 시계로 안 내려가기. 하나만으로는 부족하다.
        val activity = uncommented(File("src/main/kotlin/com/vitalguard/wear/MainActivity.kt").readText())
        assertTrue("앰비언트 관찰자가 사라졌다", activity.contains("lifecycle.addObserver(ambientObserver)"))
        assertFalse(
            "화면 유지 플래그가 앰비언트 진입을 막는다",
            activity.contains("addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)"),
        )
    }

    @Test
    fun `수집 서비스 자체는 그대로다`() {
        // 화면 문제를 고치면서 수집 경로를 건드리면 안 된다 — 데이터가 더 중요하다.
        assertTrue("포그라운드 승격이 사라졌다", service.contains("startForeground("))
        assertTrue("health 타입이 빠졌다", service.contains("FOREGROUND_SERVICE_TYPE_HEALTH"))
        assertTrue("location 타입이 빠졌다", service.contains("FOREGROUND_SERVICE_TYPE_LOCATION"))
        assertEquals(
            "착용 감지가 수집을 켜고 끄는 구조가 깨졌다",
            true,
            service.contains("offBody.start {"),
        )
    }
}
