package com.vitalguard.field.data.record

import com.vitalguard.field.data.*
import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class VoiceDraftState(
    val loading: Boolean = true, val starting: Boolean = false, val recording: Boolean = false, val stopping: Boolean = false,
    val sending: Boolean = false, val playing: Boolean = false, val working: Boolean = false, val elapsedMs: Int = 0,
    val clip: VoiceRecording? = null, val error: String? = null, val notice: String? = null,
) {
    val microphoneBusy get() = starting || recording || stopping
    val busy get() = loading || starting || stopping || sending || working
    val audioBusy get() = microphoneBusy || playing || busy
}
class VoiceCommentDraft(
    private val field: FieldController, private val queue: OutboxController, val mediaId: String, val owner: String,
    private val recorder: VoiceRecorder, private val scope: CoroutineScope, private var siteId: String? = null,
) : AutoCloseable {
    val key = "voice-comment-draft:$mediaId"
    val audioKey = "$key:audio"
    val recorderKey = Json.encode(listOf(owner, mediaId))
    private val mutable = MutableStateFlow(VoiceDraftState())
    val state = mutable.asStateFlow()
    private val s get() = mutable.value
    private fun update(block: (VoiceDraftState) -> VoiceDraftState) { mutable.value = block(s) }
    private var siteName = field.state.value.site?.site_name ?: "현장 정보 없음"
    private var operationId: String? = null
    private var recordingRevision = System.currentTimeMillis() * 1000
    private var audio: ByteArray? = null
    private var generation = 0
    private var pauseGeneration = 0
    private var ticker: Job? = null
    private val acceptance = Mutex()
    private val stopping = Mutex()
    private val writes = DraftWrites(scope)
    private val subscription = scope.launch(start = CoroutineStart.UNDISPATCHED) {
        recorder.events.collect { event ->
            when (event["type"]) {
                "stopped" -> if (s.microphoneBusy) accept(VoiceRecording.fromJson(event))
                "error" -> { endClock(); update { it.copy(stopping = false, error = event["message"] as? String ?: "녹음을 저장하지 못했습니다") } }
                "playbackStopped" -> update { it.copy(playing = false, error = event["message"] as? String ?: it.error) }
            }
        }
    }
    private fun message(error: Exception): String {
        if (error is ApiFailure) {
            if (error.code == "microphone_denied") return "마이크 권한이 필요합니다"
            val explanation = when (error.status) {
                401 -> "로그인이 만료되었습니다. 다시 로그인해 주세요."
                403 -> "이 사진에 음성 댓글을 남길 권한이 없습니다."
                404 -> "원본 사진을 찾을 수 없습니다. 삭제 여부를 확인해 주세요."
                else -> null
            }
            return if (explanation == null) error.message else "$explanation\n${error.message}"
        }
        return error.message ?: error.toString()
    }
    suspend fun restore() {
        try {
            field.local.read(owner, key)?.let { raw ->
                val data = Json.decodeObject(raw)
                operationId = data["clientOperationId"] as? String
                recordingRevision = (data["recordingRevision"] as? Number)?.toLong() ?: recordingRevision
                if (data.containsKey("siteId")) siteId = data["siteId"] as? String
                siteName = data["siteName"] as? String ?: "작성 현장명 미기록"
                data["clip"].jsonObjectOrNull()?.let { clip -> update { it.copy(clip = VoiceRecording.fromJson(clip)) } }
            }
            // sourceKey도 검사: enqueue 성공 후 operationId 쓰기 전에 죽은 경우의 중복을 막는다.
            val queued = queue.entry(operationId) ?: queue.dependents(mediaId).firstOrNull {
                it.kind == OutboxKind.voice && it.sourceKey == "$key:recording:$recordingRevision"
            }
            if (queued?.dependsOn == mediaId && queued.owner == owner) {
                s.clip?.let { recorder.cancel(it.path) }
                audio = null; operationId = null
                update { it.copy(clip = null, loading = false, notice = "이미 저장한 녹음은 사진 상세에서 확인할 수 있습니다.") }
                persist().await()
            }
            if (s.clip != null) {
                audio = field.local.readBytes(owner, audioKey)?.takeIf { it.isNotEmpty() } ?: recorder.read(s.clip!!.path)
                update { it.copy(notice = "저장 전 녹음을 복원했습니다. 들어본 뒤 저장해 주세요.") }
            } else if (recorder is RecoverableVoiceRecorder) {
                recorder.recoverDraft(recorderKey)?.let {
                    update { it.copy(loading = false) }; accept(it)
                    update { it.copy(notice = "중단된 녹음을 복원했습니다. 들어본 뒤 저장해 주세요.") }
                }
            }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = "기기 녹음을 읽지 못했습니다. 기존 파일은 보존됩니다. ${message(e)}") }
        } finally { update { it.copy(loading = false) } }
    }
    fun persist(): Deferred<Unit> {
        if (s.loading) return CompletableDeferred(Unit)
        val bytes = audio
        val empty = s.clip == null && !s.microphoneBusy
        val metadata = Json.encode(mapOf("mediaId" to mediaId, "status" to "draft", "clip" to s.clip?.toJson(),
            "clientOperationId" to operationId, "recordingRevision" to recordingRevision, "siteId" to siteId, "siteName" to siteName))
        return writes.submit {
            if (empty) { field.local.remove(owner, key); field.local.remove(owner, audioKey) }
            else { if (bytes != null) field.local.writeBytes(owner, audioKey, bytes); field.local.write(owner, key, metadata) }
        }
    }
    suspend fun start() {
        if (s.busy || s.recording || s.clip != null) return
        val expected = ++generation
        update { it.copy(starting = true, error = null, notice = null) }
        try {
            requireEditablePhoto(queue, mediaId, owner)
            persist().await()
            if (generation != expected || !s.starting) return
            if (recorder is RecoverableVoiceRecorder) recorder.startDraft(recorderKey) else recorder.start()
            if (generation != expected || !s.starting) return
            update { it.copy(starting = false, recording = true, elapsedMs = 0) }
            ticker = scope.launch { while (isActive && s.recording) { delay(1000); update { it.copy(elapsedMs = (it.elapsedMs + 1000).coerceAtMost(maxVoiceDurationMs)) } } }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { if (generation == expected) update { it.copy(starting = false, error = message(e)) } }
    }
    private fun endClock() { ticker?.cancel(); ticker = null; update { it.copy(starting = false, recording = false) } }
    private suspend fun accept(value: VoiceRecording) = acceptance.withLock {
        if (s.clip?.path == value.path && audio != null) return@withLock
        endClock()
        val fresh = s.clip?.path != value.path
        if (fresh) { recordingRevision++; operationId = null; audio = null }
        update { it.copy(stopping = true, clip = value, elapsedMs = value.durationMs, notice = when (value.reason) {
            "maxDuration" -> "최대 3분까지 녹음됩니다"
            "maxSize" -> "녹음 용량 한도에 도달해 정지했습니다"
            "background" -> "앱이 백그라운드로 전환되어 녹음을 정지했습니다"
            "recorderError" -> "녹음이 중단됐습니다. 저장된 소리를 확인해 주세요."
            else -> "들어본 뒤 저장해 주세요."
        }) }
        try { persist().await(); audio = recorder.read(value.path); persist().await()
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = "녹음 보존 상태를 확인해 주세요. ${message(e)}") }
        } finally { update { it.copy(stopping = false) } }
    }
    suspend fun stop() = stopping.withLock {
        if (!s.microphoneBusy) { acceptance.withLock { }; return@withLock }
        ++generation; endClock(); update { it.copy(stopping = true) }
        try { recorder.stop()?.let { accept(it) }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = message(e)) }
        } finally { update { it.copy(stopping = false) } }
    }
    suspend fun stopPlay() { recorder.stopPlay(); update { it.copy(playing = false) } }
    suspend fun pause() {
        ++pauseGeneration // 파일 읽기 뒤 늦게 완료된 미리듣기/다시 녹음은 시작하지 않는다.
        state.first { !it.working && !it.sending }
        stop(); stopPlay(); persist().await()
    }
    suspend fun preview() {
        if (s.busy || s.recording || s.clip == null) return
        val expected = pauseGeneration
        update { it.copy(working = true, error = null) }
        try {
            if (s.playing) stopPlay() else {
                val bytes = audio ?: recorder.read(s.clip!!.path).also { audio = it }
                if (expected != pauseGeneration) return
                update { it.copy(playing = true) }; recorder.play(bytes)
                if (expected != pauseGeneration) stopPlay()
            }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(playing = false, error = message(e)) }
        } finally { update { it.copy(working = false) } }
    }
    suspend fun discard() {
        if (s.busy) return
        ++generation; endClock(); update { it.copy(working = true, error = null, notice = null) }
        try {
            stopPlay(); recorder.cancel(s.clip?.path); audio = null; operationId = null
            update { it.copy(clip = null) }; persist().await()
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = "녹음 취소를 완료하지 못했습니다. ${message(e)}") }
        } finally { update { it.copy(working = false) } }
    }
    suspend fun rerecord() {
        val expected = pauseGeneration
        discard()
        if (expected == pauseGeneration && s.error == null) start()
    }
    suspend fun send() {
        if (s.busy || s.recording || s.clip == null) return
        update { it.copy(sending = true, error = null, notice = null) }
        try {
            val photo = requireEditablePhoto(queue, mediaId, owner)
            stopPlay()
            val clip = requireNotNull(s.clip)
            val bytes = audio ?: recorder.read(clip.path).also { audio = it }
            require(bytes.isNotEmpty() && bytes.size <= maxVoiceBytes && clip.durationMs in 0..maxVoiceDurationMs) { "재생할 녹음을 확인해 주세요" }
            persist().await(); requireEditablePhoto(queue, mediaId, owner)
            val item = queue.enqueue(OutboxKind.voice, bytes, buildMap { put("audioMs", "${clip.durationMs}"); siteId?.let { put("siteId", it) } },
                photo.siteName, owner, sourceKey = "$key:recording:$recordingRevision", dependsOn = mediaId, draftKeys = listOf(key, audioKey))
            operationId = item.id; persist().await(); recorder.cancel(clip.path)
            audio = null; operationId = null; update { it.copy(clip = null) }; persist().await()
            update { it.copy(notice = "음성을 기기에 저장했습니다. 사진 상세를 닫으면 자동으로 전송됩니다.") }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) { update { it.copy(error = message(e)) }
        } finally { update { it.copy(sending = false) } }
    }
    override fun close() { ++generation; subscription.cancel(); ticker?.cancel() }
}
