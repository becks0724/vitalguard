package com.vitalguard.field

// Port: test/hold_bundle_contract_test.dart. HTTP 본문/응답 봉투/모의 멱등성.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class HoldBundleContractTest {
    @Test fun controllerCommentOperationIdRoundTripsThroughBodyAndEnvelope() = runTest {
        val live = LiveGateway(JsonTransport { method, path, token, body ->
            assertEquals("POST", method); assertEquals("/api/calendar/media/comment", path); assertEquals("mock-access-a", token)
            assertEquals(mapOf("mediaId" to "server-photo", "body" to "한글 메모\n안전 점검", "clientOperationId" to "text-operation"), body)
            ApiReply(200, mapOf("ok" to true, "comment" to mapOf("id" to "row", "media_id" to "server-photo", "body" to "한글 메모\n안전 점검"),
                "clientOperationId" to "text-operation", "deduplicated" to true))
        })
        val gateway = object : MockGateway() {
            override suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String?) = live.addComment(token, mediaId, body, clientOperationId)
        }
        val field = FieldCoordinator(gateway, MemoryStore(), backgroundScope); field.signIn("a", "mock")
        val result = field.comment("server-photo", "한글 메모\n안전 점검", "text-operation")
        assertEquals("text-operation", result.clientOperationId); assertTrue(result.deduplicated)
        assertFalse(result.json.containsKey("clientOperationId")); assertEquals("row", result.id)
    }
    @Test fun legacyCommentOmitsOptionalIdAndEnvelopeFields() = runTest {
        val gateway = LiveGateway(JsonTransport { _, _, _, body ->
            assertEquals(mapOf("mediaId" to "photo", "body" to "기존 메모"), body)
            ApiReply(200, mapOf("ok" to true, "comment" to mapOf("id" to "comment", "media_id" to "photo", "body" to "기존 메모")))
        })
        val result = gateway.addComment("jwt", "photo", "기존 메모")
        assertNull(result.clientOperationId); assertFalse(result.deduplicated)
    }
    @Test fun mockCommentDeduplicatesWithinAnAccountButNotAcrossAccounts() = runTest {
        val gateway = MockGateway(); gateway.login("a", "mock")
        val first = gateway.addComment("jwt", "photo", "첫 메모", "same")
        val again = gateway.addComment("jwt", "photo", "다른 본문", "same")
        assertEquals(first.json, again.json); assertTrue(again.deduplicated)
        gateway.login("b", "mock")
        val other = gateway.addComment("jwt", "photo", "b의 메모", "same")
        assertNotEquals(first.id, other.id); assertFalse(other.deduplicated)
    }
    @Test fun lookupMockPreservesPhotoTextVoiceRowIdsAndAccountOwnership() = runTest {
        val gateway = MockLookupGateway(); gateway.login("a", "mock")
        val photo = gateway.upload("jwt", PHOTO_BYTES, mapOf("dateKey" to "2026-09-17", "clientOperationId" to "photo-op"))
        val text = gateway.addComment("jwt", photo.id, "메모", "text-op")
        val voice = gateway.voiceComment("jwt", photo.id, byteArrayOf(1), clientOperationId = "voice-op")
        val result = gateway.lookupOperations("jwt", listOf("photo-op", "text-op", "voice-op", "absent"))
        assertEquals(mapOf("id" to photo.id), result["photo-op"]!!.receipt)
        assertEquals(mapOf("id" to text.id), result["text-op"]!!.receipt)
        assertEquals(mapOf("id" to voice.id), result["voice-op"]!!.receipt)
        assertEquals(OperationPresence.absent, result["absent"]!!.presence)
        gateway.login("b", "mock")
        assertEquals(OperationPresence.absent, gateway.lookupOperations("jwt", listOf("photo-op"))["photo-op"]!!.presence)
        assertFalse(MockGateway() is OperationLookupGateway)
    }
    @Test fun addressUsesSixDecimalsAndTrimmedDisplayOnly() = runTest {
        val gateway = LiveGateway(JsonTransport { method, path, token, _ ->
            assertEquals("GET", method); assertEquals("/api/app/address?lat=35.123457&lon=127.123457", path)
            assertEquals("jwt", token); ApiReply(200, mapOf("ok" to true, "display" to "  도로명 주소  ", "address" to "ignored"))
        })
        assertEquals("도로명 주소", gateway.captureAddress("jwt", 35.1234567, 127.1234567))
        for (value in listOf(null, " \n ", 1)) {
            val blank = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(200, mapOf("ok" to true, "display" to value)) })
            assertNull(blank.captureAddress("jwt", 1.0, 2.0))
        }
    }
}
