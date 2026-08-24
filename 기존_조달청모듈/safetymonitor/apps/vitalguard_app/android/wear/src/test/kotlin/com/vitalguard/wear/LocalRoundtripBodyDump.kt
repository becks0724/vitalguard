// 로컬 실서버 왕복용 body 산출 — 종단 리플레이와 같은 60초 근무를 UploadPipeline 이 직렬화한 그대로 파일로 남긴다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.UploadConfig
import com.vitalguard.wear.pipeline.UploadPipeline
import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.pipeline.VitalTransport
import com.vitalguard.wear.source.FakeTrackerSource
import com.vitalguard.wear.source.TrackerEvent
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class LocalRoundtripBodyDump {

    @Test
    fun `왕복 body 를 남긴다 - 검증 절차는 checklist 1_5단계 A 항목`() {
        val events = mutableListOf<TrackerEvent>()
        for (sec in 1..60) {
            val t = sec * 1000L
            events += TrackerEvent.Hr(70 + sec % 5, listOf(800 + sec % 20), listOf(0), t)
            events += TrackerEvent.Accel(if (sec <= 15) 0.10 else 0.005, t)
        }
        events += TrackerEvent.Spo2(97, 30_000)
        events.sortBy { it.atMs }

        val queue = VitalQueue(MemoryStorage())
        val engine = CollectorEngine(FakeTrackerSource(events).also { src ->
            engineSource = src
        }, queue, batteryPct = { 85 })
        engine.start(0)
        for (t in 5_000L..60_000L step 5_000L) {
            engineSource.replayUntil(t)
            engine.flush(t)
        }

        var captured: String? = null
        UploadPipeline(queue, VitalTransport { _, body -> captured = body; 200 })
            .flushOnce(UploadConfig("dummy", "WEAR-LOCALTEST", "워치시험"))
        assertEquals(12, JSONArray(captured!!).length())

        val out = File(System.getProperty("java.io.tmpdir"), "vg-roundtrip-body.json")
        out.writeText(captured!!)
        println("왕복 body: ${out.absolutePath}")
    }

    private lateinit var engineSource: FakeTrackerSource
}
