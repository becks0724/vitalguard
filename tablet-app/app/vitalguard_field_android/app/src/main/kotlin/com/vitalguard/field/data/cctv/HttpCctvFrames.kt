package com.vitalguard.field.data.cctv

import com.vitalguard.field.data.models.CctvTicket
import com.vitalguard.field.data.models.Json
import java.net.HttpURLConnection
import java.net.URI
import java.io.ByteArrayOutputStream
import java.io.PushbackInputStream
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.*

const val cctvUnreachable = "현장 장비에 연결되지 않습니다 (Wi-Fi·장비 전원 확인)"
interface CctvFrames {
    suspend fun fetch(ticket: CctvTicket): ByteArray
    suspend fun receive(ticket: CctvTicket, cameraId: String, intervalMillis: Int, onFrame: suspend (ByteArray) -> Unit) {
        onFrame(fetch(ticket))
    }
    fun cancel() {}
}

fun cctvStreamUri(gateApi: String, cameraId: String = "CAM-03"): URI {
    val suffix = when (cameraId) { "CAM-01" -> "1"; "CAM-03" -> "3"; else -> throw CctvFailure("등록되지 않은 카메라입니다") }
    if (gateApi.isBlank()) throw CctvFailure("현장 CCTV 주소가 설정되지 않았습니다")
    val uri = try { URI(gateApi.trim()) } catch (_: Exception) { throw CctvFailure("현장 CCTV 주소 형식이 올바르지 않습니다") }
    if (uri.scheme !in listOf("http", "https") || uri.host.isNullOrEmpty() || uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null)
        throw CctvFailure("현장 CCTV 주소 형식이 올바르지 않습니다")
    return URI(uri.scheme, null, uri.host, uri.port, uri.path.trimEnd('/') + "/cctv/stream$suffix", null, null)
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
    override suspend fun fetch(ticket: CctvTicket): ByteArray {
        var first: ByteArray? = null
        read(ticket, "CAM-03", 0, false) { first = it }
        return first ?: throw CctvFailure("받은 영상이 없습니다")
    }
    override suspend fun receive(ticket: CctvTicket, cameraId: String, intervalMillis: Int, onFrame: suspend (ByteArray) -> Unit) =
        read(ticket, cameraId, intervalMillis, true, onFrame)

    private suspend fun read(ticket: CctvTicket, cameraId: String, intervalMillis: Int, continuous: Boolean,
        onFrame: suspend (ByteArray) -> Unit) {
        val callbackContext = currentCoroutineContext()
        withContext(Dispatchers.IO) {
        val uri = cctvStreamUri(ticket.gateApi, cameraId)
        // Keep the native app's existing usesCleartextTraffic=false policy.
        if (uri.scheme != "https") throw CctvFailure("현장 CCTV 주소는 HTTPS가 필요합니다")
        val request = open(uri)
        if (!connection.compareAndSet(null, request)) { request.disconnect(); throw CctvFailure("영상 요청이 진행 중입니다") }
        val lastFrame = AtomicLong(System.nanoTime())
        val expires = minOf(ticket.expiresAt, System.currentTimeMillis() + ticket.ttlSec * 1000L)
        val alarm = watchdog.scheduleAtFixedRate({
            if (System.nanoTime() - lastFrame.get() > 15_000_000_000L || System.currentTimeMillis() >= expires) request.disconnect()
        }, 1, 1, TimeUnit.SECONDS)
        var delivered = false
        try {
            request.requestMethod = "GET"
            request.instanceFollowRedirects = false
            request.useCaches = false
            request.connectTimeout = 15_000; request.readTimeout = 15_000
            // Only the freshly issued read ticket goes to the gate, never an app session token.
            request.setRequestProperty("Authorization", "Bearer ${ticket.ticket}")
            when (request.responseCode) {
                200 -> request.inputStream.use { input ->
                    val stream = PushbackInputStream(input.buffered(), 256)
                    val multipart = request.contentType.orEmpty().substringBefore(';').trim().equals("multipart/x-mixed-replace", true)
                    var lastDisplay = 0L
                    do {
                        currentCoroutineContext().ensureActive()
                        val bytes = readCctvImage(stream, request.contentType)
                        lastFrame.set(System.nanoTime())
                        val now = System.nanoTime()
                        if (!delivered || now - lastDisplay >= intervalMillis * 1_000_000L) {
                            validateImage(bytes)
                            withContext(callbackContext) { onFrame(bytes) }
                            delivered = true; lastDisplay = now
                        }
                    } while (continuous && multipart && System.currentTimeMillis() < expires - 500)
                    if (continuous && !multipart) delay(maxOf(1000, intervalMillis).toLong())
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
        } catch (e: Exception) {
            // A used ticket is never replayed; a normal expiry asks the controller for a new one.
            if (!(continuous && delivered && System.currentTimeMillis() >= expires - 1000))
                throw if (e is CctvFailure) e else CctvFailure(cctvUnreachable)
        } finally {
            alarm.cancel(false); request.disconnect(); connection.compareAndSet(request, null)
        }
        }
    }
}
