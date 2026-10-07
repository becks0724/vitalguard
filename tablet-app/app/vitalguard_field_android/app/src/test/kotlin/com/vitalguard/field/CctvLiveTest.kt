package com.vitalguard.field

import com.vitalguard.field.data.cctv.*
import com.vitalguard.field.data.mock.MemoryStore
import com.vitalguard.field.data.models.CctvTicket
import com.vitalguard.field.data.session.FieldCoordinator
import java.io.ByteArrayInputStream
import java.io.PushbackInputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CctvLiveTest {
    @Test fun consecutiveLiveFramesKeepBoundaryWithOrWithoutContentLength() {
        for (withLength in listOf(false, true)) {
            val header = if (withLength) "Content-Length: 3\r\n" else ""
            val body = "--f\r\nContent-Type: image/jpeg\r\n${header}\r\nabc\r\n--f\r\nContent-Type: image/jpeg\r\n${header}\r\ndef\r\n--f\r\n"
            val input = PushbackInputStream(ByteArrayInputStream(body.toByteArray()), 256)
            assertEquals("abc", String(readCctvImage(input, "multipart/x-mixed-replace; boundary=f")))
            assertEquals("def", String(readCctvImage(input, "multipart/x-mixed-replace; boundary=f")))
        }
    }
    @Test fun cameraRoutesAreExplicitAndNoUnknownSuffixIsOpened() {
        assertEquals("https://camera.example/prefix/cctv/stream1", cctvStreamUri("https://camera.example/prefix/", "CAM-01").toString())
        assertEquals("https://camera.example/prefix/cctv/stream3", cctvStreamUri("https://camera.example/prefix/", "CAM-03").toString())
        try { cctvStreamUri("https://camera.example", "CAM-02"); fail() } catch (_: CctvFailure) {}
    }
    @Test fun streamingUsesOneTicketForMultipleFramesAndClosesOnCancellation() = runTest {
        var opened = ""; var disconnected = false; val seen = mutableListOf<String>()
        val connection = object : HttpURLConnection(URL("https://camera.example")) {
            override fun connect() {}
            override fun disconnect() { disconnected = true }
            override fun usingProxy() = false
            override fun getResponseCode() = 200
            override fun getContentType() = "multipart/x-mixed-replace; boundary=f"
            override fun getInputStream() = ByteArrayInputStream("--f\r\n\r\nabc\r\n--f\r\n\r\ndef\r\n--f\r\n".toByteArray())
        }
        val frames = HttpCctvFrames({}, { opened = it.toString(); connection })
        try {
            frames.receive(stage3Ticket(), "CAM-01", 0) { bytes ->
                seen += String(bytes)
                if (seen.size == 2) throw CancellationException("finished")
            }
        } catch (_: CancellationException) {}
        assertEquals(listOf("abc", "def"), seen)
        assertTrue(opened.endsWith("/stream1")); assertTrue(disconnected)
        assertEquals("Bearer synthetic-ticket-1", connection.getRequestProperty("Authorization"))
    }
    @Test fun cameraSwitchDropsOldImageAndRejectsLateFramesFromOldConnection() = runTest {
        val requested = mutableListOf<String>(); val old = CompletableDeferred<Unit>(); var emittedOld = false
        val gateway = object : ScriptedGateway() {
            override suspend fun cctvTicket(accessToken: String, cameraId: String): CctvTicket {
                requested += cameraId; return stage3Ticket(requested.size)
            }
        }
        val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope, MutableClock()); field.signIn("a", "pw")
        val frames = object : CctvFrames {
            override suspend fun fetch(ticket: CctvTicket) = byteArrayOf(9)
            override suspend fun receive(ticket: CctvTicket, cameraId: String, intervalMillis: Int, onFrame: suspend (ByteArray) -> Unit) {
                if (cameraId == "CAM-03") { onFrame(byteArrayOf(3)); old.await(); onFrame(byteArrayOf(8)); emittedOld = true }
                else { onFrame(byteArrayOf(1)); awaitCancellation() }
            }
        }
        val c = CctvController(field, frames, backgroundScope, MutableClock())
        runCurrent(); c.setVisible(true); c.setForeground(true); runCurrent()
        assertArrayEquals(byteArrayOf(3), c.state.value.bytes)
        c.camera("CAM-01"); assertNull(c.state.value.bytes); assertNull(c.state.value.receivedAt)
        old.complete(Unit); runCurrent()
        assertTrue(emittedOld); assertEquals(listOf("CAM-03", "CAM-01"), requested)
        assertArrayEquals(byteArrayOf(1), c.state.value.bytes)
        c.setVisible(false); advanceTimeBy(60_000); runCurrent(); assertEquals(2, requested.size)
    }
    @Test fun realtimeFailureStillBacksOffAndDoesNotCreateZeroDelayLoop() {
        assertEquals(4, CctvState(periodMillis = 0, failures = 1).delaySeconds)
        assertEquals(60, CctvState(periodMillis = 0, failures = 6).delaySeconds)
    }
}
