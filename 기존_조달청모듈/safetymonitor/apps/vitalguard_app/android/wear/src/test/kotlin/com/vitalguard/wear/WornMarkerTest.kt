// 착용 표식 단위 시험 — 표식은 worn+ts 두 키뿐이고, 평시 표본은 worn:true 를 싣는다(서버 스키마 `worn` 과 맞물림)
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.SampleBuilder
import com.vitalguard.wear.pipeline.WornMarker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

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
    fun `표식 즉시 업로드 — 첫 전이는 즉시, 30초 내 재전이(플래핑)는 큐에만, 30초 뒤엔 다시 즉시`() {
        assertTrue(CollectorService.shouldUploadMarkerNow(0L, 1_000L))
        assertFalse(CollectorService.shouldUploadMarkerNow(1_000L, 6_300L))   // 08-31 워치8 실측: 5.3초에 3전이
        assertTrue(CollectorService.shouldUploadMarkerNow(1_000L, 31_000L))
    }

    @Test
    fun `무동작 단독 전송 표본에도 worn=true`() {
        val v = SampleBuilder().buildAndReset(sentAtMs = 5_000, stillSec = 42.0)!!
        assertEquals(true, v["worn"])
    }

    // ── 09-02 실사고 — 벗음 표식이 5.22초 만에 되돌아갔다 ───────────────────────────
    // 표식 17:02:56.325(worn=false) → 잔여물 17:03:01.702(worn=true·hr76·spo2 96)로 덮임.
    // 센서는 17:02:56.284 에 이미 끊겼다 = 새 측정이 아니라 **빌더에 남아 있던 값**이었다.

    @Test
    fun `버린 뒤에는 표본이 만들어지지 않는다`() {
        val b = SampleBuilder()
        b.heartRate(76, 1_000L)
        b.spo2(96, 1_000L)
        b.addSteps(30)
        b.addEnergyKcal(1.5)
        b.discard()
        // 벗은 뒤 틱이 flush 를 계속 부르지만, 실을 것이 없어야 행이 안 생긴다.
        assertNull("잔여물로 표본이 만들어졌다 — 벗음 표식이 되돌아간다", b.buildAndReset(sentAtMs = 2_000L))
    }

    @Test
    fun `벗음 경로가 표식을 올리기 전에 잔여물을 버린다`() {
        val svc = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
        val end = svc.substringAfter("private fun endSensing()").substringBefore("\n    }")
        assertTrue("벗음 경로가 잔여물을 안 버린다", end.contains("engine.discardPendingSample()"))
        assertTrue(
            "버리는 것이 벗음 표식보다 뒤에 있다 — 표식 뒤 틱이 잔여물을 실어 되돌린다",
            end.indexOf("engine.discardPendingSample()") < end.indexOf("postWornMarker(false)"),
        )
    }

    @Test
    fun `중지 자체는 잔여물을 안 버린다 - 심박 재구독이 정상 값을 잃지 않도록`() {
        // ⚠ `reviveHrIfStalled` 는 **착용 중에** `engine.stop() → engine.start()` 로 재구독한다.
        //   버리는 것을 stop() 안에 넣으면 재구독마다 SpO₂·피부온·걸음 누적이 통째로 사라진다.
        val eng = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText())
        val stop = eng.substringAfter("fun stop()").substringBefore("\n    }")
        assertFalse("stop() 이 빌더를 비운다 — 심박 재구독마다 정상 측정값을 버리게 된다", stop.contains("builder.discard"))

        val svc = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorService.kt").readText())
        val revive = svc.substringAfter("private fun reviveHrIfStalled").substringBefore("\n    }")
        assertTrue("재구독 경로가 바뀌었다 — 이 시험의 전제를 다시 봐야 한다", revive.contains("engine.stop()"))
        assertFalse("재구독이 잔여물을 버린다", revive.contains("discardPendingSample"))
    }
}
