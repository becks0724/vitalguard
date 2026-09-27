package com.vitalguard.field.data.live

import com.vitalguard.field.data.contracts.ApiFailure
import com.vitalguard.field.data.models.Json
import com.vitalguard.field.data.models.JsonObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class HttpUrlConnectionTransport(
    private val base: URI = URI("https://vitalguard-dashboard-569797426568.asia-northeast3.run.app"),
    private val open: (URI) -> HttpURLConnection = { it.toURL().openConnection() as HttpURLConnection },
) : JsonTransport, MultipartTransport, DownloadTransport {
    companion object {
        const val CONNECT_TIMEOUT_MS = 20_000
        const val RESPONSE_TIMEOUT_MS = 30_000
        const val UPLOAD_TIMEOUT_MS = 60_000
        const val BODY_TIMEOUT_MS = 30_000
        private val watchdog = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "field-http-deadline").apply { isDaemon = true }
        }
    }

    override suspend fun execute(method: String, path: String, token: String?, body: JsonObject?): ApiReply =
        request(method, path, token, body?.let { Json.encode(it).toByteArray(Charsets.UTF_8) },
            "application/json; charset=utf-8", RESPONSE_TIMEOUT_MS, "서버 응답 형식을 확인할 수 없습니다")

    override suspend fun executeMultipart(path: String, token: String, bytes: ByteArray, contentType: String,
        onSubmitted: () -> Unit): ApiReply =
        request("POST", path, token, bytes, contentType, UPLOAD_TIMEOUT_MS, "업로드 결과를 확인할 수 없습니다", onSubmitted)

    override suspend fun download(url: String): ByteArray = withContext(Dispatchers.IO) {
        val target = URI(url)
        require(target.scheme == "https" && target.host != null && target.userInfo == null) { "사진 주소를 확인할 수 없습니다" }
        val connection = open(target)
        try {
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = BODY_TIMEOUT_MS
            // 발급받은 스토리지 URL에는 앱 Bearer를 전달하지 않는다.
            deadline(connection, CONNECT_TIMEOUT_MS) { connection.connect() }
            val status = deadline(connection, RESPONSE_TIMEOUT_MS) { connection.responseCode }
            if (status !in 200..299) throw ApiFailure("사진을 내려받지 못했습니다", status = status)
            deadline(connection, BODY_TIMEOUT_MS) {
                connection.inputStream.use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > 32 * 1024 * 1024) throw ApiFailure("사진 크기가 다운로드 한도를 넘었습니다")
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                }
            }
        } finally { connection.disconnect() }
    }

    private suspend fun request(method: String, path: String, token: String?, bytes: ByteArray?, contentType: String,
        responseTimeout: Int, malformedMessage: String, onSubmitted: () -> Unit = {}): ApiReply = withContext(Dispatchers.IO) {
            val target = base.resolve(path)
            require(target.scheme == "https" && target.host == base.host && target.port == base.port) {
                "서버 주소를 확인할 수 없습니다"
            }
            val connection = open(target)
            try {
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.useCaches = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = responseTimeout
                connection.setRequestProperty("Accept", "application/json")
                if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
                if (bytes != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", contentType)
                    // 재전송을 위한 본문 버퍼링/인증·리다이렉트 재시도를 허용하지 않는다.
                    connection.setFixedLengthStreamingMode(bytes.size)
                }
                deadline(connection, CONNECT_TIMEOUT_MS) { connection.connect() }
                val status = deadline(connection, responseTimeout) {
                    if (bytes != null) {
                        onSubmitted()
                        connection.outputStream.use { it.write(bytes); it.flush() }
                    }
                    connection.responseCode
                }
                connection.readTimeout = BODY_TIMEOUT_MS
                val text = deadline(connection, BODY_TIMEOUT_MS) {
                    val stream = if (status >= 400) connection.errorStream else connection.inputStream
                    if (stream == null) "" else stream.use { input ->
                        val output = ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                        }
                        output.toString("UTF-8")
                    }
                }
                val data = try { Json.decodeObject(text) } catch (_: Exception) {
                    throw ApiFailure(malformedMessage, status = status, uncertainWrite = method != "GET")
                }
                ApiReply(status, data)
            } finally { connection.disconnect() }
        }

    // readTimeout은 각 read에만 적용된다. 느린 본문도 원본처럼 총 30초로 제한한다.
    private fun <T> deadline(connection: HttpURLConnection, timeoutMs: Int, block: () -> T): T {
        val timedOut = AtomicBoolean(false)
        val alarm = watchdog.schedule({
            timedOut.set(true)
            connection.disconnect()
        }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
        try {
            val result = block()
            if (timedOut.get()) throw SocketTimeoutException()
            return result
        } catch (error: Exception) {
            if (timedOut.get()) throw SocketTimeoutException()
            throw error
        } finally { alarm.cancel(false) }
    }
}
