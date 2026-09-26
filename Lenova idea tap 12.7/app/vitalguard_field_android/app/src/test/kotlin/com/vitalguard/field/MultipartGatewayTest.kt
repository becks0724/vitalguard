package com.vitalguard.field

// Ports: outbox_test.dart/hold_bundle_contract_test.dart의 영수증·동일 작업 전송 경계.
// app-media multipart 세부 계약은 live_gateway.dart upload/_multipart/voiceComment.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import java.io.*
import java.net.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class MultipartGatewayTest {
    private fun gateway(sender: MultipartTransport) = LiveGateway(JsonTransport { _, _, _, _ -> error("JSON 경로 호출 금지") }, multipartTransport = sender)
    @Test fun detectsJpegPngAndInkAndSendsBoundaryBearerFieldsAndBytesOnce() = runTest {
        for ((bytes, fields, filename, type) in listOf(
            listOf(PHOTO_BYTES, PHOTO_FIELDS, "capture.jpg", "image/jpeg"),
            listOf(byteArrayOf(1, 2), PHOTO_FIELDS, "annotation.png", "image/png"),
            listOf("{\"v\":1}".toByteArray(), PHOTO_FIELDS + ("annotationOf" to "photo"), "annotation.json", "application/json"))) {
            @Suppress("UNCHECKED_CAST") val metadata = fields as Map<String, String>
            var requests = 0
            val gateway = gateway(MultipartTransport { path, token, body, contentType, onSubmitted ->
                requests++; assertEquals("/api/app-media", path); assertEquals("jwt", token)
                val boundary = contentType.substringAfter("boundary=")
                val text = body.toString(Charsets.UTF_8)
                assertTrue(text.startsWith("--$boundary\r\n")); assertTrue(text.endsWith("\r\n--$boundary--\r\n"))
                assertTrue(text.contains("name=\"file\"; filename=\"$filename\"\r\nContent-Type: $type\r\n\r\n"))
                assertTrue(text.contains("name=\"clientOperationId\"\r\n\r\noperation\r\n"))
                assertTrue(text.contains("작성 당시 주소")); onSubmitted()
                ApiReply(200, mapOf("ok" to true, "media" to mapOf("id" to "row", "date_key" to "2026-09-17"),
                    "clientOperationId" to "operation", "deduplicated" to true))
            })
            val result = gateway.upload("jwt", bytes as ByteArray, metadata + ("clientOperationId" to "operation"))
            assertEquals(1, requests); assertEquals("operation", result.clientOperationId); assertTrue(result.deduplicated)
            assertFalse(result.json.containsKey("clientOperationId"))
        }
    }
    @Test fun missingOperationInvalidFieldAndInkOversizeOpenNoHttp() = runTest {
        var requests = 0
        val gateway = gateway(MultipartTransport { _, _, _, _, _ -> requests++; error("HTTP 금지") })
        assertEquals(400, failure { gateway.upload("jwt", PHOTO_BYTES, PHOTO_FIELDS) }.status)
        rejects { gateway.upload("jwt", PHOTO_BYTES, mapOf("clientOperationId" to "id", "bad\r\nkey" to "value")) }
        assertEquals(413, failure { gateway.upload("jwt", ByteArray(maxInkUploadBytes + 1), mapOf("clientOperationId" to "id", "annotationOf" to "photo")) }.status)
        assertEquals(0, requests)
    }
    @Test fun incompleteOrMismatchedSuccessIsAnUncertainWrite() = runTest {
        val normal = mapOf("ok" to true, "media" to mapOf("id" to "row", "date_key" to "2026-09-17"), "clientOperationId" to "id", "deduplicated" to false)
        for (body in listOf(normal - "deduplicated", normal + ("clientOperationId" to "other"), normal + ("media" to emptyMap<String, Any>()),
            normal + ("media" to mapOf("id" to "row")), normal + ("media" to mapOf("id" to "", "date_key" to "date")))) {
            val gateway = gateway(MultipartTransport { _, _, _, _, _ -> ApiReply(200, body) })
            assertTrue(failure { gateway.upload("jwt", PHOTO_BYTES, PHOTO_FIELDS + ("clientOperationId" to "id")) }.uncertainWrite)
        }
    }
    @Test fun server5xxIsUncertainButPermission4xxIsDefinite() = runTest {
        for (status in listOf(400, 401, 403, 404, 500, 503)) {
            val gateway = gateway(MultipartTransport { _, _, _, _, _ -> ApiReply(status, mapOf("ok" to false, "error" to "failure", "action" to "none")) })
            val e = failure { gateway.upload("jwt", PHOTO_BYTES, PHOTO_FIELDS + ("clientOperationId" to "id")) }
            assertEquals(status, e.status); assertEquals(status >= 500, e.uncertainWrite); assertEquals("none", e.action)
        }
    }
    @Test fun voiceUsesCommentOfAudioMsSiteAndTenMibLimit() = runTest {
        var requests = 0
        val gateway = gateway(MultipartTransport { _, _, body, _, submitted ->
            requests++; submitted()
            val text = body.toString(Charsets.UTF_8)
            assertTrue(text.contains("filename=\"voice-comment.m4a\"\r\nContent-Type: audio/mp4"))
            for ((key, value) in mapOf("commentOf" to "photo", "audioMs" to "1000", "clientOperationId" to "voice", "siteId" to "site"))
                assertTrue(text.contains("name=\"$key\"\r\n\r\n$value\r\n"))
            ApiReply(200, mapOf("ok" to true, "comment" to mapOf("id" to "row", "media_id" to "photo", "body" to ""), "clientOperationId" to "voice", "deduplicated" to false))
        })
        gateway.voiceComment("jwt", "photo", ByteArray(maxVoiceBytes), 1000, "voice", "site")
        assertEquals(1, requests)
        assertEquals(413, failure { gateway.voiceComment("jwt", "photo", ByteArray(maxVoiceBytes + 1), clientOperationId = "voice") }.status)
        assertEquals(400, failure { gateway.voiceComment("jwt", "", byteArrayOf(1), clientOperationId = "voice") }.status)
        assertEquals(400, failure { gateway.voiceComment("jwt", "photo", byteArrayOf(), clientOperationId = "voice") }.status)
        assertEquals(400, failure { gateway.voiceComment("jwt", "photo", byteArrayOf(1), -1, "voice") }.status)
        assertEquals(1, requests)
    }
    @Test fun voiceChecksItsReceiptAndUsesSubmissionAwareFailureMessages() = runTest {
        val bad = gateway(MultipartTransport { _, _, _, _, _ -> ApiReply(200, mapOf("ok" to true, "clientOperationId" to "id", "deduplicated" to false,
            "comment" to mapOf("id" to "row", "media_id" to "other", "body" to ""))) })
        assertEquals("음성 댓글 등록 결과를 확인할 수 없습니다", failure { bad.voiceComment("jwt", "photo", byteArrayOf(1), clientOperationId = "id") }.message)
        for (submitted in listOf(false, true)) for (error in listOf(SocketTimeoutException("timeout"), SocketException("socket"), IOException("body"))) {
            val gateway = gateway(MultipartTransport { _, _, _, _, mark -> if (submitted) mark(); throw error })
            val e = failure { gateway.voiceComment("jwt", "photo", byteArrayOf(1), clientOperationId = "id") }
            assertEquals(submitted, e.uncertainWrite)
            val photo = failure { gateway.upload("jwt", PHOTO_BYTES, mapOf("clientOperationId" to "id")) }
            assertTrue(photo.uncertainWrite); assertEquals("업로드 결과 불명 · 자동 재전송하지 않습니다", photo.message)
        }
    }
    @Test fun httpTransportBuffersOneMultipartBodyAndUsesSeparateSixtySecondDeadline() = runTest {
        val output = ByteArrayOutputStream()
        var connected = 0; var disconnected = false; var responseTimeout = 0
        val connection = object : HttpURLConnection(URI("https://unit.invalid").toURL()) {
            override fun connect() { connected++ }
            override fun disconnect() { disconnected = true }
            override fun usingProxy() = false
            override fun getResponseCode(): Int { responseTimeout = readTimeout; return 200 }
            override fun getOutputStream() = output
            override fun getInputStream() = ByteArrayInputStream("{\"ok\":true}".toByteArray())
        }
        var marked = false
        val transport = HttpUrlConnectionTransport(URI("https://unit.invalid")) { connection }
        val payload = byteArrayOf(0, 1, -1, 2)
        transport.executeMultipart("/api/app-media", "jwt", payload, "multipart/form-data; boundary=vg-unit") { marked = true }
        assertEquals(1, connected); assertTrue(disconnected && marked); assertArrayEquals(payload, output.toByteArray())
        assertEquals(60_000, responseTimeout); assertEquals(30_000, connection.readTimeout)
        assertEquals(20_000, connection.connectTimeout); assertFalse(connection.instanceFollowRedirects)
        assertEquals("Bearer jwt", connection.getRequestProperty("Authorization"))
        assertEquals("multipart/form-data; boundary=vg-unit", connection.getRequestProperty("Content-Type"))
    }
}
