// 착용 표식 단위 시험 — 표식은 worn+ts 두 키뿐이고, 평시 표본은 worn:true 를 싣는다(서버 스키마 `worn` 과 맞물림)
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.SampleBuilder
import com.vitalguard.wear.pipeline.WornMarker
import org.junit.Assert.assertEquals
import org.junit.Test

class WornMarkerTest {
    @Test
    fun `벗음 표식은 worn=false 와 ts 두 키뿐이다`() {
        val m = WornMarker.build(false, 1_700_000_000_000L)
        assertEquals(setOf("worn", "ts"), m.keys)
        assertEquals(false, m["worn"])
        assertEquals("2023-11-14T22:13:20.000Z", m["ts"])
    }

    @Test
    fun `착용 표식은 worn=true`() {
        assertEquals(true, WornMarker.build(true, 0L)["worn"])
    }

    @Test
    fun `평시 표본은 worn=true 를 싣는다`() {
        val b = SampleBuilder()
        b.heartRate(72, 1_700_000_000_000L)
        val v = b.buildAndReset(sentAtMs = 1_700_000_001_000L)!!
        assertEquals(true, v["worn"])
    }

    @Test
    fun `무동작 단독 전송 표본에도 worn=true`() {
        val v = SampleBuilder().buildAndReset(sentAtMs = 5_000, stillSec = 42.0)!!
        assertEquals(true, v["worn"])
    }
}
