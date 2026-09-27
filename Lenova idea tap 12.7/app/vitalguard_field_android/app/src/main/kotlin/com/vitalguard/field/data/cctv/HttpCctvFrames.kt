package com.vitalguard.field.data.cctv

import com.vitalguard.field.data.models.CctvTicket
import com.vitalguard.field.data.models.Json
import java.net.HttpURLConnection
import java.net.URI
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*

const val cctvUnreachable = "현장 장비에 연결되지 않습니다 (Wi-Fi·장비 전원 확인)"
interface CctvFrames {
    suspend fun fetch(ticket: CctvTicket): ByteArray
    fun cancel() {}
}

fun cctvStreamUri(gateApi: String): URI {
    if (gateApi.isBlank()) throw CctvFailure("현장 CCTV 주소가 설정되지 않았습니다")
    val uri = try { URI(gateApi.trim()) } catch (_: Exception) { throw CctvFailure("현장 CCTV 주소 형식이 올바르지 않습니다") }
    if (uri.scheme !in listOf("http", "https") || uri.host.isNullOrEmpty() || uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null)
        throw CctvFailure("현장 CCTV 주소 형식이 올바르지 않습니다")
    return URI(uri.scheme, null, uri.host, uri.port, uri.path.trimEnd('/') + "/cctv/stream3", null, null)
}

class HttpCctvFrames(
    private val validateImage: (ByteArray) -> Unit,
    private val open: (URI) -> HttpURLConnection = { it.toURL().openConnection() as HttpURLConnection },
) : CctvFrames {
    companion object {
        private val watchdog = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "cctv-deadline").apply { isDaemon = true } }
    }
    private val connection = AtomicReference<HttpURLConnection?>()
    override fun cancel() { connection.get()?.disconnect() }
    override suspend fun fetch(ticket: CctvTicket): ByteArray = withContext(Dispatchers.IO) {
        val uri = cctvStreamUri(ticket.gateApi)
        // Keep the native app's existing usesCleartextTraffic=false policy.
        if (uri.scheme != "https") throw CctvFailure("현장 CCTV 주소는 HTTPS가 필요합니다")
        val request = open(uri)
        if (!connection.compareAndSet(null, request)) { request.disconnect(); throw CctvFailure("영상 요청이 진행 중입니다") }
        val alarm = watchdog.schedule({ request.disconnect() }, 15, TimeUnit.SECONDS)
        try {
            request.requestMethod = "GET"
            request.instanceFollowRedirects = false
            request.useCaches = false
            request.connectTimeout = 15_000; request.readTimeout = 15_000
            // Only the freshly issued read ticket goes to the gate, never an app session token.
            request.setRequestProperty("Authorization", "Bearer ${ticket.ticket}")
            when (request.responseCode) {
                200 -> request.inputStream.use { input ->
                    val bytes = readCctvImage(input.buffered(), request.contentType)
                    currentCoroutineContext().ensureActive()
                    validateImage(bytes)
                    bytes
                }
                401, 403 -> throw CctvFailure("현장 장비의 영상 접근이 거부되었습니다. 다시 시도합니다")
                404 -> throw CctvFailure("현장 장비에서 CCTV 영상을 찾을 수 없습니다")
                429 -> throw CctvFailure("요청이 많습니다. 잠시 후 다시 시도합니다")
                503 -> {
                    val raw = request.errorStream?.use { input ->
                        val out = ByteArrayOutputStream(); val buffer = ByteArray(512)
                        while (out.size() < 4096) {
                            val n = input.read(buffer, 0, minOf(buffer.size, 4096 - out.size()))
                            if (n < 0) break
                            out.write(buffer, 0, n)
                        }
                        out.toString("UTF-8").trim()
                    }.orEmpty()
                    val reason = runCatching { Json.decodeObject(raw)["error"] as? String }.getOrNull() ?: raw
                    throw CctvFailure(when (reason) {
                        "disabled" -> "현장에서 카메라를 꺼 두었습니다"
                        "too many viewers" -> "동시 접속이 많습니다"
                        else -> cctvUnreachable
                    })
                }
                else -> throw CctvFailure(cctvUnreachable)
            }
        } catch (e: CancellationException) { throw e
        } catch (e: CctvFailure) { throw e
        } catch (_: Exception) { throw CctvFailure(cctvUnreachable)
        } finally {
            alarm.cancel(false); request.disconnect(); connection.compareAndSet(request, null)
        }
    }
}
