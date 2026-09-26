package com.vitalguard.field

import com.vitalguard.field.capture.*

import java.time.Instant

internal val capturedAt: Instant = Instant.parse("2026-08-19T05:07:17Z")

/** capture_ocr_test.dart의 _PipelinePort. upload 이벤트만 save-local로 바꾸었다. */
internal open class FakeCapturePort : CapturePipelinePort {
    var fix: CaptureFix? = null
    var server: String? = null
    var device: String? = null
    var recognized = "안전난간 점검"
    var locationFailure = false
    var serverFailure = false
    var deviceFailure = false
    val ocrFailures = mutableSetOf<String>()
    val stampFailures = mutableSetOf<String>()
    val saveFailures = mutableSetOf<String>()
    val calls = mutableListOf<String>()
    val savedFields = mutableListOf<Map<String, String>>()
    val savedBytes = mutableListOf<ByteArray>()

    override suspend fun requestLocation(): CaptureFix? {
        calls += "location"
        if (locationFailure) throw CaptureFailure("위치 실패")
        return fix
    }

    override suspend fun serverAddress(fix: CaptureFix): String? {
        calls += "server-address"
        if (serverFailure) throw CaptureFailure("서버 주소 실패")
        return server
    }

    override suspend fun deviceAddress(fix: CaptureFix): String? {
        calls += "device-address"
        if (deviceFailure) throw CaptureFailure("기기 주소 실패")
        return device
    }

    override suspend fun recognizeOriginal(path: String): String {
        calls += "ocr:$path"
        if (path in ocrFailures) throw CaptureFailure("OCR 실패")
        return recognized
    }

    override suspend fun stampResizeJpeg(path: String, stampLines: List<String>): ByteArray {
        calls += "stamp-resize:$path"
        if (path in stampFailures) throw CaptureFailure("각인 실패")
        return byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xd9.toByte())
    }

    override suspend fun saveLocal(jpeg: ByteArray, fields: Map<String, String>): LocalCaptureFile {
        calls += "save-local"
        if (fields["title"] in saveFailures) throw CaptureFailure("저장 실패")
        savedFields += fields.toMap()
        savedBytes += jpeg.copyOf()
        val id = "capture-${savedFields.size}"
        return LocalCaptureFile(id, "outbox-file:$id")
    }
}

internal suspend fun CapturePipeline.runCapture(
    paths: List<String> = listOf("/original/full-resolution.jpg"),
    mode: CaptureMode = CaptureMode.photo,
    siteId: String? = null,
): CaptureRunResult = process(paths, capturedAt, mode, "홍길동", "EMP-6861", siteId)

internal fun pipeline(port: CapturePipelinePort): CapturePipeline = CapturePipeline(port, deleteOriginal = {})
