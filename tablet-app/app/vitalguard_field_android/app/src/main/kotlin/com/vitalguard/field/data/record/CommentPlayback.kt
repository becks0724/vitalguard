package com.vitalguard.field.data.record

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

interface CommentAudioPlayer {
    suspend fun play(bytes: ByteArray, onStopped: (String?) -> Unit)
    fun stop()
}
data class CommentPlaybackState(val activeId: String? = null, val loading: Boolean = false,
    val errors: Map<String, String> = emptyMap())

/** 한 상세에서 하나만 재생한다. 늦은 다운로드/플레이어 콜백은 새 댓글 또는 닫힌 화면을 건드리지 않는다. */
class CommentPlaybackController(private val field: FieldController, private val player: CommentAudioPlayer,
    private val scope: CoroutineScope) : AutoCloseable {
    private val mutable = MutableStateFlow(CommentPlaybackState())
    val state = mutable.asStateFlow()
    private var generation = 0
    private var work: Job? = null
    fun toggle(comment: MediaComment) {
        val stopping = mutable.value.activeId == comment.id
        stop()
        if (stopping) return
        val expected = generation
        mutable.value = mutable.value.copy(activeId = comment.id, loading = true,
            errors = mutable.value.errors - comment.id)
        work = scope.launch {
            try {
                val bytes = field.voiceBytes(comment)
                ensureActive()
                if (expected != generation) return@launch
                player.play(bytes) { message ->
                    if (expected == generation) finish(comment.id, message)
                }
                if (expected == generation) mutable.value = mutable.value.copy(loading = false)
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                if (expected == generation) { player.stop(); finish(comment.id, e.message ?: "음성을 재생하지 못했습니다") }
            }
        }
    }
    private fun finish(id: String, error: String?) {
        mutable.value = mutable.value.copy(activeId = null, loading = false,
            errors = if (error == null) mutable.value.errors else mutable.value.errors + (id to error))
    }
    fun stop() {
        generation++; work?.cancel(); player.stop()
        mutable.value = mutable.value.copy(activeId = null, loading = false)
    }
    fun clearErrors() { mutable.value = mutable.value.copy(errors = emptyMap()) }
    override fun close() = stop()
}
