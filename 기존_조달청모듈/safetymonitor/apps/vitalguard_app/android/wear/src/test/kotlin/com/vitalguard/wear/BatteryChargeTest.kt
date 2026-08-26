// 배터리 충전카운터 가드 — 워치가 읽어 실었는가, 그리고 키 이름이 서버 스키마와 같은가
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.SampleBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **충전카운터(µAh)가 배터리%와 같은 규칙으로 실려 나간다.**
 *
 * 왜 필요한가 — 퍼센트는 정수라 1% 계단(445mAh 기준 4,450µAh) 아래를 못 본다. 6.6%/h 로
 * 떨어져도 한 계단에 9분이라 짧은 구간의 소모율을 아예 못 잰다. µAh 는 해상도가 약 100배라
 * 표본 두 개의 차이가 곧 소모량이다(08-26 실측 = 100초에 4,680µAh → 168mAh/h).
 */
class BatteryChargeTest {
    private val service = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText(),
    )
    private val engine = uncommented(
        File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText(),
    )

    /** 서버 Zod 스키마의 필드명과 **글자 그대로** 같아야 한다 — 다르면 Zod 가 무음 strip 한다. */
    private val WIRE_KEY = "batteryChargeUah"

    @Test
    fun `측정값이 있으면 충전카운터를 함께 싣는다`() {
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, batteryChargeUah = 388_908L)!!
        assertEquals(388_908L, v[WIRE_KEY])
        assertEquals(84, v["batteryPct"])
    }

    @Test
    fun `무동작 단독 전송에서도 함께 싣는다`() {
        // 벗어둔 것인지 쓰러진 것인지를 가르는 구간에서도 배터리 추이는 끊기면 안 된다.
        val v = SampleBuilder().buildAndReset(
            sentAtMs = 2_000L, stillSec = 300.0, batteryPct = 84, batteryChargeUah = 388_908L,
        )!!
        assertEquals(388_908L, v[WIRE_KEY])
    }

    @Test
    fun `못 읽으면 아예 안 싣는다`() {
        // null 을 0 으로 바꿔 실으면 "다 썼다" 로 읽힌다. 없는 것은 없는 채로 둔다.
        val b = SampleBuilder()
        b.heartRate(96, 1_000L)
        val v = b.buildAndReset(sentAtMs = 2_000L, batteryPct = 84, batteryChargeUah = null)!!
        assertFalse("못 읽은 값을 키로 만들었다", v.containsKey(WIRE_KEY))
    }

    @Test
    fun `실을 것이 없으면 배터리만으로 행을 만들지 않는다`() {
        // 배터리는 부가 정보다. 이것 때문에 빈 행이 늘면 DB 가 배터리 로그가 된다.
        assertNull(SampleBuilder().buildAndReset(sentAtMs = 2_000L, batteryChargeUah = 388_908L))
    }

    @Test
    fun `기기가 못 읽을 때의 표식을 걸러낸다`() {
        // BatteryManager 는 못 읽으면 0 또는 Int.MIN_VALUE 를 준다. 그대로 실으면 안 된다.
        assertTrue(
            "0 이하를 걸러내지 않는다 — 0µAh 가 '잔량 없음' 으로 저장된다",
            service.contains("takeIf { it > 0L }"),
        )
    }

    @Test
    fun `충전카운터를 실제로 읽는다`() {
        assertTrue(
            "CHARGE_COUNTER 를 안 읽는다",
            service.contains("BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER"),
        )
        // getIntProperty 로 읽으면 µAh 가 잘린다(µAh 는 수십만~수천만). Long 이어야 한다.
        assertTrue("getLongProperty 가 아니다", service.contains("getLongProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER)"))
        assertTrue("엔진에 전달되지 않는다", engine.contains("batteryChargeUah = batteryChargeUah()"))
    }
}
