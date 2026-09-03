// 배터리 충전상태 가드 — 워치가 읽어 실었는가, 그리고 **원시 정수를 접지 않았는가**
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.SampleBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **충전 상태가 원시 정수 그대로 실려 나간다.**
 *
 * 왜 필요한가(09-03). 관제는 배터리 그래프에 "충전기에 올려둔 구간" 을 음영으로 그린다.
 * 그 구간을 가르는 유일한 신호가 이 값인데, 워치는 종전에 잔량 두 종(%·µAh)만 읽었다 —
 * 서버는 µAh 가 오르는 것을 보고 **사후에 역산**할 수밖에 없었고, 표본 두 개(4분)가 모여야
 * 알 수 있어 실시간 화면에서는 못 썼다.
 *
 * ★ 왜 불리언이 아니라 정수인가. 이 워치는 배터리 보호 모드 상한이 90% 다
 *   (09-03 실측 `dumpsys battery` = `mMaximumProtectionThreshold: 90`). 그래서 **독 위에서
 *   4(미충전)로 앉는다.** `charging=true/false` 로 접으면 그 구간이 통째로 사라진다.
 *   정수를 그대로 올리면 해석이 바뀌어도 서버만 고치면 된다 — 워치는 재설치가 비싸다.
 */
class BatteryStatusTest {
    private val service = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
    )
    private val engine = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText(),
    )

    /** 서버 Zod 스키마의 필드명과 **글자 그대로** 같아야 한다 — 다르면 Zod 가 무음 strip 한다. */
    private val WIRE_KEY = "batteryStatus"

    @Test
    fun `측정값이 있으면 충전상태를 함께 싣는다`() {
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, batteryStatus = 3)!!
        assertEquals(3, v[WIRE_KEY])
    }

    @Test
    fun `무동작 단독 전송에서도 함께 싣는다`() {
        // 벗어둔 구간이야말로 충전 여부가 궁금한 자리다 — 여기서 끊기면 음영이 그 구간에만 빈다.
        val v = SampleBuilder().buildAndReset(
            sentAtMs = 2_000L, stillSec = 300.0, batteryPct = 84, batteryStatus = 2,
        )!!
        assertEquals(2, v[WIRE_KEY])
    }

    @Test
    fun `못 읽으면 아예 안 싣는다`() {
        // 못 읽은 것을 3(방전)으로 채우면 "충전 안 하고 있다" 는 **거짓**이 그려진다.
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, batteryStatus = null)!!
        assertFalse("못 읽은 값을 키로 만들었다", v.containsKey(WIRE_KEY))
    }

    @Test
    fun `실을 것이 없으면 충전상태만으로 행을 만들지 않는다`() {
        assertNull(SampleBuilder().buildAndReset(sentAtMs = 2_000L, batteryStatus = 2))
    }

    @Test
    fun `원시 정수를 접지 않는다 - 독 위 4가 살아 있어야 한다`() {
        // ★ 이 가드의 핵심. 불리언으로 접으면 배터리 보호 모드(90% 상한) 때문에 독 위에서
        //   나오는 4(미충전)가 "충전 아님" 으로 뭉개져 음영이 그 구간에서 끊긴다.
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        listOf(1, 2, 3, 4, 5).forEach { st ->
            val v = b.also { it.heartRate(96, 1_000L) }.buildAndReset(sentAtMs = 2_000L, batteryStatus = st)!!
            assertEquals("상태 $st 가 원시값으로 안 실렸다 — 접혔거나 매핑됐다", st, v[WIRE_KEY])
        }
    }

    @Test
    fun `기기가 못 읽을 때의 표식을 걸러낸다`() {
        // BatteryManager 는 못 읽으면 0 또는 Int.MIN_VALUE 를 준다. 유효 범위는 1..5 뿐이다.
        assertTrue(
            "범위 밖 값을 걸러내지 않는다 — 0 이나 Int.MIN_VALUE 가 상태로 저장된다",
            service.contains("takeIf { it in 1..5 }"),
        )
    }

    @Test
    fun `충전상태를 실제로 읽고 엔진에 전달한다`() {
        assertTrue(
            "BATTERY_PROPERTY_STATUS 를 안 읽는다",
            service.contains("BatteryManager.BATTERY_PROPERTY_STATUS"),
        )
        assertTrue("엔진에 전달되지 않는다", engine.contains("batteryStatus = batteryStatus()"))
    }
}
