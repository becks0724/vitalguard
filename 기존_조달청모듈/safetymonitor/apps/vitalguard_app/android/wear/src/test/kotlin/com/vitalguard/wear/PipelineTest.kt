// A 검증 — 정준 ts·병합 규칙·큐 상한·업로드 상태기계(재시도 30s/300s·자격 스탬프)
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.FlushOutcome
import com.vitalguard.wear.pipeline.IsoMs
import com.vitalguard.wear.pipeline.QueueStorage
import com.vitalguard.wear.pipeline.SampleBuilder
import com.vitalguard.wear.pipeline.UploadConfig
import com.vitalguard.wear.pipeline.UploadPipeline
import com.vitalguard.wear.pipeline.VitalQueue
import com.vitalguard.wear.pipeline.VitalTransport
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryStorage : QueueStorage {
    var text: String? = null
    override fun save(text: String) { this.text = text }
    override fun load(): String? = text
}

class IsoMsTest {
    @Test
    fun `정준 형태 - 밀리초 항상 3자리에 Z 종결`() {
        assertEquals("1970-01-01T00:00:00.000Z", IsoMs.format(0))
        assertEquals("2026-08-24T03:00:00.007Z", IsoMs.format(1_787_540_400_007))
    }
}

class SampleBuilderTest {
    @Test
    fun `병합 - flush 1회는 항목 1건, 측정 시각은 별도 키`() {
        val b = SampleBuilder()
        b.heartRate(72, atMs = 1_000)
        b.spo2(97, atMs = 2_000)
        b.addSteps(12)
        val v = b.buildAndReset(sentAtMs = 5_000, stillSec = 3.0, batteryPct = 80)!!
        assertEquals(72, v["heartRate"])
        assertEquals(IsoMs.format(1_000), v["heartRateMeasuredAt"])
        assertEquals(IsoMs.format(2_000), v["spo2MeasuredAt"])
        assertEquals(IsoMs.format(5_000), v["ts"])
        assertEquals(12, v["steps"])
        assertEquals(80, v["batteryPct"])
    }

    @Test
    fun `1회 소비 - 다음 flush 에 직전 값이 복사되지 않는다`() {
        val b = SampleBuilder()
        b.heartRate(72, 1_000)
        b.buildAndReset(5_000)
        assertNull(b.buildAndReset(10_000))     // 새 측정 없음 → 항목 없음
    }

    @Test
    fun `무동작 지속만은 단독 전송된다 - 벗음과 쓰러짐을 가르는 재료`() {
        val v = SampleBuilder().buildAndReset(sentAtMs = 5_000, stillSec = 42.0)!!
        assertEquals(42.0, v["motionStillSec"])
        assertFalse(v.containsKey("heartRate"))
    }

    @Test
    fun `0 채움 금지 - 측정 안 된 키는 존재하지 않는다`() {
        val b = SampleBuilder()
        b.heartRate(72, 1_000)
        val v = b.buildAndReset(5_000)!!
        listOf("spo2", "steps", "flightsClimbed", "activeEnergyKcal", "hrvSdnnMs").forEach {
            assertFalse("$it 가 실려선 안 된다", v.containsKey(it))
        }
    }
}

class VitalQueueTest {
    @Test
    fun `상한 초과는 오래된 것부터 폐기`() {
        val q = VitalQueue(MemoryStorage(), maxQueue = 3)
        repeat(5) { q.add(mapOf("ts" to "t$it")) }
        assertEquals(3, q.size)
        assertEquals("t2", q.peek(1)[0]["ts"])   // t0·t1 폐기됨
    }

    @Test
    fun `영속 왕복 - 재기동 복원`() {
        val s = MemoryStorage()
        VitalQueue(s).add(mapOf("ts" to "a", "heartRate" to 70))
        val q2 = VitalQueue(s)
        assertEquals(1, q2.restore())
        assertEquals(70, q2.peek(1)[0]["heartRate"])
    }
}

class UploadPipelineTest {
    private fun queueOf(n: Int): VitalQueue =
        VitalQueue(MemoryStorage()).also { q -> repeat(n) { q.add(mapOf("ts" to "t$it")) } }

    private val cfg = UploadConfig(token = "jwt", workerId = "EMP-1", workerName = "홍길동")

    @Test
    fun `성공 - 배치만큼 큐에서 빠지고 잔여를 보고한다`() {
        val q = queueOf(7)
        val p = UploadPipeline(q, transport = { _, _ -> 200 }, maxBatchPerRequest = 5)
        val r = p.flushOnce(cfg) as FlushOutcome.Sent
        assertEquals(5, r.count)
        assertEquals(2, r.remaining)
    }

    @Test
    fun `자격 스탬프 - workerId·source 는 전송 시점에 붙는다`() {
        var seen: String? = null
        val p = UploadPipeline(queueOf(1), transport = { _, body -> seen = body; 200 })
        p.flushOnce(cfg)
        val item = JSONArray(seen!!).getJSONObject(0)
        assertEquals("EMP-1", item.getString("workerId"))
        assertEquals("VitAlGuard-WatchVitals", item.getString("source"))
        assertEquals("홍길동", item.getString("workerName"))
    }

    @Test
    fun `재시도 간격 - 네트워크와 5xx 는 30초, 인증 거부는 300초`() {
        assertEquals(30, (UploadPipeline(queueOf(1), { _, _ -> -1 }).flushOnce(cfg) as FlushOutcome.RetryAfterSec).sec)
        assertEquals(30, (UploadPipeline(queueOf(1), { _, _ -> 500 }).flushOnce(cfg) as FlushOutcome.RetryAfterSec).sec)
        val auth = UploadPipeline(queueOf(1), { _, _ -> 401 }).flushOnce(cfg) as FlushOutcome.RetryAfterSec
        assertEquals(300, auth.sec)
        assertTrue(auth.authRejected)
    }

    @Test
    fun `미로그인 - 큐는 쌓이되 업로드는 쉰다`() {
        val q = queueOf(3)
        val p = UploadPipeline(q, com.vitalguard.wear.pipeline.VitalTransport { _, _ -> throw AssertionError("전송되면 안 된다") })
        assertEquals(FlushOutcome.Idle, p.flushOnce(config = null))
        assertEquals(3, q.size)
    }

    @Test
    fun `실패 시 큐 보존 - 유실 없이 다음 기회를 기다린다`() {
        val q = queueOf(3)
        UploadPipeline(q, com.vitalguard.wear.pipeline.VitalTransport { _, _ -> 500 }).flushOnce(cfg)
        assertEquals(3, q.size)
    }
}
