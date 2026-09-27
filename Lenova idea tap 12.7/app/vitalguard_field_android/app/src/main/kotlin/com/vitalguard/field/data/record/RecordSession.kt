package com.vitalguard.field.data.record

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*

data class RecordRecovery(val media: CalendarMedia, val ink: Boolean)
class RecordSession(private val field: FieldController, private val outbox: OutboxController, val owner: String) {
    suspend fun remember(media: CalendarMedia, ink: Boolean = false) {
        field.local.write(owner, recordSessionKey, Json.encode(mapOf("ink" to ink,
            "media" to media.json + mapOf("media_url" to null, "thumbnail_url" to null))))
    }
    suspend fun read(): RecordRecovery? {
        val raw = field.local.read(owner, recordSessionKey)?.takeIf { it.isNotEmpty() } ?: return null
        val saved = Json.decodeObject(raw)
        outbox.load()
        outbox.loadError.value?.let { error(it) }
        if (outbox.account != owner) return null
        val media = requireNotNull(saved["media"].jsonObjectOrNull())
        val photo = outbox.entry(media["id"] as? String)
        if (media["local"] != true || photo == null || photo.owner != owner || photo.kind != OutboxKind.photo || photo.phase == OutboxPhase.completed) {
            close(); return null
        }
        return RecordRecovery(fromOutbox(photo), saved["ink"] == true)
    }
    suspend fun close() = field.local.remove(owner, recordSessionKey)
}
fun requireEditablePhoto(outbox: OutboxController, id: String, owner: String): OutboxEntry {
    val photo = outbox.entry(id)
    if (outbox.account != owner || photo == null || photo.owner != owner || photo.kind != OutboxKind.photo || photo.needsVerification || outbox.isBusy(photo) ||
        photo.phase !in setOf(OutboxPhase.waiting, OutboxPhase.failed)) {
        throw ApiFailure("전송 전 사진만 편집할 수 있습니다. 전송 상태를 확인해 주세요.")
    }
    return photo
}

// 스냅샷은 호출 시점에 만든다. 실패한 쓰기 뒤에도 다음 스냅샷을 순서대로 쓴다.
// Supervisor를 써서 async의 저장 실패가 ViewModel의 다른 작업을 취소하지 않게 한다.
internal class DraftWrites(private val scope: CoroutineScope) {
    private var tail: Deferred<Unit>? = null
    fun submit(block: suspend () -> Unit): Deferred<Unit> {
        val previous = tail
        val result = CompletableDeferred<Unit>()
        tail = result
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                try { previous?.await() } catch (e: CancellationException) { throw e } catch (_: Exception) { }
                block()
                result.complete(Unit)
            } catch (e: Exception) { result.completeExceptionally(e); if (e is CancellationException) throw e }
        }
        return result
    }
}
