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
) : JsonTransport {
    companion object {
        const val CONNECT_TIMEOUT_MS = 20_000
        const val RESPONSE_TIMEOUT_MS = 30_000
        const val BODY_TIMEOUT_MS = 30_000
        private val watchdog = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "field-http-deadline").apply { isDaemon = true }
        }
    }

    override suspend fun execute(method: String, path: String, token: String?, body: JsonObject?): ApiReply =
        withContext(Dispatchers.IO) {
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
                connection.readTimeout = RESPONSE_TIMEOUT_MS
                connection.setRequestProperty("Accept", "application/json")
                if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
                val bytes = body?.let { Json.encode(it).toByteArray(Charsets.UTF_8) }
                if (bytes != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    // 재전송을 위한 본문 버퍼링/인증·리다이렉트 재시도를 허용하지 않는다.
                    connection.setFixedLengthStreamingMode(bytes.size)
                }
                deadline(connection, CONNECT_TIMEOUT_MS) { connection.connect() }
                val status = deadline(connection, RESPONSE_TIMEOUT_MS) {
                    if (bytes != null) connection.outputStream.use { it.write(bytes); it.flush() }
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
                    throw ApiFailure("서버 응답 형식을 확인할 수 없습니다", status = status, uncertainWrite = method != "GET")
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
