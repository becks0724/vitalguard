// C 검증 — 페이크 리플레이 종단: 소스 → 파생 → 병합 → 큐 → (MockWebServer 실HTTP) 업로드
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.FlushOutcome
import com.vitalguard.wear.pipeline.HttpTransport
import com.vitalguard.wear.pipeline.UploadConfig
import com.vitalguard.wear.pipeline.UploadPipeline
import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.source.FakeTrackerSource
import com.vitalguard.wear.source.TrackerEvent
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EndToEndReplayTest {

    /** 60초 근무 재현 — 1Hz 심박(IBI 동반)·1Hz 가속도·30초 지점 SpO₂ 1건. */
    private fun sixtySecondsOfWork(): List<TrackerEvent> {
        val events = mutableListOf<TrackerEvent>()
        for (sec in 1..60) {
            val t = sec * 1000L
            events += TrackerEvent.Hr(bpm = 70 + sec % 5, ibiMs = listOf(800 + sec % 20), ibiStatus = listOf(0), atMs = t)
            // 15초까지 활동(임계 이상), 이후 정지 — 무동작 지속이 45초로 끝나야 한다.
            events += TrackerEvent.Accel(magG = if (sec <= 15) 0.10 else 0.005, atMs = t)
        }
        events += TrackerEvent.Spo2(pct = 97, atMs = 30_000)
        events.sortBy { it.atMs }
        return events
    }

    @Test
    fun `리플레이 - 5초 flush 12회가 병합 항목 12건을 만들고 실HTTP 로 올라간다`() {
        val source = FakeTrackerSource(sixtySecondsOfWork())
        val queue = VitalQueue(MemoryStorage())
        val engine = CollectorEngine(source, queue, batteryPct = { 85 })

        engine.start(nowMs = 0)
        var flushed = 0
        for (t in 5_000L..60_000L step 5_000L) {
            source.replayUntil(t)
            if (engine.flush(t)) flushed++
        }
        assertEquals(12, flushed)
        assertEquals(12, queue.size)

        // ── 계약 검사 — 서버 UNIQUE(worker_id, ts) 아래에서 유실 0이어야 한다 ──
        val rows = queue.peek(12)
        assertEquals("ts 중복은 곧 조용한 유실", 12, rows.map { it["ts"] }.toSet().size)
        val spo2Rows = rows.filter { it.containsKey("spo2") }
        assertEquals("SpO₂ 는 측정 1건 = 전송 1회(복사 금지)", 1, spo2Rows.size)
        assertEquals(IsoMs30s(), spo2Rows[0]["spo2MeasuredAt"])
        // 정지 후 마지막 flush(60초) — 무동작 지속 = 60 - 15 = 45초.
        assertEquals(45.0, rows.last()["motionStillSec"])
        // 창(60개)이 차기 전인 첫 flush 에는 변동폭 키 자체가 없다(0 금지).
        assertFalse(rows.first().containsKey("motionVariabilityMg"))
        assertTrue(rows.last().containsKey("motionVariabilityMg"))

        // ── 실HTTP 업로드 — HttpURLConnection 이 실제 소켓으로 나간다 ──
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(200))
            val pipeline = UploadPipeline(queue, HttpTransport(server.url("/").toString()))
            val outcome = pipeline.flushOnce(UploadConfig("jwt-token", "EMP-6861", "홍길동"))
            assertEquals(FlushOutcome.Sent(12, 0), outcome)

            val req = server.takeRequest()
            assertEquals("/api/app/vital", req.path)
            assertEquals("Bearer jwt-token", req.getHeader("Authorization"))
            assertEquals("application/json", req.getHeader("Content-Type"))
            val body = JSONArray(req.body.readUtf8())
            assertEquals(12, body.length())
            assertEquals("EMP-6861", body.getJSONObject(0).getString("workerId"))
            // 갤럭시 전용 출처 — 서버가 이 값으로 wearos 를 확정한다(애플과 분리 · 2026-08-25).
            // ⚠ 문자열을 여기 손으로 적지 않는다 — 이 시험이 검증할 것은 **전송 시점에 스탬프되는가**
            //   이지 특정 값이 아니다. 값의 정합(서버 화이트리스트·스키마 열거형·적재 관문)은
            //   dashboard-web 의 교차언어 가드가 UploadPipeline.kt 를 직접 읽어 대조한다
            //   (2026-08-25-watch-source-origin.guard.test.ts · 4건). 두 곳에 적으면 갈린다.
            org.junit.Assert.assertTrue(
                "source 가 안 실렸다",
                body.getJSONObject(0).getString("source").startsWith("VitAlGuard-"),
            )
        }
    }

    @Test
    fun `HRV 는 창 주기당 1회 - 가짜 밀도 재현 금지`() {
        val source = FakeTrackerSource(sixtySecondsOfWork())
        val queue = VitalQueue(MemoryStorage())
        val engine = CollectorEngine(source, queue, batteryPct = { null })
        engine.start(0)
        for (t in 5_000L..60_000L step 5_000L) {
            source.replayUntil(t)
            engine.flush(t)
        }
        val hrvRows = queue.peek(12).filter { it.containsKey("hrvSdnnMs") }
        assertEquals(1, hrvRows.size)
    }

    private fun IsoMs30s() = com.vitalguard.wear.pipeline.IsoMs.format(30_000)
}
