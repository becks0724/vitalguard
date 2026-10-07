package com.vitalguard.field.data.mock

import com.vitalguard.field.data.contracts.*
import com.vitalguard.field.data.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

// 마이크·파일·네트워크 없는 모의. TestScope의 가상 시간도 주입할 수 있다.
class MockVoiceRecorder(private val scope: CoroutineScope, private val now: () -> Long = { System.nanoTime() / 1_000_000 }) : RecoverableVoiceRecorder {
    private val mutable = MutableSharedFlow<JsonObject>(extraBufferCapacity = 16)
    override val events = mutable.asSharedFlow()
    private val files = mutableMapOf<String, ByteArray>()
    private val drafts = mutableMapOf<String, VoiceRecording>()
    private var key: String? = null
    private var startedAt: Long? = null
    private var last: VoiceRecording? = null
    private var sequence = 0
    private var limit: Job? = null
    private var playback: Job? = null
    override suspend fun start() = startDraft("")
    override suspend fun startDraft(draftKey: String) {
        check(startedAt == null) { "이미 녹음 중입니다" }
        key = draftKey; last = null; startedAt = now()
        limit = scope.launch { delay(maxVoiceDurationMs.toLong()); autoStop("maxDuration") }
    }
    fun autoStop(reason: String) {
        if (startedAt != null) mutable.tryEmit(finish(reason).toJson() + ("type" to "stopped"))
    }
    private fun finish(reason: String): VoiceRecording {
        limit?.cancel(); limit = null
        val duration = (now() - requireNotNull(startedAt)).coerceIn(0, maxVoiceDurationMs.toLong()).toInt()
        startedAt = null
        val path = "mock-voice-${++sequence}.m4a"
        val bytes = "MOCK VOICE $sequence".toByteArray()
        files[path] = bytes
        return VoiceRecording(path, if (reason == "maxDuration") maxVoiceDurationMs else duration, bytes.size, reason).also {
            last = it; key?.let { key -> drafts[key] = it }
        }
    }
    override suspend fun stop(): VoiceRecording? = if (startedAt != null) finish("manual") else last
    override suspend fun recoverDraft(draftKey: String): VoiceRecording? = drafts[draftKey]
    override suspend fun read(path: String): ByteArray = requireNotNull(files[path]) { "녹음 파일이 없습니다" }.copyOf()
    override suspend fun cancel(path: String?) {
        if (path == null && startedAt != null) finish("cancelled")
        val target = path ?: last?.path
        files.remove(target); drafts.entries.removeAll { it.value.path == target }
        if (last?.path == target) last = null
        stopPlay()
    }
    override suspend fun play(audio: ByteArray) {
        stopPlay(); playback = scope.launch { delay((last?.durationMs ?: 1000).coerceAtLeast(1).toLong()); mutable.emit(mapOf("type" to "playbackStopped")) }
    }
    override suspend fun stopPlay() { playback?.cancel(); playback = null }
    override fun close() { limit?.cancel(); playback?.cancel(); startedAt = null }
}
class MockSpeechInput : SpeechInput {
    private val mutable = MutableSharedFlow<JsonObject>(extraBufferCapacity = 16)
    override val events = mutable.asSharedFlow()
    override suspend fun available() = true
    override suspend fun start(runId: String) { mutable.emit(mapOf("type" to "final", "runId" to runId,
        "results" to listOf("가스 농도 추가 경보 발생", "가스 농도 초과 경보 발생", "가스 농도 추가 경부 발생"))) }
    override suspend fun stop(cancel: Boolean) { }
}
