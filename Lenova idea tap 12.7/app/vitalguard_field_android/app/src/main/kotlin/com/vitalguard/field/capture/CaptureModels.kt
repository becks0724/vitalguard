package com.vitalguard.field.capture

import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import com.vitalguard.field.data.models.asKstIso
import java.time.ZoneOffset
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.roundToLong

const val scannerPreparationMessage = "인터넷에 연결해 한 번 준비해 주세요"
const val cameraPermissionDeniedMessage = "카메라 권한이 거절되어 사진을 촬영하지 않았습니다."
const val captureProcessingMessage = "좌표·주소·글자를 확인하고 기기에 저장하는 중입니다."

enum class CaptureMode { photo, document }

class CaptureFailure(override val message: String) : Exception(message)

data class CaptureFix(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double? = null,
    val measuredAt: Instant? = null,
)

data class CaptureAddress(val text: String, val deviceEstimated: Boolean) {
    val stamped: String
        get() = text.oneLine() + if (deviceEstimated) " (기기 추정)" else ""
}

data class CapturedOriginal(val path: String, val capturedAt: Instant)

data class LocalCaptureFile(val id: String, val bytesKey: String)

data class CaptureTimings(
    val locationMs: Long,
    val addressMs: Long,
    val ocrMs: Long,
    val stampMs: Long,
    val saveMs: Long,
)

data class CaptureRecord(
    val file: LocalCaptureFile,
    val fields: Map<String, String>,
    val stampLines: List<String>,
    val timings: CaptureTimings,
)

data class CaptureRunResult(
    val failed: Int = 0,
    val records: List<CaptureRecord> = emptyList(),
    val lastError: String? = null,
) {
    val uploaded: Int get() = 0
    val queued: Int get() = records.size
    val queuedIds: List<String> get() = records.map { it.file.id }
    val detailPhotoId: String? get() = queuedIds.singleOrNull()?.takeIf { failed == 0 }
    val operationMessage: String
        get() = buildList {
            if (queued > 0) add("기기에 저장됨 · ${queued}건 · 상세를 닫으면 자동 전송됩니다")
            if (failed > 0) add("${failed}건 처리 실패")
            lastError?.let(::add)
        }.joinToString("\n")
}

private val kstStampFormatter = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss", Locale.ROOT)
    .withZone(ZoneOffset.ofHours(9))

fun captureKstStamp(instant: Instant): String = kstStampFormatter.format(instant)

fun captureKstIso(instant: Instant): String = captureKstStamp(instant).replace(' ', 'T') + "+09:00"

/** Flutter record_screens._recordTime: 오프셋 없는 기존 기록은 KST로 읽고 원문은 보존한다. */
fun captureRecordedTime(source: String?, zone: ZoneId = ZoneId.systemDefault()): String {
    if (source.isNullOrBlank()) return "촬영 시각 미기록"
    return try {
        val instant = OffsetDateTime.parse(asKstIso(source)).toInstant()
        kstStampFormatter.withZone(zone).format(instant)
    } catch (_: DateTimeParseException) {
        "시각 확인 불가"
    }
}

fun captureCoordinateDigits(accuracyMeters: Double?): Int = if ((accuracyMeters ?: 0.0) > 10) 5 else 6

fun captureStampLines(
    capturedAt: Instant,
    fix: CaptureFix?,
    address: CaptureAddress?,
    workerName: String,
    workerId: String,
): List<String> = buildList {
    add("[${captureKstStamp(capturedAt)}]")
    if (address != null && address.text.isNotBlank()) add(address.stamped)
    if (fix == null) {
        add("위치 미확보")
    } else {
        val digits = captureCoordinateDigits(fix.accuracyMeters)
        val accuracy = fix.accuracyMeters?.takeIf { it > 0 }
            ?.let { " (±${it.roundToLong()}m)" }.orEmpty()
        // Dart Duration.inSeconds는 0 쪽으로 절삭한다. 기기 시간대와 무관하게 Instant로 비교.
        val ageSeconds = fix.measuredAt?.let {
            (Duration.between(it, capturedAt).toMillis() / 1000).coerceIn(0L, 1L shl 31)
        } ?: 0L
        val age = if (ageSeconds >= 60) " (${(ageSeconds / 60.0).roundToLong()}분 전 좌표)" else ""
        add("${fix.latitude.fixed(digits)}, ${fix.longitude.fixed(digits)}$accuracy$age")
    }
    add("작업자/ID: ${workerName.oneLine()}, ${workerId.oneLine()}")
}

fun captureUploadFields(
    capturedAt: Instant,
    title: String,
    ocrText: String,
    fix: CaptureFix?,
    address: CaptureAddress?,
    siteId: String? = null,
): Map<String, String> = buildMap {
    put("dateKey", captureKstStamp(capturedAt).take(10))
    put("capturedAt", captureKstIso(capturedAt))
    put("title", title)
    put("ocrText", ocrText)
    address?.let { put("roadAddress", it.stamped) }
    fix?.let {
        put("latitude", it.latitude.fixed(6))
        put("longitude", it.longitude.fixed(6))
    }
    if (!siteId.isNullOrEmpty()) put("siteId", siteId)
    // uploader·workerName·workerId는 넣지 않는다. 본 앱에서는 JWT 사용자에게 귀속한다.
}

private fun String.oneLine(): String = replace(Regex("[\r\n]+"), " ").trim()
private fun Double.fixed(digits: Int): String = String.format(Locale.ROOT, "%.${digits}f", this)
