// 워치 QR 로그인 클라이언트 — 응답 해석·secret 비노출·왕복(MockWebServer)을 못 박는다
package com.vitalguard.wear

import com.vitalguard.wear.pipeline.DeviceLoginClient
import com.vitalguard.wear.pipeline.DevicePoll
import com.vitalguard.wear.pipeline.DeviceStart
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DeviceLoginClientTest {
    private val client = DeviceLoginClient("https://example.test")
    private val secret = "a".repeat(64)

    private fun startBody(size: Int = 3, rows: List<String> = listOf("101", "010", "101"), code: String = "K7MZ-4QPD"): String =
        JSONObject().put("ok", true).put("code", code).put("secret", secret).put("expiresInSec", 300)
            .put("pairUrl", "https://example.test/pair?code=$code")
            .put("qr", JSONObject().put("size", size).put("rows", JSONArray(rows))).toString()

    @Test
    fun `start — 코드·secret·만료·QR 행렬을 뽑는다`() {
        val r = client.parseStart(200, startBody()) as DeviceStart.Ok
        assertEquals("K7MZ-4QPD", r.code)
        assertEquals(secret, r.secret)
        assertEquals(300, r.expiresInSec)
        assertEquals(3, r.qrSize)
        assertEquals(listOf("101", "010", "101"), r.qrRows)
    }

    @Test
    fun `start — 행렬이 깨지면 QR 만 비우고 코드는 살린다(글자로 승인 가능)`() {
        val r = client.parseStart(200, startBody(size = 3, rows = listOf("101", "01"))) as DeviceStart.Ok
        assertEquals(0, r.qrSize)
        assertTrue(r.qrRows.isEmpty())
        assertEquals("K7MZ-4QPD", r.code)
    }

    @Test
    fun `start — secret 이 짧거나 없으면 거부한다(토큰 수령 자격이 없는 코드는 쓸모없다)`() {
        val body = JSONObject(startBody()).put("secret", "short").toString()
        assertTrue(client.parseStart(200, body) is DeviceStart.Failed)
        assertTrue(client.parseStart(429, """{"ok":false,"error":"too_many_requests"}""") is DeviceStart.Failed)
    }

    @Test
    fun `poll — pending·expired·approved·404 를 가른다 · 사번 없는 승인은 거부`() {
        assertTrue(client.parsePoll(200, """{"ok":true,"status":"pending"}""") is DevicePoll.Pending)
        assertTrue(client.parsePoll(200, """{"ok":true,"status":"expired"}""") is DevicePoll.Expired)
        assertTrue(client.parsePoll(404, """{"ok":false,"error":"not_found"}""") is DevicePoll.Expired)
        val ok = client.parsePoll(200, """{"ok":true,"status":"approved","token":"tok","workerId":"EMP-6861","workerName":"장우진"}""") as DevicePoll.Approved
        assertEquals("tok", ok.token); assertEquals("EMP-6861", ok.workerId); assertEquals("장우진", ok.workerName)
        val noId = client.parsePoll(200, """{"ok":true,"status":"approved","token":"tok","workerId":null}""")
        assertTrue((noId as DevicePoll.Failed).message.contains("사번"))
    }

    @Test
    fun `왕복 — start 는 POST, poll 은 code·secret 을 쿼리로 보낸다`() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(startBody()))
        server.enqueue(MockResponse().setBody("""{"ok":true,"status":"pending"}"""))
        server.start()
        try {
            val c = DeviceLoginClient(server.url("/").toString())
            val s = c.start() as DeviceStart.Ok
            val p = c.poll(s.code, s.secret)
            assertTrue(p is DevicePoll.Pending)
            val r1 = server.takeRequest(); val r2 = server.takeRequest()
            assertEquals("POST", r1.method); assertEquals("/api/app-auth/device/start", r1.path)
            assertEquals("GET", r2.method)
            assertTrue(r2.path!!.startsWith("/api/app-auth/device/poll?code=K7MZ-4QPD&secret=$secret"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `secret 은 로그·저장소로 새지 않는다(구조 검사)`() {
        val src = uncommented(File("src/main/kotlin/com/vitalguard/wear/pipeline/DeviceLoginClient.kt").takeIf { it.exists() }
            ?.readText() ?: File("wear/src/main/kotlin/com/vitalguard/wear/pipeline/DeviceLoginClient.kt").readText())
        assertFalse("poll 예외 로그에 URL(secret 포함)을 싣는다", Regex("""Log\.w\(TAG, "QR 로그인 확인[^\n]*url""").containsMatchIn(src))
        // KDoc 이 "ConfigStore 저장 금지" 를 말하므로 이름이 아니라 **호출**(생성자·저장 메서드)을 본다.
        assertFalse("secret 을 ConfigStore 에 저장한다", Regex("""ConfigStore\(|saveSession\(|\.token\s*=""").containsMatchIn(src))
        assertEquals(4_000L, DeviceLoginClient.POLL_INTERVAL_MS)
    }
}
