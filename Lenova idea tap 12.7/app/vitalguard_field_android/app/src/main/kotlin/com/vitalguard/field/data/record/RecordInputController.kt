package com.vitalguard.field.data.record

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class RecordInputState(
    val note: String = "", val speechText: String = "", val candidates: List<String> = emptyList(), val choice: Int? = null,
    val speaking: Boolean = false, val saving: Boolean = false, val confirmed: Boolean = false, val loading: Boolean = true,
    val speechStatus: String = "음성 입력 대기", val error: String? = null, val notice: String? = null,
) {
    val composed get() = listOfNotNull(note.takeIf { it.isNotEmpty() }, speechText.takeIf { choice != null && it.isNotEmpty() }).joinToString("\n")
    val persistedText get() = if (confirmed && choice != null) composed else note
}
class RecordInputController(
    private val field: FieldController, private val queue: OutboxController, val media: CalendarMedia, val owner: String,
    private val speech: SpeechInput, recorder: VoiceRecorder, private val scope: CoroutineScope,
) : AutoCloseable {
    val key = "comment-draft:${media.id}:new"
    val voice = VoiceCommentDraft(field, queue, media.id, owner, recorder, scope, media.site_id)
    private val mutable = MutableStateFlow(RecordInputState())
    val state = mutable.asStateFlow()
    private val s get() = mutable.value
    private fun update(block: (RecordInputState) -> RecordInputState) { mutable.value = block(s) }
    private val session = RecordSession(field, queue, owner)
    private val writes = DraftWrites(scope)
    private var revision = System.currentTimeMillis() * 1000
    private var speechGeneration = 0
    private var runId: String? = null
    private val subscription = scope.launch(start = CoroutineStart.UNDISPATCHED) {
        try { speech.events.collect(::onSpeech)
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(speaking = false, error = "음성 입력 연결 실패: ${e.message}") } }
    }
    suspend fun restore() {
        require(media.json["local"] == true) { "로컬 사진에만 메모를 붙일 수 있습니다" }
        try {
            requireEditablePhoto(queue, media.id, owner)
            voice.restore()
            field.local.read(owner, key)?.let { raw ->
                val data = Json.decodeObject(raw)
                revision = (data["revision"] as? Number)?.toLong() ?: revision
                update { it.copy(note = data["text"] as? String ?: "") }
            }
            if (queue.account == owner) session.remember(media)
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { update { it.copy(error = "이전에 저장한 초안을 읽지 못했습니다") }
        } finally { update { it.copy(loading = false) } }
    }
    fun note(value: String) { if (!s.saving) { update { it.copy(note = value, confirmed = false) }; autosave() } }
    fun speechText(value: String) { if (!s.saving) { update { it.copy(speechText = value, confirmed = false) }; autosave() } }
    fun choose(index: Int) {
        if (!s.saving && index in s.candidates.indices) { update { it.copy(choice = index, speechText = it.candidates[index], confirmed = false) }; autosave() }
    }
    fun confirm(value: Boolean) { if (!s.saving && s.composed.isNotBlank()) { update { it.copy(confirmed = value) }; autosave() } }
    fun persist(): Deferred<Unit> {
        if (s.loading) return CompletableDeferred(Unit)
        val text = s.persistedText // 확인하지 않은 STT 후보는 메모 초안에도 쓰지 않는다.
        val snapshot = Json.encode(mapOf("text" to text, "status" to "draft", "revision" to revision, "mediaId" to media.id))
        return writes.submit { if (text.isEmpty()) field.local.remove(owner, key) else field.local.write(owner, key, snapshot) }
    }
    private fun autosave() {
        val pending = persist()
        scope.launch { try { pending.await() } catch (e: CancellationException) { throw e
        } catch (_: Exception) { update { it.copy(error = "초안 저장에 실패했습니다. 저장 공간을 확인해 주세요.") } } }
    }
    suspend fun stopSpeech() {
        ++speechGeneration; runId = null; update { it.copy(speaking = false) }
        speech.stop(cancel = true)
    }
    suspend fun finishSpeech() { if (s.speaking) speech.stop() }
    suspend fun flush() = supervisorScope {
        // 글 저장은 권한/녹음 종료보다 먼저 시작. 실패해도 다른 보존 작업은 끝낸다.
        val text = persist()
        val tasks = listOf(async { text.await() }, async { stopSpeech() }, async { voice.pause() })
        var failure: Exception? = null
        tasks.forEach { try { it.await() } catch (e: Exception) { if (failure == null) failure = e } }
        failure?.let { throw it }
    }
    suspend fun leave(): Boolean {
        if (s.loading || s.saving || voice.state.value.sending) return false
        return try { flush(); session.close(); true } catch (e: CancellationException) { throw e
        } catch (_: Exception) { update { it.copy(error = "초안 저장에 실패했습니다. 저장 공간을 확인해 주세요.") }; false }
    }
    suspend fun remember() { if (queue.account == owner) session.remember(media) }
    suspend fun startSpeech() {
        if (s.speaking || s.saving || s.loading || voice.state.value.audioBusy) return
        val expected = ++speechGeneration
        update { it.copy(speaking = true, error = null) }
        try {
            if (!speech.available()) {
                if (expected == speechGeneration) update { it.copy(speaking = false, error = "온디바이스 인식기를 사용할 수 없습니다. 직접 입력해 주세요.") }
                return
            }
            if (expected != speechGeneration) return
            runId = "record-${System.currentTimeMillis() * 1000 + expected}"
            update { it.copy(candidates = emptyList(), choice = null, confirmed = false, speechText = "", speechStatus = "마이크 준비 중") }
            autosave(); speech.start(requireNotNull(runId))
        } catch (e: CancellationException) { throw e
        } catch (_: Exception) { if (expected == speechGeneration) { runId = null; update { it.copy(speaking = false, error = "마이크 권한과 인식기 상태를 확인해 주세요") } } }
    }
    private fun onSpeech(e: JsonObject) {
        if (runId == null || e["runId"] != runId) return
        when (e["type"]) {
            "status" -> update { it.copy(speechStatus = when (e["state"]) { "ready" -> "말씀하세요"; "waiting_final" -> "후보를 받는 중"; else -> "음성 입력 중" }) }
            "partial" -> update { it.copy(speechStatus = "인식 중 · 아직 저장하지 않습니다") }
            "final" -> {
                val candidates = (e["results"] as? List<*>)?.filterIsInstance<String>()?.take(5).orEmpty()
                runId = null
                update { it.copy(candidates = candidates, choice = null, confirmed = false, speaking = false,
                    speechStatus = if (candidates.isEmpty()) "후보가 없습니다. 다시 말하거나 펜으로 기록해 주세요." else "맞는 후보를 고르고 문장을 확인하세요") }
            }
            "error" -> { runId = null; update { it.copy(speaking = false, error = "음성 인식 오류 ${e["code"]} · ${e["name"]}") } }
            "cancelled", "diagnostic_error" -> { runId = null; update { it.copy(speaking = false, speechStatus = "음성 입력이 중단됐습니다") } }
        }
    }
    suspend fun save() {
        if (!s.confirmed || s.composed.isBlank() || s.saving || voice.state.value.audioBusy) return
        val text = s.composed
        update { it.copy(saving = true, error = null, notice = null) }
        try {
            val photo = requireEditablePhoto(queue, media.id, owner)
            stopSpeech(); persist().await(); requireEditablePhoto(queue, media.id, owner)
            queue.enqueue(OutboxKind.text, text.toByteArray(Charsets.UTF_8), media.site_id?.let { mapOf("siteId" to it) }.orEmpty(),
                photo.siteName, owner, sourceKey = "comment-draft:${media.id}:$revision", dependsOn = media.id, draftKeys = listOf(key))
            revision++
            update { it.copy(note = "", speechText = "", candidates = emptyList(), choice = null, confirmed = false,
                notice = "메모 저장됨") }
            persist().await()
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = "메모를 저장하지 못했습니다: ${e.message}") }
        } finally { update { it.copy(saving = false) } }
    }
    override fun close() { ++speechGeneration; runId = null; subscription.cancel(); voice.close() }
}
