package com.vitalguard.field.ui.record

import com.vitalguard.field.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

// Port: record_screens.dart의 활성 조건. UI와 JVM 테스트에서 같은 계산을 사용한다.
fun canDiscard(item: OutboxEntry) = item.phase == OutboxPhase.waiting || item.phase == OutboxPhase.failed
fun attachmentCounts(items: List<OutboxEntry>) = listOf(OutboxKind.ink to "주석", OutboxKind.text to "메모", OutboxKind.voice to "음성")
    .joinToString(" · ") { (kind, name) -> "$name ${items.count { it.kind == kind }}" }
data class PhotoActionAvailability(val processing: Boolean, val uncertain: Boolean, val reauthenticate: Boolean,
    val editable: Boolean, val deletable: Boolean, val sendable: Boolean)
fun photoActions(photo: OutboxEntry, attachments: List<OutboxEntry>, busyIds: Set<String>, offline: Boolean, busy: Boolean = false): PhotoActionAvailability {
    val members = listOf(photo) + attachments
    val processing = busy || members.any { it.id in busyIds || it.phase == OutboxPhase.sending }
    val uncertain = members.any { it.needsVerification || it.phase == OutboxPhase.uncertain }
    val reauthenticate = members.any { it.phase == OutboxPhase.reauthenticate }
    val editable = (canDiscard(photo) || (photo.phase == OutboxPhase.completed && photo.receipt?.get("id") is String)) && !processing && !uncertain && !reauthenticate
    val deletable = editable && members.all { canDiscard(it) || (photo.phase == OutboxPhase.completed && it.phase == OutboxPhase.completed) }
    return PhotoActionAvailability(processing, uncertain, reauthenticate, editable, deletable,
        members.any { it.phase == OutboxPhase.failed } && !processing && !offline && !uncertain && !reauthenticate)
}
data class RecordActionState(val busy: Boolean = false, val error: String? = null)
class RecordActions(private val queue: OutboxController, private val scope: CoroutineScope, private val onDeleted: (String) -> Unit = {}) {
    private val mutable = MutableStateFlow<Map<String, RecordActionState>>(emptyMap())
    val state = mutable.asStateFlow()
    fun stateKey(photo: OutboxEntry) = "${photo.owner}:${photo.id}"
    private fun run(photo: OutboxEntry, action: suspend () -> Unit) {
        val key = stateKey(photo)
        if (mutable.value[key]?.busy == true) return
        mutable.value = mutable.value + (key to RecordActionState(busy = true))
        scope.launch {
            var error: String? = null
            try { action()
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) { error = e.message ?: e.toString()
            } finally { mutable.value = mutable.value + (key to RecordActionState(error = error)) }
        }
    }
    fun send(photo: OutboxEntry) = run(photo) {
        if (!queue.field.state.value.offline) queue.sendBundle(photo.id, retry = true)
    }
    fun discard(photo: OutboxEntry, id: String = photo.id) = run(photo) {
        if (id == photo.id) {
            queue.deletePhoto(id)
            (photo.receipt?.get("id") as? String)?.let(onDeleted)
        } else queue.discard(id)
    }
}
