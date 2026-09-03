// 미착용 배터리 표본 가드 — 충전 구간이 관제에 남는 유일한 경로가 조용히 끊기지 않는가
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.WornMarker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **벗어서 충전하는 동안에도 배터리가 서버에 남는다.**
 *
 * 왜 필요한가(09-03 실측). 벗으면 `endSensing` 이 엔진을 세우고 빌더를 비워 `buildAndReset` 이
 * null 을 낸다 — 앱과 tick 은 멀쩡히 도는데 **행이 아예 안 생긴다.** 그런데 충전은 거의 항상
 * 벗은 상태에서 일어난다. 그날 워치는 `status:2`(무선 독 · +288mA · 80→93%)를 알고 있었는데
 * **서버에는 9분간 표본 0건**이었다. 관제 배터리 차트의 충전 음영이 데이터를 받을 수 없었다.
 *
 * ★ 이 경로가 없으면 음영 기능은 **영영 발현하지 않는 죽은 코드**가 된다.
 */
class IdleBatteryTest {
    private val service = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
    )

    @Test
    fun `worn false 를 함께 실어 서버 게이트를 통과한다`() {
        // ★ 이 한 줄이 "서버를 안 고쳐도 되는" 근거다 — hasMonitorableSignal 의
        //   `typeof s.worn === "boolean"` 이 이 행을 통과시킨다. 그리고 사실이기도 하다
        //   (이 표본은 미착용 중에만 만들어진다).
        val v = WornMarker.idleBattery(1_000L, pct = 93, chargeUah = 430_000L, status = 2)!!
        assertEquals(false, v["worn"])
        assertEquals(93, v["batteryPct"])
        assertEquals(430_000L, v["batteryChargeUah"])
        assertEquals(2, v["batteryStatus"])
        assertTrue("ts 가 없다 — 서버가 시각 없는 행을 거부한다", v.containsKey("ts"))
    }

    @Test
    fun `키 이름이 평시 표본과 같다`() {
        // 다르면 Zod 가 무음 strip 하고, 차트는 "충전 안 했네" 로 그린다.
        val v = WornMarker.idleBattery(1_000L, 93, 430_000L, 2)!!
        val builder = SampleBuilderKeys.of()
        listOf("batteryPct", "batteryChargeUah", "batteryStatus").forEach {
            assertTrue("$it 키가 평시 표본에 없다", builder.contains(it))
            assertTrue("$it 키가 미착용 표본에 없다", v.containsKey(it))
        }
    }

    @Test
    fun `잔량을 못 읽으면 행을 만들지 않는다`() {
        // 할 말이 없는 행은 안 만든다 — 그러면 DB 가 진짜 배터리 로그가 된다.
        assertNull(WornMarker.idleBattery(1_000L, pct = null, chargeUah = 430_000L, status = 2))
    }

    @Test
    fun `못 읽은 값은 키를 만들지 않는다`() {
        val v = WornMarker.idleBattery(1_000L, pct = 93, chargeUah = null, status = null)!!
        assertFalse("못 읽은 µAh 를 키로 만들었다", v.containsKey("batteryChargeUah"))
        assertFalse("못 읽은 상태를 키로 만들었다", v.containsKey("batteryStatus"))
        assertEquals(93, v["batteryPct"])
    }

    @Test
    fun `첫 회는 즉시 · 그 뒤는 10분마다`() {
        assertTrue("첫 회를 미뤘다", CollectorService.shouldPostIdleBattery(0L, 5_000L))
        assertFalse("10분 전에 또 보냈다", CollectorService.shouldPostIdleBattery(1_000L, 1_000L + 599_999L))
        assertTrue("10분이 지났는데 안 보냈다", CollectorService.shouldPostIdleBattery(1_000L, 1_000L + 600_000L))
        assertEquals(600_000L, CollectorService.IDLE_BATTERY_INTERVAL_MS)
    }

    @Test
    fun `★ 세 관문이 다 있다 - 미착용·자격·주기`() {
        val fn = service.substringAfter("private fun postIdleBatteryIfDue").substringBefore("private fun postWornMarker")
        assertTrue(
            "착용 중에도 보낸다 — 평시 표본이 이미 배터리를 싣는데 행이 두 벌이 된다",
            fn.contains("if (sensing) return"),
        )
        assertTrue(
            "자격 없이도 보낸다 — 자동 로그아웃 뒤에도 계속 쌓여 행 수 상한이 사라진다",
            fn.contains("if (config.token == null) return"),
        )
        assertTrue("주기 게이트가 없다", fn.contains("shouldPostIdleBattery(lastIdleBatteryMs, now)"))
    }

    @Test
    fun `tick 이 이 경로를 부른다`() {
        val tick = service.substringAfter("private val tick =").substringBefore("private fun uploadOnce")
        assertTrue("tick 이 미착용 배터리 표본을 안 부른다", tick.contains("postIdleBatteryIfDue(now)"))
    }

    @Test
    fun `★ 자동 로그아웃이 행 수 상한을 씌운다 - tick 순서가 근거다`() {
        // 상한 계산 = 미착용 90분 ÷ 10분 = 9행. 이것이 성립하려면 **checkAutoLogout 이 먼저** 돌아야
        // 한다 — 90분째 tick 에서 자격이 먼저 지워져야 그 회차가 안 나간다. 순서가 뒤집히면 한 행이
        // 더 나가고, 더 중요하게는 "자격 없는 전송" 이 한 번 생긴다.
        val tick = service.substringAfter("private val tick =").substringBefore("private fun uploadOnce")
        val logout = tick.indexOf("checkAutoLogout(now)")
        val idle = tick.indexOf("postIdleBatteryIfDue(now)")
        assertTrue("checkAutoLogout 이 tick 에 없다", logout >= 0)
        assertTrue("postIdleBatteryIfDue 가 tick 에 없다", idle >= 0)
        assertTrue("자동 로그아웃이 미착용 배터리 표본보다 뒤에 있다 — 상한 근거가 깨진다", logout < idle)
    }
}

/** 평시 표본이 싣는 배터리 키 — 소스에서 뽑는다(손으로 적으면 두 벌이 된다). */
private object SampleBuilderKeys {
    fun of(): String = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/pipeline/SampleBuilder.kt").readText(),
    )
}
