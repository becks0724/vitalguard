package com.vitalguard.field.data.live

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.io.IOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeoutException
import java.util.logging.Logger
import kotlinx.coroutines.CancellationException

data class ApiReply(val status: Int, val body: JsonObject)

fun interface JsonTransport {
    suspend fun execute(method: String, path: String, token: String?, body: JsonObject?): ApiReply
}

// Port: live_gateway.dart. 단계 1은 세션 4개 + site-info + site-status만 HTTP를 구현한다.
class LiveGateway(
    private val transport: JsonTransport = HttpUrlConnectionTransport(),
    private val unknownLoginCode: (String) -> Unit = {
        Logger.getLogger("vitalguard_field.login").warning("Unknown login error code: $it")
    },
) : FieldGateway {
    override val isMock = false

    private suspend fun json(method: String, path: String, token: String? = null, body: JsonObject? = null): JsonObject {
        try {
            val reply = transport.execute(method, path, token, body)
            if (reply.status !in 200..299 || reply.body["ok"] != true) {
                throw ApiFailure(
                    reply.body["error"]?.toString() ?: "요청이 완료되지 않았습니다",
                    status = reply.status,
                    code = if (reply.body["ok"] == false && reply.body["error"] == "unknown camera") "unknown camera" else null,
                    action = reply.body["action"] as? String,
                    retryAfterSec = (reply.body["retryAfterSec"] as? Number)?.toInt(),
                    twoFactorRequired = reply.body["twoFactorRequired"] == true,
                    uncertainWrite = method != "GET" && reply.status >= 500,
                )
            }
            return reply.body
        } catch (e: SocketTimeoutException) {
            throw ApiFailure("서버 응답을 기다리는 시간이 지났습니다", uncertainWrite = method != "GET")
        } catch (e: TimeoutException) {
            throw ApiFailure("서버 응답을 기다리는 시간이 지났습니다", uncertainWrite = method != "GET")
        } catch (e: UnknownHostException) {
            throw ApiFailure("서버에 연결할 수 없습니다", uncertainWrite = method != "GET", networkUnreachable = true)
        } catch (e: SocketException) {
            throw ApiFailure("서버에 연결할 수 없습니다", uncertainWrite = method != "GET", networkUnreachable = true)
        } catch (e: IOException) {
            throw ApiFailure("응답 수신이 중단됐습니다", uncertainWrite = method != "GET")
        }
    }

    override suspend fun login(id: String, password: String, totpCode: String?): MobileSession {
        try {
            val body = linkedMapOf<String, Any?>(
                "id" to id, "password" to password, "platform" to "android", "deviceName" to "VitAlGuard 현장 태블릿",
            )
            if (totpCode != null) body["totpCode"] = totpCode
            return MobileSession(json("POST", "/api/mobile/v1/session/login", body = body))
        } catch (error: ApiFailure) {
            if (Regex("[가-힣]").containsMatchIn(error.message)) throw error
            val message = when (error.message) {
                "invalid_credentials" -> "아이디 또는 비밀번호가 올바르지 않습니다"
                "not_approved" -> "승인 대기 중인 계정입니다. 관리자에게 문의해 주세요"
                "too_many_attempts" -> error.retryAfterSec?.let { "로그인 시도가 많습니다. ${it}초 후 다시 시도해 주세요" }
                    ?: "로그인 시도가 많습니다. 다시 시도해 주세요"
                "invalid_request" -> "아이디와 비밀번호를 입력해 주세요"
                "app_auth_not_configured" -> "서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요"
                else -> null
            }
            if (message == null) {
                // 원본 응답/토큰 가능성이 있는 임의 문장은 기록하지 않고 코드만 로그에 남긴다.
                unknownLoginCode(error.message.takeIf { Regex("[A-Za-z_][A-Za-z0-9_]{0,63}").matches(it) } ?: "(unrecognized)")
            }
            throw ApiFailure(message ?: "로그인하지 못했습니다", status = error.status, code = error.code,
                action = error.action, retryAfterSec = error.retryAfterSec, twoFactorRequired = error.twoFactorRequired,
                uncertainWrite = error.uncertainWrite, networkUnreachable = error.networkUnreachable)
        }
    }
    override suspend fun refresh(refreshToken: String) =
        MobileSession(json("POST", "/api/mobile/v1/session/refresh", body = mapOf("refreshToken" to refreshToken)))
    override suspend fun me(accessToken: String) = AppUser(requireNotNull(
        json("GET", "/api/mobile/v1/session/me", accessToken)["user"].jsonObjectOrNull()
    ) { "사용자 응답 형식을 확인할 수 없습니다" })
    override suspend fun logout(accessToken: String) {
        json("POST", "/api/mobile/v1/session/logout", accessToken)
    }
    override suspend fun siteInfo(accessToken: String): SiteInfo? =
        json("GET", "/api/admin/site-info", accessToken)["siteInfo"].jsonObjectOrNull()?.let(::SiteInfo)
    override suspend fun siteStatus(accessToken: String): SiteStatus = try {
        SiteStatus(json("GET", "/api/app/admin/site-status", accessToken))
    } catch (error: ApiFailure) {
        throw ApiFailure("현장 요약을 받을 수 없습니다", status = error.status,
            action = if (error.status == 403) "none" else error.action?.takeIf { it in setOf("refresh", "reauth", "none") },
            retryAfterSec = error.retryAfterSec)
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        throw ApiFailure("현장 요약 응답 형식을 확인할 수 없습니다")
    }
}
