package com.vitalguard.field.data.contracts

import com.vitalguard.field.data.models.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

const val maxVoiceDurationMs = 180_000
fun voiceTime(ms: Int): String = "${ms / 60000}:${((ms / 1000) % 60).toString().padStart(2, '0')}"
data class VoiceRecording(val path: String, val durationMs: Int, val byteLength: Int, val reason: String = "manual") {
    fun toJson(): JsonObject = mapOf("path" to path, "durationMs" to durationMs, "byteLength" to byteLength, "reason" to reason)
    companion object {
        fun fromJson(json: JsonObject) = VoiceRecording(json["path"] as String, (json["durationMs"] as Number).toInt(),
            (json["byteLength"] as Number).toInt(), json["reason"] as? String ?: "manual")
    }
}
interface VoiceRecorder : AutoCloseable {
    val events: Flow<JsonObject>
    suspend fun start()
    suspend fun stop(): VoiceRecording?
    suspend fun cancel(path: String? = null)
    suspend fun read(path: String): ByteArray
    suspend fun play(audio: ByteArray)
    suspend fun stopPlay()
    override fun close()
}
interface RecoverableVoiceRecorder : VoiceRecorder {
    suspend fun startDraft(draftKey: String)
    suspend fun recoverDraft(draftKey: String): VoiceRecording?
}
class UnavailableVoiceRecorder : VoiceRecorder {
    override val events = emptyFlow<JsonObject>()
    override suspend fun start(): Unit = throw UnsupportedOperationException("이 기기에서는 녹음할 수 없습니다")
    override suspend fun stop(): VoiceRecording? = null
    override suspend fun cancel(path: String?) { }
    override suspend fun read(path: String): ByteArray = throw UnsupportedOperationException("녹음 파일이 없습니다")
    override suspend fun play(audio: ByteArray): Unit = throw UnsupportedOperationException("재생할 수 없습니다")
    override suspend fun stopPlay() { }
    override fun close() { }
}
interface SpeechInput : AutoCloseable {
    val events: Flow<JsonObject>
    suspend fun available(): Boolean
    suspend fun start(runId: String)
    suspend fun stop(cancel: Boolean = false)
    override fun close() { }
}
