package com.vitalguard.field

// Ports: outbox_test.dart / outbox_bundle_test.dart의 모의·지연·저장 실패 경계.
import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import com.vitalguard.field.data.mock.*
import com.vitalguard.field.data.session.FieldCoordinator
import kotlinx.coroutines.*
import kotlinx.coroutines.test.TestScope
import org.junit.Assert.*

val PHOTO_BYTES = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 7)
val PHOTO_FIELDS = mapOf("dateKey" to "2026-09-17", "capturedAt" to "2026-09-17T09:00:00+09:00",
    "siteId" to "site-a", "title" to "작업 사진", "ocrText" to "원래 문구", "roadAddress" to "작성 당시 주소")
data class WriteCall(val kind: OutboxKind, val bytes: ByteArray, val fields: Map<String, String>)
open class OutboxGateway : MockGateway() {
    override val isMock = false
    val writes = mutableListOf<WriteCall>()
    var failKind: OutboxKind? = null
    var writeFailure: ApiFailure? = null
    var gate: CompletableDeferred<Unit>? = null
    var expireOnce = false
    var refreshes = 0
    var statusFailure: ApiFailure? = null
    var duplicate = false
    override suspend fun refresh(refreshToken: String): MobileSession { refreshes++; return super.refresh(refreshToken) }
    override suspend fun siteStatus(accessToken: String): SiteStatus {
        statusFailure?.let { throw it }; return super.siteStatus(accessToken)
    }
    private suspend fun record(call: WriteCall) {
        writes += call
        if (expireOnce && writes.size == 1) throw ApiFailure("만료", status = 401, action = "refresh")
        if (failKind == null || failKind == call.kind) writeFailure?.let { throw it }
        gate?.await()
    }
    override suspend fun upload(token: String, bytes: ByteArray, fields: Map<String, String>): CalendarMedia {
        record(WriteCall(if (fields.containsKey("annotationOf")) OutboxKind.ink else OutboxKind.photo, bytes.copyOf(), fields.toMap()))
        val result = super.upload(token, bytes, fields)
        return CalendarMedia(result.json, result.clientOperationId, duplicate || result.deduplicated)
    }
    override suspend fun addComment(token: String, mediaId: String, body: String, clientOperationId: String?): MediaComment {
        record(WriteCall(OutboxKind.text, body.toByteArray(), mapOf("mediaId" to mediaId, "clientOperationId" to clientOperationId.orEmpty())))
        return super.addComment(token, mediaId, body, clientOperationId)
    }
    override suspend fun voiceComment(token: String, mediaId: String, audio: ByteArray, durationMs: Int?, clientOperationId: String?, siteId: String?): MediaComment {
        record(WriteCall(OutboxKind.voice, audio.copyOf(), buildMap {
            put("commentOf", mediaId); put("clientOperationId", clientOperationId.orEmpty())
            durationMs?.let { put("audioMs", "$it") }; siteId?.let { put("siteId", it) }
        }))
        // 조회로만 부모를 확인한 경우에도 서버에 존재하는 사진처럼 응답한다.
        return MediaComment(mapOf("id" to "voice-${writes.size}", "media_id" to mediaId, "body" to "", "audio_ms" to durationMs), clientOperationId)
    }
}
class LookupOutboxGateway : OutboxGateway(), OperationLookupGateway {
    val queries = mutableListOf<List<String>>()
    var lookupFailure: Exception? = null
    var lookupGate: CompletableDeferred<Map<String, OperationCheck>>? = null
    var lookupResult = OperationCheck(OperationPresence.unknown)
    override suspend fun lookupOperations(token: String, clientOperationIds: List<String>): Map<String, OperationCheck> {
        queries += clientOperationIds.toList()
        lookupFailure?.let { throw it }
        return lookupGate?.await() ?: clientOperationIds.associateWith { lookupResult }
    }
}
class FaultStore : MemoryStore() {
    var fails: (String, ByteArray) -> Boolean = { _, _ -> false }
    val writtenKeys = mutableListOf<String>()
    override suspend fun writeBytes(accountId: String, key: String, bytes: ByteArray) {
        if (fails(key, bytes)) error("저장 공간 부족")
        writtenKeys += key
        super.writeBytes(accountId, key, bytes)
    }
}
class OutboxRig(val field: FieldCoordinator, var box: OutboxController, val store: MemoryStore,
    val gateway: OutboxGateway, val clock: MutableClock, val scope: CoroutineScope) {
    suspend fun photo(sourceKey: String? = null, fields: Map<String, String> = PHOTO_FIELDS) =
        box.enqueue(OutboxKind.photo, PHOTO_BYTES, fields, "작성 현장 A", sourceKey = sourceKey)
    suspend fun offline(value: Boolean = true) {
        gateway.statusFailure = if (value) ApiFailure("연결 불가") else null
        try { field.siteStatus() } catch (_: ApiFailure) { }
    }
    suspend fun restore(entries: List<OutboxEntry> = box.items.value) {
        store.write("a", outboxStorageKey, Json.encode(mapOf("schemaVersion" to 1, "items" to entries.map { it.toJson() })))
        box.close()
        box = OutboxController(field, scope, clock)
        box.load()
    }
}
suspend fun TestScope.outboxRig(gateway: OutboxGateway = OutboxGateway(), store: MemoryStore = FaultStore()): OutboxRig {
    val clock = MutableClock(java.time.Instant.parse("2026-09-26T00:00:00Z"))
    val field = FieldCoordinator(gateway, store, backgroundScope, clock)
    field.signIn("a", "mock")
    val box = OutboxController(field, backgroundScope, clock)
    box.load()
    return OutboxRig(field, box, store, gateway, clock, backgroundScope)
}
data class Bundle(val photo: OutboxEntry, val ink: OutboxEntry, val text: OutboxEntry, val voice: OutboxEntry) {
    val all get() = listOf(photo, ink, text, voice)
}
suspend fun OutboxRig.bundle(): Bundle {
    val photo = photo()
    val ink = box.enqueue(OutboxKind.ink, "{\"v\":1}".toByteArray(), mapOf("siteId" to "wrong"), "작성 현장 A",
        dependsOn = photo.id, annotationDraftId = "draft-1", draftKeys = listOf("ink:draft"), previewBytes = byteArrayOf(9))
    val text = box.enqueue(OutboxKind.text, "한글 메모\n안전 점검".toByteArray(), emptyMap(), "작성 현장 A", dependsOn = photo.id,
        draftKeys = listOf("comment-draft:${photo.id}:new"))
    val voice = box.enqueue(OutboxKind.voice, byteArrayOf(1, 2), mapOf("audioMs" to "1234"), "작성 현장 A", dependsOn = photo.id)
    return Bundle(photo, ink, text, voice)
}
suspend fun rejects(block: suspend () -> Any?) {
    var thrown = false
    try { block() } catch (_: Exception) { thrown = true }
    assertTrue("Expected a rejected operation", thrown)
}
