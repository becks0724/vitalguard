// 벗은 뒤 HRV 잔여물 가드 — 얼어붙은 IBI 창이 flush 에서 다시 표본이 되는 경로를 엔진 통과로 못 박는다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.QueueStorage
import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.source.FakeTrackerSource
import com.vitalguard.wear.source.TrackerEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 한 문장 보장 = **벗은 뒤에는 tick 이 flush 를 계속 불러도 표본이 한 건도 만들어지지 않는다 — IBI 창이 남아 있어도.**
 *
 * 09-05 실측(EMP-6861 · WATCH.DESIGN 제보) — 18:35:16 worn=false 표식 뒤 18:36:52 / 18:42:56 / 18:48:59 에
 * worn=true 행 3건. 세 행 모두 hrvSdnnMs=237.94 · motionVariabilityMg=146 으로 **값이 같고** 심박은 없다.
 * 기전 = ① tick 은 벗은 뒤에도 flush() 를 부른다 ② IBI 창은 start() 에서만 비워져 벗으면 얼어붙는다
 * ③ stop() 이 lastBpm 을 null 로 만들어 Sdnn.hrConsistent 가 필터를 통째로 건너뛴다(착용 중엔 bpm 106~111 로
 * 같은 창을 거부하고 있었다) ④ flush 가 raw variabilityMg 를 써서 146 이 반복됐다.
 *
 * ★ `WornMarkerTest.버린 뒤에는 표본이 만들어지지 않는다` 가 이것을 못 잡은 이유 — 빌더 단독으로 discard→build 만
 *   봤다. 재주입은 **엔진의 flush 안**에서 일어나므로 시험 경로 밖이었다([[L-123]] 꼴 — 빌더 동작은 못박았지
 *   엔진 배선은 아니었다). 그래서 이 가드는 엔진을 통과한다.
 */
class OffBodyHrvResidueTest {

    private class MemStorage : QueueStorage {
        private var text: String? = null
        override fun save(text: String) { this.text = text }
        override fun load(): String? = text
    }

    /** 75bpm 과 정합하는 IBI(790~810ms) 1초 1건 × 120초 — MIN_SAMPLES(30)를 넉넉히 넘긴다. */
    private fun wornEvents(): List<TrackerEvent> =
        (1..120).map { sec -> TrackerEvent.Hr(75, listOf(790 + (sec % 3) * 10), listOf(0), sec * 1000L) }

    @Test
    fun `벗은 뒤 300초 창이 돌아와도 얼어붙은 IBI 로 표본을 만들지 않는다`() {
        val queue = VitalQueue(MemStorage())
        val source = FakeTrackerSource(wornEvents())
        val engine = CollectorEngine(source, queue, batteryPct = { 80 })
        engine.start(0)
        source.replayUntil(120_000)
        engine.flush(120_000)
        // 양성 통제군 — 창이 실제로 채워져 HRV 가 계산됐음을 먼저 본다. 이것이 없으면 아래 "0건" 은
        // "재주입이 안 됐다" 가 아니라 "애초에 아무것도 안 들어왔다" 여도 초록이다(L-108 — 부정 통제군은 통제군이 아니다).
        val worn = queue.peek(10)
        assertEquals("착용 중 첫 flush 가 표본 1건을 만들어야 한다", 1, worn.size)
        assertTrue("착용 중 표본에 HRV 가 없다 — 창이 안 채워져 이 시험이 아무것도 재지 않는다", (worn[0] as Map<*, *>).containsKey("hrvSdnnMs"))

        // 벗음 — CollectorService.endSensing() 과 같은 순서(stop → discard).
        engine.stop()
        engine.discardPendingSample()

        // tick 은 계속 돈다. 300s 게이트 안(240s)과 밖(480s · 실측의 세 번째 tick 자리) 모두.
        assertFalse("게이트 안인데 표본이 생겼다", engine.flush(240_000))
        assertFalse("300초 창이 돌아오자 얼어붙은 IBI 창이 표본이 됐다 — 09-05 18:48:59 행 그대로", engine.flush(480_000))
        assertFalse(engine.flush(840_000))
        assertEquals("벗은 뒤 행이 늘었다", 1, queue.peek(10).size)
    }

    @Test
    fun `벗음 경로가 IBI 창을 비운다 - stop 이 아니라 discard 자리`() {
        // 구조 — stop() 은 워치독 재구독(stop→start)도 부르므로 거기 두면 착용 중 정상 창을 버린다(56592f5 와 같은 이유).
        val src = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText())
        val discard = src.substringAfter("fun discardPendingSample()").substringBefore("\n    }")
        assertTrue("discardPendingSample 이 ibiWindow 를 비우지 않는다", discard.contains("ibiWindow.clear()"))
        assertTrue("discardPendingSample 이 ibiStatusWindow 를 비우지 않는다 — 인덱스 정합이 깨진다", discard.contains("ibiStatusWindow.clear()"))
        val stop = src.substringAfter("fun stop()").substringBefore("\n    }")
        assertFalse("stop() 이 IBI 창을 비운다 — 워치독 재구독마다 정상 창을 버리게 된다", stop.contains("ibiWindow.clear()"))
    }

    @Test
    fun `flush 는 게이트판 변동폭을 쓴다 - raw 는 벗어도 값을 낸다`() {
        val src = uncommented(File("src/main/kotlin/com/vitalguard/wear/CollectorEngine.kt").readText())
        val flush = src.substringAfter("fun flush(nowMs: Long)").substringBefore("Stress.compute(")
        assertTrue("flush 가 motionVarNow() 를 쓰지 않는다", flush.contains("variabilityMg = motionVarNow()"))
        assertFalse("flush 가 raw motion.variabilityMg() 를 쓴다 — 벗은 뒤 146 이 반복된다", flush.contains("motion.variabilityMg()"))
    }
}
