package com.vitalguard.field

// Ports: login_connection_test.dart / login_error_test.dart의 응답 형식/전송 경계.
// HttpURLConnection은 가짜 객체만 사용한다. 실제 네트워크/로컬 HTTP 서버를 열지 않는다.
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.Json
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

private class FakeConnection(var status: Int = 200, var text: String = """{"ok":true}""") :
    HttpURLConnection(URL("https://unit.invalid")) {
    val output = ByteArrayOutputStream()
    var closed = false
    val streamingLength get() = fixedContentLength
    override fun connect() {}
    override fun disconnect() { closed = true }
    override fun usingProxy() = false
    override fun getResponseCode() = status
    override fun getInputStream() = ByteArrayInputStream(text.toByteArray())
    override fun getErrorStream() = ByteArrayInputStream(text.toByteArray())
    override fun getOutputStream() = output
}

class HttpTransportTest {
    @Test fun headersTimeoutsStreamingAndRedirectPolicyAreApplied() = runTest {
        val connection = FakeConnection()
        val transport = HttpUrlConnectionTransport(URI("https://unit.invalid"), { uri ->
            assertEquals("/api/mobile/v1/session/login", uri.path); connection
        })
        transport.execute("POST", "/api/mobile/v1/session/login", "synthetic-access", mapOf("id" to "demo"))
        assertEquals("application/json", connection.getRequestProperty("Accept"))
        assertEquals("Bearer synthetic-access", connection.getRequestProperty("Authorization"))
        assertEquals("application/json; charset=utf-8", connection.getRequestProperty("Content-Type"))
        assertFalse(connection.instanceFollowRedirects); assertFalse(connection.useCaches)
        assertEquals(20_000, connection.connectTimeout); assertEquals(30_000, connection.readTimeout)
        assertEquals(connection.output.size(), connection.streamingLength)
        assertEquals(mapOf("id" to "demo"), Json.decodeObject(connection.output.toString("UTF-8")))
        assertTrue(connection.closed)
    }
    @Test fun malformedPostResponseIsUncertainAndRedirectIsNeverFollowed() = runTest {
        val broken = FakeConnection(text = "<html>private</html>")
        val transport = HttpUrlConnectionTransport(URI("https://unit.invalid"), { broken })
        val error = failure { transport.execute("POST", "/api/mobile/v1/session/login", null, emptyMap()) }
        assertEquals("서버 응답 형식을 확인할 수 없습니다", error.message); assertEquals(200, error.status)
        assertTrue(error.uncertainWrite); assertTrue(broken.closed)
        val redirect = FakeConnection(302)
        var connections = 0
        val gateway = LiveGateway(HttpUrlConnectionTransport(URI("https://unit.invalid"), { connections++; redirect }))
        assertEquals(302, failure { gateway.me("access") }.status); assertEquals(1, connections)
        assertFalse(redirect.instanceFollowRedirects)
    }
}
