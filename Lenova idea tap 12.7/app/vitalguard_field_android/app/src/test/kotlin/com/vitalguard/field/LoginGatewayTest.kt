package com.vitalguard.field

// Ports: login_error_test.dart, login_connection_test.dart (게이트웨이 부분), site_status_test.dart.
import com.vitalguard.field.data.live.*
import com.vitalguard.field.data.models.*
import java.io.IOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class LoginGatewayTest {
    @Test fun knownLoginErrorsKeepKoreanTextAndStatus() = runTest {
        listOf(
            Triple("invalid_credentials", 401, "아이디 또는 비밀번호가 올바르지 않습니다"),
            Triple("not_approved", 403, "승인 대기 중인 계정입니다. 관리자에게 문의해 주세요"),
            Triple("too_many_attempts", 429, "로그인 시도가 많습니다. 다시 시도해 주세요"),
            Triple("invalid_request", 400, "아이디와 비밀번호를 입력해 주세요"),
            Triple("app_auth_not_configured", 503, "서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요"),
        ).forEach { (code, status, message) ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(status, mapOf("ok" to false, "error" to code)) })
            val error = failure { gateway.login("demo", "synthetic") }
            assertEquals(message, error.message); assertEquals(message, error.toString())
            assertEquals(status, error.status); assertNull(error.retryAfterSec)
            assertEquals(status >= 500, error.uncertainWrite)
        }
    }
    @Test fun serverLockSecondsAreNotRoundedOrInvented() = runTest {
        listOf(0, 1, 37).forEach { seconds ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ ->
                ApiReply(429, mapOf("ok" to false, "error" to "too_many_attempts", "retryAfterSec" to seconds))
            })
            val e = failure { gateway.login("demo", "synthetic") }
            assertEquals("로그인 시도가 많습니다. ${seconds}초 후 다시 시도해 주세요", e.message)
            assertEquals(seconds, e.retryAfterSec)
        }
    }
    @Test fun unknownCodesStayOutOfScreenButKeepAuthenticationMetadata() = runTest {
        listOf("unknown_login_error", "Unexpected server error", "").forEach { code ->
            val logs = mutableListOf<String>()
            val gateway = LiveGateway(JsonTransport { _, _, _, _ ->
                ApiReply(503, mapOf("ok" to false, "error" to code, "action" to "reauth",
                    "retryAfterSec" to 15, "twoFactorRequired" to true))
            }, logs::add)
            val e = failure { gateway.login("demo", "synthetic") }
            assertEquals("로그인하지 못했습니다", e.message); assertEquals(503, e.status)
            assertEquals("reauth", e.action); assertEquals(15, e.retryAfterSec)
            assertTrue(e.twoFactorRequired); assertTrue(e.uncertainWrite); assertEquals(1, logs.size)
        }
    }
    @Test fun koreanTotpMessagesArePassedThrough() = runTest {
        listOf("인증 앱의 6자리 코드를 입력하세요.", "코드가 일치하지 않습니다. 다시 확인해주세요.",
            "이미 사용한 코드입니다. 다음 코드를 기다려주세요.").forEach { message ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ ->
                ApiReply(401, mapOf("ok" to false, "error" to message, "twoFactorRequired" to true))
            })
            val e = failure { gateway.login("demo", "synthetic", "123456") }
            assertEquals(message, e.message); assertTrue(e.twoFactorRequired)
        }
    }
    @Test fun connectionTimeoutAndInterruptedBodyHaveDistinctFlagsForReadAndWrite() = runTest {
        listOf(
            Triple(UnknownHostException(), "서버에 연결할 수 없습니다", true),
            Triple(SocketException(), "서버에 연결할 수 없습니다", true),
            Triple(SocketTimeoutException(), "서버 응답을 기다리는 시간이 지났습니다", false),
            Triple(IOException(), "응답 수신이 중단됐습니다", false),
        ).forEach { (cause, message, unreachable) ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> throw cause })
            listOf(false, true).forEach { readOnly ->
                repeat(2) {
                    val e = failure { if (readOnly) gateway.me("access") else gateway.login("demo", "synthetic") }
                    assertEquals(message, e.message); assertNull(e.status)
                    assertEquals(unreachable, e.networkUnreachable); assertEquals(!readOnly, e.uncertainWrite)
                }
            }
        }
    }
    @Test fun nonLoginErrorsAreUnchangedAndOkMustBeTrueEvenOn200() = runTest {
        listOf("invalid_credentials", "unknown_api_error", "잉크본에는 annotationOf(원본 ID)가 필요합니다").forEach { message ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(400, mapOf("ok" to false, "error" to message)) })
            assertEquals(message, failure { gateway.refresh("refresh") }.message)
        }
        listOf(null, false, "true").forEach { ok ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(200, mapOf("ok" to ok)) })
            assertEquals(200, failure { gateway.refresh("refresh") }.status)
        }
    }
    @Test fun sixRoutesUseExactFieldsAndSiteInfoEnvelope() = runTest {
        val calls = mutableListOf<String>()
        val gateway = LiveGateway(JsonTransport { method, path, token, body ->
            calls += "$method $path"
            when (path) {
                "/api/mobile/v1/session/login" -> {
                    assertNull(token)
                    assertEquals(mapOf("id" to "demo", "password" to "synthetic", "totpCode" to "123456",
                        "platform" to "android", "deviceName" to "VitAlGuard 현장 태블릿"), body)
                    ApiReply(200, session().json)
                }
                REFRESH -> { assertEquals(mapOf("refreshToken" to "refresh"), body); ApiReply(200, session().json) }
                ME -> { assertEquals("access", token); assertNull(body); ApiReply(200, mapOf("ok" to true, "user" to SAVED_USER)) }
                SITE_INFO -> ApiReply(200, mapOf("ok" to true, "siteInfo" to SAVED_SITE))
                SITE_STATUS -> ApiReply(200, siteStatusReply())
                else -> ApiReply(200, mapOf("ok" to true))
            }
        })
        gateway.login("demo", "synthetic", "123456"); gateway.refresh("refresh")
        gateway.me("access"); gateway.logout("access")
        assertEquals("assigned-site", gateway.siteInfo("access")?.site_id)
        assertEquals(NOW, gateway.siteStatus("access").fetchedAt)
        assertEquals(listOf("POST /api/mobile/v1/session/login", "POST $REFRESH", "GET $ME",
            "POST /api/mobile/v1/session/logout", "GET $SITE_INFO", "GET $SITE_STATUS"), calls)
        assertEquals("다음 단계", failure { gateway.cctvTicket("access", "CAM-03") }.message)
        assertEquals("영속 보관된 작업 ID가 필요합니다", failure { gateway.upload("access", byteArrayOf(1), emptyMap()) }.message)
        assertEquals(6, calls.size)
    }
    @Test fun siteStatusHidesPrivateErrorsAnd403NeverRequestsRefresh() = runTest {
        listOf(401, 403, 404, 429, 503).forEach { status ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(status,
                mapOf("ok" to false, "error" to "synthetic-private-error", "action" to if (status == 403) "reauth" else "refresh", "retryAfterSec" to 12)) })
            val e = failure { gateway.siteStatus("access") }
            assertEquals(status, e.status); assertEquals("현장 요약을 받을 수 없습니다", e.message)
            assertNull(e.code); assertEquals(if (status == 403) "none" else "refresh", e.action); assertEquals(12, e.retryAfterSec)
        }
        listOf(null, "synthetic-private-error", "2026-09-14T15:13:04").forEach { time ->
            val gateway = LiveGateway(JsonTransport { _, _, _, _ -> ApiReply(200, siteStatusReply() + ("fetchedAt" to time)) })
            assertEquals("현장 요약 응답 형식을 확인할 수 없습니다", failure { gateway.siteStatus("access") }.message)
        }
    }
}
