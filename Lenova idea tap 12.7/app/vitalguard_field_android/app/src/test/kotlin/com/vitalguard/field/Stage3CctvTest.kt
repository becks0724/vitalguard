package com.vitalguard.field

import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.session.FieldCoordinator
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

fun stage3Ticket(number: Int = 1, expires: Long = 4070908800000L, gate: String = "https://camera.example/base") = CctvTicket(
    mapOf("ok" to true, "ticket" to "synthetic-ticket-$number", "expiresAt" to expires, "ttlSec" to 60, "gateApi" to gate))

class Stage3CctvTest {
    private fun fragmented(value: String) = object : ByteArrayInputStream(value.toByteArray(Charsets.ISO_8859_1)) {
        override fun read(b: ByteArray, off: Int, len: Int) = super.read(b, off, minOf(len, 1))
    }
    private fun rejects(block: () -> Any) { try { block(); fail("Expected CctvFailure") } catch (_: CctvFailure) {} }
    @Test fun firstMultipartFrameStopsAtContentLengthWithoutWaitingForBoundary() {
        val body = "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 3\r\n\r\nabc"
        val input = object : InputStream() {
            var position = 0
            override fun read(): Int { if (position == body.length) error("Must not drain stream"); return body[position++].code }
        }
        assertArrayEquals("abc".toByteArray(), readCctvImage(input, "multipart/x-mixed-replace; boundary=frame"))
        assertEquals(body.length, input.position)
    }
    @Test fun splitHeadersQuotedBoundaryAndNoLengthFirstPartAreSupported() {
        val body = "preamble\r\n--f-1\r\nContent-Type: image/jpeg\r\n\r\nabc\r\n--f-1\r\nsecond frame"
        assertArrayEquals("abc".toByteArray(), readCctvImage(fragmented(body), "multipart/x-mixed-replace; boundary=\"f-1\""))
        assertArrayEquals("abc".toByteArray(), readCctvImage(fragmented("--frame\r\n\r\nabc\r\n--frame"), "multipart/x-mixed-replace; boundary=frame"))
    }
    @Test fun imageResponseAndBoundsValidation() {
        assertArrayEquals(byteArrayOf(1, 2, 3), readCctvImage(ByteArrayInputStream(byteArrayOf(1, 2, 3)), "image/png"))
        rejects { readCctvImage(ByteArrayInputStream(byteArrayOf()), "image/jpeg") }
        rejects { readCctvImage(fragmented("abc"), "application/json") }
        rejects { readCctvImage(fragmented("--x\r\nContent-Length: 16777217\r\n\r\n"), "multipart/x-mixed-replace; boundary=x") }
        rejects { readCctvImage(fragmented("--x\r\nContent-Length: 4\r\n\r\nabc"), "multipart/x-mixed-replace; boundary=x") }
        rejects { readCctvImage(fragmented("--x\r\nContent-Type: text/html\r\n\r\nabc"), "multipart/x-mixed-replace; boundary=x") }
        rejects { readCctvImage(fragmented("--x\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\na"), "multipart/x-mixed-replace; boundary=x") }
        rejects { readCctvImage(fragmented("x".repeat(65_537)), "multipart/x-mixed-replace; boundary=x") }
    }
    @Test fun gateUrlsPreservePathAndRejectCredentialsQueriesFragments() {
        assertEquals("https://camera.example:8443/prefix/cctv/stream3", cctvStreamUri("https://camera.example:8443/prefix/").toString())
        for (url in listOf("", "file:///tmp/camera", "https://user:password@camera.example", "https://camera.example/?token=x", "https://camera.example/#x"))
            rejects { cctvStreamUri(url) }
    }
    private class Connection(val response: Int = 200, val payload: String = "--f\r\nContent-Length: 3\r\n\r\nabc") : HttpURLConnection(URL("https://camera.example")) {
        val headers = mutableMapOf<String, String>(); var disconnected = false
        override fun connect() {}
        override fun disconnect() { disconnected = true }
        override fun usingProxy() = false
        override fun getResponseCode() = response
        override fun getContentType() = "multipart/x-mixed-replace; boundary=f"
        override fun getInputStream() = ByteArrayInputStream(payload.toByteArray())
        override fun getErrorStream() = ByteArrayInputStream(payload.toByteArray())
        override fun setRequestProperty(key: String, value: String) { headers[key] = value }
    }
    @Test fun gateUsesOnlyReadTicketDisablesRedirectsAndClosesTheStream() = runTest {
        val connection = Connection(); var validated = false
        val reader = HttpCctvFrames({ validated = true }, { connection })
        assertArrayEquals("abc".toByteArray(), reader.fetch(stage3Ticket()))
        assertEquals(mapOf("Authorization" to "Bearer synthetic-ticket-1"), connection.headers)
        assertFalse(connection.instanceFollowRedirects); assertFalse(connection.useCaches)
        assertTrue(connection.disconnected); assertTrue(validated)
    }
    @Test fun errorsAreSanitizedAndExistingCleartextPolicyIsPreserved() = runTest {
        for ((status, body, message) in listOf(
            Triple(503, "{\"error\":\"disabled\"}", "현장에서 카메라를 꺼 두었습니다"),
            Triple(503, "{\"error\":\"too many viewers\"}", "동시 접속이 많습니다"),
            Triple(503, "secret-server-trace", cctvUnreachable))) {
            val connection = Connection(status, body)
            try { HttpCctvFrames({}, { connection }).fetch(stage3Ticket()); fail() }
            catch (e: CctvFailure) { assertEquals(message, e.message) }
            assertTrue(connection.disconnected)
        }
        var opened = false
        try { HttpCctvFrames({}, { opened = true; Connection() }).fetch(stage3Ticket(gate = "http://camera.example")); fail() }
        catch (e: CctvFailure) { assertEquals("현장 CCTV 주소는 HTTPS가 필요합니다", e.message) }
        assertFalse(opened)
    }
    @Test fun eachPollGetsAFreshTicketAndHiddenScreenStopsNewRequests() = runTest {
        var tickets = 0; val seen = mutableListOf<String>()
        val gateway = object : ScriptedGateway() {
            override suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket {
                assertEquals("CAM-03", cameraId); return stage3Ticket(++tickets)
            }
        }
        val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock()); field.signIn("a", "pw")
        val cctv = CctvController(field, object : CctvFrames { override suspend fun fetch(ticket: CctvTicket): ByteArray { seen += ticket.ticket; return byteArrayOf(1) } }, backgroundScope, MutableClock())
        runCurrent(); cctv.setForeground(true); cctv.setVisible(true); runCurrent()
        assertEquals(1, tickets)
        advanceTimeBy(5000); runCurrent(); assertEquals(2, tickets); assertEquals(2, seen.distinct().size)
        cctv.setVisible(false); advanceTimeBy(60_000); runCurrent(); assertEquals(2, tickets)
        cctv.setVisible(true); runCurrent(); assertEquals(3, tickets)
        field.signOut(); runCurrent(); assertNull(cctv.state.value.bytes); assertFalse(cctv.state.value.active)
    }
    @Test fun lateTicketNeverOpensHiddenGateAndResumeWaitsForSingleFlight() = runTest {
        val pending = CompletableDeferred<CctvTicket>(); var tickets = 0; var frames = 0
        val gateway = object : ScriptedGateway() { override suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket {
            tickets++; return if (tickets == 1) pending.await() else stage3Ticket(tickets)
        } }
        val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock()); field.signIn("a", "pw")
        val cctv = CctvController(field, object : CctvFrames { override suspend fun fetch(ticket: CctvTicket): ByteArray { frames++; return byteArrayOf(1) } }, backgroundScope, MutableClock())
        runCurrent(); cctv.setForeground(true); cctv.setVisible(true); runCurrent(); assertEquals(1, tickets)
        cctv.setVisible(false); pending.complete(stage3Ticket()); runCurrent(); assertEquals(0, frames)
        cctv.setVisible(true); runCurrent(); assertEquals(2, tickets); assertEquals(1, frames)
    }
    @Test fun failureBackoffAndExpiryNeverReuseTickets() = runTest {
        var tickets = 0; var fetches = 0
        val clock = MutableClock()
        val gateway = object : ScriptedGateway() { override suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket =
            stage3Ticket(++tickets, expires = clock.millis() - 1) }
        val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope, clock); field.signIn("a", "pw")
        val cctv = CctvController(field, object : CctvFrames { override suspend fun fetch(ticket: CctvTicket): ByteArray { fetches++; return byteArrayOf(1) } }, backgroundScope, clock)
        runCurrent(); cctv.setForeground(true); cctv.setVisible(true); runCurrent()
        assertEquals(10, cctv.state.value.delaySeconds); assertEquals(0, fetches)
        advanceTimeBy(9999); runCurrent(); assertEquals(1, tickets)
        advanceTimeBy(1); runCurrent(); assertEquals(2, tickets); assertEquals(20, cctv.state.value.delaySeconds)
        cctv.setForeground(false); advanceTimeBy(60_000); runCurrent(); assertEquals(2, tickets)
    }
}
