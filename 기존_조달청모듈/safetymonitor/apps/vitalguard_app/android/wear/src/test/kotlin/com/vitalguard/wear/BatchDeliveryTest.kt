// 08-24 실측이 강제한 계약 — 배치 전달 구간에서 측정 시각이 도착 시각으로 뭉개지지 않아야 한다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.source.FakeTrackerSource
import com.vitalguard.wear.source.TrackerEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BatchDeliveryTest {

    /**
     * 실측 재현 — 화면 꺼짐 219초 동안 센서 허브가 모았다가 한꺼번에 220건을 준다.
     * 각 표본의 측정 시각(atMs)은 **1초 간격 그대로**이고, 도착만 몰린다.
     */
    private fun burstAfterScreenOff(): List<TrackerEvent> {
        val events = mutableListOf<TrackerEvent>()
        for (sec in 1..60) {                       // 정상 구간
            events += TrackerEvent.Hr(90, listOf(660), listOf(0), sec * 1000L)
        }
        for (sec in 61..280) {                     // 화면 꺼짐 — 측정 시각은 계속 1초 간격
            events += TrackerEvent.Hr(88, listOf(680), listOf(0), sec * 1000L)
        }
        return events
    }

    @Test
    fun `배치가 쏟아져도 측정 시각은 표본별로 보존된다`() {
        val events = burstAfterScreenOff()
        val queue = VitalQueue(MemoryStorage())
        val source = FakeTrackerSource(events)
        val engine = CollectorEngine(source, queue, batteryPct = { 80 })
        engine.start(0)

        // 60초까지는 정상 흐름, 그 뒤 280초 시점에 220건이 한 번에 도착하는 상황을 재현한다.
        source.replayUntil(60_000)
        engine.flush(60_000)
        source.replayUntil(280_000)               // 배치 도착
        engine.flush(280_000)

        val rows = queue.peek(10)
        assertEquals(2, rows.size)
        // 두 번째 항목의 심박 측정 시각은 **마지막 표본의 측정 시각(280초)** 이어야 한다.
        // 도착 시각으로 뭉개면 이 값이 flush 시각과 구분되지 않는다.
        assertEquals(
            com.vitalguard.wear.pipeline.IsoMs.format(280_000),
            rows[1]["heartRateMeasuredAt"],
        )
        // ts(전송 시각)와 측정 시각은 별개 키로 남는다 — 세 시각 구분 계약.
        assertTrue(rows[0].containsKey("heartRateMeasuredAt"))
        assertEquals(com.vitalguard.wear.pipeline.IsoMs.format(60_000), rows[0]["ts"])
    }
}
