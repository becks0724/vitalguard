package com.vitalguard.field.data.live

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import java.io.IOException
import java.io.ByteArrayOutputStream
import java.net.URLEncoder
import java.util.Locale
import java.util.UUID
import com.vitalguard.field.data.operationLookupBatchSize
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

fun interface MultipartTransport {
    suspend fun executeMultipart(path: String, token: String, bytes: ByteArray, contentType: String, onSubmitted: () -> Unit): ApiReply
}

fun interface DownloadTransport { suspend fun download(url: String): ByteArray }

// Port: live_gateway.dart. JSON과 app-media multipart는 같은 전송 경계를 주입한다.
class LiveGateway(
    private val transport: JsonTransport = HttpUrlConnectionTransport(),
    private val unknownLoginCode: (String) -> Unit = {
        Logger.getLogger("vitalguard_field.login").warning("Unknown login error code: $it")
    },
    private val multipartTransport: MultipartTransport? = transport as? MultipartTransport,
    private val downloadTransport: DownloadTransport? = transport as? DownloadTransport,
) : FieldGateway, CaptureAddressGateway, OperationLookupGateway {
    override val isMock = false

    private suspend fun json(method: String, path: String, token: String? = null, body: JsonObject? = null): JsonObject {
        try {
            val reply = transport.execute(method, path, token, body)
            if (reply.status !in 200..299 || reply.body["ok"] != true) {
                throw ApiFailure(
                    reply.body["error"]?.toString() ?: "요청이 완료되지 않았습니다",
                    status = reply.status,
                    code = reply.body["code"] as? String ?: if (reply.body["ok"] == false && reply.body["error"] == "unknown camera") "unknown camera" else null,
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

    override suspend fun captureAddress(token: String, latitude: Double, longitude: Double): String? {
        val lat = String.format(Locale.ROOT, "%.6f", latitude)
        val lon = String.format(Locale.ROOT, "%.6f", longitude)
        return (json("GET", "/api/app/address?lat=$lat&lon=$lon", token)["display"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
    }

    override suspend fun calendarMedia(token: String, from: String, to: String): List<CalendarMedia> {
        require(java.time.LocalDate.parse(from) <= java.time.LocalDate.parse(to))
        val rows = json("GET", "/api/calendar/media?from=$from&to=$to", token)["media"] as? List<*>
            ?: throw ApiFailure("달력 응답 형식을 확인할 수 없습니다")
        return rows.map { row ->
            val data = row.jsonObjectOrNull() ?: throw ApiFailure("달력 응답 형식을 확인할 수 없습니다")
            if ((data["id"] as? String).isNullOrBlank() || data["date_key"] !is String)
                throw ApiFailure("달력 기록의 날짜와 ID를 확인할 수 없습니다")
            CalendarMedia(data)
        }
    }

    override suspend fun calendarPhoto(token: String, id: String): ByteArray {
        val url = json("GET", "/api/calendar/media/download-url?id=${URLEncoder.encode(id, "UTF-8")}", token)["url"] as? String
            ?: throw ApiFailure("사진 다운로드 주소를 확인할 수 없습니다")
        return (downloadTransport ?: throw ApiFailure("사진 다운로드 구성이 없습니다")).download(url)
    }

    override suspend fun calendarVoice(comment: MediaComment): ByteArray {
        // 목록 GET이 audio_storage_key로 발급한 audio_url. 댓글 ID로 download-url을 호출하지 않는다.
        val url = calendarVoiceUrl(comment) ?: throw ApiFailure(voiceUrlUnavailable)
        val bytes = (downloadTransport ?: throw ApiFailure("음성 다운로드 구성이 없습니다")).download(url)
        if (bytes.size > maxVoiceBytes) throw ApiFailure("음성 크기가 다운로드 한도를 넘었습니다")
        return bytes
    }

    override suspend fun deleteCalendarMedia(token: String, id: String) {
        // 오류 문구·code를 그대로 보존한다. 특히 403은 로컬 삭제 성공으로 간주하지 않는다.
        json("DELETE", "/api/calendar/media?id=${URLEncoder.encode(id, "UTF-8")}", token)
    }

    override suspend fun lookupOperations(token: String, clientOperationIds: List<String>): Map<String, OperationCheck> {
        if (clientOperationIds.isEmpty() || clientOperationIds.size > operationLookupBatchSize ||
            clientOperationIds.any { it.isEmpty() || it.length > 128 || it.trim() != it }) {
            throw ApiFailure("작업 ID는 앞뒤 공백 없는 1~128자, 요청당 1~50개여야 합니다", status = 400)
        }
        val ids = clientOperationIds.toSet()
        val path = "/api/app/admin/operation-status?" + clientOperationIds.joinToString("&") {
            "clientOperationId=" + URLEncoder.encode(it, "UTF-8")
        }
        try {
            val rows = json("GET", path, token)["operations"] as? List<*> ?: error("작업 조회 응답 누락")
            check(rows.size == ids.size) { "작업 조회 응답 누락" }
            val results = linkedMapOf<String, OperationCheck>()
            for (value in rows) {
                val row = value.jsonObjectOrNull() ?: error("작업 조회 응답 형식")
                val id = row["clientOperationId"] as? String ?: error("작업 조회 응답 형식")
                check(id in ids && id !in results) { "작업 조회 ID 불일치" }
                val presence = when (row["status"]) {
                    "registered" -> OperationPresence.confirmed
                    "not_registered" -> OperationPresence.absent
                    else -> error("알 수 없는 작업 상태")
                }
                results[id] = OperationCheck(presence, receipt =
                    if (presence == OperationPresence.confirmed && row["id"] is String) mapOf("id" to row["id"]) else null)
            }
            return results
        } catch (error: ApiFailure) {
            throw ApiFailure(when (error.status) {
                401 -> "로그인이 만료되었습니다. 다시 로그인해 주세요"
                403 -> "서버 상태를 조회할 권한이 없습니다"
                400 -> "작업 ID 조회 요청이 올바르지 않습니다"
                503 -> "서버 DB 장애로 작업 상태를 조회하지 못했습니다"
                else -> "연결 또는 서버 응답을 확인하지 못했습니다"
            }, status = error.status, action = if (error.status == 401) "reauth" else null)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            throw ApiFailure("서버 작업 상태 응답을 확인하지 못했습니다")
        }
    }

    override suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia {
        val ink = fields.containsKey("annotationOf")
        if (ink) inkUploadSizeError(bytes.size)?.let { throw ApiFailure(it, status = 413) }
        val jpeg = bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()
        val filename = if (ink) "annotation.json" else if (jpeg) "capture.jpg" else "annotation.png"
        val contentType = if (ink) "application/json" else if (jpeg) "image/jpeg" else "image/png"
        val data = multipart(token, bytes, fields, filename, contentType)
        val row = data["media"].jsonObjectOrNull()
        if (row == null || (row["id"] as? String).isNullOrEmpty() || row["date_key"] !is String) {
            throw ApiFailure("업로드 응답의 기록 ID를 확인할 수 없습니다", uncertainWrite = true)
        }
        return CalendarMedia(row, data["clientOperationId"] as? String, data["deduplicated"] == true)
    }

    private suspend fun multipart(token: String, bytes: ByteArray, fields: Map<String, String>,
        fileName: String, contentType: String, voice: Boolean = false): JsonObject {
        if (fields["clientOperationId"].isNullOrEmpty()) throw ApiFailure("영속 보관된 작업 ID가 필요합니다", status = 400)
        val boundary = "vg-${UUID.randomUUID()}"
        val body = multipartBody(bytes, fields, fileName, contentType, boundary)
        var submitted = false
        try {
            val sender = multipartTransport ?: throw ApiFailure("업로드 전송 구성이 없습니다", status = 400)
            val reply = sender.executeMultipart("/api/app-media", token, body, "multipart/form-data; boundary=$boundary") { submitted = true }
            val data = reply.body
            if (reply.status != 200 || data["ok"] != true) {
                throw ApiFailure(data["error"]?.toString() ?: "업로드 실패", status = reply.status,
                    action = data["action"] as? String, uncertainWrite = reply.status >= 500)
            }
            if (data["clientOperationId"] != fields["clientOperationId"] || data["deduplicated"] !is Boolean) {
                throw ApiFailure("서버 응답의 작업 ID를 확인할 수 없습니다", uncertainWrite = true)
            }
            return data
        } catch (e: SocketTimeoutException) {
            throw ApiFailure(if (voice) "서버 응답 대기 시간이 지났습니다: ${e.message ?: e}" else "업로드 결과 불명 · 자동 재전송하지 않습니다",
                uncertainWrite = if (voice) submitted else true)
        } catch (e: TimeoutException) {
            throw ApiFailure(if (voice) "서버 응답 대기 시간이 지났습니다: ${e.message ?: e}" else "업로드 결과 불명 · 자동 재전송하지 않습니다",
                uncertainWrite = if (voice) submitted else true)
        } catch (e: UnknownHostException) {
            throw ApiFailure("서버에 연결할 수 없습니다", uncertainWrite = submitted, networkUnreachable = true)
        } catch (e: SocketException) {
            throw ApiFailure("서버에 연결할 수 없습니다", uncertainWrite = submitted, networkUnreachable = true)
        } catch (e: IOException) {
            throw ApiFailure(if (voice) "응답 수신이 중단됐습니다: ${e.message}" else "업로드 결과 불명 · 자동 재전송하지 않습니다",
                uncertainWrite = if (voice) submitted else true)
        }
    }

    override suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String?): MediaComment {
        val data = json("POST", "/api/calendar/media/comment", token, buildMap {
            put("mediaId", mediaId); put("body", body)
            clientOperationId?.let { put("clientOperationId", it) }
        })
        val row = data["comment"].jsonObjectOrNull() ?: throw ApiFailure("서버 응답 형식을 확인할 수 없습니다", uncertainWrite = true)
        return MediaComment(row, data["clientOperationId"] as? String, data["deduplicated"] == true)
    }

    override suspend fun voiceComment(token: String, mediaId: String, audio: ByteArray, durationMs: Int?,
        clientOperationId: String?, siteId: String?): MediaComment {
        if (mediaId.isBlank() || audio.isEmpty() || (durationMs ?: 0) < 0) throw ApiFailure("원본 사진과 유효한 녹음이 필요합니다", status = 400)
        if (audio.size > maxVoiceBytes) throw ApiFailure("녹음 크기가 10 MiB를 넘었습니다", status = 413)
        val fields = buildMap {
            put("commentOf", mediaId)
            durationMs?.let { put("audioMs", "$it") }
            clientOperationId?.let { put("clientOperationId", it) }
            siteId?.let { put("siteId", it) }
        }
        val data = multipart(token, audio, fields, "voice-comment.m4a", "audio/mp4", voice = true)
        val row = data["comment"].jsonObjectOrNull()
        if (row == null || (row["id"] as? String).isNullOrEmpty() || row["media_id"] != mediaId || row["body"] !is String) {
            throw ApiFailure("음성 댓글 등록 결과를 확인할 수 없습니다", uncertainWrite = true)
        }
        return MediaComment(row, data["clientOperationId"] as? String, data["deduplicated"] == true)
    }

}

// 파일 스트림 대신 본문 전체를 한 번 조립한다. CRLF·필드명 검증은 Dart _multipart와 같다.
internal fun multipartBody(bytes: ByteArray, fields: Map<String, String>, fileName: String, contentType: String, boundary: String): ByteArray {
    val output = ByteArrayOutputStream()
    fun add(text: String) { output.write(text.toByteArray(Charsets.UTF_8)) }
    for ((key, value) in fields) {
        require(Regex("^[A-Za-z][A-Za-z0-9_]*$").matches(key)) { "잘못된 폼 키" }
        add("--$boundary\r\nContent-Disposition: form-data; name=\"$key\"\r\n\r\n$value\r\n")
    }
    add("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$fileName\"\r\nContent-Type: $contentType\r\n\r\n")
    output.write(bytes)
    add("\r\n--$boundary--\r\n")
    return output.toByteArray()
}
