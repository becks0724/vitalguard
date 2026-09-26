package com.vitalguard.field.pilot.capture

import java.io.File
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/** Flutter CapturePipelinePort와 같은 경계. upload만 앱 전용 저장으로 바꾼다. */
interface CapturePipelinePort {
    suspend fun requestLocation(): CaptureFix?
    suspend fun serverAddress(fix: CaptureFix): String?
    suspend fun deviceAddress(fix: CaptureFix): String?
    suspend fun recognizeOriginal(path: String): String
    suspend fun stampResizeJpeg(path: String, stampLines: List<String>): ByteArray
    suspend fun saveLocal(jpeg: ByteArray, fields: Map<String, String>): LocalCaptureFile
}

/** Android API에 의존하지 않는 순수 Kotlin/JVM 파이프라인. */
class CapturePipeline(
    private val port: CapturePipelinePort,
    private val nanoTime: () -> Long = System::nanoTime,
    private val deleteOriginal: suspend (String) -> Unit = { path ->
        withContext(Dispatchers.IO) { File(path).delete() }
        Unit
    },
) {
    suspend fun process(
        originalPaths: List<String>,
        capturedAt: Instant,
        mode: CaptureMode,
        workerName: String,
        workerId: String,
        siteId: String? = null,
    ): CaptureRunResult {
        if (originalPaths.isEmpty()) return CaptureRunResult()
        try {
            // 촬영 직후 위치부터 요청한다. 실패해도 사진 처리 자체를 실패시키지 않는다.
            val locationStart = nanoTime()
            val fix = optional { port.requestLocation() }
            val locationMs = elapsedMs(locationStart)
            val addressStart = nanoTime()
            var address: CaptureAddress? = null
            if (fix != null) {
                optional { port.serverAddress(fix) }?.trim()?.takeIf { it.isNotEmpty() }
                    ?.let { address = CaptureAddress(it, deviceEstimated = false) }
                if (address == null) {
                    optional { port.deviceAddress(fix) }?.trim()?.takeIf { it.isNotEmpty() }
                        ?.let { address = CaptureAddress(it, deviceEstimated = true) }
                }
            }
            val addressMs = elapsedMs(addressStart)
            val lines = captureStampLines(capturedAt, fix, address, workerName, workerId)
            var failed = 0
            var lastError: String? = null
            val records = mutableListOf<CaptureRecord>()
            originalPaths.forEachIndexed { index, path ->
                try {
                    // ★ 원본 경로의 OCR이 끝난 뒤에만 리사이즈/각인을 실행한다.
                    val ocrStart = nanoTime()
                    val recognized = port.recognizeOriginal(path).trim()
                    val ocrMs = elapsedMs(ocrStart)
                    val pageText = "페이지 ${index + 1}\n${recognized.ifEmpty { "[텍스트 미검출]" }}"
                    val ocrText = (listOf(pageText) + lines).joinToString("\n")
                    val stampStart = nanoTime()
                    val jpeg = port.stampResizeJpeg(path, lines)
                    val stampMs = elapsedMs(stampStart)
                    val title = if (mode == CaptureMode.photo) "현장 사진" else "서류 스캔 · 페이지 ${index + 1}"
                    val fields = captureUploadFields(capturedAt, title, ocrText, fix, address, siteId)
                    val saveStart = nanoTime()
                    val file = port.saveLocal(jpeg, fields)
                    val saveMs = elapsedMs(saveStart)
                    records += CaptureRecord(
                        file, fields, lines,
                        CaptureTimings(locationMs, addressMs, ocrMs, stampMs, saveMs),
                    )
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    failed++
                    lastError = if (error is CaptureFailure) error.message else error.toString()
                }
            }
            return CaptureRunResult(failed, records.toList(), lastError)
        } finally {
            // Flutter DeviceCaptureLauncher._process의 finally를 이 경계로 옮겼다.
            // 성공/실패한 모든 원본을 배치 처리 후 정리한다. 보관한 JPEG/JSON은 지우지 않는다.
            withContext(NonCancellable) {
                originalPaths.forEach { path ->
                    try { deleteOriginal(path) } catch (_: Exception) { /* 원본과 같은 best effort */ }
                }
            }
        }
    }

    private fun elapsedMs(start: Long): Long = ((nanoTime() - start) / 1_000_000).coerceAtLeast(0)

    private suspend fun <T> optional(block: suspend () -> T?): T? = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
}
