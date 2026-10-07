package com.vitalguard.field

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class Stage3GatewayTest {
    @Test fun ackPreservesIntegerAndUuidWireTypesAndOnlySendsId() = runTest {
        val bodies = mutableListOf<Map<String, Any?>?>()
        val gateway = LiveGateway(JsonTransport { method, path, token, body ->
            assertEquals("POST", method); assertEquals("/api/app/admin/alerts/ack", path); assertEquals("synthetic", token)
            bodies += body; ApiReply(200, mapOf("ok" to true, "acked" to false))
        })
        val uuid = "C6A83A20-7AE5-4B0E-9846-3D95AA5E1182"
        assertFalse(gateway.ackAlert("synthetic", " 42 "))
        assertFalse(gateway.ackAlert("synthetic", uuid))
        assertEquals(mapOf("id" to 42L), bodies[0]); assertEquals(mapOf("id" to uuid), bodies[1])
    }
    @Test fun invalidAckIdsFailBeforeTransport() = runTest {
        var calls = 0
        val gateway = LiveGateway(JsonTransport { _, _, _, _ -> calls++; error("must not send") })
        for (id in listOf("", "0", "-2", "1.5", "a1", "9007199254740992", "99999999999999999999"))
            assertEquals(400, failure { gateway.ackAlert("x", id) }.status)
        assertEquals(0, calls)
    }
    @Test fun malformedAckAnd5xxAreUncertainAndNeverRetry() = runTest {
        for (reply in listOf(ApiReply(200, mapOf("ok" to true)), ApiReply(503, mapOf("ok" to false)))) {
            var calls = 0
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> calls++; reply })
            assertTrue(failure { gateway.ackAlert("x", "42") }.uncertainWrite); assertEquals(1, calls)
        }
    }
    @Test fun forbiddenAckPreservesRejectedStatusWithoutUncertainty() = runTest {
        val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(403, mapOf("ok" to false, "action" to "reauth")) })
        val error = failure { gateway.ackAlert("x", "42") }
        assertEquals(403, error.status); assertEquals("none", error.action); assertFalse(error.uncertainWrite)
    }
    @Test fun ticketUsesDedicatedRouteAndPreservesUnknownCameraCode() = runTest {
        val gateway = LiveGateway(JsonTransport { method, path, _, body ->
            assertEquals("POST", method); assertEquals("/api/app/admin/cctv-ticket", path)
            assertEquals(mapOf("cameraId" to "CAM-03"), body)
            ApiReply(404, mapOf("ok" to false, "error" to "unknown camera"))
        })
        assertEquals("unknown camera", failure { gateway.cctvTicket("x", "CAM-03") }.code)
    }
    @Test fun ticketPayloadValidationDoesNotExposeTheToken() = runTest {
        val sensitive = "do-not-log-this token"
        val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(200, mapOf("ok" to true, "ticket" to sensitive,
            "expiresAt" to 42L, "ttlSec" to 60, "gateApi" to "https://camera.example")) })
        val error = failure { gateway.cctvTicket("x", "CAM-03") }
        assertFalse(error.message.contains(sensitive))
    }
}
