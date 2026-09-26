package com.vitalguard.field.data.models

import com.vitalguard.field.data.OutboxEntry
import com.vitalguard.field.data.OutboxKind
import com.vitalguard.field.data.contracts.FieldController
import java.time.*
import java.time.format.DateTimeFormatter
import java.util.Locale

// Port: lib/data/models/record_origin.dart. 기기 시간대와 무관한 촬영 KST 계약.
fun fromOutbox(photo: OutboxEntry): CalendarMedia {
    require(photo.kind == OutboxKind.photo) { "사진 항목이 필요합니다" }
    val fields = photo.fields
    return CalendarMedia(mapOf(
        "id" to photo.id, "date_key" to fields["dateKey"], "captured_at" to fields["capturedAt"],
        "title" to fields["title"], "site_id" to fields["siteId"], "ocr_text" to fields["ocrText"],
        "road_address" to fields["roadAddress"], "latitude" to fields["latitude"]?.toDoubleOrNull(),
        "longitude" to fields["longitude"]?.toDoubleOrNull(), "media_url" to null, "thumbnail_url" to null, "local" to true,
    ))
}
const val maxInkUploadBytes = 2_097_152
const val maxVoiceBytes = 10 * 1024 * 1024
fun inkUploadSizeError(byteLength: Int): String? = if (byteLength > maxInkUploadBytes)
    "잉크 크기 ${String.format(Locale.ROOT, "%.1f", byteLength / 1024.0)} KB가 전송 한도 2 MB (2,097,152바이트)를 넘었습니다. 기기에는 저장됩니다. 획을 줄인 뒤 다시 저장해 주세요." else null
fun calendarDate(date: LocalDate): String = date.toString()
fun calendarDate(date: LocalDateTime): String = calendarDate(date.toLocalDate())
fun kstNow(clock: Clock = Clock.systemUTC()): LocalDateTime = LocalDateTime.ofInstant(clock.instant(), ZoneOffset.ofHours(9))
fun asKstIso(source: String): String {
    val zoned = Regex("(Z|[+-]\\d{2}:?\\d{2})$").containsMatchIn(source)
    val normalized = source.replace(Regex("([+-]\\d{2})(\\d{2})$"), "$1:$2")
        .replace(Regex("^(\\d{4}-\\d{2}-\\d{2}) "), "$1T").replace(',', '.')
    val instant = if (zoned) OffsetDateTime.parse(normalized).toInstant()
        else LocalDateTime.parse(normalized).toInstant(ZoneOffset.ofHours(9))
    val local = instant.atOffset(ZoneOffset.ofHours(9))
    // Dart ISO는 밀리초 3자리, 마이크로초가 있으면 6자리까지 보존한다.
    val micros = local.nano / 1000
    val fraction = if (micros % 1000 == 0) String.format(Locale.ROOT, "%03d", micros / 1000)
        else String.format(Locale.ROOT, "%06d", micros)
    return local.format(DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss", Locale.ROOT)) + ".$fraction+09:00"
}
fun annotationFields(original: CalendarMedia): Map<String, String> = buildMap {
    put("dateKey", original.date_key)
    put("annotationOf", original.id)
    put("title", "현장 이미지 (주석) — 원본 ${original.captured_at ?: original.date_key} · ${original.id}")
    original.captured_at?.let { put("capturedAt", asKstIso(it)) }
    original.site_id?.let { put("siteId", it) }
    original.ocr_text?.let { put("ocrText", it) }
    original.road_address?.let { put("roadAddress", it) }
    original.latitude?.let { put("latitude", "$it") }
    original.longitude?.let { put("longitude", "$it") }
}

// Port: record_session.dart의 정리 함수만. 편집/입력/세션 복구 자체는 2b.
const val recordSessionKey = "record:active-draft"
fun localRecordDraftKeys(photoId: String) = listOf(
    "annotation:$photoId", "annotation-base:$photoId", "comment-draft:$photoId:new",
    "voice-comment-draft:$photoId", "voice-comment-draft:$photoId:audio",
)
suspend fun clearLocalRecordDrafts(controller: FieldController, photoId: String, owner: String? = null) {
    val account = owner ?: controller.state.value.user?.id ?: return
    localRecordDraftKeys(photoId).forEach { controller.local.remove(account, it) }
    val raw = controller.local.read(account, recordSessionKey)
    if (!raw.isNullOrEmpty() && Json.decodeObject(raw)["media"].jsonObjectOrNull()?.get("id") == photoId) {
        controller.local.remove(account, recordSessionKey)
    }
}
