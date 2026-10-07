package com.vitalguard.field

// Port: test/operation_lookup_test.dart. 주입 transport만 사용하며 실제 네트워크 없음.
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import java.net.URI
import java.net.URLDecoder
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class OperationLookupTest {
    @Test fun getUsesBearerAndRepeatedEncodedParametersWithoutChangingIds() = runTest {
        val ids = listOf("한글 &/?+#", "one", "one")
        val gateway = LiveGateway(JsonTransport { method, path, token, body ->
            assertEquals("GET", method); assertEquals("jwt", token); assertNull(body)
            val uri = URI(path); assertEquals("/api/app/admin/operation-status", uri.path)
            assertEquals(ids, uri.rawQuery.split('&').map { URLDecoder.decode(it.substringAfter('='), "UTF-8") })
            ApiReply(200, mapOf("ok" to true, "operations" to listOf(
                mapOf("clientOperationId" to ids[0], "status" to "registered", "id" to "row"),
                mapOf("clientOperationId" to "one", "status" to "not_registered"))))
        })
        val result = gateway.lookupOperations("jwt", ids)
        assertEquals(OperationPresence.confirmed, result[ids[0]]!!.presence)
        assertEquals(mapOf("id" to "row"), result[ids[0]]!!.receipt)
        assertEquals(OperationPresence.absent, result["one"]!!.presence)
    }
    @Test fun validatesOneToFiftyIdsBeforeDedupAndPreservesOneTo128Characters() = runTest {
        var requests = 0
        val gateway = LiveGateway(JsonTransport { _, path, _, _ ->
            requests++
            val ids = URI(path).rawQuery.split('&').map { URLDecoder.decode(it.substringAfter('='), "UTF-8") }.toSet()
            ApiReply(200, mapOf("ok" to true, "operations" to ids.map { mapOf("clientOperationId" to it, "status" to "not_registered") }))
        })
        for (ids in listOf(emptyList(), List(51) { "same" }, listOf(""), listOf("x".repeat(129)), listOf(" a"), listOf("a "), listOf("\ta"))) {
            assertEquals(400, failure { gateway.lookupOperations("jwt", ids) }.status)
        }
        assertEquals(0, requests)
        gateway.lookupOperations("jwt", List(50) { if (it == 0) "x".repeat(128) else "$it" })
        assertEquals(1, requests)
    }
    @Test fun httpErrorsKeepTheirStatusAndNeverReturnAbsence() = runTest {
        val cases = mapOf(400 to "작업 ID 조회 요청이 올바르지 않습니다", 401 to "로그인이 만료되었습니다. 다시 로그인해 주세요",
            403 to "서버 상태를 조회할 권한이 없습니다", 503 to "서버 DB 장애로 작업 상태를 조회하지 못했습니다")
        for ((status, message) in cases) {
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(status, mapOf("ok" to false, "error" to "private")) })
            val error = failure { gateway.lookupOperations("jwt", listOf("id")) }
            assertEquals(status, error.status); assertEquals(message, error.message)
            assertEquals(if (status == 401) "reauth" else null, error.action)
        }
    }
    @Test fun communicationsFailuresDoNotBecomeEmptyOrAbsent() = runTest {
        for (error in listOf(SocketTimeoutException(), UnknownHostException(), java.io.IOException())) {
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> throw error })
            assertEquals("연결 또는 서버 응답을 확인하지 못했습니다", failure { gateway.lookupOperations("jwt", listOf("id")) }.message)
        }
    }
    @Test fun missingDuplicateForeignUnknownAndMalformedRowsRejectTheWholeBatch() = runTest {
        val row = mapOf("clientOperationId" to "a", "status" to "registered")
        for (rows in listOf(null, "invalid", emptyList<Any>(), listOf(row, row),
            listOf(row + ("clientOperationId" to "other")), listOf(row + ("status" to "pending")), listOf(1),
            listOf(mapOf("status" to "registered")))) {
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(200, mapOf("ok" to true, "operations" to rows)) })
            assertEquals("서버 작업 상태 응답을 확인하지 못했습니다", failure { gateway.lookupOperations("jwt", listOf("a")) }.message)
        }
    }
    @Test fun registeredOptionalIdDoesNotRequireOrCoerceANonStringReceipt() = runTest {
        val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(200, mapOf("ok" to true, "operations" to listOf(
            mapOf("clientOperationId" to "with-id", "status" to "registered", "id" to "row"),
            mapOf("clientOperationId" to "legacy", "status" to "registered"),
            mapOf("clientOperationId" to "bad-id", "status" to "registered", "id" to 123),
            mapOf("clientOperationId" to "absent", "status" to "not_registered", "id" to "ignored")))) })
        val result = gateway.lookupOperations("jwt", listOf("with-id", "legacy", "bad-id", "absent"))
        assertEquals(mapOf("id" to "row"), result["with-id"]!!.receipt)
        assertNull(result["legacy"]!!.receipt); assertNull(result["bad-id"]!!.receipt); assertNull(result["absent"]!!.receipt)
        assertEquals(OperationPresence.confirmed, result["legacy"]!!.presence)
    }
}
